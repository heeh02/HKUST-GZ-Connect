use crate::{Error, Result};
use flate2::read::GzDecoder;
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs::File;
use std::io::{Cursor, Read};
use std::path::Path;

pub const MAX_PACKAGE_BYTES: u64 = 512 * 1024 * 1024;
pub const MAX_MEMBER_BYTES: usize = 256 * 1024 * 1024;
pub const AR_MAGIC: &[u8] = b"!<arch>\n";

const BINARY_PATHS: &[(&str, &str)] = &[
    (
        "svpnservice",
        "./usr/share/sangfor/EasyConnect/resources/bin/svpnservice",
    ),
    (
        "ECAgent",
        "./usr/share/sangfor/EasyConnect/resources/bin/ECAgent",
    ),
    (
        "CSClient",
        "./usr/share/sangfor/EasyConnect/resources/bin/CSClient",
    ),
    (
        "EasyMonitor",
        "./usr/share/sangfor/EasyConnect/resources/bin/EasyMonitor",
    ),
];

const CAPABILITY_MARKERS: &[(&str, &[&[u8]])] = &[
    ("auth.configuration_endpoint", &[b"/por/conf.csp"]),
    ("auth.logout_endpoint", &[b"/por/logout.csp"]),
    ("auth.resource_endpoint", &[b"/por/rclist.csp"]),
    ("auth.session_identifier", &[b"TWFID"]),
    ("l3.command_tunnel", &[b"MakeCmdTunnel"]),
    ("l3.handshake.client_message", &[b"WriteV clientMsg"]),
    ("l3.handshake.server_message", &[b"RecvV serverMsg"]),
    ("l3.handshake.tls_ack", &[b"RecvV ssl ack"]),
    ("l3.handshake.tls_syn", &[b"WriteV ssl syn"]),
    ("l3.new_connection", &[b"MakeTunnel NEWCONNECT"]),
    ("l3.reconnect", &[b"MakeTunnel RECONNECT"]),
    ("l3.tcp_keepalive", &[b"SO_KEEPALIVE"]),
    ("l3.udp_tunnel", &[b"m_bUdpTunnelCanUse", b"UdpSendThread"]),
];

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    !needle.is_empty()
        && haystack
            .windows(needle.len())
            .any(|window| window == needle)
}

fn sha256_bytes(value: &[u8]) -> String {
    hex::encode(Sha256::digest(value))
}

fn sha256_file(path: &Path) -> Result<String> {
    let mut file = File::open(path)?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 1024 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            return Ok(hex::encode(digest.finalize()));
        }
        digest.update(&buffer[..read]);
    }
}

pub fn read_ar_members(path: &Path) -> Result<BTreeMap<String, Vec<u8>>> {
    if path.metadata()?.len() > MAX_PACKAGE_BYTES {
        return Err(Error("package exceeds the configured size limit".into()));
    }
    let mut stream = File::open(path)?;
    let mut magic = [0_u8; 8];
    stream.read_exact(&mut magic)?;
    if magic != AR_MAGIC {
        return Err(Error("package is not an ar archive".into()));
    }
    let mut members = BTreeMap::new();
    loop {
        let mut header = [0_u8; 60];
        let first = stream.read(&mut header[..1])?;
        if first == 0 {
            break;
        }
        stream
            .read_exact(&mut header[1..])
            .map_err(|_| Error("invalid ar member header".into()))?;
        if &header[58..60] != b"`\n" {
            return Err(Error("invalid ar member header".into()));
        }
        let name = std::str::from_utf8(&header[..16])
            .map_err(|_| Error("invalid ar member name".into()))?
            .trim()
            .trim_end_matches('/')
            .to_owned();
        let size = std::str::from_utf8(&header[48..58])
            .ok()
            .and_then(|value| value.trim().parse::<usize>().ok())
            .ok_or_else(|| Error("invalid ar member size".into()))?;
        if size > MAX_MEMBER_BYTES {
            return Err(Error("ar member exceeds the size limit".into()));
        }
        let mut data = vec![0; size];
        stream
            .read_exact(&mut data)
            .map_err(|_| Error("truncated ar member".into()))?;
        if size % 2 == 1 {
            let mut padding = [0_u8; 1];
            stream.read_exact(&mut padding)?;
        }
        if name == "debian-binary"
            || ["control.tar", "data.tar"]
                .iter()
                .any(|prefix| name == *prefix || name.starts_with(&format!("{prefix}.")))
        {
            members.insert(name, data);
        }
    }
    if !members.keys().any(|name| name.starts_with("control.tar"))
        || !members.keys().any(|name| name.starts_with("data.tar"))
    {
        return Err(Error("Debian package is missing required members".into()));
    }
    Ok(members)
}

