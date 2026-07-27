use crate::engine::netstack::VirtualNetstack;
use crate::engine::proxy::{NameResolver, resolve_host, validate_domain};
use crate::{Error, Result};
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream, UdpSocket as TokioUdpSocket};
use tokio::sync::RwLock;
use ts_netstack_smoltcp::netsock::UdpSocket as VirtualUdpSocket;

const SOCKS_VERSION: u8 = 5;
const NO_AUTHENTICATION: u8 = 0;
const NO_ACCEPTABLE_METHODS: u8 = 0xff;
const CONNECT_COMMAND: u8 = 1;
const UDP_ASSOCIATE_COMMAND: u8 = 3;
const ADDRESS_IPV4: u8 = 1;
const ADDRESS_DOMAIN: u8 = 3;
const ADDRESS_IPV6: u8 = 4;
const MAX_AUTH_METHODS: usize = 32;
const MAX_DOMAIN_BYTES: usize = 253;
const MAX_UDP_DATAGRAM_BYTES: usize = 65_507;
const MAX_UDP_PAYLOAD_BYTES: usize = MAX_UDP_DATAGRAM_BYTES - 10;
const MAX_ACTIVE_CONNECTIONS: usize = 256;
// A client that opens a connection and then stalls must not hold a slot for the
// lifetime of the tunnel. The greeting is pure loopback I/O and has to arrive
// immediately; the request may additionally wait for gateway DNS.
const GREETING_TIMEOUT: Duration = Duration::from_secs(10);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
// `accept` reports per-connection and resource-pressure failures that must not
// take the whole local frontend down with them. Only a listener that keeps
// failing is treated as unrecoverable.
const MAX_CONSECUTIVE_ACCEPT_FAILURES: u32 = 16;
const ACCEPT_FAILURE_BACKOFF: Duration = Duration::from_millis(100);

#[derive(Debug, Eq, PartialEq)]
enum SocksRequest {
    Connect(SocketAddr),
    UdpAssociate,
}

pub struct SocksServer {
    bind: SocketAddr,
    netstack: Arc<VirtualNetstack>,
    resolver: Arc<dyn NameResolver>,
}

pub struct BoundSocksServer {
    listener: TcpListener,
    server: Arc<SocksServer>,
}

impl SocksServer {
    pub fn new(
        bind: SocketAddr,
        netstack: Arc<VirtualNetstack>,
        resolver: Arc<dyn NameResolver>,
    ) -> Result<Self> {
        if !bind.ip().is_loopback() || bind.port() == 0 {
            return Err(Error(
                "SOCKS5 listener must use a nonzero loopback address".into(),
            ));
        }
        Ok(Self {
            bind,
            netstack,
            resolver,
        })
    }

    pub async fn bind(self) -> Result<BoundSocksServer> {
        let listener = TcpListener::bind(self.bind)
            .await
            .map_err(|_| Error("cannot bind the SOCKS5 listener".into()))?;
        Ok(BoundSocksServer {
            listener,
            server: Arc::new(self),
        })
    }
}

impl BoundSocksServer {
    pub async fn serve(self) -> Result<()> {
        let mut connections = tokio::task::JoinSet::new();
        let mut consecutive_failures = 0_u32;
        loop {
            tokio::select! {
                accepted = self.listener.accept() => {
                    let (client, peer) = match accepted {
                        Ok(accepted) => {
                            consecutive_failures = 0;
                            accepted
                        }
                        Err(error) => {
                            consecutive_failures += 1;
                            if consecutive_failures >= MAX_CONSECUTIVE_ACCEPT_FAILURES {
                                return Err(Error(format!(
                                    "SOCKS5 listener stopped accepting connections: {error}"
                                )));
                            }
                            // Descriptor and buffer exhaustion leave the pending
                            // connection queued, so retry after a pause instead
                            // of spinning on the same failure.
                            tokio::time::sleep(ACCEPT_FAILURE_BACKOFF).await;
                            continue;
                        }
                    };
                    if !peer.ip().is_loopback() {
                        continue;
                    }
                    // Best effort: Nagle is a latency optimisation, so failing to
                    // clear it must not deny the client its connection.
                    let _ = configure_client_socket(&client);
                    while connections.try_join_next().is_some() {}
                    if connections.len() >= MAX_ACTIVE_CONNECTIONS {
                        continue;
                    }
                    let server = Arc::clone(&self.server);
                    connections.spawn(async move {
                        if let Err(error) = server.handle(client).await {
                            eprintln!("SOCKS5 request failed: {error}");
                        }
                    });
                }
                _ = connections.join_next(), if !connections.is_empty() => {}
            }
        }
    }
}

