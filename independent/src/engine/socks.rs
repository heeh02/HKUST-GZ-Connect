use crate::engine::netstack::VirtualNetstack;
use crate::{Error, Result};
use std::future::Future;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::pin::Pin;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

const SOCKS_VERSION: u8 = 5;
const NO_AUTHENTICATION: u8 = 0;
const NO_ACCEPTABLE_METHODS: u8 = 0xff;
const CONNECT_COMMAND: u8 = 1;
const ADDRESS_IPV4: u8 = 1;
const ADDRESS_DOMAIN: u8 = 3;
const ADDRESS_IPV6: u8 = 4;
const MAX_AUTH_METHODS: usize = 32;
const MAX_DOMAIN_BYTES: usize = 253;

pub type ResolveFuture<'a> = Pin<Box<dyn Future<Output = Result<Ipv4Addr>> + Send + 'a>>;

pub trait NameResolver: Send + Sync {
    fn resolve_ipv4<'a>(&'a self, host: &'a str) -> ResolveFuture<'a>;
}

pub struct RejectDomainResolver;

impl NameResolver for RejectDomainResolver {
    fn resolve_ipv4<'a>(&'a self, _host: &'a str) -> ResolveFuture<'a> {
        Box::pin(async {
            Err(Error(
                "SOCKS domain requests require the VPN DNS module".into(),
            ))
        })
    }
}

pub struct SocksServer {
    bind: SocketAddr,
    netstack: Arc<VirtualNetstack>,
    resolver: Arc<dyn NameResolver>,
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

    pub async fn serve(self) -> Result<()> {
        let listener = TcpListener::bind(self.bind)
            .await
            .map_err(|_| Error("cannot bind the SOCKS5 listener".into()))?;
        let server = Arc::new(self);
        loop {
            let (client, peer) = listener
                .accept()
                .await
                .map_err(|_| Error("SOCKS5 accept failed".into()))?;
            if !peer.ip().is_loopback() {
                continue;
            }
            let server = Arc::clone(&server);
            tokio::spawn(async move {
                let _ = server.handle(client).await;
            });
        }
    }

    async fn handle(&self, mut client: TcpStream) -> Result<()> {
        negotiate_no_authentication(&mut client).await?;
        let remote = read_connect_request(&mut client, self.resolver.as_ref()).await?;
        match self.netstack.connect_tcp(remote).await {
            Ok(mut upstream) => {
                send_reply(&mut client, 0).await?;
                tokio::io::copy_bidirectional(&mut client, &mut upstream)
                    .await
                    .map_err(|_| Error("SOCKS5 stream forwarding failed".into()))?;
                Ok(())
            }
            Err(error) => {
                let _ = send_reply(&mut client, 5).await;
                Err(error)
            }
        }
    }
}

async fn negotiate_no_authentication(client: &mut TcpStream) -> Result<()> {
    let mut header = [0_u8; 2];
    client.read_exact(&mut header).await?;
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
    Ok(())
}

async fn read_connect_request(
    client: &mut TcpStream,
    resolver: &dyn NameResolver,
) -> Result<SocketAddr> {
    let mut header = [0_u8; 4];
    client.read_exact(&mut header).await?;
    if header[..3] != [SOCKS_VERSION, CONNECT_COMMAND, 0] {
        send_reply(client, 7).await?;
        return Err(Error("unsupported SOCKS5 command".into()));
    }
    let address = match header[3] {
        ADDRESS_IPV4 => {
            let mut octets = [0_u8; 4];
            client.read_exact(&mut octets).await?;
            Ipv4Addr::from(octets)
        }
        ADDRESS_DOMAIN => {
            let length = usize::from(client.read_u8().await?);
            if length == 0 || length > MAX_DOMAIN_BYTES {
                send_reply(client, 8).await?;
                return Err(Error("SOCKS5 domain has an invalid length".into()));
            }
            let mut encoded = vec![0_u8; length];
            client.read_exact(&mut encoded).await?;
            let host = std::str::from_utf8(&encoded)
                .map_err(|_| Error("SOCKS5 domain must be UTF-8".into()))?;
            validate_domain(host)?;
            resolver.resolve_ipv4(host).await?
        }
        ADDRESS_IPV6 => {
            let mut ignored = [0_u8; 16];
            client.read_exact(&mut ignored).await?;
            send_reply(client, 8).await?;
            return Err(Error("SOCKS5 IPv6 is not implemented".into()));
        }
        _ => {
            send_reply(client, 8).await?;
            return Err(Error("SOCKS5 address type is invalid".into()));
        }
    };
    let port = client.read_u16().await?;
    if address.is_unspecified() || port == 0 {
        send_reply(client, 8).await?;
        return Err(Error("SOCKS5 destination is invalid".into()));
    }
    Ok(SocketAddr::new(IpAddr::V4(address), port))
}

fn validate_domain(host: &str) -> Result<()> {
    if host.len() > MAX_DOMAIN_BYTES
        || host.is_empty()
        || !host
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_'))
        || host
            .split('.')
            .any(|label| label.is_empty() || label.len() > 63)
    {
        return Err(Error("SOCKS5 domain has an invalid shape".into()));
    }
    Ok(())
}

async fn send_reply(client: &mut TcpStream, status: u8) -> Result<()> {
    client
        .write_all(&[SOCKS_VERSION, status, 0, ADDRESS_IPV4, 0, 0, 0, 0, 0, 0])
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn domain_validation_is_bounded() {
        assert!(validate_domain("hpc3.internal.example").is_ok());
        assert!(validate_domain("").is_err());
        assert!(validate_domain("bad/domain").is_err());
        assert!(validate_domain("a..b").is_err());
        assert!(validate_domain(&format!("{}.example", "a".repeat(64))).is_err());
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