fn parse_control(value: &[u8]) -> BTreeMap<String, String> {
    String::from_utf8_lossy(value)
        .lines()
        .filter(|line| !line.starts_with(char::is_whitespace))
        .filter_map(|line| line.split_once(':'))
        .filter(|(key, _)| matches!(*key, "Package" | "Version" | "Architecture" | "Maintainer"))
        .map(|(key, value)| (key.to_ascii_lowercase(), value.trim().to_owned()))
        .collect()
}

fn archive_reader(name: &str, data: Vec<u8>) -> Result<Box<dyn Read>> {
    let cursor = Cursor::new(data);
    match name {
        value if value.ends_with(".tar") => Ok(Box::new(cursor)),
        value if value.ends_with(".tar.gz") => Ok(Box::new(GzDecoder::new(cursor))),
        value if value.ends_with(".tar.xz") => Ok(Box::new(xz2::read::XzDecoder::new(cursor))),
        value if value.ends_with(".tar.zst") || value.ends_with(".tar.zstd") => {
            zstd::stream::read::Decoder::new(cursor)
                .map(|decoder| Box::new(decoder) as Box<dyn Read>)
                .map_err(|error| Error(format!("invalid zstd stream: {error}")))
        }
        _ => Err(Error(format!(
            "unsupported Debian tar compression for {name}"
        ))),
    }
}

fn tar_members(
    name: &str,
    compressed: Vec<u8>,
    wanted: &[&str],
) -> Result<BTreeMap<String, Vec<u8>>> {
    let mut archive = tar::Archive::new(archive_reader(name, compressed)?);
    let mut result = BTreeMap::new();
    for entry in archive
        .entries()
        .map_err(|error| Error(format!("invalid tar archive: {error}")))?
    {
        let mut entry = entry.map_err(|error| Error(format!("invalid tar member: {error}")))?;
        let path = entry
            .path()
            .map_err(|error| Error(format!("invalid tar path: {error}")))?
            .to_string_lossy()
            .into_owned();
        let normalized = path.trim_start_matches("./");
        if wanted
            .iter()
            .any(|candidate| candidate.trim_start_matches("./") == normalized)
        {
            if entry.size() > MAX_MEMBER_BYTES as u64 {
                return Err(Error(format!("tar member exceeds limit: {path}")));
            }
            let mut data = Vec::with_capacity(entry.size() as usize);
            entry.read_to_end(&mut data)?;
            result.insert(normalized.to_owned(), data);
        }
    }
    Ok(result)
}