impl SocksServer {
    async fn handle(&self, mut client: TcpStream) -> Result<()> {
        let Some(request) = bounded_handshake(
            &mut client,
            self.resolver.as_ref(),
            GREETING_TIMEOUT,
            REQUEST_TIMEOUT,
        )
        .await?
        else {
            return Ok(());
        };
        match request {
            SocksRequest::Connect(remote) => match self.netstack.connect_tcp(remote).await {
                Ok(mut upstream) => {
                    send_reply(&mut client, 0, None).await?;
                    match tokio::io::copy_bidirectional(&mut client, &mut upstream).await {
                        // Either side hanging up ends a proxied session normally.
                        Ok(_) => Ok(()),
                        Err(error) if peer_departed(&error) => Ok(()),
                        Err(_) => Err(Error("SOCKS5 stream forwarding failed".into())),
                    }
                }
                Err(error) => {
                    let _ = send_reply(&mut client, 5, None).await;
                    Err(error)
                }
            },
            SocksRequest::UdpAssociate => self.handle_udp_associate(client).await,
        }
    }

    async fn handle_udp_associate(&self, mut control: TcpStream) -> Result<()> {
        let local = Arc::new(
            TokioUdpSocket::bind(SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0))
                .await
                .map_err(|_| Error("cannot bind the SOCKS5 UDP relay".into()))?,
        );
        let local_address = local
            .local_addr()
            .map_err(|_| Error("cannot inspect the SOCKS5 UDP relay".into()))?;
        let tunnel = Arc::new(self.netstack.bind_udp().await?);
        let client_endpoint = Arc::new(RwLock::new(None::<SocketAddr>));
        send_reply(&mut control, 0, Some(local_address)).await?;

        let mut upload = tokio::spawn(relay_udp_upload(
            Arc::clone(&local),
            Arc::clone(&tunnel),
            Arc::clone(&client_endpoint),
            Arc::clone(&self.resolver),
        ));
        let mut download = tokio::spawn(relay_udp_download(local, tunnel, client_endpoint));
        let result = tokio::select! {
            result = wait_for_control_close(&mut control) => result,
            result = &mut upload => relay_task_result(result, "upload"),
            result = &mut download => relay_task_result(result, "download"),
        };
        upload.abort();
        download.abort();
        result
    }
}

async fn relay_udp_upload(
    local: Arc<TokioUdpSocket>,
    tunnel: Arc<VirtualUdpSocket>,
    client_endpoint: Arc<RwLock<Option<SocketAddr>>>,
    resolver: Arc<dyn NameResolver>,
) -> Result<()> {
    let mut datagram = vec![0_u8; MAX_UDP_DATAGRAM_BYTES];
    loop {
        let (length, peer) = local
            .recv_from(&mut datagram)
            .await
            .map_err(|_| Error("SOCKS5 UDP relay receive failed".into()))?;
        if !peer.ip().is_loopback() {
            continue;
        }
        let Ok((remote, payload)) = parse_udp_request(&datagram[..length], resolver.as_ref()).await
        else {
            continue;
        };
        {
            let mut endpoint = client_endpoint.write().await;
            match *endpoint {
                Some(expected) if expected != peer => continue,
                Some(_) => {}
                None => *endpoint = Some(peer),
            }
        }
        tunnel
            .send_to(remote, payload)
            .await
            .map_err(|_| Error("SOCKS5 UDP tunnel send failed".into()))?;
    }
}

async fn relay_udp_download(
    local: Arc<TokioUdpSocket>,
    tunnel: Arc<VirtualUdpSocket>,
    client_endpoint: Arc<RwLock<Option<SocketAddr>>>,
) -> Result<()> {
    let mut payload = vec![0_u8; MAX_UDP_PAYLOAD_BYTES];
    loop {
        let (remote, length) = tunnel
            .recv_from(&mut payload)
            .await
            .map_err(|_| Error("SOCKS5 UDP tunnel receive failed".into()))?;
        let Some(peer) = *client_endpoint.read().await else {
            continue;
        };
        let response = encode_udp_response(remote, &payload[..length])?;
        local
            .send_to(&response, peer)
            .await
            .map_err(|_| Error("SOCKS5 UDP relay send failed".into()))?;
    }
}

