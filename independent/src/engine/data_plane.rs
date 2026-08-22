use crate::engine::ip_packet::{push_and_extract_ipv4, validate_ipv4_packet};
use crate::modern::{
    ModernCommand, ModernControlRequest, ModernTokenAcquisition, parse_address_reply,
    validate_channel_reply,
};
use crate::special_tls11::{SpecialTls11Shutdown, SpecialTls11Stream};
use crate::{Error, ErrorKind, Result};
use std::net::{Ipv4Addr, SocketAddr};
use std::time::Duration;
use zeroize::Zeroizing;

pub struct EasyConnectDataPlane {
    lease: AddressLease,
    sender: PacketSender,
    receiver: PacketReceiver,
}

fn data_plane_stage_error(context: &'static str, error: Error) -> Error {
    let kind = match error.kind() {
        ErrorKind::DataPlaneTransient | ErrorKind::Io => ErrorKind::DataPlaneTransient,
        _ => ErrorKind::DataPlane,
    };
    Error::classified(kind, format!("{context}: {error}"))
}

fn data_plane_protocol_error(message: &'static str) -> Error {
    Error::classified(ErrorKind::DataPlane, message)
}

/// Cipher-free shutdown ownership for every socket in one Modern data plane.
/// Dropping this value closes all sockets without performing network I/O.
#[must_use = "dropping the data-plane shutdown handle closes the transport sockets"]
pub struct DataPlaneShutdown {
    lease: SpecialTls11Shutdown,
    sender: SpecialTls11Shutdown,
    receiver: SpecialTls11Shutdown,
}

impl DataPlaneShutdown {
    #[cfg(test)]
    pub(crate) fn from_tcp_streams_for_test(
        lease: std::net::TcpStream,
        sender: std::net::TcpStream,
        receiver: std::net::TcpStream,
    ) -> Self {
        Self {
            lease: SpecialTls11Shutdown::from_tcp_stream_for_test(lease),
            sender: SpecialTls11Shutdown::from_tcp_stream_for_test(sender),
            receiver: SpecialTls11Shutdown::from_tcp_stream_for_test(receiver),
        }
    }

    pub fn shutdown(&self) -> Result<()> {
        let mut failed = false;
        for result in [
            self.lease.shutdown(),
            self.sender.shutdown(),
            self.receiver.shutdown(),
        ] {
            failed |= result.is_err();
        }
        if failed {
            Err(Error::classified(
                ErrorKind::DataPlane,
                "one or more data-plane sockets could not be closed",
            ))
        } else {
            Ok(())
        }
    }
}

impl Drop for DataPlaneShutdown {
    fn drop(&mut self) {
        let _ = self.shutdown();
    }
}

impl EasyConnectDataPlane {
    pub fn connect(
        gateway_host: &str,
        acquisition: &ModernTokenAcquisition,
        timeout: Duration,
        configured_certificate_pin: Option<&[u8; 32]>,
    ) -> Result<Self> {
        let peer = acquisition.peer_address();
        let verified_leaf = acquisition.verified_leaf_sha256();
        let mut lease_stream = connect_tls(
            peer,
            gateway_host,
            timeout,
            verified_leaf,
            configured_certificate_pin,
        )
        .map_err(|error| data_plane_stage_error("modern address TLS", error))?;
        let request =
            ModernControlRequest::new(ModernCommand::RequestAddress, acquisition.token(), None)
                .map_err(|error| data_plane_stage_error("modern address request", error))?;
        lease_stream
            .write_application_data(request.as_bytes())
            .map_err(|error| data_plane_stage_error("modern address request", error))?;
        let reply = lease_stream
            .read_application_data(128)
            .map_err(|error| data_plane_stage_error("modern address reply", error))?;
        let assigned_address = parse_address_reply(&reply)?;
        if assigned_address.is_unspecified() {
            return Err(data_plane_protocol_error(
                "gateway returned an unspecified virtual address",
            ));
        }

        let mut send_stream = connect_tls(
            peer,
            gateway_host,
            timeout,
            verified_leaf,
            configured_certificate_pin,
        )
        .map_err(|error| data_plane_stage_error("modern send TLS", error))?;
        let send_request = ModernControlRequest::new(
            ModernCommand::Send,
            acquisition.token(),
            Some(assigned_address),
        )
        .map_err(|error| data_plane_stage_error("modern send request", error))?;
        send_stream
            .write_application_data(send_request.as_bytes())
            .map_err(|error| data_plane_stage_error("modern send request", error))?;
        validate_channel_reply(
            &send_stream
                .read_application_data(1500)
                .map_err(|error| data_plane_stage_error("modern send reply", error))?,
            ModernCommand::Send,
        )?;
        // The connection timeout protects setup, but the production send
        // channel must tolerate transient backpressure while TCP retransmits.
        // Keeping the setup write timeout would turn a temporary stall into a
        // fatal data-plane failure.
        send_stream
            .set_write_timeout(None)
            .map_err(|error| data_plane_stage_error("modern send socket", error))?;

        let mut receive_stream = connect_tls(
            peer,
            gateway_host,
            timeout,
            verified_leaf,
            configured_certificate_pin,
        )
        .map_err(|error| data_plane_stage_error("modern receive TLS", error))?;
        let receive_request = ModernControlRequest::new(
            ModernCommand::Receive,
            acquisition.token(),
            Some(assigned_address),
        )
        .map_err(|error| data_plane_stage_error("modern receive request", error))?;
        receive_stream
            .write_application_data(receive_request.as_bytes())
            .map_err(|error| data_plane_stage_error("modern receive request", error))?;
        validate_channel_reply(
            &receive_stream
                .read_application_data(1500)
                .map_err(|error| data_plane_stage_error("modern receive reply", error))?,
            ModernCommand::Receive,
        )?;
        // The connection timeout protects setup, but the production receive
        // channel is intentionally idle until a tunneled packet arrives.
        // Treating that idle period as a socket failure disconnects a healthy
        // session after `timeout`.
        receive_stream
            .set_read_timeout(None)
            .map_err(|error| data_plane_stage_error("modern receive socket", error))?;

        Ok(Self {
            lease: AddressLease {
                stream: lease_stream,
                assigned_address,
            },
            sender: PacketSender {
                stream: send_stream,
                assigned_address,
            },
            receiver: PacketReceiver {
                stream: receive_stream,
                buffered: Zeroizing::new(Vec::new()),
            },
        })
    }

