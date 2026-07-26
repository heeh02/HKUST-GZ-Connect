use crate::engine::ip_packet::{push_and_extract_ipv4, validate_ipv4_packet};
use crate::modern::{
    ModernCommand, ModernControlRequest, ModernTokenAcquisition, parse_address_reply,
    validate_channel_reply,
};
use crate::special_tls11::SpecialTls11Stream;
use crate::{Error, Result};
use std::net::{Ipv4Addr, SocketAddr};
use std::time::Duration;
use zeroize::Zeroizing;

pub struct EasyConnectDataPlane {
    lease: AddressLease,
    sender: PacketSender,
    receiver: PacketReceiver,
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
        )?;
        let request =
            ModernControlRequest::new(ModernCommand::RequestAddress, acquisition.token(), None)?;
        lease_stream.write_application_data(request.as_bytes())?;
        let reply = lease_stream.read_application_data(128)?;
        let assigned_address = parse_address_reply(&reply)?;
        if assigned_address.is_unspecified() {
            return Err(Error(
                "gateway returned an unspecified virtual address".into(),
            ));
        }

        let mut send_stream = connect_tls(
            peer,
            gateway_host,
            timeout,
            verified_leaf,
            configured_certificate_pin,
        )?;
        let send_request = ModernControlRequest::new(
            ModernCommand::Send,
            acquisition.token(),
            Some(assigned_address),
        )?;
        send_stream.write_application_data(send_request.as_bytes())?;
        validate_channel_reply(
            &send_stream.read_application_data(1500)?,
            ModernCommand::Send,
        )?;

        let mut receive_stream = connect_tls(
            peer,
            gateway_host,
            timeout,
            verified_leaf,
            configured_certificate_pin,
        )?;
        let receive_request = ModernControlRequest::new(
            ModernCommand::Receive,
            acquisition.token(),
            Some(assigned_address),
        )?;
        receive_stream.write_application_data(receive_request.as_bytes())?;
        validate_channel_reply(
            &receive_stream.read_application_data(1500)?,
            ModernCommand::Receive,
        )?;
        // The connection timeout protects setup, but the production receive
        // channel is intentionally idle until a tunneled packet arrives.
        // Treating that idle period as a socket failure disconnects a healthy
        // session after `timeout`.
        receive_stream.set_read_timeout(None)?;

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
