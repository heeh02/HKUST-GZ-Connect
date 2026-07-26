use crate::engine::netstack::VirtualNetstack;
use crate::engine::proxy::{NameResolver, ResolveFuture};
use crate::{Error, Result};
use rand::RngCore;
use rand::rngs::OsRng;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;

const DNS_HEADER_LEN: usize = 12;
const DNS_PORT: u16 = 53;
const DNS_MAX_RESPONSE: usize = 4096;
const DNS_TYPE_A: u16 = 1;
const DNS_CLASS_IN: u16 = 1;
const MAX_POINTER_JUMPS: usize = 16;

pub struct VpnDnsResolver {
    netstack: Arc<VirtualNetstack>,
    servers: Vec<Ipv4Addr>,
    timeout: Duration,
}

impl VpnDnsResolver {
    pub fn new(
        netstack: Arc<VirtualNetstack>,
        servers: Vec<Ipv4Addr>,
        timeout: Duration,
    ) -> Result<Self> {
        if servers.is_empty() || servers.iter().any(Ipv4Addr::is_unspecified) {
            return Err(Error(
                "VPN DNS configuration contains no valid server".into(),
            ));
        }
        Ok(Self {
            netstack,
            servers,
            timeout,
        })
    }

    async fn resolve(&self, host: &str) -> Result<Ipv4Addr> {
        let mut last_error = Error("VPN DNS lookup failed".into());
        for server in &self.servers {
            match self.resolve_with_server(host, *server).await {
                Ok(address) => return Ok(address),
                Err(error) => last_error = error,
            }
        }
        Err(last_error)
    }

    async fn resolve_with_server(&self, host: &str, server: Ipv4Addr) -> Result<Ipv4Addr> {
        let mut id_bytes = [0_u8; 2];
        OsRng.fill_bytes(&mut id_bytes);
        let id = u16::from_be_bytes(id_bytes);
        let query = build_query(host, id)?;
        let socket = self.netstack.bind_udp().await?;
        let endpoint = SocketAddr::new(IpAddr::V4(server), DNS_PORT);
        socket
            .send_to(endpoint, &query)
            .await
            .map_err(|_| Error("VPN DNS query send failed".into()))?;
        let mut response = vec![0_u8; DNS_MAX_RESPONSE];
        let receive = tokio::time::timeout(self.timeout, socket.recv_from(&mut response))
            .await
            .map_err(|_| Error("VPN DNS query timed out".into()))?
            .map_err(|_| Error("VPN DNS response failed".into()))?;
        let (source, length) = receive;
        if source != endpoint {
            return Err(Error(
                "VPN DNS response came from an unexpected server".into(),
            ));
        }
        response.truncate(length);
        parse_a_response(&response, id)
    }
}

impl NameResolver for VpnDnsResolver {
    fn resolve_ipv4<'a>(&'a self, host: &'a str) -> ResolveFuture<'a> {
        Box::pin(async move { self.resolve(host).await })
    }
}

fn build_query(host: &str, id: u16) -> Result<Vec<u8>> {
    let mut query = Vec::with_capacity(DNS_HEADER_LEN + host.len() + 6);
    query.extend_from_slice(&id.to_be_bytes());
    query.extend_from_slice(&0x0100_u16.to_be_bytes());
    query.extend_from_slice(&1_u16.to_be_bytes());
    query.extend_from_slice(&0_u16.to_be_bytes());
    query.extend_from_slice(&0_u16.to_be_bytes());
    query.extend_from_slice(&0_u16.to_be_bytes());
    for label in host.split('.') {
        if label.is_empty()
            || label.len() > 63
            || !label
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        {
            return Err(Error("DNS name has an invalid label".into()));
        }
        query.push(label.len() as u8);
        query.extend_from_slice(label.as_bytes());
    }
    query.push(0);
    query.extend_from_slice(&DNS_TYPE_A.to_be_bytes());
    query.extend_from_slice(&DNS_CLASS_IN.to_be_bytes());
    Ok(query)
}

fn read_u16(data: &[u8], offset: usize) -> Result<u16> {
    let bytes = data
        .get(offset..offset + 2)
        .ok_or_else(|| Error("DNS message is truncated".into()))?;
    Ok(u16::from_be_bytes([bytes[0], bytes[1]]))
}

