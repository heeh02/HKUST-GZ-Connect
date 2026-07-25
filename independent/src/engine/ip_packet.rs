use crate::{Error, Result};
use std::net::Ipv4Addr;
use zeroize::Zeroizing;

pub const IPV4_MIN_HEADER_LEN: usize = 20;
pub const ENGINE_MTU: usize = 1500;
const MAX_BUFFERED_PACKET_BYTES: usize = 2 * u16::MAX as usize;

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
    if packet.len() > ENGINE_MTU {
        return Err(Error(
            "IPv4 packet exceeds the configured tunnel MTU".into(),
        ));
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
    if total_length < header_length || total_length > ENGINE_MTU {
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
