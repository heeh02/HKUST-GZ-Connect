pub use crate::gateway_http::endpoint_url;
use crate::xml::{MAX_XML_BYTES, child_text, direct_child, parse_xml};
use crate::{Error, Result};
use reqwest::blocking::{Client, Response};
use reqwest::header::{ACCEPT, CONTENT_LENGTH, USER_AGENT};
use reqwest::redirect::Policy;
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::{Read, Write};
use std::path::Path;
use std::time::Duration;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use url::Url;

pub const SNAPSHOT_SCHEMA_VERSION: u64 = 1;
pub const DEFAULT_MAX_ARTIFACT_BYTES: u64 = 512 * 1024 * 1024;
pub const DEFAULT_TIMEOUT_SECONDS: u64 = 15;

const DISCOVERY_FIELDS: &[&str] = &[
    "ErrorCode",
    "StartAuth",
    "RndImg",
    "Anonymous",
    "Deny_normal_user",
    "Softkey",
    "enablethirdpartycert",
    "enablewechatqrcode",
    "Is_enable_mult_client",
    "Is_multclient_version",
    "DomainSSOEnable",
    "DenyAccessWithoutCom",
    "DeviceType",
    "AllowBindSms",
    "GMVERSION",
    "VPNVERSION",
    "SSLALGOR",
    "EFlag",
];

const SENSITIVE_XML_FIELDS: &[&str] = &[
    "TWFID",
    "CSRF_RAND_CODE",
    "RSA_ENCRYPT_KEY",
    "RSA_ENCRYPT_EXP",
    "PASSWORD",
    "TOKEN",
    "COOKIE",
    "SESSIONID",
    "SID",
];

const SENSITIVE_FIELD_MARKERS: &[&str] = &[
    "PASSWORD",
    "PASSWD",
    "TOKEN",
    "COOKIE",
    "SESSION",
    "CSRF",
    "RSA_ENCRYPT",
    "TWFID",
];

const HIGH_RISK_MODULES: &[&str] = &[
    "CSClientModule",
    "SangforCoreModule",
    "TCPModule",
    "TCPX64Module",
    "TCPDriverModule",
    "L3vpnModule",
    "VnicModule",
    "VnicModule64",
    "ECAgentModule",
    "ECBaseModule",
    "DnsModule",
    "DnsDriverModule",
    "EasyConnectModule",
];

pub fn utc_now() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "unknown".into())
}

pub fn canonical_hash(value: &Value) -> String {
    let payload = serde_json::to_vec(value).expect("JSON values always serialize");
    hex::encode(Sha256::digest(payload))
}

pub fn is_sensitive_field(name: &str) -> bool {
    let normalized = name.to_ascii_uppercase();
    SENSITIVE_XML_FIELDS.contains(&normalized.as_str())
        || SENSITIVE_FIELD_MARKERS
            .iter()
            .any(|marker| normalized.contains(marker))
}

pub fn parse_discovery(data: &[u8]) -> Result<Value> {
    let document = parse_xml(data, "auth discovery")?;
    let root = document.root_element();
    let mut values = Map::new();
    for name in DISCOVERY_FIELDS {
        let value = root
            .descendants()
            .find(|node| node.is_element() && node.tag_name().name() == *name)
            .and_then(|node| node.text())
            .unwrap_or_default()
            .trim();
        if !value.is_empty() {
            values.insert((*name).into(), Value::String(value.into()));
        }
    }
    let schema_fields = root
        .descendants()
        .filter(|node| node.is_element())
        .map(|node| node.tag_name().name())
        .filter(|name| !is_sensitive_field(name))
        .map(str::to_owned)
        .collect::<BTreeSet<_>>()
        .into_iter()
        .map(Value::String)
        .collect::<Vec<_>>();
    let mut result = json!({
        "values": values,
        "schema_fields": schema_fields,
    });
    let hash = canonical_hash(&result);
    result["compatibility_hash"] = Value::String(hash);
    Ok(result)
}