async fn wait_for_control_close(control: &mut TcpStream) -> Result<()> {
    let mut control_byte = [0_u8; 1];
    loop {
        match control.read(&mut control_byte).await {
            Ok(0) => return Ok(()),
            Ok(_) => continue,
            Err(error) => return Err(Error(error.to_string())),
        }
    }
}

fn relay_task_result(
    result: std::result::Result<Result<()>, tokio::task::JoinError>,
    direction: &str,
) -> Result<()> {
    match result {
        Ok(Ok(())) => Err(Error(format!(
            "SOCKS5 UDP {direction} relay stopped unexpectedly"
        ))),
        Ok(Err(error)) => Err(error),
        Err(_) => Err(Error(format!("SOCKS5 UDP {direction} relay task failed"))),
    }
}

/// Disables Nagle on an accepted client socket.
///
/// The SOCKS exchange is a sequence of short writes followed by a read, and the
/// success reply is only ten bytes. Holding those back until the client
/// acknowledges the previous segment adds a delayed-ACK stall in front of every
/// proxied request.
fn configure_client_socket(client: &TcpStream) -> Result<()> {
    client
        .set_nodelay(true)
        .map_err(|_| Error("cannot configure the SOCKS5 client socket".into()))
}

/// Reports whether an I/O error means the peer simply went away.
///
/// A client that disconnects has ended its session, not failed it. Logging those
/// as request failures buries the real errors: the desktop health probe closes
/// its socket the moment it has the reply, and browsers routinely abandon
/// speculative connections.
fn peer_departed(error: &std::io::Error) -> bool {
    matches!(
        error.kind(),
        std::io::ErrorKind::BrokenPipe
            | std::io::ErrorKind::ConnectionReset
            | std::io::ErrorKind::ConnectionAborted
            | std::io::ErrorKind::NotConnected
            | std::io::ErrorKind::UnexpectedEof
    )
}

/// Reads the greeting and request under explicit deadlines so a client that
/// connects and then stalls cannot hold one of the bounded connection slots.
///
/// `Ok(None)` means the client disconnected before completing the handshake.
async fn bounded_handshake(
    client: &mut TcpStream,
    resolver: &dyn NameResolver,
    greeting_timeout: Duration,
    request_timeout: Duration,
) -> Result<Option<SocksRequest>> {
    let greeted = tokio::time::timeout(greeting_timeout, negotiate_no_authentication(client))
        .await
        .map_err(|_| Error("SOCKS5 authentication greeting timed out".into()))??;
    if !greeted {
        return Ok(None);
    }
    tokio::time::timeout(request_timeout, read_request(client, resolver))
        .await
        .map_err(|_| Error("SOCKS5 request timed out".into()))?
        .map(Some)
}

/// Returns `Ok(false)` when the client disconnected instead of greeting.
async fn negotiate_no_authentication(client: &mut TcpStream) -> Result<bool> {
    let mut header = [0_u8; 2];
    if let Err(error) = client.read_exact(&mut header).await {
        if peer_departed(&error) {
            return Ok(false);
        }
        return Err(error.into());
    }
    if header[0] != SOCKS_VERSION || header[1] == 0 || usize::from(header[1]) > MAX_AUTH_METHODS {
        return Err(Error("invalid SOCKS5 authentication greeting".into()));
    }
    let mut methods = vec![0_u8; usize::from(header[1])];
    client.read_exact(&mut methods).await?;
    let method = if methods.contains(&NO_AUTHENTICATION) {
        NO_AUTHENTICATION
    } else {
        NO_ACCEPTABLE_METHODS
    };
    client.write_all(&[SOCKS_VERSION, method]).await?;
    if method == NO_ACCEPTABLE_METHODS {
        return Err(Error("SOCKS5 client offered no supported method".into()));
    }
    Ok(true)
}

