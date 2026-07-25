use crate::{Error, Result};
use iced_x86::{Decoder, DecoderOptions, OpKind};
use object::{Object, ObjectSection};
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::Path;

const MAX_BINARY_BYTES: usize = 256 * 1024 * 1024;

const PROTOCOL_MARKERS: &[(&str, &[u8])] = &[
    ("command_tunnel.create", b"MakeCmdTunnel"),
    ("data_tunnel.create", b"MakeTunnel"),
    ("data_tunnel.new", b"MakeTunnel NEWCONNECT"),
    ("data_tunnel.reconnect", b"MakeTunnel RECONNECT"),
    ("handshake.tls_syn", b"WriteV ssl syn"),
    ("handshake.tls_ack_receive", b"RecvV ssl ack"),
    ("handshake.tls_ack_send", b"WriteV ssl ack"),
    ("handshake.client_message", b"WriteV clientMsg"),
    ("handshake.server_message", b"RecvV serverMsg"),
    ("handshake.server_reply", b"_HandleServerReply"),
    ("handshake.server_magic", b"AABB"),
    ("session.context", b"sslctx"),
    ("session.change", b"L3VpnChangeTwfid"),
    ("heartbeat.command", b"send HEARTBEAT"),
    ("heartbeat.data_send", b"send heartbeat"),
    ("heartbeat.data_receive", b"recv heartbeat"),
    ("heartbeat.windows_tcp", b"rec TCP HeartBeat"),
    ("packet.tun_read", b"ReadTunPacket()"),
    ("packet.tunnel_write", b"m_sendTunnel.Write()"),
    ("packet.tcp_receive", b"TcpRecvThread"),
    ("packet.tcp_send", b"TcpSendThread"),
    ("packet.header_check", b"checkHead"),
    ("packet.fix_header_v3", b"IPTunnel_FixHeader_V3"),
    ("transport.udp", b"UdpSendThread"),
];

fn occurrences(haystack: &[u8], needle: &[u8]) -> Vec<usize> {
    if needle.is_empty() {
        return Vec::new();
    }
    haystack
        .windows(needle.len())
        .enumerate()
        .filter_map(|(offset, value)| (value == needle).then_some(offset))
        .collect()
}

fn c_string_start(data: &[u8], offset: usize) -> usize {
    let lower_bound = offset.saturating_sub(4096);
    data[lower_bound..offset]
        .iter()
        .rposition(|byte| *byte == 0)
        .map(|relative| lower_bound + relative + 1)
        .unwrap_or(offset)
}

pub fn xrefs_to_addresses(
    text: &[u8],
    text_address: u64,
    targets: &BTreeSet<u64>,
) -> BTreeMap<u64, Vec<u64>> {
    xrefs_to_addresses_with_bitness(text, text_address, targets, 64)
}

fn xrefs_to_addresses_with_bitness(
    text: &[u8],
    text_address: u64,
    targets: &BTreeSet<u64>,
    bitness: u32,
) -> BTreeMap<u64, Vec<u64>> {
    let mut result = targets
        .iter()
        .map(|target| (*target, Vec::new()))
        .collect::<BTreeMap<_, _>>();
    let mut decoder = Decoder::with_ip(bitness, text, text_address, DecoderOptions::NONE);
    while decoder.can_decode() {
        let instruction = decoder.decode();
        let mut referenced = BTreeSet::new();
        if instruction.is_ip_rel_memory_operand() {
            referenced.insert(instruction.ip_rel_memory_address());
        }
        for operand in 0..instruction.op_count() {
            let immediate = match instruction.op_kind(operand) {
                OpKind::Immediate8 => Some(instruction.immediate8() as u64),
                OpKind::Immediate8_2nd => Some(instruction.immediate8_2nd() as u64),
                OpKind::Immediate16 => Some(instruction.immediate16() as u64),
                OpKind::Immediate32 => Some(instruction.immediate32() as u64),
                OpKind::Immediate64 => Some(instruction.immediate64()),
                OpKind::Immediate8to16 => Some(instruction.immediate8to16() as u64),
                OpKind::Immediate8to32 => Some(instruction.immediate8to32() as u64),
                OpKind::Immediate8to64 => Some(instruction.immediate8to64() as u64),
                OpKind::Immediate32to64 => Some(instruction.immediate32to64() as u64),
                _ => None,
            };
            if let Some(immediate) = immediate {
                referenced.insert(immediate);
            }
        }
        for target in referenced {
            if let Some(xrefs) = result.get_mut(&target) {
                xrefs.push(instruction.ip() - text_address);
            }
        }
    }
    result
}