pub fn inspect_package(path: &Path) -> Result<Value> {
    let mut members = read_ar_members(path)?;
    let control_name = members
        .keys()
        .find(|name| name.starts_with("control.tar"))
        .cloned()
        .ok_or_else(|| Error("package control archive is missing".into()))?;
    let data_name = members
        .keys()
        .find(|name| name.starts_with("data.tar"))
        .cloned()
        .ok_or_else(|| Error("package data archive is missing".into()))?;
    let control_members = tar_members(
        &control_name,
        members
            .remove(&control_name)
            .expect("validated required member"),
        &["./control", "control"],
    )?;
    let control_bytes = control_members
        .get("control")
        .ok_or_else(|| Error("package control metadata is missing".into()))?;
    let control = parse_control(control_bytes);
    if control.is_empty() {
        return Err(Error("package control metadata is missing".into()));
    }
    let wanted = BINARY_PATHS
        .iter()
        .map(|(_, path)| *path)
        .collect::<Vec<_>>();
    let binary_members = tar_members(
        &data_name,
        members
            .remove(&data_name)
            .expect("validated required member"),
        &wanted,
    )?;
    let mut binaries = Map::new();
    for (logical_name, expected_path) in BINARY_PATHS {
        let normalized = expected_path.trim_start_matches("./");
        let data = binary_members
            .get(normalized)
            .ok_or_else(|| Error(format!("missing expected binary: {logical_name}")))?;
        let capabilities = CAPABILITY_MARKERS
            .iter()
            .map(|(label, markers)| {
                (
                    (*label).to_owned(),
                    Value::Bool(markers.iter().all(|marker| contains(data, marker))),
                )
            })
            .collect::<Map<_, _>>();
        binaries.insert(
            (*logical_name).to_owned(),
            json!({
                "size": data.len(),
                "sha256": sha256_bytes(data),
                "capabilities": capabilities,
            }),
        );
    }
    let mut package = Map::new();
    package.insert(
        "filename".into(),
        Value::String(
            path.file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
        ),
    );
    package.insert("size".into(), Value::from(path.metadata()?.len()));
    package.insert("sha256".into(), Value::String(sha256_file(path)?));
    for (key, value) in control {
        package.insert(key, Value::String(value));
    }
    Ok(json!({
        "schema_version": 1,
        "package": package,
        "binaries": binaries,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::Compression;
    use flate2::write::GzEncoder;
    use std::fs;
    use std::io::Write;

    fn tar_bytes(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut archive = tar::Builder::new(Vec::new());
        for (name, value) in files {
            let mut header = tar::Header::new_gnu();
            header.set_size(value.len() as u64);
            header.set_mode(0o644);
            header.set_cksum();
            archive
                .append_data(&mut header, name, Cursor::new(*value))
                .unwrap();
        }
        archive.into_inner().unwrap()
    }

    fn tar_gz(files: &[(&str, &[u8])]) -> Vec<u8> {
        let output = Vec::new();
        let mut encoder = GzEncoder::new(output, Compression::default());
        encoder.write_all(&tar_bytes(files)).unwrap();
        encoder.finish().unwrap()
    }

    fn ar_archive(members: &[(&str, Vec<u8>)]) -> Vec<u8> {
        let mut output = AR_MAGIC.to_vec();
        for (name, value) in members {
            let header = format!(
                "{:<16}{:<12}{:<6}{:<6}{:<8o}{:<10}`\n",
                format!("{name}/"),
                0,
                0,
                0,
                0o100644,
                value.len()
            );
            assert_eq!(header.len(), 60);
            output.extend_from_slice(header.as_bytes());
            output.extend_from_slice(value);
            if value.len() % 2 == 1 {
                output.push(b'\n');
            }
        }
        output
    }

    #[test]
    fn inspects_package_without_emitting_vendor_strings() {
        let control = tar_gz(&[(
            "./control",
            b"Package: easyconnect\nVersion: 1.2.3\nArchitecture: amd64\nMaintainer: Vendor\n",
        )]);
        let marker_data = b"WriteV ssl syn\0RecvV ssl ack\0";
        let binary_files = BINARY_PATHS
            .iter()
            .map(|(_, path)| (*path, marker_data.as_slice()))
            .collect::<Vec<_>>();
        let package = ar_archive(&[
            ("debian-binary", b"2.0\n".to_vec()),
            ("control.tar.gz", control),
            ("data.tar.gz", tar_gz(&binary_files)),
        ]);
        // Rust test names contain `::`, which is not a valid Windows filename.
        // The process id is sufficient because this test creates one package.
        let path = std::env::temp_dir().join(format!("ec-compat-test-{}.deb", std::process::id()));
        fs::write(&path, package).unwrap();
        let result = inspect_package(&path).unwrap();
        fs::remove_file(path).unwrap();
        assert_eq!(result["package"]["version"], "1.2.3");
        let capabilities = &result["binaries"]["svpnservice"]["capabilities"];
        assert_eq!(capabilities["l3.handshake.tls_syn"], true);
        assert_eq!(capabilities["l3.handshake.tls_ack"], true);
        assert_eq!(capabilities["l3.udp_tunnel"], false);
        assert!(!result.to_string().contains("WriteV ssl syn"));
    }

    #[test]
    fn rejects_truncated_archive() {
        let path =
            std::env::temp_dir().join(format!("ec-compat-truncated-{}.deb", std::process::id()));
        let mut file = File::create(&path).unwrap();
        file.write_all(AR_MAGIC).unwrap();
        file.write_all(b"short").unwrap();
        drop(file);
        assert!(read_ar_members(&path).is_err());
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn accepts_common_debian_compressions() {
        let tar = tar_bytes(&[("control", b"Package: test\n")]);
        let mut xz = xz2::write::XzEncoder::new(Vec::new(), 6);
        xz.write_all(&tar).unwrap();
        let compressed = [
            ("control.tar", tar.clone()),
            ("control.tar.xz", xz.finish().unwrap()),
            (
                "control.tar.zst",
                zstd::stream::encode_all(Cursor::new(&tar), 3).unwrap(),
            ),
        ];
        for (name, data) in compressed {
            let members = tar_members(name, data, &["control"]).unwrap();
            assert_eq!(members["control"], b"Package: test\n");
        }
    }
}
