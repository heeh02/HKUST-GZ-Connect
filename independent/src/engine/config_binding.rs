use crate::engine::provider_composition::ProductionProviderFamily;
use crate::{Error, ErrorKind, Result};
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs::{File, OpenOptions};
use std::io::{Read, Take};
use std::path::Path;
use url::Url;

pub const MAX_ENGINE_CONFIG_BYTES: usize = 256 * 1024;
pub const MAX_CONFIG_BINDING_FRAME_BYTES: usize = 1024;
const MAX_JAVASCRIPT_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ConfigBindingFrame {
    #[serde(rename = "type")]
    kind: String,
    api_version: u8,
    config_sha256: String,
    gateway_origin: String,
    profile_id: String,
    profile_revision: u64,
    protocol_family: String,
}

pub struct ExpectedConfigBinding {
    sha256: [u8; 32],
    gateway_origin: String,
    profile_id: String,
    profile_revision: u64,
    protocol_family: ProductionProviderFamily,
}

impl ExpectedConfigBinding {
    pub fn new(
        sha256: &str,
        gateway_origin: &str,
        profile_id: &str,
        profile_revision: u64,
        protocol_family: &str,
    ) -> Result<Self> {
        let digest = hex::decode(sha256)
            .ok()
            .and_then(|bytes| <[u8; 32]>::try_from(bytes).ok())
            .filter(|_| {
                sha256
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
            })
            .ok_or_else(config_binding_error)?;
        let gateway_origin = normalized_https_root_origin(gateway_origin)?;
        if !valid_profile_id(profile_id)
            || profile_revision == 0
            || profile_revision > MAX_JAVASCRIPT_SAFE_INTEGER
        {
            return Err(config_binding_error());
        }
        let protocol_family =
            ProductionProviderFamily::parse(protocol_family).map_err(|_| config_binding_error())?;
        Ok(Self {
            sha256: digest,
            gateway_origin,
            profile_id: profile_id.to_owned(),
            profile_revision,
            protocol_family,
        })
    }

    pub fn profile_id(&self) -> &str {
        &self.profile_id
    }

    pub const fn profile_revision(&self) -> u64 {
        self.profile_revision
    }

    pub const fn protocol_family(&self) -> ProductionProviderFamily {
        self.protocol_family
    }
}

fn config_binding_error() -> Error {
    Error::classified(
        ErrorKind::Configuration,
        "engine configuration binding is invalid",
    )
}

fn valid_profile_id(value: &str) -> bool {
    let bytes = value.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= 64
        && (bytes[0].is_ascii_lowercase() || bytes[0].is_ascii_digit())
        && bytes[bytes.len() - 1].is_ascii_alphanumeric()
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || *byte == b'-')
}

pub fn read_expected_config_binding<R: Read>(mut stream: R) -> Result<ExpectedConfigBinding> {
    let mut payload = Vec::with_capacity(256);
    loop {
        if payload.len() >= MAX_CONFIG_BINDING_FRAME_BYTES {
            return Err(config_binding_error());
        }
        let mut byte = [0_u8; 1];
        let count = stream.read(&mut byte).map_err(|_| config_binding_error())?;
        if count == 0 {
            return Err(config_binding_error());
        }
        if byte[0] == b'\n' {
            break;
        }
        payload.push(byte[0]);
    }
    let frame: ConfigBindingFrame =
        serde_json::from_slice(&payload).map_err(|_| config_binding_error())?;
    if frame.kind != "engine_config_binding" || frame.api_version != 1 {
        return Err(config_binding_error());
    }
    ExpectedConfigBinding::new(
        &frame.config_sha256,
        &frame.gateway_origin,
        &frame.profile_id,
        frame.profile_revision,
        &frame.protocol_family,
    )
}

fn normalized_https_root_origin(value: &str) -> Result<String> {
    let parsed = Url::parse(value).map_err(|_| config_binding_error())?;
    if parsed.scheme() != "https"
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.host_str().is_none()
        || parsed.path() != "/"
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err(config_binding_error());
    }
    Ok(parsed.origin().ascii_serialization())
}