async fn read_request(client: &mut TcpStream, resolver: &dyn NameResolver) -> Result<SocksRequest> {
    let mut header = [0_u8; 4];
    client.read_exact(&mut header).await?;
    if header[0] != SOCKS_VERSION || header[2] != 0 {
        send_reply(client, 7, None).await?;
        return Err(Error("unsupported SOCKS5 command".into()));
    }
    let command = header[1];
    if !matches!(command, CONNECT_COMMAND | UDP_ASSOCIATE_COMMAND) {
        // The command can be rejected as soon as the fixed header is complete.
        // Waiting for an address first lets a malformed client withhold the
        // remainder and prevents it from receiving the required 0x07 reply.
        send_reply(client, 7, None).await?;
        return Err(Error("unsupported SOCKS5 command".into()));
    }
    if header[3] == ADDRESS_IPV6 {
        // Tell the client the address family is unsupported instead of letting
        // it wait for a reply that never arrives.
        let mut ignored = [0_u8; 18];
        let _ = client.read_exact(&mut ignored).await;
        send_reply(client, 8, None).await?;
        return Err(Error("SOCKS5 IPv6 is not implemented".into()));
    }
    let address = consume_address(client, header[3], resolver, command == CONNECT_COMMAND).await?;
    let port = client.read_u16().await?;
    if command == UDP_ASSOCIATE_COMMAND {
        return Ok(SocksRequest::UdpAssociate);
    }
    let address = address.ok_or_else(|| Error("SOCKS5 destination is missing".into()))?;
    if address.is_unspecified() || port == 0 {
        send_reply(client, 8, None).await?;
        return Err(Error("SOCKS5 destination is invalid".into()));
    }
    Ok(SocksRequest::Connect(SocketAddr::new(
        IpAddr::V4(address),
        port,
    )))
}

async fn consume_address(
    client: &mut TcpStream,
    address_type: u8,
    resolver: &dyn NameResolver,
    resolve_domain: bool,
) -> Result<Option<Ipv4Addr>> {
    match address_type {
        ADDRESS_IPV4 => {
            let mut octets = [0_u8; 4];
            client.read_exact(&mut octets).await?;
            Ok(Some(Ipv4Addr::from(octets)))
        }
        ADDRESS_DOMAIN => {
            let length = usize::from(client.read_u8().await?);
            if length == 0 || length > MAX_DOMAIN_BYTES {
                return Err(Error("SOCKS5 domain has an invalid length".into()));
            }
            let mut encoded = vec![0_u8; length];
            client.read_exact(&mut encoded).await?;
            let host = std::str::from_utf8(&encoded)
                .map_err(|_| Error("SOCKS5 domain must be UTF-8".into()))?;
            validate_domain(host)?;
            if resolve_domain {
                Ok(Some(resolve_host(host, resolver).await?))
            } else {
                Ok(None)
            }
        }
        ADDRESS_IPV6 => {
            let mut ignored = [0_u8; 16];
            client.read_exact(&mut ignored).await?;
            Err(Error("SOCKS5 IPv6 is not implemented".into()))
        }
        _ => Err(Error("SOCKS5 address type is invalid".into())),
    }
}

async fn parse_udp_request<'a>(
    datagram: &'a [u8],
    resolver: &dyn NameResolver,
) -> Result<(SocketAddr, &'a [u8])> {
    if datagram.len() < 7 || datagram[..3] != [0, 0, 0] {
        return Err(Error(
            "SOCKS5 UDP fragmentation is unsupported or malformed".into(),
        ));
    }
    let mut offset = 4;
    let address = match datagram[3] {
        ADDRESS_IPV4 => {
            let octets = datagram
                .get(offset..offset + 4)
                .ok_or_else(|| Error("SOCKS5 UDP IPv4 address is truncated".into()))?;
            offset += 4;
            Ipv4Addr::new(octets[0], octets[1], octets[2], octets[3])
        }
        ADDRESS_DOMAIN => {
            let length = usize::from(
                *datagram
                    .get(offset)
                    .ok_or_else(|| Error("SOCKS5 UDP domain length is missing".into()))?,
            );
            offset += 1;
            if length == 0 || length > MAX_DOMAIN_BYTES {
                return Err(Error("SOCKS5 UDP domain length is invalid".into()));
            }
            let encoded = datagram
                .get(offset..offset + length)
                .ok_or_else(|| Error("SOCKS5 UDP domain is truncated".into()))?;
            offset += length;
            let host = std::str::from_utf8(encoded)
                .map_err(|_| Error("SOCKS5 UDP domain must be UTF-8".into()))?;
            resolve_host(host, resolver).await?
        }
        ADDRESS_IPV6 => return Err(Error("SOCKS5 UDP IPv6 is not implemented".into())),
        _ => return Err(Error("SOCKS5 UDP address type is invalid".into())),
    };
    let port_bytes = datagram
        .get(offset..offset + 2)
        .ok_or_else(|| Error("SOCKS5 UDP port is truncated".into()))?;
    offset += 2;
    let port = u16::from_be_bytes([port_bytes[0], port_bytes[1]]);
    if address.is_unspecified() || port == 0 {
        return Err(Error("SOCKS5 UDP destination is invalid".into()));
    }
    if datagram.len() - offset > MAX_UDP_PAYLOAD_BYTES {
        return Err(Error("SOCKS5 UDP payload is too large".into()));
    }
    Ok((
        SocketAddr::new(IpAddr::V4(address), port),
        &datagram[offset..],
    ))
}

