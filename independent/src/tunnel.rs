use crate::{Error, Result};
use std::fmt::{Debug, Formatter};
use zeroize::Zeroize;

pub const CLIENT_SYNC_LEN: usize = 82;
pub const SERVER_SYNC_LEN: usize = 122;
pub const CLIENT_ACK_LEN: usize = 43;
pub const CLIENT_MESSAGE_LEN: usize = 76;
pub const SERVER_MESSAGE_LEN: usize = 40;
pub const WINDOWS_CLIENT_MESSAGE_LEN: usize = 64;
pub const WINDOWS_SERVER_MESSAGE_LEN: usize = 36;

pub const IPCP_HEADER_LEN: usize = 12;
pub const IPCP_MAX_FRAME_LEN: usize = 1600;

const CLIENT_MAGIC: [u8; 4] = *b"JJYY";
const SERVER_MAGIC: [u8; 4] = *b"AABB";
const IPCP_MAGIC: [u8; 4] = *b"IPCP";

pub struct SessionContext {
    command_context: [u8; 32],
    client_binding: [u8; 16],
    payload_material: [u8; 16],
}

impl SessionContext {
    pub fn from_sslctx_hex(value: &str) -> Result<Self> {
        if value.len() != 128 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(Error(
                "L3 session context must contain exactly 128 hexadecimal characters".into(),
            ));
        }
        let mut decoded = hex::decode(value)
            .map_err(|_| Error("L3 session context is not valid hexadecimal".into()))?;
        let command_context = decoded[..32].try_into().expect("validated context length");
        let client_binding = decoded[32..48]
            .try_into()
            .expect("validated context length");
        let payload_material = decoded[48..64]
            .try_into()
            .expect("validated context length");
        decoded.zeroize();
        Ok(Self {
            command_context,
            client_binding,
            payload_material,
        })
    }

    pub fn client_binding(&self) -> [u8; 16] {
        self.client_binding
    }

    pub fn payload_material_present(&self) -> bool {
        self.payload_material.iter().any(|byte| *byte != 0)
    }

    pub fn handshake_session_identifier(&self) -> [u8; 32] {
        self.command_context
    }

    pub fn windows_command_message(
        &self,
        new_connection: bool,
        lan_address: std::net::Ipv4Addr,
    ) -> zeroize::Zeroizing<[u8; WINDOWS_CLIENT_MESSAGE_LEN]> {
        let mut message = zeroize::Zeroizing::new([0_u8; WINDOWS_CLIENT_MESSAGE_LEN]);
        message[..4].copy_from_slice(&u32::from(new_connection).to_le_bytes());
        message[4..36].copy_from_slice(&self.command_context);
        message[36..52].copy_from_slice(&self.client_binding);
        message[60..64].copy_from_slice(&u32::from_be_bytes(lan_address.octets()).to_le_bytes());
        message
    }
}

impl Debug for SessionContext {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("SessionContext")
            .field("command_context", &"<redacted>")
            .field("client_binding", &"<redacted>")
            .field("payload_material", &"<redacted>")
            .finish()
    }
}

impl Drop for SessionContext {
    fn drop(&mut self) {
        self.command_context.zeroize();
        self.client_binding.zeroize();
        self.payload_material.zeroize();
    }
}

/// Numeric tunnel roles observed in the authorized x86_64 Linux client.
///
/// Roles 2-4 remain deliberately opaque until a dynamic trace establishes
/// their behavior. Naming an unknown role would turn a hypothesis into API.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum TunnelKind {
    CommandNew = 0,
    CommandReconnect = 1,
    Opaque2 = 2,
    Opaque3 = 3,
    Opaque4 = 4,
    DataSendNew = 5,
    DataReceiveNew = 6,
    DataReceiveReconnect = 7,
    DataSendReconnect = 8,
}

impl TunnelKind {
    pub fn is_command(self) -> bool {
        matches!(self, Self::CommandNew | Self::CommandReconnect)
    }

    fn auxiliary_field(self, network_order_auxiliary: u32) -> u32 {
        match self {
            Self::CommandNew | Self::CommandReconnect => u32::MAX,
            Self::Opaque2 | Self::Opaque3 | Self::Opaque4 => 0,
            Self::DataSendNew
            | Self::DataReceiveNew
            | Self::DataReceiveReconnect
            | Self::DataSendReconnect => u32::from_be(network_order_auxiliary),
        }
    }