pub fn inspect_protocol_markers(path: &Path) -> Result<Value> {
    let data = fs::read(path)?;
    if data.len() > MAX_BINARY_BYTES {
        return Err(Error("binary exceeds the analysis size limit".into()));
    }
    let object = object::File::parse(data.as_slice())
        .map_err(|error| Error(format!("unsupported executable format: {error}")))?;
    let (bitness, architecture) = match object.architecture() {
        object::Architecture::X86_64 => (64, "x86_64"),
        object::Architecture::I386 => (32, "x86"),
        architecture => {
            return Err(Error(format!(
                "unsupported analysis architecture: {architecture:?}"
            )));
        }
    };
    let text = object
        .section_by_name(".text")
        .or_else(|| object.section_by_name("__text"))
        .ok_or_else(|| Error("executable has no text section".into()))?;
    let text_data = text
        .data()
        .map_err(|error| Error(format!("cannot read text section: {error}")))?;
    let text_address = text.address();

    let sections = object
        .sections()
        .filter_map(|section| {
            section
                .file_range()
                .map(|(offset, size)| (offset as usize, size as usize, section.address()))
        })
        .collect::<Vec<_>>();
    let file_to_address = |offset: usize| {
        sections.iter().find_map(|(start, size, address)| {
            (*start <= offset && offset < start.saturating_add(*size))
                .then_some(address + (offset - start) as u64)
        })
    };

    let marker_addresses = PROTOCOL_MARKERS
        .iter()
        .map(|(label, marker)| {
            let raw_occurrences = occurrences(&data, marker);
            let addresses = raw_occurrences
                .iter()
                .map(|offset| c_string_start(&data, *offset))
                .filter_map(file_to_address)
                .collect::<BTreeSet<_>>();
            ((*label).to_owned(), (raw_occurrences.len(), addresses))
        })
        .collect::<BTreeMap<_, _>>();
    let targets = marker_addresses
        .values()
        .flat_map(|(_, addresses)| addresses)
        .copied()
        .collect::<BTreeSet<_>>();
    let xrefs = xrefs_to_addresses_with_bitness(text_data, text_address, &targets, bitness);

    let mut markers = Map::new();
    for (label, (occurrence_count, addresses)) in marker_addresses {
        let offsets = addresses
            .iter()
            .flat_map(|address| xrefs.get(address).into_iter().flatten())
            .copied()
            .collect::<BTreeSet<_>>();
        markers.insert(
            label,
            json!({
                "present": !addresses.is_empty(),
                "occurrence_count": occurrence_count,
                "xref_count": offsets.len(),
                "text_relative_xrefs": offsets,
            }),
        );
    }
    Ok(json!({
        "schema_version": 1,
        "binary": {
            "filename": path.file_name().unwrap_or_default().to_string_lossy(),
            "size": data.len(),
            "sha256": hex::encode(Sha256::digest(&data)),
            "architecture": architecture,
        },
        "text": {
            "size": text_data.len(),
            "sha256": hex::encode(Sha256::digest(text_data)),
        },
        "markers": markers,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_rip_relative_reference_without_copying_code() {
        // lea rax, [rip + 9] points to 0x1010; mov edi, 0x2020 is absolute.
        let text = [
            0x48, 0x8d, 0x05, 0x09, 0x00, 0x00, 0x00, 0xbf, 0x20, 0x20, 0x00, 0x00, 0xc3,
        ];
        let targets = BTreeSet::from([0x1010, 0x2020]);
        let result = xrefs_to_addresses(&text, 0x1000, &targets);
        assert_eq!(result[&0x1010], [0]);
        assert_eq!(result[&0x2020], [7]);
    }

    #[test]
    fn resolves_32_bit_immediate_reference() {
        // mov eax, 0x2020; ret
        let text = [0xb8, 0x20, 0x20, 0x00, 0x00, 0xc3];
        let targets = BTreeSet::from([0x2020]);
        let result = xrefs_to_addresses_with_bitness(&text, 0x1000, &targets, 32);
        assert_eq!(result[&0x2020], [0]);
    }
}