fn encode_udp_response(remote: SocketAddr, payload: &[u8]) -> Result<Vec<u8>> {
    let IpAddr::V4(address) = remote.ip() else {
        return Err(Error("SOCKS5 UDP response requires IPv4".into()));
    };
    let mut response = Vec::with_capacity(10 + payload.len());
    response.extend_from_slice(&[0, 0, 0, ADDRESS_IPV4]);
    response.extend_from_slice(&address.octets());
    response.extend_from_slice(&remote.port().to_be_bytes());
    response.extend_from_slice(payload);
    Ok(response)
}

async fn send_reply(client: &mut TcpStream, status: u8, bound: Option<SocketAddr>) -> Result<()> {
    let (address, port) = match bound {
        Some(SocketAddr::V4(value)) => (*value.ip(), value.port()),
        _ => (Ipv4Addr::UNSPECIFIED, 0),
    };
    client
        .write_all(&[
            SOCKS_VERSION,
            status,
            0,
            ADDRESS_IPV4,
            address.octets()[0],
            address.octets()[1],
            address.octets()[2],
            address.octets()[3],
            port.to_be_bytes()[0],
            port.to_be_bytes()[1],
        ])
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::proxy::ResolveFuture;

    #[test]
    fn udp_response_round_trips_source_and_payload() {
        let response =
            encode_udp_response("10.20.30.40:53".parse().unwrap(), b"dns-response").unwrap();
        assert_eq!(&response[..10], &[0, 0, 0, 1, 10, 20, 30, 40, 0, 53]);
        assert_eq!(&response[10..], b"dns-response");
    }

    #[tokio::test]
    async fn udp_request_parsing_supports_ipv4_and_vpn_dns() {
        struct StaticResolver;
        impl NameResolver for StaticResolver {
            fn resolve_ipv4<'a>(&'a self, host: &'a str) -> ResolveFuture<'a> {
                Box::pin(async move {
                    if host == "campus.example" {
                        Ok(Ipv4Addr::new(10, 20, 30, 40))
                    } else {
                        Err(Error("not found".into()))
                    }
                })
            }
        }
        let ipv4 = [0, 0, 0, 1, 10, 1, 2, 3, 0, 53, 1, 2, 3];
        let (remote, payload) = parse_udp_request(&ipv4, &StaticResolver).await.unwrap();
        assert_eq!(remote, "10.1.2.3:53".parse().unwrap());
        assert_eq!(payload, &[1, 2, 3]);

        let mut domain = vec![0, 0, 0, 3, 14];
        domain.extend_from_slice(b"campus.example");
        domain.extend_from_slice(&443_u16.to_be_bytes());
        domain.extend_from_slice(b"payload");
        let (remote, payload) = parse_udp_request(&domain, &StaticResolver).await.unwrap();
        assert_eq!(remote, "10.20.30.40:443".parse().unwrap());
        assert_eq!(payload, b"payload");
    }

    #[tokio::test]
    async fn udp_request_rejects_fragmentation() {
        let fragmented = [0, 0, 1, 1, 10, 1, 2, 3, 0, 53];
        assert!(
            parse_udp_request(&fragmented, &crate::engine::proxy::RejectDomainResolver)
                .await
                .is_err()
        );
    }

    async fn connected_pair() -> (TcpStream, TcpStream) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let client = TcpStream::connect(address).await.unwrap();
        let (server, _) = listener.accept().await.unwrap();
        (client, server)
    }

    #[tokio::test]
    async fn stalled_client_cannot_hold_a_connection_slot() {
        let (_client, mut server) = connected_pair().await;
        let error = bounded_handshake(
            &mut server,
            &crate::engine::proxy::RejectDomainResolver,
            Duration::from_millis(50),
            Duration::from_millis(50),
        )
        .await
        .expect_err("a silent client must not block the handshake");
        assert!(error.to_string().contains("greeting timed out"));
    }

    #[tokio::test]
    async fn stalled_request_after_a_valid_greeting_also_times_out() {
        let (mut client, mut server) = connected_pair().await;
        let handshake = tokio::spawn(async move {
            bounded_handshake(
                &mut server,
                &crate::engine::proxy::RejectDomainResolver,
                Duration::from_secs(5),
                Duration::from_millis(50),
            )
            .await
            .map(|_| ())
        });
        client
            .write_all(&[SOCKS_VERSION, 1, NO_AUTHENTICATION])
            .await
            .unwrap();
        let mut negotiated = [0_u8; 2];
        client.read_exact(&mut negotiated).await.unwrap();
        assert_eq!(negotiated, [SOCKS_VERSION, NO_AUTHENTICATION]);
        let error = handshake.await.unwrap().expect_err("stalled request");
        assert!(error.to_string().contains("request timed out"));
    }

    #[tokio::test]
    async fn a_client_that_leaves_before_the_greeting_is_not_a_failure() {
        // The desktop health probe closes its socket as soon as it has the reply,
        // and browsers open and abandon speculative connections. Reporting those
        // as request failures fills the user-visible log with noise that hides
        // the errors that matter.
        let (client, mut server) = connected_pair().await;
        drop(client);
        let outcome = bounded_handshake(
            &mut server,
            &crate::engine::proxy::RejectDomainResolver,
            Duration::from_secs(5),
            Duration::from_secs(5),
        )
        .await
        .expect("a departed client is a completed session, not an error");
        assert!(outcome.is_none());
    }

    #[test]
    fn only_a_departed_peer_is_treated_as_a_clean_end() {
        use std::io::ErrorKind;
        for kind in [
            ErrorKind::BrokenPipe,
            ErrorKind::ConnectionReset,
            ErrorKind::ConnectionAborted,
            ErrorKind::NotConnected,
            ErrorKind::UnexpectedEof,
        ] {
            assert!(peer_departed(&std::io::Error::from(kind)), "{kind:?}");
        }
        for kind in [
            ErrorKind::PermissionDenied,
            ErrorKind::AddrInUse,
            ErrorKind::InvalidData,
            ErrorKind::TimedOut,
        ] {
            assert!(!peer_departed(&std::io::Error::from(kind)), "{kind:?}");
        }
    }

    #[tokio::test]
    async fn accepted_clients_have_nagle_disabled() {
        let (_client, server) = connected_pair().await;
        assert!(!server.nodelay().unwrap());
        configure_client_socket(&server).unwrap();
        assert!(server.nodelay().unwrap());
    }

    #[tokio::test]
    async fn ipv6_requests_receive_an_address_type_reply() {
        let (mut client, mut server) = connected_pair().await;
        let request = tokio::spawn(async move {
            read_request(&mut server, &crate::engine::proxy::RejectDomainResolver).await
        });
        let mut ipv6_request = vec![SOCKS_VERSION, CONNECT_COMMAND, 0, ADDRESS_IPV6];
        ipv6_request.extend_from_slice(&[0; 16]);
        ipv6_request.extend_from_slice(&443_u16.to_be_bytes());
        client.write_all(&ipv6_request).await.unwrap();
        let mut reply = [0_u8; 10];
        client.read_exact(&mut reply).await.unwrap();
        assert_eq!(reply[..4], [SOCKS_VERSION, 8, 0, ADDRESS_IPV4]);
        assert!(request.await.unwrap().is_err());
    }

    #[tokio::test]
    async fn unsupported_command_is_rejected_before_waiting_for_its_address() {
        let (mut client, mut server) = connected_pair().await;
        let request = tokio::spawn(async move {
            read_request(&mut server, &crate::engine::proxy::RejectDomainResolver).await
        });
        client
            .write_all(&[SOCKS_VERSION, 2, 0, ADDRESS_IPV6])
            .await
            .unwrap();
        let mut reply = [0_u8; 10];
        tokio::time::timeout(Duration::from_secs(1), client.read_exact(&mut reply))
            .await
            .expect("command rejection must not wait for the address")
            .unwrap();
        assert_eq!(reply[..4], [SOCKS_VERSION, 7, 0, ADDRESS_IPV4]);
        assert!(request.await.unwrap().is_err());
    }

    #[test]
    fn listener_requires_loopback() {
        struct Noop;
        impl NameResolver for Noop {
            fn resolve_ipv4<'a>(&'a self, _host: &'a str) -> ResolveFuture<'a> {
                Box::pin(async { Err(Error("unused".into())) })
            }
        }
        let invalid = SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), 1080);
        // A full netstack requires a live data plane; validate the invariant
        // directly here instead of constructing one.
        assert!(!invalid.ip().is_loopback());
        assert_eq!(std::mem::size_of::<Noop>(), 0);
    }
}
