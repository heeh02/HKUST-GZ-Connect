use crate::{Error, Result};
use std::net::Ipv4Addr;
use zeroize::Zeroizing;

pub const IPV4_MIN_HEADER_LEN: usize = 20;

/// The largest packet the tunnel will carry in either direction.
///
/// This is a safety bound on framing, not a path property: the gateway may send
/// a full-size packet at any time and rejecting it would tear the tunnel down.
pub const MAX_TUNNEL_PACKET_BYTES: usize = 1500;

/// The MTU advertised to the userspace stack, which fixes the MSS campus servers
/// are told to use.
///
/// Deliberately below [`MAX_TUNNEL_PACKET_BYTES`]. Some campus destinations sit
/// behind a link that cannot carry a full-size packet and do not receive the
/// ICMP notification that would let TCP discover it, so a server told it may send
/// 1460-byte segments black-holes its large replies: the connection establishes,
/// small requests succeed, and anything bigger — a TLS certificate flight, for
/// example — never arrives. Asking for smaller segments costs a few percent in
/// per-packet overhead and makes those hosts reachable.
pub const DEFAULT_STACK_MTU: usize = 1400;
pub const MIN_STACK_MTU: usize = 576;

const MAX_BUFFERED_PACKET_BYTES: usize = 2 * u16::MAX as usize;

/// Environment override for the advertised MTU.
///
/// Editing the JSON inside a signed macOS bundle breaks its signature, so tuning
/// the value on an installed build has to go through the environment.
pub const STACK_MTU_ENV: &str = "HKUSTGZ_TUNNEL_MTU";

/// Clamps a configured MTU into the range the framing layer can carry.
///
/// The environment override wins over the configuration file; anything
/// unparseable falls through to the configured value.
pub fn stack_mtu(configured: Option<u64>) -> usize {
    let requested = std::env::var(STACK_MTU_ENV)
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .or(configured);
    match requested {
        Some(value) => (value as usize).clamp(MIN_STACK_MTU, MAX_TUNNEL_PACKET_BYTES),
        None => DEFAULT_STACK_MTU,
    }
}

pub fn validate_ipv4_packet(packet: &[u8], expected_source: Option<Ipv4Addr>) -> Result<()> {
    if packet.len() < IPV4_MIN_HEADER_LEN {
        return Err(Error(
            "IPv4 packet is shorter than the minimum header".into(),
        ));
    }
    if packet[0] >> 4 != 4 {
        return Err(Error("packet is not IPv4".into()));
    }
    let header_length = usize::from(packet[0] & 0x0f) * 4;
    if header_length < IPV4_MIN_HEADER_LEN || header_length > packet.len() {
        return Err(Error("IPv4 header length is invalid".into()));
    }
    let total_length = usize::from(u16::from_be_bytes([packet[2], packet[3]]));
    if total_length != packet.len() || total_length < header_length {
        return Err(Error("IPv4 total length does not match packet size".into()));
    }
    if packet.len() > MAX_TUNNEL_PACKET_BYTES {
        return Err(Error("IPv4 packet exceeds the tunnel framing limit".into()));
    }
    if let Some(expected_source) = expected_source
        && packet[12..16] != expected_source.octets()
    {
        return Err(Error(
            "outbound IPv4 packet has an unexpected source address".into(),
        ));
    }
    Ok(())
}