fn skip_name(data: &[u8], mut offset: usize) -> Result<usize> {
    let start = offset;
    let mut consumed = None;
    let mut jumps = 0;
    loop {
        let length = *data
            .get(offset)
            .ok_or_else(|| Error("DNS name is truncated".into()))?;
        if length & 0xc0 == 0xc0 {
            let suffix = *data
                .get(offset + 1)
                .ok_or_else(|| Error("DNS compression pointer is truncated".into()))?;
            let target = (usize::from(length & 0x3f) << 8) | usize::from(suffix);
            if target >= data.len() || target >= offset || jumps >= MAX_POINTER_JUMPS {
                return Err(Error("DNS compression pointer is invalid".into()));
            }
            consumed.get_or_insert(offset + 2);
            offset = target;
            jumps += 1;
        } else if length == 0 {
            return Ok(consumed.unwrap_or(offset + 1).max(start + 1));
        } else {
            if length > 63 || length & 0xc0 != 0 {
                return Err(Error("DNS label length is invalid".into()));
            }
            offset = offset
                .checked_add(1 + usize::from(length))
                .ok_or_else(|| Error("DNS label length overflow".into()))?;
            if offset > data.len() {
                return Err(Error("DNS label is truncated".into()));
            }
        }
    }
}

fn parse_a_response(data: &[u8], expected_id: u16) -> Result<Ipv4Addr> {
    if data.len() < DNS_HEADER_LEN || read_u16(data, 0)? != expected_id {
        return Err(Error("DNS response header is invalid".into()));
    }
    let flags = read_u16(data, 2)?;
    if flags & 0x8000 == 0 || flags & 0x0200 != 0 || flags & 0x000f != 0 {
        return Err(Error("DNS response status is not successful".into()));
    }
    let question_count = usize::from(read_u16(data, 4)?);
    let answer_count = usize::from(read_u16(data, 6)?);
    if question_count == 0 || answer_count == 0 {
        return Err(Error("DNS response contains no answer".into()));
    }
    let mut offset = DNS_HEADER_LEN;
    for _ in 0..question_count {
        offset = skip_name(data, offset)?;
        offset = offset
            .checked_add(4)
            .ok_or_else(|| Error("DNS question length overflow".into()))?;
        if offset > data.len() {
            return Err(Error("DNS question is truncated".into()));
        }
    }
    for _ in 0..answer_count {
        offset = skip_name(data, offset)?;
        let record = data
            .get(offset..offset + 10)
            .ok_or_else(|| Error("DNS answer is truncated".into()))?;
        let record_type = u16::from_be_bytes([record[0], record[1]]);
        let class = u16::from_be_bytes([record[2], record[3]]);
        let data_length = usize::from(u16::from_be_bytes([record[8], record[9]]));
        offset += 10;
        let record_data = data
            .get(offset..offset + data_length)
            .ok_or_else(|| Error("DNS answer data is truncated".into()))?;
        if record_type == DNS_TYPE_A && class == DNS_CLASS_IN && data_length == 4 {
            return Ok(Ipv4Addr::new(
                record_data[0],
                record_data[1],
                record_data[2],
                record_data[3],
            ));
        }
        offset += data_length;
    }
    Err(Error("DNS response contains no IPv4 address".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn query_encoding_is_bounded() {
        let query = build_query("hpc3.internal.example", 0x1234).unwrap();
        assert_eq!(&query[..2], &[0x12, 0x34]);
        assert!(query.ends_with(&[0, 0, 1, 0, 1]));
        assert!(build_query("bad..name", 1).is_err());
    }

    #[test]
    fn parses_compressed_a_answer() {
        let mut response = build_query("host.example", 0x1234).unwrap();
        response[2..4].copy_from_slice(&0x8180_u16.to_be_bytes());
        response[6..8].copy_from_slice(&1_u16.to_be_bytes());
        response.extend_from_slice(&[0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 30, 0, 4, 10, 20, 30, 40]);
        assert_eq!(
            parse_a_response(&response, 0x1234).unwrap(),
            Ipv4Addr::new(10, 20, 30, 40)
        );
        assert!(parse_a_response(&response, 7).is_err());
    }
}