    fn expected_server_status(self) -> Option<u32> {
        match self {
            Self::CommandNew | Self::CommandReconnect => None,
            Self::Opaque2 | Self::Opaque3 | Self::Opaque4 => Some(u32::MAX),
            Self::DataSendNew | Self::DataSendReconnect => Some(2),
            Self::DataReceiveNew | Self::DataReceiveReconnect => Some(1),
        }
    }
}

impl TryFrom<u32> for TunnelKind {
    type Error = Error;

    fn try_from(value: u32) -> Result<Self> {
        match value {
            0 => Ok(Self::CommandNew),
            1 => Ok(Self::CommandReconnect),
            2 => Ok(Self::Opaque2),
            3 => Ok(Self::Opaque3),
            4 => Ok(Self::Opaque4),
            5 => Ok(Self::DataSendNew),
            6 => Ok(Self::DataReceiveNew),
            7 => Ok(Self::DataReceiveReconnect),
            8 => Ok(Self::DataSendReconnect),
            _ => Err(Error(format!("unknown tunnel kind {value}"))),
        }
    }
}

/// Behavior-only representation of the two client-owned TLS-shaped prefaces.
///
/// The official byte sequences are intentionally not embedded. A version
/// adapter must provide bytes obtained from an authorized, locally installed
/// client and pass compatibility validation before use.
#[derive(Clone, Copy, Debug)]
pub struct Preface<'a> {
    pub client_sync: &'a [u8],
    pub client_ack: &'a [u8],
}

impl Preface<'_> {
    pub fn validate(&self) -> Result<()> {
        if self.client_sync.len() != CLIENT_SYNC_LEN {
            return Err(Error(format!(
                "client sync length must be {CLIENT_SYNC_LEN}"
            )));
        }
        if self.client_ack.len() != CLIENT_ACK_LEN {
            return Err(Error(format!("client ack length must be {CLIENT_ACK_LEN}")));
        }
        Ok(())
    }
}

#[derive(Debug, Eq, PartialEq)]
pub struct ClientMessage([u8; CLIENT_MESSAGE_LEN]);

impl ClientMessage {
    pub fn new(kind: TunnelKind, session_binding: [u8; 16], network_order_auxiliary: u32) -> Self {
        let mut bytes = [0_u8; CLIENT_MESSAGE_LEN];
        bytes[..5].copy_from_slice(&[0x17, 0x03, 0x01, 0x00, 0x3c]);
        bytes[8..12].copy_from_slice(&CLIENT_MAGIC);
        bytes[12..16].copy_from_slice(&(kind as u32).to_le_bytes());
        bytes[48..64].copy_from_slice(&session_binding);
        bytes[68..72].copy_from_slice(&0_u32.to_le_bytes());
        bytes[72..76].copy_from_slice(&kind.auxiliary_field(network_order_auxiliary).to_le_bytes());
        Self(bytes)
    }

    pub fn as_bytes(&self) -> &[u8; CLIENT_MESSAGE_LEN] {
        &self.0
    }
}

impl Drop for ClientMessage {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

#[derive(Debug, Eq, PartialEq)]
pub struct ServerMessage {
    bytes: [u8; SERVER_MESSAGE_LEN],
}

impl Drop for ServerMessage {
    fn drop(&mut self) {
        self.bytes.zeroize();
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ServerReply {
    CommandSpecific,
    DataAccepted,
}

pub struct CommandOpenReply {
    virtual_ip_raw: u32,
    lan_ip_raw: u32,
    pub encryption_enabled: bool,
    pub compression_enabled: bool,
    pub udp_port: u32,
}

impl CommandOpenReply {
    pub fn virtual_ip_auxiliary(&self) -> u32 {
        self.virtual_ip_raw
    }

    pub fn virtual_ip_present(&self) -> bool {
        self.virtual_ip_raw != 0
    }

    pub fn lan_ip_present(&self) -> bool {
        self.lan_ip_raw != 0
    }
}

impl Debug for CommandOpenReply {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("CommandOpenReply")
            .field("virtual_ip", &"<redacted>")
            .field("lan_ip", &"<redacted>")
            .field("encryption_enabled", &self.encryption_enabled)
            .field("compression_enabled", &self.compression_enabled)
            .field("udp_port", &self.udp_port)
            .finish()
    }
}

impl Drop for CommandOpenReply {
    fn drop(&mut self) {
        self.virtual_ip_raw.zeroize();
        self.lan_ip_raw.zeroize();
        self.udp_port.zeroize();
    }
}

impl ServerMessage {
    pub fn parse(input: &[u8]) -> Result<Self> {
        let bytes: [u8; SERVER_MESSAGE_LEN] = input.try_into().map_err(|_| {
            Error(format!(
                "server message length must be {SERVER_MESSAGE_LEN}"
            ))
        })?;
        if bytes[..4] != SERVER_MAGIC {
            return Err(Error("server message magic mismatch".into()));
        }
        Ok(Self { bytes })
    }