fn package_entry(platform: &str, kind: &str, node: roxmltree::Node<'_, '_>) -> Value {
    let info = direct_child(node, "info");
    let raw_link = info
        .and_then(|value| direct_child(value, "link"))
        .and_then(|value| value.text())
        .unwrap_or_default()
        .trim();
    let parsed = Url::parse(raw_link).ok();
    let link_host = parsed
        .as_ref()
        .and_then(Url::host_str)
        .map(|host| {
            parsed
                .as_ref()
                .and_then(Url::port)
                .map(|port| format!("{host}:{port}"))
                .unwrap_or_else(|| host.to_owned())
        })
        .unwrap_or_default();
    let link_path = parsed
        .as_ref()
        .map(Url::path)
        .unwrap_or_default()
        .to_owned();
    json!({
        "platform": platform,
        "kind": kind,
        "alias": child_text(node, "alias"),
        "version": child_text(node, "version"),
        "custom": info.map(|value| child_text(value, "custom")).unwrap_or_default(),
        "link_present": !raw_link.is_empty(),
        "link_host": link_host,
        "link_path": link_path,
    })
}

pub fn parse_packages(data: &[u8]) -> Result<Value> {
    let document = parse_xml(data, "package metadata")?;
    let root = document.root_element();
    let mut packages = Vec::new();
    if let Some(mac) = direct_child(root, "mac") {
        packages.push(package_entry("mac", "default", mac));
    }
    if let Some(linux) = direct_child(root, "linux") {
        for package_type in linux.children().filter(roxmltree::Node::is_element) {
            for architecture in package_type.children().filter(roxmltree::Node::is_element) {
                packages.push(package_entry(
                    "linux",
                    &format!(
                        "{}-{}",
                        package_type.tag_name().name(),
                        architecture.tag_name().name()
                    ),
                    architecture,
                ));
            }
        }
    }
    packages.sort_by_key(|item| {
        format!(
            "{}:{}",
            item["platform"].as_str().unwrap_or_default(),
            item["kind"].as_str().unwrap_or_default()
        )
    });
    let mut result = json!({"packages": packages});
    result["compatibility_hash"] = Value::String(canonical_hash(&result));
    Ok(result)
}

fn strip_xml_declaration(data: &[u8]) -> &[u8] {
    let start = data
        .iter()
        .position(|byte| !byte.is_ascii_whitespace())
        .unwrap_or(data.len());
    if data
        .get(start..start + 5)
        .is_some_and(|value| value.eq_ignore_ascii_case(b"<?xml"))
        && let Some(end) = data[start..].windows(2).position(|value| value == b"?>")
    {
        return &data[start + end + 2..];
    }
    data
}

fn normalize_element(node: roxmltree::Node<'_, '_>) -> Value {
    let attributes = node
        .attributes()
        .map(|attribute| (attribute.name().to_owned(), json!(attribute.value())))
        .collect::<Map<_, _>>();
    let children = node
        .children()
        .filter(roxmltree::Node::is_element)
        .map(normalize_element)
        .collect::<Vec<_>>();
    json!({
        "tag": node.tag_name().name(),
        "attributes": attributes,
        "text": node.text().unwrap_or_default().trim(),
        "children": children,
    })
}