pub fn push_and_extract_ipv4(
    buffered: &mut Zeroizing<Vec<u8>>,
    chunk: &[u8],
) -> Result<Option<Zeroizing<Vec<u8>>>> {
    if buffered.len().saturating_add(chunk.len()) > MAX_BUFFERED_PACKET_BYTES {
        return Err(Error(
            "buffered tunnel data exceeds the safety limit".into(),
        ));
    }
    buffered.extend_from_slice(chunk);
    if buffered.len() < IPV4_MIN_HEADER_LEN {
        return Ok(None);
    }
    if buffered[0] >> 4 != 4 {
        return Err(Error("tunnel stream does not begin with IPv4".into()));
    }
    let header_length = usize::from(buffered[0] & 0x0f) * 4;
    if header_length < IPV4_MIN_HEADER_LEN {
        return Err(Error("tunnel stream has an invalid IPv4 header".into()));
    }
    let total_length = usize::from(u16::from_be_bytes([buffered[2], buffered[3]]));
    if total_length < header_length || total_length > MAX_TUNNEL_PACKET_BYTES {
        return Err(Error(
            "tunnel stream declares an invalid IPv4 length".into(),
        ));
    }
    if buffered.len() < total_length {
        return Ok(None);
    }
    let packet_bytes: Vec<u8> = buffered.drain(..total_length).collect();
    let packet = Zeroizing::new(packet_bytes);
    validate_ipv4_packet(&packet, None)?;
    Ok(Some(packet))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Mutex, OnceLock};

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    fn packet(payload: &[u8]) -> Vec<u8> {
        let mut packet = vec![0_u8; IPV4_MIN_HEADER_LEN];
        packet[0] = 0x45;
        packet[2..4].copy_from_slice(
            &u16::try_from(IPV4_MIN_HEADER_LEN + payload.len())
                .unwrap()
                .to_be_bytes(),
        );
        packet[12..16].copy_from_slice(&[10, 0, 0, 2]);
        packet[16..20].copy_from_slice(&[10, 0, 0, 3]);
        packet.extend_from_slice(payload);
        packet
    }

    #[test]
    fn the_advertised_mtu_is_below_what_the_tunnel_still_accepts() {
        // The two limits must stay decoupled: asking servers for smaller segments
        // must never make the engine reject a full-size packet the gateway sends,
        // because that error tears the tunnel down.
        const { assert!(DEFAULT_STACK_MTU < MAX_TUNNEL_PACKET_BYTES) };
        let full_size = packet(&vec![0_u8; MAX_TUNNEL_PACKET_BYTES - IPV4_MIN_HEADER_LEN]);
        assert_eq!(full_size.len(), MAX_TUNNEL_PACKET_BYTES);
        validate_ipv4_packet(&full_size, None).expect("a full-size inbound packet stays valid");
    }

    #[test]
    fn configured_mtu_is_clamped_to_a_carriable_range() {
        // Serialised with the override test: both read the same process environment.
        let _guard = env_lock().lock().unwrap_or_else(|error| error.into_inner());
        unsafe { std::env::remove_var(STACK_MTU_ENV) };
        assert_eq!(stack_mtu(None), DEFAULT_STACK_MTU);
        assert_eq!(stack_mtu(Some(1300)), 1300);
        assert_eq!(stack_mtu(Some(9000)), MAX_TUNNEL_PACKET_BYTES);
        assert_eq!(stack_mtu(Some(0)), MIN_STACK_MTU);
        assert_eq!(stack_mtu(Some(68)), MIN_STACK_MTU);
    }

    #[test]
    fn the_environment_can_retune_the_mtu_without_repackaging() {
        let _guard = env_lock().lock().unwrap_or_else(|error| error.into_inner());
        unsafe { std::env::set_var(STACK_MTU_ENV, "1200") };
        assert_eq!(stack_mtu(Some(1400)), 1200);
        assert_eq!(stack_mtu(None), 1200);
        unsafe { std::env::set_var(STACK_MTU_ENV, "not-a-number") };
        assert_eq!(
            stack_mtu(Some(1400)),
            1400,
            "garbage falls back to the config"
        );
        unsafe { std::env::set_var(STACK_MTU_ENV, "60000") };
        assert_eq!(stack_mtu(None), MAX_TUNNEL_PACKET_BYTES);
        unsafe { std::env::remove_var(STACK_MTU_ENV) };
    }

    #[test]
    fn validates_source_and_total_length() {
        let packet = packet(b"test");
        validate_ipv4_packet(&packet, Some(Ipv4Addr::new(10, 0, 0, 2))).unwrap();
        assert!(validate_ipv4_packet(&packet, Some(Ipv4Addr::new(10, 0, 0, 9))).is_err());
        let mut truncated = packet.clone();
        truncated.pop();
        assert!(validate_ipv4_packet(&truncated, None).is_err());
    }

    #[test]
    fn extracts_fragmented_and_coalesced_packets() {
        let first = packet(b"one");
        let second = packet(b"two");
        let mut buffered = Zeroizing::new(Vec::new());
        assert!(
            push_and_extract_ipv4(&mut buffered, &first[..8])
                .unwrap()
                .is_none()
        );
        let mut tail = first[8..].to_vec();
        tail.extend_from_slice(&second);
        assert_eq!(
            push_and_extract_ipv4(&mut buffered, &tail)
                .unwrap()
                .unwrap()
                .as_slice(),
            first
        );
        assert_eq!(
            push_and_extract_ipv4(&mut buffered, &[])
                .unwrap()
                .unwrap()
                .as_slice(),
            second
        );
    }
}