    pub fn status(&self) -> u32 {
        u32::from_le_bytes(self.bytes[4..8].try_into().expect("fixed field"))
    }

    pub fn validate_for(&self, kind: TunnelKind) -> Result<ServerReply> {
        let Some(expected) = kind.expected_server_status() else {
            return Ok(ServerReply::CommandSpecific);
        };
        if expected != u32::MAX && self.status() != expected {
            return Err(Error(format!(
                "server rejected tunnel kind {} with status {}",
                kind as u32,
                self.status()
            )));
        }
        Ok(ServerReply::DataAccepted)
    }

    pub fn command_open_reply(&self) -> Result<CommandOpenReply> {
        if self.status() != 0 {
            return Err(Error(format!(
                "expected command message type 0, received {}",
                self.status()
            )));
        }
        let encryption = u32::from_le_bytes(self.bytes[12..16].try_into().expect("fixed field"));
        let compression = u32::from_le_bytes(self.bytes[24..28].try_into().expect("fixed field"));
        if encryption > 1 || compression > 1 {
            return Err(Error(
                "command message contains unsupported transform flags".into(),
            ));
        }
        Ok(CommandOpenReply {
            virtual_ip_raw: u32::from_le_bytes(self.bytes[8..12].try_into().expect("fixed field")),
            lan_ip_raw: u32::from_le_bytes(self.bytes[16..20].try_into().expect("fixed field")),
            encryption_enabled: encryption == 1,
            compression_enabled: compression == 1,
            udp_port: u32::from_le_bytes(self.bytes[20..24].try_into().expect("fixed field")),
        })
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum HandshakeState {
    Disconnected,
    TcpConnected,
    AwaitingServerSync,
    ServerSyncReceived,
    AwaitingServerMessage,
    Established,
    Failed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum HandshakeEvent {
    TcpConnected,
    ClientSyncSent,
    ServerSyncReceived { bytes: usize },
    ClientAckAndMessageSent,
    ServerMessageAccepted,
    Fail,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct TunnelHandshake {
    state: HandshakeState,
}

impl Default for TunnelHandshake {
    fn default() -> Self {
        Self {
            state: HandshakeState::Disconnected,
        }
    }
}

impl TunnelHandshake {
    pub fn state(&self) -> HandshakeState {
        self.state
    }

    pub fn advance(&mut self, event: HandshakeEvent) -> Result<()> {
        if event == HandshakeEvent::Fail {
            self.state = HandshakeState::Failed;
            return Ok(());
        }
        self.state = match (self.state, event) {
            (HandshakeState::Disconnected, HandshakeEvent::TcpConnected) => {
                HandshakeState::TcpConnected
            }
            (HandshakeState::TcpConnected, HandshakeEvent::ClientSyncSent) => {
                HandshakeState::AwaitingServerSync
            }
            (
                HandshakeState::AwaitingServerSync,
                HandshakeEvent::ServerSyncReceived {
                    bytes: SERVER_SYNC_LEN,
                },
            ) => HandshakeState::ServerSyncReceived,
            (HandshakeState::ServerSyncReceived, HandshakeEvent::ClientAckAndMessageSent) => {
                HandshakeState::AwaitingServerMessage
            }
            (HandshakeState::AwaitingServerMessage, HandshakeEvent::ServerMessageAccepted) => {
                HandshakeState::Established
            }
            (state, event) => {
                return Err(Error(format!(
                    "invalid tunnel handshake transition: {state:?} + {event:?}"
                )));
            }
        };
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IpcpFrame {
    pub channel: u32,
    pub payload: Vec<u8>,
}

impl IpcpFrame {
    pub fn new(channel: u32, payload: Vec<u8>) -> Result<Self> {
        let total = IPCP_HEADER_LEN
            .checked_add(payload.len())
            .ok_or_else(|| Error("IPCP frame length overflow".into()))?;
        if total > IPCP_MAX_FRAME_LEN {
            return Err(Error(format!(
                "IPCP frame exceeds {IPCP_MAX_FRAME_LEN} bytes"
            )));
        }
        Ok(Self { channel, payload })
    }

    pub fn encode(&self) -> Result<Vec<u8>> {
        let total = IPCP_HEADER_LEN
            .checked_add(self.payload.len())
            .ok_or_else(|| Error("IPCP frame length overflow".into()))?;
        if total > IPCP_MAX_FRAME_LEN {
            return Err(Error(format!(
                "IPCP frame exceeds {IPCP_MAX_FRAME_LEN} bytes"
            )));
        }
        let mut output = Vec::with_capacity(total);
        output.extend_from_slice(&IPCP_MAGIC);
        output.extend_from_slice(&(total as u32).to_le_bytes());
        output.extend_from_slice(&self.channel.to_le_bytes());
        output.extend_from_slice(&self.payload);
        Ok(output)
    }

    /// Decodes one frame from a stream prefix.
    ///
    /// `Ok(None)` means more bytes are required. Malformed headers fail closed.
    pub fn decode_prefix(input: &[u8]) -> Result<Option<(Self, usize)>> {
        if input.len() < IPCP_HEADER_LEN {
            return Ok(None);
        }
        if input[..4] != IPCP_MAGIC {
            return Err(Error("IPCP frame magic mismatch".into()));
        }
        let total = u32::from_le_bytes(input[4..8].try_into().expect("fixed field")) as usize;
        if !(IPCP_HEADER_LEN..=IPCP_MAX_FRAME_LEN).contains(&total) {
            return Err(Error(format!("invalid IPCP frame length {total}")));
        }
        if input.len() < total {
            return Ok(None);
        }
        let channel = u32::from_le_bytes(input[8..12].try_into().expect("fixed field"));
        let payload = input[IPCP_HEADER_LEN..total].to_vec();
        Ok(Some((Self { channel, payload }, total)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_client_message_without_fixture_secrets() {
        let token = [0x5a; 16];
        let message = ClientMessage::new(TunnelKind::DataSendNew, token, 0x0102_0304);
        let bytes = message.as_bytes();
        assert_eq!(&bytes[..5], &[0x17, 0x03, 0x01, 0x00, 0x3c]);
        assert_eq!(&bytes[8..12], b"JJYY");
        assert_eq!(&bytes[12..16], &5_u32.to_le_bytes());
        assert_eq!(&bytes[16..48], &[0; 32]);
        assert_eq!(&bytes[48..64], &token);
        assert_eq!(&bytes[64..72], &[0; 8]);
        assert_eq!(&bytes[72..76], &u32::from_be(0x0102_0304).to_le_bytes());
    }

    #[test]
    fn command_and_opaque_auxiliary_fields_match_observed_switch() {
        let token = [0; 16];
        let command = ClientMessage::new(TunnelKind::CommandNew, token, 7);
        let opaque = ClientMessage::new(TunnelKind::Opaque3, token, 7);
        assert_eq!(&command.as_bytes()[72..76], &[0xff; 4]);
        assert_eq!(&opaque.as_bytes()[72..76], &[0; 4]);
    }

    #[test]
    fn validates_data_server_status_by_direction() {
        let mut send = [0; SERVER_MESSAGE_LEN];
        send[..4].copy_from_slice(b"AABB");
        send[4..8].copy_from_slice(&2_u32.to_le_bytes());
        assert_eq!(
            ServerMessage::parse(&send)
                .unwrap()
                .validate_for(TunnelKind::DataSendReconnect)
                .unwrap(),
            ServerReply::DataAccepted
        );

        let mut receive = send;
        receive[4..8].copy_from_slice(&1_u32.to_le_bytes());
        assert_eq!(
            ServerMessage::parse(&receive)
                .unwrap()
                .validate_for(TunnelKind::DataReceiveNew)
                .unwrap(),
            ServerReply::DataAccepted
        );
        assert!(
            ServerMessage::parse(&receive)
                .unwrap()
                .validate_for(TunnelKind::DataSendNew)
                .is_err()
        );
    }

    #[test]
    fn parses_command_open_without_exposing_addresses() {
        let mut bytes = [0; SERVER_MESSAGE_LEN];
        bytes[..4].copy_from_slice(b"AABB");
        bytes[8..12].copy_from_slice(&[192, 0, 2, 44]);
        bytes[12..16].copy_from_slice(&1_u32.to_le_bytes());
        bytes[16..20].copy_from_slice(&[198, 51, 100, 9]);
        bytes[20..24].copy_from_slice(&443_u32.to_le_bytes());
        let message = ServerMessage::parse(&bytes).unwrap();
        let reply = message.command_open_reply().unwrap();
        assert!(reply.virtual_ip_present());
        assert!(reply.lan_ip_present());
        assert!(reply.encryption_enabled);
        assert!(!reply.compression_enabled);
        assert_eq!(reply.udp_port, 443);
        let debug = format!("{reply:?}");
        assert!(!debug.contains("192"));
        assert!(!debug.contains("198"));
    }

    #[test]
    fn rejects_unknown_tunnel_kind_and_server_magic() {
        assert!(TunnelKind::try_from(9).is_err());
        assert!(ServerMessage::parse(&[0; SERVER_MESSAGE_LEN]).is_err());
    }

    #[test]
    fn handshake_requires_observed_order_and_lengths() {
        let mut handshake = TunnelHandshake::default();
        handshake.advance(HandshakeEvent::TcpConnected).unwrap();
        handshake.advance(HandshakeEvent::ClientSyncSent).unwrap();
        assert!(
            handshake
                .advance(HandshakeEvent::ServerSyncReceived { bytes: 121 })
                .is_err()
        );
        handshake
            .advance(HandshakeEvent::ServerSyncReceived {
                bytes: SERVER_SYNC_LEN,
            })
            .unwrap();
        handshake
            .advance(HandshakeEvent::ClientAckAndMessageSent)
            .unwrap();
        handshake
            .advance(HandshakeEvent::ServerMessageAccepted)
            .unwrap();
        assert_eq!(handshake.state(), HandshakeState::Established);
    }

    #[test]
    fn ipcp_stream_codec_is_bounded_and_incremental() {
        let frame = IpcpFrame::new(0x1020_3040, vec![0x45, 0, 0, 20]).unwrap();
        let encoded = frame.encode().unwrap();
        assert_eq!(&encoded[..4], b"IPCP");
        assert_eq!(
            u32::from_le_bytes(encoded[4..8].try_into().unwrap()),
            encoded.len() as u32
        );
        assert!(IpcpFrame::decode_prefix(&encoded[..11]).unwrap().is_none());
        assert!(IpcpFrame::decode_prefix(&encoded[..15]).unwrap().is_none());
        let (decoded, consumed) = IpcpFrame::decode_prefix(&encoded).unwrap().unwrap();
        assert_eq!(decoded, frame);
        assert_eq!(consumed, encoded.len());
    }

    #[test]
    fn ipcp_codec_rejects_bad_magic_and_oversize() {
        let mut bad_magic = [0; IPCP_HEADER_LEN];
        bad_magic[4..8].copy_from_slice(&(IPCP_HEADER_LEN as u32).to_le_bytes());
        assert!(IpcpFrame::decode_prefix(&bad_magic).is_err());
        assert!(IpcpFrame::new(0, vec![0; IPCP_MAX_FRAME_LEN]).is_err());
    }

    #[test]
    fn derives_only_observed_halves_of_hex_session_context() {
        let source = (0_u8..64)
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        let context = SessionContext::from_sslctx_hex(&source).unwrap();
        let mut expected = [0_u8; 16];
        for (index, value) in expected.iter_mut().enumerate() {
            *value = index as u8 + 32;
        }
        assert_eq!(context.client_binding(), expected);
        assert!(context.payload_material_present());
        let mut handshake_identifier = [0_u8; 32];
        for (index, value) in handshake_identifier.iter_mut().enumerate() {
            *value = index as u8;
        }
        assert_eq!(context.handshake_session_identifier(), handshake_identifier);
        let message = context.windows_command_message(true, std::net::Ipv4Addr::new(192, 0, 2, 7));
        assert_eq!(&message[..4], &1_u32.to_le_bytes());
        assert_eq!(&message[4..36], &(0_u8..32).collect::<Vec<_>>());
        assert_eq!(&message[36..52], &(32_u8..48).collect::<Vec<_>>());
        assert!(message[52..60].iter().all(|byte| *byte == 0));
        assert_eq!(&message[60..64], &[7, 2, 0, 192]);
        assert!(!format!("{context:?}").contains(&source[64..96]));
        assert!(SessionContext::from_sslctx_hex("abcd").is_err());
    }
}