fn parse_modules_document(document: &roxmltree::Document<'_>) -> Result<Value> {
    let root = document.root_element();
    let modules = if root.tag_name().name() == "Modules" {
        root
    } else {
        root.children()
            .find(|node| node.is_element() && node.tag_name().name() == "Modules")
            .ok_or_else(|| Error("Windows module manifest: missing Modules element".into()))?
    };
    let mut entries = Vec::new();
    for node in modules
        .children()
        .filter(|node| node.is_element() && node.tag_name().name() == "Module")
    {
        let name = child_text(node, "ModuleName");
        if name.is_empty() {
            continue;
        }
        let dependencies = child_text(node, "Dependence")
            .split(';')
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(Value::from)
            .collect::<Vec<_>>();
        entries.push(json!({
            "name": name,
            "alias": child_text(node, "AliasName"),
            "version": child_text(node, "Version"),
            "basic": child_text(node, "BasicModule").eq_ignore_ascii_case("true"),
            "dependencies": dependencies,
            "path": child_text(node, "ServInstallPath"),
            "vendor_md5": child_text(node, "MD5").to_ascii_lowercase(),
        }));
    }
    entries.sort_by_key(|item| item["name"].as_str().unwrap_or_default().to_owned());
    let vpn_version = direct_child(modules, "VpnVersion")
        .map(|node| child_text(node, "Version"))
        .unwrap_or_default();
    let install_options = if root.tag_name().name() == "InstallOption" {
        Some(root)
    } else {
        root.children()
            .find(|node| node.is_element() && node.tag_name().name() == "InstallOption")
    };
    let install_option_modules = install_options
        .map(|options| {
            options
                .children()
                .filter(|node| node.is_element() && node.tag_name().name() == "Module")
                .map(|node| child_text(node, "ModuleName"))
                .filter(|name| !name.is_empty())
                .collect::<BTreeSet<_>>()
                .into_iter()
                .map(Value::String)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let install_options_hash = install_options
        .map(normalize_element)
        .map(|value| canonical_hash(&value))
        .unwrap_or_default();
    let mut result = json!({
        "vpn_version": vpn_version,
        "module_count": entries.len(),
        "modules": entries,
        "install_option_modules": install_option_modules,
        "install_options_hash": install_options_hash,
    });
    result["compatibility_hash"] = Value::String(canonical_hash(&result));
    Ok(result)
}

pub fn parse_modules(data: &[u8]) -> Result<Value> {
    match parse_xml(data, "Windows module manifest") {
        Ok(document) => parse_modules_document(&document),
        Err(original) => {
            let fragment = strip_xml_declaration(data);
            let mut wrapped = b"<SangforManifest>".to_vec();
            wrapped.extend_from_slice(fragment);
            wrapped.extend_from_slice(b"</SangforManifest>");
            let document =
                parse_xml(&wrapped, "Windows module manifest fragment").map_err(|_| original)?;
            parse_modules_document(&document)
        }
    }
}

fn client(timeout_seconds: u64, ca_file: Option<&str>) -> Result<Client> {
    let mut builder = Client::builder()
        .timeout(Duration::from_secs(timeout_seconds))
        .redirect(Policy::none())
        .https_only(true);
    if let Some(path) = ca_file.filter(|value| !value.is_empty()) {
        let pem = fs::read(path)?;
        let certificate = reqwest::Certificate::from_pem(&pem)
            .map_err(|error| Error(format!("{path}: invalid CA certificate: {error}")))?;
        builder = builder.add_root_certificate(certificate);
    }
    builder
        .build()
        .map_err(|error| Error(format!("cannot build HTTPS client: {error}")))
}

fn response_headers(response: &Response) -> BTreeMap<String, String> {
    response
        .headers()
        .iter()
        .filter_map(|(name, value)| {
            value
                .to_str()
                .ok()
                .map(|value| (name.as_str().to_ascii_lowercase(), value.trim().to_owned()))
        })
        .collect()
}

fn fetch_xml(client: &Client, url: &str) -> Result<(Vec<u8>, BTreeMap<String, String>, u16)> {
    let mut response = client
        .get(url)
        .header(USER_AGENT, "hkustgzconnect-ec-watch/2")
        .header(ACCEPT, "application/xml,text/xml,*/*;q=0.1")
        .send()
        .map_err(|error| Error(format!("{url}: request failed: {error}")))?;
    let status = response.status().as_u16();
    let headers = response_headers(&response);
    let mut body = Vec::new();
    response
        .by_ref()
        .take((MAX_XML_BYTES + 1) as u64)
        .read_to_end(&mut body)?;
    if body.len() > MAX_XML_BYTES {
        return Err(Error(format!("{url}: response is too large")));
    }
    Ok((body, headers, status))
}

fn fetch_head(client: &Client, url: &str) -> Result<(BTreeMap<String, String>, u16)> {
    let response = client
        .head(url)
        .header(USER_AGENT, "hkustgzconnect-ec-watch/2")
        .send()
        .map_err(|error| Error(format!("{url}: request failed: {error}")))?;
    let status = response.status().as_u16();
    Ok((response_headers(&response), status))
}

fn fetch_artifact_digest(
    client: &Client,
    url: &str,
    max_bytes: u64,
) -> Result<(String, u64, BTreeMap<String, String>, u16)> {
    let mut response = client
        .get(url)
        .header(USER_AGENT, "hkustgzconnect-ec-watch/2")
        .header(ACCEPT, "application/octet-stream,*/*;q=0.1")
        .send()
        .map_err(|error| Error(format!("{url}: request failed: {error}")))?;
    let status = response.status().as_u16();
    let headers = response_headers(&response);
    if let Some(length) = response.headers().get(CONTENT_LENGTH) {
        let length = length
            .to_str()
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .ok_or_else(|| Error(format!("{url}: invalid Content-Length")))?;
        if length > max_bytes {
            return Err(Error(format!(
                "{url}: declared artifact size exceeds {max_bytes} bytes"
            )));
        }
    }
    let mut digest = Sha256::new();
    let mut byte_count = 0_u64;
    let mut buffer = [0_u8; 1024 * 1024];
    loop {
        let read = response.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        byte_count += read as u64;
        if byte_count > max_bytes {
            return Err(Error(format!("{url}: artifact exceeds {max_bytes} bytes")));
        }
        digest.update(&buffer[..read]);
    }
    Ok((hex::encode(digest.finalize()), byte_count, headers, status))
}

fn string(config: &Value, key: &str) -> String {
    config[key].as_str().unwrap_or_default().trim().to_owned()
}

fn endpoint(config: &Value, name: &str) -> Result<String> {
    let path = config["endpoints"][name]
        .as_str()
        .unwrap_or_default()
        .trim();
    if path.is_empty() {
        return Err(Error(format!("missing endpoint: {name}")));
    }
    endpoint_url(&string(config, "base_url"), path)
}

pub fn collect_snapshot(config: &Value) -> Result<Value> {
    let target = string(config, "target");
    let base_url = string(config, "base_url");
    if target.is_empty() || !config["endpoints"].is_object() {
        return Err(Error(
            "config requires target, base_url, and endpoints".into(),
        ));
    }
    if Url::parse(&base_url)
        .ok()
        .map(|url| url.scheme() == "https")
        != Some(true)
    {
        return Err(Error("base_url must use HTTPS".into()));
    }
    let timeout = config["timeout_seconds"]
        .as_u64()
        .unwrap_or(DEFAULT_TIMEOUT_SECONDS);
    let http = client(timeout, config["ca_file"].as_str())?;
    let get_xml = |name: &str| -> Result<(Vec<u8>, BTreeMap<String, String>)> {
        let url = endpoint(config, name)?;
        let (body, headers, status) = fetch_xml(&http, &url)?;
        if status != 200 {
            return Err(Error(format!("{name}: unexpected HTTP status {status}")));
        }
        Ok((body, headers))
    };
    let (discovery_body, discovery_headers) = get_xml("discovery")?;
    let (packages_body, packages_headers) = get_xml("packages")?;
    let (modules_body, modules_headers) = get_xml("windows_modules")?;
    let installer_path = config["endpoints"]["windows_installer"]
        .as_str()
        .unwrap_or_default()
        .trim();
    let installer_metadata = if installer_path.is_empty() {
        json!({})
    } else {
        let url = endpoint_url(&base_url, installer_path)?;
        let hash = config["hash_windows_installer"].as_bool().unwrap_or(true);
        let (sha256, byte_count, headers, status) = if hash {
            fetch_artifact_digest(
                &http,
                &url,
                config["max_artifact_bytes"]
                    .as_u64()
                    .unwrap_or(DEFAULT_MAX_ARTIFACT_BYTES),
            )?
        } else {
            let (headers, status) = fetch_head(&http, &url)?;
            let byte_count = headers
                .get("content-length")
                .and_then(|value| value.parse().ok())
                .unwrap_or(0);
            (String::new(), byte_count, headers, status)
        };
        json!({
            "http_status": status,
            "content_length": byte_count.to_string(),
            "content_type": headers.get("content-type").cloned().unwrap_or_default(),
            "last_modified": headers.get("last-modified").cloned().unwrap_or_default(),
            "etag": headers.get("etag").cloned().unwrap_or_default(),
            "sha256": sha256,
        })
    };
    let mut snapshot = json!({
        "schema_version": SNAPSHOT_SCHEMA_VERSION,
        "collected_at": utc_now(),
        "target": target,
        "base_url": base_url,
        "discovery": parse_discovery(&discovery_body)?,
        "packages": parse_packages(&packages_body)?,
        "windows_modules": parse_modules(&modules_body)?,
        "windows_installer": installer_metadata,
        "source_metadata": {
            "discovery_last_modified": discovery_headers.get("last-modified").cloned().unwrap_or_default(),
            "packages_last_modified": packages_headers.get("last-modified").cloned().unwrap_or_default(),
            "modules_last_modified": modules_headers.get("last-modified").cloned().unwrap_or_default(),
        },
    });
    let mut hash_source = snapshot.clone();
    hash_source
        .as_object_mut()
        .expect("snapshot is an object")
        .remove("collected_at");
    snapshot["snapshot_hash"] = Value::String(canonical_hash(&hash_source));
    Ok(snapshot)
}

fn object_map(value: &Value, section: &str, array: &str, keys: &[&str]) -> BTreeMap<String, Value> {
    value[section][array]
        .as_array()
        .into_iter()
        .flatten()
        .map(|item| {
            (
                keys.iter()
                    .map(|key| item[*key].as_str().unwrap_or_default())
                    .collect::<Vec<_>>()
                    .join(":"),
                item.clone(),
            )
        })
        .collect()
}

pub fn diff_snapshots(old: &Value, new: &Value) -> Value {
    let mut changes = Vec::new();
    let mut change = |category: &str, key: &str, before: &Value, after: &Value, severity: &str| {
        if before != after {
            changes.push(json!({
                "category": category,
                "key": key,
                "before": before,
                "after": after,
                "severity": severity,
            }));
        }
    };
    for key in ["target", "schema_version", "base_url"] {
        change("snapshot", key, &old[key], &new[key], "critical");
    }
    let old_values = old["discovery"]["values"].as_object();
    let new_values = new["discovery"]["values"].as_object();
    let discovery_keys = old_values
        .into_iter()
        .flat_map(|value| value.keys())
        .chain(new_values.into_iter().flat_map(|value| value.keys()))
        .cloned()
        .collect::<BTreeSet<_>>();
    for key in discovery_keys {
        let critical = [
            "StartAuth",
            "RndImg",
            "Softkey",
            "enablethirdpartycert",
            "Is_enable_mult_client",
            "DomainSSOEnable",
            "DeviceType",
            "VPNVERSION",
        ]
        .contains(&key.as_str());
        change(
            "discovery",
            &key,
            &old["discovery"]["values"][&key],
            &new["discovery"]["values"][&key],
            if critical { "critical" } else { "warning" },
        );
    }
    change(
        "discovery",
        "schema_fields",
        &old["discovery"]["schema_fields"],
        &new["discovery"]["schema_fields"],
        "warning",
    );
    let old_packages = object_map(old, "packages", "packages", &["platform", "kind"]);
    let new_packages = object_map(new, "packages", "packages", &["platform", "kind"]);
    for key in old_packages
        .keys()
        .chain(new_packages.keys())
        .cloned()
        .collect::<BTreeSet<_>>()
    {
        change(
            "package",
            &key,
            old_packages.get(&key).unwrap_or(&Value::Null),
            new_packages.get(&key).unwrap_or(&Value::Null),
            "warning",
        );
    }
    let old_modules = object_map(old, "windows_modules", "modules", &["name"]);
    let new_modules = object_map(new, "windows_modules", "modules", &["name"]);
    for key in old_modules
        .keys()
        .chain(new_modules.keys())
        .cloned()
        .collect::<BTreeSet<_>>()
    {
        change(
            "windows_module",
            &key,
            old_modules.get(&key).unwrap_or(&Value::Null),
            new_modules.get(&key).unwrap_or(&Value::Null),
            if HIGH_RISK_MODULES.contains(&key.as_str()) {
                "critical"
            } else {
                "warning"
            },
        );
    }
    for key in [
        "vpn_version",
        "install_option_modules",
        "install_options_hash",
    ] {
        change(
            "windows_module_manifest",
            key,
            &old["windows_modules"][key],
            &new["windows_modules"][key],
            if matches!(key, "vpn_version" | "install_options_hash") {
                "critical"
            } else {
                "warning"
            },
        );
    }
    for key in [
        "http_status",
        "content_length",
        "content_type",
        "last_modified",
        "etag",
        "sha256",
    ] {
        change(
            "windows_installer",
            key,
            &old["windows_installer"][key],
            &new["windows_installer"][key],
            if matches!(key, "content_length" | "last_modified" | "etag" | "sha256") {
                "critical"
            } else {
                "warning"
            },
        );
    }
    let mut summary = json!({"info": 0, "warning": 0, "critical": 0});
    for item in &changes {
        let severity = item["severity"].as_str().unwrap_or("info");
        summary[severity] = Value::from(summary[severity].as_u64().unwrap_or(0) + 1);
    }
    json!({
        "schema_version": 1,
        "old_snapshot_hash": old["snapshot_hash"].as_str().unwrap_or_default(),
        "new_snapshot_hash": new["snapshot_hash"].as_str().unwrap_or_default(),
        "changed": !changes.is_empty(),
        "summary": summary,
        "changes": changes,
    })
}

pub fn load_json(path: &Path) -> Result<Value> {
    let value: Value = serde_json::from_slice(
        &fs::read(path).map_err(|error| Error(format!("{}: {error}", path.display())))?,
    )
    .map_err(|error| Error(format!("{}: cannot load JSON: {error}", path.display())))?;
    if !value.is_object() {
        return Err(Error(format!("{}: expected a JSON object", path.display())));
    }
    Ok(value)
}

pub fn write_json(path: Option<&Path>, value: &Value) -> Result<()> {
    let mut payload = serde_json::to_vec_pretty(value)?;
    payload.push(b'\n');
    if let Some(path) = path {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(path, payload)?;
    } else {
        std::io::stdout().write_all(&payload)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const DISCOVERY: &[u8] = include_bytes!("../tests/fixtures/login_auth.xml");
    const PACKAGES: &[u8] = include_bytes!("../tests/fixtures/ec_pkg.xml");
    const MODULES: &[u8] = include_bytes!("../tests/fixtures/windows_modules.xml");

    fn base_snapshot() -> Value {
        json!({
            "snapshot_hash": "old",
            "schema_version": 1,
            "discovery": parse_discovery(DISCOVERY).unwrap(),
            "packages": parse_packages(PACKAGES).unwrap(),
            "windows_modules": parse_modules(MODULES).unwrap(),
            "windows_installer": {
                "http_status": 200,
                "content_length": "100",
                "content_type": "application/x-msdownload",
                "last_modified": "yesterday",
                "etag": "",
                "sha256": "abc",
            },
            "target": "test",
            "base_url": "https://vpn.example.edu",
        })
    }

    #[test]
    fn discovery_is_sanitized() {
        let result = parse_discovery(DISCOVERY).unwrap();
        assert_eq!(result["values"]["VPNVERSION"], "M7.6.8R2");
        let serialized = result.to_string();
        assert!(!serialized.contains("REDACTED"));
        assert!(
            !result["schema_fields"]
                .to_string()
                .contains("CSRF_RAND_CODE")
        );
        assert!(!result["schema_fields"].to_string().contains("TwfID"));
        assert_eq!(
            result["compatibility_hash"],
            "e6cc59e19ee8d09d052463e71cd3da39e1fd631dd8a9090ba187a8bc7aa34624"
        );
    }

    #[test]
    fn package_links_discard_credentials_and_queries() {
        let result = parse_packages(PACKAGES).unwrap();
        let packages = result["packages"].as_array().unwrap();
        let mac = packages
            .iter()
            .find(|item| item["platform"] == "mac")
            .unwrap();
        assert_eq!(mac["version"], "7.6.7.4");
        assert_eq!(mac["link_host"], "download.example.edu");
        assert_eq!(mac["link_path"], "/client.pkg");
        let serialized = mac.to_string();
        assert!(!serialized.contains("synthetic"));
        assert!(!serialized.contains("demo"));
        assert!(!serialized.contains("fake"));
        assert_eq!(
            result["compatibility_hash"],
            "768242cb066abe101e51db447591ca10891e56294514a4a14efafe19242df669"
        );
    }

    #[test]
    fn module_fragment_and_dependencies_parse() {
        let result = parse_modules(MODULES).unwrap();
        assert_eq!(result["vpn_version"], "7.6.7.0.201");
        assert_eq!(result["module_count"], 2);
        assert_eq!(result["install_option_modules"][0], "TCPModule");
        assert!(!result["install_options_hash"].as_str().unwrap().is_empty());
        assert_eq!(
            result["compatibility_hash"],
            "35fcc693cb5b373574559d72d38e489852aaf2bff3d042ee256d6312c5a5f85a"
        );
    }

    #[test]
    fn endpoint_is_origin_bound() {
        assert!(
            endpoint_url(
                "https://vpn.example.edu",
                "https://attacker.invalid/payload"
            )
            .is_err()
        );
        assert_eq!(
            endpoint_url("https://vpn.example.edu/base", "/metadata.xml").unwrap(),
            "https://vpn.example.edu/metadata.xml"
        );
    }

    #[test]
    fn diff_classifies_critical_changes() {
        let old = base_snapshot();
        let mut new = old.clone();
        new["snapshot_hash"] = json!("new");
        assert!(!diff_snapshots(&old, &new)["changed"].as_bool().unwrap());
        new["discovery"]["values"]["RndImg"] = json!("1");
        let result = diff_snapshots(&old, &new);
        assert_eq!(result["summary"]["critical"], 1);
        assert_eq!(result["changes"][0]["key"], "RndImg");
    }
}