    pub fn assigned_address(&self) -> Ipv4Addr {
        self.lease.assigned_address
    }

    pub fn shutdown_handle(&self) -> Result<DataPlaneShutdown> {
        Ok(DataPlaneShutdown {
            lease: self.lease.stream.shutdown_handle()?,
            sender: self.sender.stream.shutdown_handle()?,
            receiver: self.receiver.stream.shutdown_handle()?,
        })
    }

    pub fn split(self) -> (AddressLease, PacketSender, PacketReceiver) {
        (self.lease, self.sender, self.receiver)
    }
}

fn connect_tls(
    peer: SocketAddr,
    host: &str,
    timeout: Duration,
    verified_leaf: &[u8; 32],
    configured_pin: Option<&[u8; 32]>,
) -> Result<SpecialTls11Stream> {
    SpecialTls11Stream::connect(peer, host, timeout, verified_leaf, configured_pin)
}

pub struct AddressLease {
    stream: SpecialTls11Stream,
    assigned_address: Ipv4Addr,
}

impl AddressLease {
    pub fn assigned_address(&self) -> Ipv4Addr {
        self.assigned_address
    }

    pub fn transport_is_open(&self) -> bool {
        self.stream.peer_address().is_ok()
    }
}

pub struct PacketSender {
    stream: SpecialTls11Stream,
    assigned_address: Ipv4Addr,
}

impl PacketSender {
    pub fn send_ipv4(&mut self, packet: &[u8]) -> Result<()> {
        validate_ipv4_packet(packet, Some(self.assigned_address))?;
        self.stream.write_application_data(packet)
    }
}

pub struct PacketReceiver {
    stream: SpecialTls11Stream,
    buffered: Zeroizing<Vec<u8>>,
}

impl PacketReceiver {
    pub fn receive_ipv4(&mut self) -> Result<Zeroizing<Vec<u8>>> {
        loop {
            if let Some(packet) = push_and_extract_ipv4(&mut self.buffered, &[])? {
                return Ok(packet);
            }
            let chunk = self.stream.read_application_data(16 * 1024)?;
            if let Some(packet) = push_and_extract_ipv4(&mut self.buffered, &chunk)? {
                return Ok(packet);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use std::net::{TcpListener, TcpStream};

    fn socket_pair() -> (TcpStream, TcpStream) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let client = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        let (server, _) = listener.accept().unwrap();
        (client, server)
    }

    #[test]
    fn data_plane_shutdown_closes_every_transport_socket() {
        let (lease, mut lease_peer) = socket_pair();
        let (sender, mut sender_peer) = socket_pair();
        let (receiver, mut receiver_peer) = socket_pair();
        let shutdown = DataPlaneShutdown::from_tcp_streams_for_test(lease, sender, receiver);
        shutdown.shutdown().unwrap();
        for peer in [&mut lease_peer, &mut sender_peer, &mut receiver_peer] {
            peer.set_read_timeout(Some(Duration::from_secs(1))).unwrap();
            let mut byte = [0_u8; 1];
            assert_eq!(peer.read(&mut byte).unwrap(), 0);
        }
    }

    #[test]
    fn dropping_data_plane_shutdown_is_a_nonblocking_socket_close_backstop() {
        let (lease, mut lease_peer) = socket_pair();
        let (sender, mut sender_peer) = socket_pair();
        let (receiver, mut receiver_peer) = socket_pair();
        let shutdown = DataPlaneShutdown::from_tcp_streams_for_test(lease, sender, receiver);
        drop(shutdown);
        for peer in [&mut lease_peer, &mut sender_peer, &mut receiver_peer] {
            peer.set_read_timeout(Some(Duration::from_secs(1))).unwrap();
            let mut byte = [0_u8; 1];
            assert_eq!(peer.read(&mut byte).unwrap(), 0);
        }
    }

    #[test]
    fn setup_retry_classification_uses_kinds_instead_of_diagnostic_text() {
        for io_kind in [
            std::io::ErrorKind::ConnectionReset,
            std::io::ErrorKind::ConnectionAborted,
            std::io::ErrorKind::UnexpectedEof,
            std::io::ErrorKind::TimedOut,
        ] {
            let classified =
                data_plane_stage_error("synthetic I/O", Error::from(std::io::Error::from(io_kind)));
            assert_eq!(classified.kind(), ErrorKind::DataPlaneTransient);
        }

        for diagnostic in [
            "failed to fill whole buffer",
            "special TLS certificate does not match",
            "TLS record MAC verification failed",
            "modern channel reply has an unexpected status",
        ] {
            let protocol = data_plane_stage_error("synthetic protocol", Error(diagnostic.into()));
            assert_eq!(protocol.kind(), ErrorKind::DataPlane);
        }

        let transient = data_plane_stage_error(
            "synthetic transport",
            Error::classified(
                ErrorKind::DataPlaneTransient,
                "certificate wording cannot make this permanent",
            ),
        );
        assert_eq!(transient.kind(), ErrorKind::DataPlaneTransient);
    }
}
