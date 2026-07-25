use crate::tunnel::{CLIENT_ACK_LEN, CLIENT_SYNC_LEN, Preface};
use crate::{Error, Result};
use iced_x86::{Decoder, DecoderOptions, Instruction, Mnemonic, OpKind, Register};
use object::{Object, ObjectSection};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::fs;
use std::path::Path;
use zeroize::Zeroizing;

const MAX_BINARY_BYTES: usize = 256 * 1024 * 1024;
const BACKWARD_INSTRUCTION_LIMIT: usize = 12;
const SESSION_IDENTIFIER_LEN: usize = 32;
const SESSION_IDENTIFIER_OFFSET: usize = 44;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum SyncMaterialization {
    Fixed,
    SessionIdentifier { offset: usize, length: usize },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ControlLayout {
    Legacy,
    Windows767,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OfficialPrefaceAdapter {
    client_sync: [u8; CLIENT_SYNC_LEN],
    client_ack: [u8; CLIENT_ACK_LEN],
    sync_materialization: SyncMaterialization,
    architecture: &'static str,
    binary_sha256: [u8; 32],
    text_sha256: [u8; 32],
}

pub struct MaterializedPreface {
    client_sync: Zeroizing<[u8; CLIENT_SYNC_LEN]>,
    client_ack: [u8; CLIENT_ACK_LEN],
}

impl MaterializedPreface {
    pub fn preface(&self) -> Preface<'_> {
        Preface {
            client_sync: self.client_sync.as_ref(),
            client_ack: &self.client_ack,
        }
    }
}

impl OfficialPrefaceAdapter {
    pub fn from_executable(path: &Path) -> Result<Self> {
        let data = fs::read(path)?;
        if data.len() > MAX_BINARY_BYTES {
            return Err(Error("binary exceeds the adapter size limit".into()));
        }
        let object = object::File::parse(data.as_slice())
            .map_err(|error| Error(format!("unsupported executable format: {error}")))?;
        let (bitness, architecture, sync_materialization) = match object.architecture() {
            object::Architecture::X86_64 => (64, "x86_64", SyncMaterialization::Fixed),
            object::Architecture::I386 => (
                32,
                "x86",
                SyncMaterialization::SessionIdentifier {
                    offset: SESSION_IDENTIFIER_OFFSET,
                    length: SESSION_IDENTIFIER_LEN,
                },
            ),
            architecture => {
                return Err(Error(format!(
                    "unsupported adapter architecture: {architecture:?}"
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

        let readable_sections = object
            .sections()
            .filter_map(|section| {
                let section_data = section.data().ok()?;
                (!section_data.is_empty()).then_some((section.address(), section_data))
            })
            .collect::<Vec<_>>();
        let read_virtual = |address: u64, length: usize| {
            readable_sections.iter().find_map(|(start, bytes)| {
                let relative = address.checked_sub(*start)? as usize;
                let end = relative.checked_add(length)?;
                (end <= bytes.len()).then(|| bytes[relative..end].to_vec())
            })
        };

        let (sync_addresses, ack_addresses) =
            find_preface_addresses(text_data, text.address(), bitness, read_virtual);
        let sync_address = unique_address(sync_addresses, "client sync")?;
        let ack_address = unique_address(ack_addresses, "client ack")?;
        let client_sync: [u8; CLIENT_SYNC_LEN] = read_virtual(sync_address, CLIENT_SYNC_LEN)
            .and_then(|bytes| bytes.try_into().ok())
            .ok_or_else(|| Error("cannot resolve client sync bytes".into()))?;
        let client_ack: [u8; CLIENT_ACK_LEN] = read_virtual(ack_address, CLIENT_ACK_LEN)
            .and_then(|bytes| bytes.try_into().ok())
            .ok_or_else(|| Error("cannot resolve client ack bytes".into()))?;

        Ok(Self {
            client_sync,
            client_ack,
            sync_materialization,
            architecture,
            binary_sha256: Sha256::digest(&data).into(),
            text_sha256: Sha256::digest(text_data).into(),
        })
    }

    pub fn validate(&self) -> Result<()> {
        Preface {
            client_sync: &self.client_sync,
            client_ack: &self.client_ack,
        }
        .validate()
    }

    pub fn control_layout(&self) -> ControlLayout {
        ControlLayout::Legacy
    }

    pub fn materialize_preface(
        &self,
        session_identifier: Option<&[u8; SESSION_IDENTIFIER_LEN]>,
    ) -> Result<MaterializedPreface> {
        self.validate()?;
        let mut client_sync = Zeroizing::new(self.client_sync);
        match self.sync_materialization {
            SyncMaterialization::Fixed => {}
            SyncMaterialization::SessionIdentifier { offset, length } => {
                let identifier = session_identifier.ok_or_else(|| {
                    Error("official adapter requires a 32-byte session identifier".into())
                })?;
                if length != identifier.len() || offset + length > client_sync.len() {
                    return Err(Error("invalid session identifier patch metadata".into()));
                }
                client_sync[offset..offset + length].copy_from_slice(identifier);
            }
        }
        Ok(MaterializedPreface {
            client_sync,
            client_ack: self.client_ack,
        })
    }

    pub fn sanitized_summary(&self, filename: &str) -> Value {
        let materialization = match self.sync_materialization {
            SyncMaterialization::Fixed => json!({"mode": "fixed"}),
            SyncMaterialization::SessionIdentifier { offset, length } => json!({
                "mode": "session_identifier_patch",
                "offset": offset,
                "length": length,
            }),
        };
        let control = match self.control_layout() {
            ControlLayout::Legacy => json!({
                "mode": "legacy",
                "client_message_length": 76,
                "server_message_length": 40,
            }),
            ControlLayout::Windows767 => json!({
                "mode": "windows_7_6_7",
                "client_message_length": 64,
                "server_message_length": 36,
            }),
        };
        json!({
            "schema_version": 1,
            "binary": {
                "filename": filename,
                "sha256": hex::encode(self.binary_sha256),
                "text_sha256": hex::encode(self.text_sha256),
            },
            "adapter": {
                "architecture": self.architecture,
                "client_sync": {
                    "length": self.client_sync.len(),
                    "sha256": hex::encode(Sha256::digest(self.client_sync)),
                    "materialization": materialization,
                },
                "client_ack": {
                    "length": self.client_ack.len(),
                    "sha256": hex::encode(Sha256::digest(self.client_ack)),
                },
                "control": control,
            },
        })
    }
}

fn unique_address(addresses: BTreeSet<u64>, label: &str) -> Result<u64> {
    match addresses.len() {
        1 => Ok(*addresses.first().expect("one address")),
        0 => Err(Error(format!("cannot locate {label} preface"))),
        count => Err(Error(format!(
            "ambiguous {label} preface: {count} referenced candidates"
        ))),
    }
}

fn immediate(instruction: &Instruction, operand: u32) -> Option<u64> {
    match instruction.op_kind(operand) {
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
    }
}

fn direct_register_immediate(instruction: &Instruction) -> Option<(Register, u64)> {
    if instruction.mnemonic() != Mnemonic::Mov
        || instruction.op_count() != 2
        || instruction.op_kind(0) != OpKind::Register
    {
        return None;
    }
    Some((instruction.op_register(0), immediate(instruction, 1)?))
}

fn looks_like_sync(bytes: &[u8]) -> bool {
    bytes.len() == CLIENT_SYNC_LEN
        && bytes[0] == 0x16
        && bytes[1] == 0x03
        && bytes[2] <= 0x04
        && usize::from(u16::from_be_bytes([bytes[3], bytes[4]])) + 5 == bytes.len()
        && bytes[5] == 0x01
}

fn looks_like_ack(bytes: &[u8]) -> bool {
    bytes.len() == CLIENT_ACK_LEN
        && bytes[0] == 0x14
        && bytes[1] == 0x03
        && bytes[2] <= 0x04
        && u16::from_be_bytes([bytes[3], bytes[4]]) == 1
        && bytes[5] == 1
        && bytes[6] == 0x16
        && bytes[7] == bytes[1]
        && bytes[8] == bytes[2]
        && usize::from(u16::from_be_bytes([bytes[9], bytes[10]])) + 11 == bytes.len()
}

fn find_preface_addresses<F>(
    text: &[u8],
    text_address: u64,
    bitness: u32,
    read_virtual: F,
) -> (BTreeSet<u64>, BTreeSet<u64>)
where
    F: Fn(u64, usize) -> Option<Vec<u8>>,
{
    let mut decoder = Decoder::with_ip(bitness, text, text_address, DecoderOptions::NONE);
    let mut instructions = Vec::new();
    while decoder.can_decode() {
        instructions.push(decoder.decode());
    }

    let mut sync = BTreeSet::new();
    let mut ack = BTreeSet::new();
    for (index, instruction) in instructions.iter().enumerate() {
        if instruction.mnemonic() != Mnemonic::Call {
            continue;
        }
        let mut length = None;
        let mut address = None;
        let mut pushed_immediates = Vec::new();
        for previous in instructions[..index]
            .iter()
            .rev()
            .take(BACKWARD_INSTRUCTION_LIMIT)
        {
            if previous.mnemonic() == Mnemonic::Call {
                break;
            }
            if previous.mnemonic() == Mnemonic::Push
                && let Some(value) = immediate(previous, 0)
            {
                pushed_immediates.push(value);
            }
            let Some((register, value)) = direct_register_immediate(previous) else {
                continue;
            };
            if length.is_none() && matches!(register, Register::EDX | Register::RDX) {
                length = usize::try_from(value).ok();
            }
            if address.is_none() && matches!(register, Register::ESI | Register::RSI) {
                address = Some(value);
            }
        }
        if bitness == 32 {
            let has_session_length = pushed_immediates.contains(&(SESSION_IDENTIFIER_LEN as u64));
            let has_sync_length = pushed_immediates.contains(&(CLIENT_SYNC_LEN as u64));
            let has_ack_length = pushed_immediates.contains(&(CLIENT_ACK_LEN as u64));
            for candidate in pushed_immediates.iter().copied() {
                if has_session_length
                    && has_sync_length
                    && read_virtual(candidate, CLIENT_SYNC_LEN)
                        .is_some_and(|bytes| looks_like_sync(&bytes))
                {
                    sync.insert(candidate);
                }
                if has_ack_length
                    && read_virtual(candidate, CLIENT_ACK_LEN)
                        .is_some_and(|bytes| looks_like_ack(&bytes))
                {
                    ack.insert(candidate);
                }
            }
            continue;
        }
        let (Some(length), Some(address)) = (length, address) else {
            continue;
        };
        if length == CLIENT_SYNC_LEN
            && read_virtual(address, length).is_some_and(|bytes| looks_like_sync(&bytes))
        {
            sync.insert(address);
        }
        if length == CLIENT_ACK_LEN
            && read_virtual(address, length).is_some_and(|bytes| looks_like_ack(&bytes))
        {
            ack.insert(address);
        }
    }
    (sync, ack)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_only_call_referenced_tls_shaped_prefaces() {
        let mut sync = [0_u8; CLIENT_SYNC_LEN];
        sync[..6].copy_from_slice(&[0x16, 0x03, 0x01, 0x00, 0x4d, 0x01]);
        let mut ack = [0_u8; CLIENT_ACK_LEN];
        ack[..11].copy_from_slice(&[
            0x14, 0x03, 0x01, 0x00, 0x01, 0x01, 0x16, 0x03, 0x01, 0x00, 0x20,
        ]);

        let text = [
            0xba, 0x52, 0x00, 0x00, 0x00, // mov edx, 82
            0xbe, 0x00, 0x20, 0x00, 0x00, // mov esi, 0x2000
            0xe8, 0x00, 0x00, 0x00, 0x00, // call next
            0xba, 0x2b, 0x00, 0x00, 0x00, // mov edx, 43
            0xbe, 0x00, 0x21, 0x00, 0x00, // mov esi, 0x2100
            0xe8, 0x00, 0x00, 0x00, 0x00, // call next
        ];
        let reader = |address, length| match (address, length) {
            (0x2000, CLIENT_SYNC_LEN) => Some(sync.to_vec()),
            (0x2100, CLIENT_ACK_LEN) => Some(ack.to_vec()),
            _ => None,
        };
        let (sync_addresses, ack_addresses) = find_preface_addresses(&text, 0x1000, 64, reader);
        assert_eq!(sync_addresses, BTreeSet::from([0x2000]));
        assert_eq!(ack_addresses, BTreeSet::from([0x2100]));
    }

    #[test]
    fn finds_x86_session_patched_sync_and_fixed_ack() {
        let mut sync = [0_u8; CLIENT_SYNC_LEN];
        sync[..6].copy_from_slice(&[0x16, 0x03, 0x01, 0x00, 0x4d, 0x01]);
        let mut ack = [0_u8; CLIENT_ACK_LEN];
        ack[..11].copy_from_slice(&[
            0x14, 0x03, 0x01, 0x00, 0x01, 0x01, 0x16, 0x03, 0x01, 0x00, 0x20,
        ]);
        let text = [
            0x6a, 0x20, // push 32-byte session identifier length
            0x50, // push eax
            0x6a, 0x52, // push 82-byte sync length
            0x68, 0x00, 0x20, 0x00, 0x00, // push sync template
            0x51, // push ecx
            0xe8, 0, 0, 0, 0, // call builder
            0x6a, 0x2b, // push 43-byte ack length
            0x68, 0x00, 0x21, 0x00, 0x00, // push ack
            0x56, // push esi
            0xe8, 0, 0, 0, 0, // call writer
        ];
        let reader = |address, length| match (address, length) {
            (0x2000, CLIENT_SYNC_LEN) => Some(sync.to_vec()),
            (0x2100, CLIENT_ACK_LEN) => Some(ack.to_vec()),
            _ => None,
        };
        let (sync_addresses, ack_addresses) = find_preface_addresses(&text, 0x1000, 32, reader);
        assert_eq!(sync_addresses, BTreeSet::from([0x2000]));
        assert_eq!(ack_addresses, BTreeSet::from([0x2100]));
    }

    #[test]
    fn rejects_shape_without_complete_record_lengths() {
        assert!(!looks_like_sync(&[0; CLIENT_SYNC_LEN]));
        assert!(!looks_like_ack(&[0; CLIENT_ACK_LEN]));
    }
}