#[cfg(unix)]
fn open_config(path: &Path) -> Result<File> {
    use std::os::unix::fs::{MetadataExt, OpenOptionsExt};

    let file = OpenOptions::new()
        .read(true)
        // O_NOFOLLOW rejects a last-component symlink. O_NONBLOCK also keeps
        // a regular-file-to-FIFO replacement from hanging this startup gate
        // before the opened-handle metadata check can reject it.
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)
        .map_err(|_| config_binding_error())?;
    let metadata = file.metadata().map_err(|_| config_binding_error())?;
    if !metadata.is_file() || metadata.nlink() != 1 {
        return Err(config_binding_error());
    }
    Ok(file)
}

#[cfg(windows)]
fn open_config(path: &Path) -> Result<File> {
    use std::os::windows::fs::{MetadataExt, OpenOptionsExt};

    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;
    let path_metadata = std::fs::symlink_metadata(path).map_err(|_| config_binding_error())?;
    if path_metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return Err(config_binding_error());
    }
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
        .map_err(|_| config_binding_error())?;
    let metadata = file.metadata().map_err(|_| config_binding_error())?;
    if !metadata.is_file() || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return Err(config_binding_error());
    }
    Ok(file)
}

#[cfg(not(any(unix, windows)))]
fn open_config(path: &Path) -> Result<File> {
    OpenOptions::new()
        .read(true)
        .open(path)
        .map_err(|_| config_binding_error())
}

fn read_bounded_config(path: &Path) -> Result<Vec<u8>> {
    let file = open_config(path)?;
    let metadata = file.metadata().map_err(|_| config_binding_error())?;
    if !metadata.is_file() || metadata.len() > MAX_ENGINE_CONFIG_BYTES as u64 {
        return Err(config_binding_error());
    }
    let mut payload = Vec::with_capacity(metadata.len() as usize);
    let mut bounded: Take<File> = file.take((MAX_ENGINE_CONFIG_BYTES + 1) as u64);
    bounded
        .read_to_end(&mut payload)
        .map_err(|_| config_binding_error())?;
    if payload.len() > MAX_ENGINE_CONFIG_BYTES || payload.len() as u64 != metadata.len() {
        return Err(config_binding_error());
    }
    Ok(payload)
}

pub fn load_engine_config(path: &Path, binding: Option<&ExpectedConfigBinding>) -> Result<Value> {
    let payload = read_bounded_config(path)?;
    let actual_sha256: [u8; 32] = Sha256::digest(&payload).into();
    if binding.is_some_and(|expected| actual_sha256 != expected.sha256) {
        return Err(config_binding_error());
    }
    let value: Value = serde_json::from_slice(&payload).map_err(|_| config_binding_error())?;
    if !value.is_object() {
        return Err(config_binding_error());
    }
    if let Some(expected) = binding {
        let actual = value["base_url"]
            .as_str()
            .ok_or_else(config_binding_error)
            .and_then(normalized_https_root_origin)?;
        if actual != expected.gateway_origin {
            return Err(config_binding_error());
        }
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::provider_composition::EASYCONNECT_PASSWORD_MODERN_L3_V1;
    use std::io::Write;

    fn fixture() -> (std::path::PathBuf, Vec<u8>) {
        let payload = br#"{"base_url":"https://vpn.example.edu","proxy":{}}"#.to_vec();
        let path = std::env::temp_dir().join(format!(
            "ec-config-binding-{}-{}.json",
            std::process::id(),
            rand::random::<u64>()
        ));
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .unwrap();
        file.write_all(&payload).unwrap();
        (path, payload)
    }

    fn binding(payload: &[u8]) -> ExpectedConfigBinding {
        ExpectedConfigBinding::new(
            &hex::encode(Sha256::digest(payload)),
            "https://vpn.example.edu",
            "school-a",
            7,
            "easyconnect-password-modern-l3-v1",
        )
        .unwrap()
    }

    fn binding_frame(payload: &[u8]) -> Vec<u8> {
        format!(
            "{{\"type\":\"engine_config_binding\",\"apiVersion\":1,\"configSha256\":\"{}\",\"gatewayOrigin\":\"https://vpn.example.edu\",\"profileId\":\"school-a\",\"profileRevision\":7,\"protocolFamily\":\"easyconnect-password-modern-l3-v1\"}}\ncredential-line\n",
            hex::encode(Sha256::digest(payload)),
        )
        .into_bytes()
    }

    #[test]
    fn exact_digest_origin_and_profile_context_load_once_from_one_handle() {
        let (path, payload) = fixture();
        let expected = binding(&payload);
        let value = load_engine_config(&path, Some(&expected)).unwrap();
        assert_eq!(value["base_url"], "https://vpn.example.edu");
        assert_eq!(expected.profile_id(), "school-a");
        assert_eq!(expected.profile_revision(), 7);
        assert_eq!(
            expected.protocol_family().name(),
            EASYCONNECT_PASSWORD_MODERN_L3_V1
        );
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn binding_frame_is_exact_bounded_and_never_consumes_the_credential_prefix() {
        let (path, payload) = fixture();
        let frame = binding_frame(&payload);
        let mut cursor = std::io::Cursor::new(frame);
        let expected = read_expected_config_binding(&mut cursor).unwrap();
        assert_eq!(expected.profile_id(), "school-a");
        let mut remainder = String::new();
        cursor.read_to_string(&mut remainder).unwrap();
        assert_eq!(remainder, "credential-line\n");

        for invalid in [
            b"{}\n".to_vec(),
            b"{\"type\":\"engine_config_binding\",\"apiVersion\":1,\"unknown\":true}\n".to_vec(),
            vec![b'x'; MAX_CONFIG_BINDING_FRAME_BYTES + 1],
        ] {
            assert!(read_expected_config_binding(invalid.as_slice()).is_err());
        }
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn digest_origin_profile_and_shape_mismatches_fail_closed_without_echoing_values() {
        let (path, payload) = fixture();
        for result in [
            ExpectedConfigBinding::new(
                &"00".repeat(32),
                "https://vpn.example.edu",
                "school-a",
                7,
                EASYCONNECT_PASSWORD_MODERN_L3_V1,
            )
            .and_then(|binding| load_engine_config(&path, Some(&binding))),
            ExpectedConfigBinding::new(
                &hex::encode(Sha256::digest(&payload)),
                "https://other.example.edu",
                "school-a",
                7,
                EASYCONNECT_PASSWORD_MODERN_L3_V1,
            )
            .and_then(|binding| load_engine_config(&path, Some(&binding))),
            ExpectedConfigBinding::new(
                &hex::encode(Sha256::digest(&payload)),
                "https://vpn.example.edu",
                "school-a",
                7,
                "dynamic-provider-name",
            )
            .and_then(|binding| load_engine_config(&path, Some(&binding))),
            ExpectedConfigBinding::new(
                "private-digest",
                "https://vpn.example.edu",
                "school-a",
                7,
                EASYCONNECT_PASSWORD_MODERN_L3_V1,
            )
            .and_then(|binding| load_engine_config(&path, Some(&binding))),
            ExpectedConfigBinding::new(
                &hex::encode(Sha256::digest(&payload)),
                "https://vpn.example.edu",
                "../school-a",
                7,
                EASYCONNECT_PASSWORD_MODERN_L3_V1,
            )
            .and_then(|binding| load_engine_config(&path, Some(&binding))),
        ] {
            let error = result.unwrap_err().to_string();
            assert_eq!(error, "engine configuration binding is invalid");
            assert!(!error.contains("private-digest"));
            assert!(!error.contains(path.to_string_lossy().as_ref()));
        }
        std::fs::remove_file(path).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn symlink_config_is_never_followed() {
        use std::os::unix::fs::symlink;

        let (path, payload) = fixture();
        let link = path.with_extension("link.json");
        symlink(&path, &link).unwrap();
        assert!(load_engine_config(&link, Some(&binding(&payload))).is_err());
        std::fs::remove_file(link).unwrap();
        std::fs::remove_file(path).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn fifo_config_without_a_writer_is_rejected_without_blocking() {
        let path = std::env::temp_dir().join(format!(
            "ec-config-binding-fifo-{}-{}",
            std::process::id(),
            rand::random::<u64>()
        ));
        let status = std::process::Command::new("mkfifo")
            .arg(&path)
            .status()
            .unwrap();
        assert!(status.success());
        assert!(load_engine_config(&path, None).is_err());
        std::fs::remove_file(path).unwrap();
    }
}
