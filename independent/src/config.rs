use crate::tunnel::SessionContext;
use crate::xml::{direct_child, parse_xml};
use crate::{Error, Result};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::net::{IpAddr, Ipv4Addr};
use url::Url;
use zeroize::{Zeroize, Zeroizing};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Endpoint {
    pub host: String,
    pub port: u16,
    pub scheme: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PortRange {
    pub start: u16,
    pub end: u16,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PortPolicy {
    pub unrestricted: bool,
    pub ranges: Vec<PortRange>,
}

impl PortPolicy {
    pub fn allows(&self, port: u16) -> bool {
        port > 0
            && (self.unrestricted
                || self
                    .ranges
                    .iter()
                    .any(|range| range.start <= port && port <= range.end))
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GatewayConfiguration {
    pub l3_dns: Vec<String>,
    pub vpn_lines: Vec<Endpoint>,
    pub web_vpn: Option<Endpoint>,
    pub has_l3_configuration: bool,
    pub has_tcp_configuration: bool,
}

pub struct TunnelBootstrap {
    pub server: Option<IpAddr>,
    pub port: Option<u16>,
    pub lan_address: Option<Ipv4Addr>,
    session_identifier: Option<Zeroizing<String>>,
    pub context: Option<SessionContext>,
}

impl TunnelBootstrap {
    pub fn session_identifier(&self) -> Option<&str> {
        self.session_identifier.as_ref().map(|value| value.as_str())
    }

    pub fn safe_summary(&self) -> Value {
        json!({
            "present": true,
            "complete": self.server.is_some()
                && self.port.is_some()
                && self.session_identifier.is_some()
                && self.context.is_some(),
            "server_address_family": self.server.map(|server| {
                if server.is_ipv4() { "ipv4" } else { "ipv6" }
            }),
            "port_present": self.port.is_some(),
            "lan_address_present": self.lan_address.is_some(),
            "session_identifier_present": self.session_identifier.is_some(),
            "session_identifier_length": self.session_identifier
                .as_ref()
                .map(|value| value.len())
                .unwrap_or(0),
            "context_present": self.context.is_some(),
            "client_binding_bytes": self.context.as_ref().map(|_| 16).unwrap_or(0),
            "payload_material_present": self.context
                .as_ref()
                .is_some_and(SessionContext::payload_material_present),
            "serialized": false,
        })
    }
}

impl std::fmt::Debug for TunnelBootstrap {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("TunnelBootstrap")
            .field("server", &"<redacted>")
            .field("port", &"<redacted>")
            .field("lan_address", &"<redacted>")
            .field("session_identifier", &"<redacted>")
            .field(
                "context",
                &if self.context.is_some() {
                    "<redacted>"
                } else {
                    "<absent>"
                },
            )
            .finish()
    }
}

impl GatewayConfiguration {
    pub fn safe_summary(&self) -> Value {
        json!({
            "l3_dns_count": self.l3_dns.len(),
            "vpn_line_count": self.vpn_lines.len(),
            "web_vpn_present": self.web_vpn.is_some(),
            "has_l3_configuration": self.has_l3_configuration,
            "has_tcp_configuration": self.has_tcp_configuration,
        })
    }
}

#[derive(Clone, Eq, PartialEq)]
pub struct Resource {
    pub identifier: String,
    pub resource_type: String,
    pub protocol: String,
    pub host: String,
    pub ports: PortPolicy,
    pub service: String,
    pub group_identifier: String,
}

impl std::fmt::Debug for Resource {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("Resource")
            .field("identifier", &"<redacted>")
            .field("resource_type", &"<redacted>")
            .field("protocol", &"<redacted>")
            .field("host", &"<redacted>")
            .field("ports", &"<redacted>")
            .field("service", &"<redacted>")
            .field("group_identifier", &"<redacted>")
            .finish()
    }
}

#[derive(Clone, Eq, PartialEq)]
pub struct ResourceConfiguration {
    pub resources: Vec<Resource>,
    pub dns_policy_present: bool,
    pub default_resource_identifier: String,
}

impl std::fmt::Debug for ResourceConfiguration {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ResourceConfiguration")
            .field("resource_count", &self.resources.len())
            .field("dns_policy_present", &self.dns_policy_present)
            .field(
                "default_resource_present",
                &!self.default_resource_identifier.is_empty(),
            )
            .finish()
    }
}

impl ResourceConfiguration {
    pub fn safe_summary(&self) -> Value {
        let mut protocols = BTreeMap::<&'static str, usize>::new();
        let mut types = BTreeMap::<&'static str, usize>::new();
        for resource in &self.resources {
            let protocol = match resource.protocol.to_ascii_lowercase().as_str() {
                "" => "unspecified",
                "http" => "http",
                "https" => "https",
                "tcp" => "tcp",
                "udp" => "udp",
                _ => "other",
            };
            let resource_type = match resource.resource_type.to_ascii_lowercase().as_str() {
                "" => "unspecified",
                "web" => "web",
                "tcp" => "tcp",
                "udp" => "udp",
                "app" | "application" | "remote_app" | "remoteapp" => "application",
                "folder" | "group" => "folder",
                _ => "other",
            };
            *protocols.entry(protocol).or_default() += 1;
            *types.entry(resource_type).or_default() += 1;
        }
        json!({
            "resource_count": self.resources.len(),
            "dns_policy_present": self.dns_policy_present,
            "default_resource_present": !self.default_resource_identifier.is_empty(),
            "protocol_counts": protocols,
            "type_counts": types,
        })
    }
}

fn parse_port(value: &str) -> Result<u16> {
    value
        .parse::<u16>()
        .ok()
        .filter(|port| *port > 0)
        .ok_or_else(|| Error("port is outside 1..65535".into()))
}

pub fn parse_port_policy(value: &str) -> Result<PortPolicy> {
    let value = value.trim();
    if matches!(value, "" | "0" | "*") {
        return Ok(PortPolicy {
            unrestricted: true,
            ranges: Vec::new(),
        });
    }
    let mut ranges = Vec::new();
    for item in value
        .split(|character: char| matches!(character, ',' | ';' | '|') || character.is_whitespace())
    {
        if item.is_empty() {
            continue;
        }
        let (start, end) = item
            .split_once('-')
            .or_else(|| item.split_once('~'))
            .unwrap_or((item, item));
        if end.contains(['-', '~']) {
            return Err(Error(
                "resource port policy has multiple range separators".into(),
            ));
        }
        let non_decimal_class = |bound: &str| {
            if bound.contains(':') {
                "colon"
            } else if bound.contains('/') {
                "slash"
            } else if bound.contains('~') {
                "tilde"
            } else if bound.chars().any(|character| character.is_alphabetic()) {
                "alphabetic"
            } else {
                "other"
            }
        };
        let start = start.parse::<u32>().map_err(|_| {
            Error(format!(
                "resource port policy contains a {} non-decimal bound",
                non_decimal_class(start)
            ))
        })?;
        let end = end.parse::<u32>().map_err(|_| {
            Error(format!(
                "resource port policy contains a {} non-decimal bound",
                non_decimal_class(end)
            ))
        })?;
        if start == 0 || end == 0 {
            return Err(Error("resource port policy contains a zero bound".into()));
        }
        if start > u16::MAX as u32 || end > u16::MAX as u32 {
            return Err(Error("resource port policy bound exceeds 65535".into()));
        }
        let start = start as u16;
        let end = end as u16;
        if start > end {
            return Err(Error("resource port range is invalid".into()));
        }
        ranges.push(PortRange { start, end });
    }
    if ranges.is_empty() {
        return Err(Error("resource port policy is empty".into()));
    }
    Ok(PortPolicy {
        unrestricted: false,
        ranges,
    })
}

fn parse_endpoint(value: &str, default_scheme: &str) -> Result<Option<Endpoint>> {
    let value = value.trim();
    if value.is_empty() {
        return Ok(None);
    }
    let candidate = if value.contains("://") {
        value.to_owned()
    } else {
        format!("{default_scheme}://{value}")
    };
    let parsed = Url::parse(&candidate).map_err(|_| Error("invalid endpoint".into()))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(Error("unsupported endpoint".into()));
    }
    let host = parsed
        .host_str()
        .filter(|host| !host.is_empty())
        .ok_or_else(|| Error("invalid endpoint".into()))?
        .to_owned();
    let port = parsed
        .port_or_known_default()
        .ok_or_else(|| Error("invalid endpoint".into()))?;
    Ok(Some(Endpoint {
        host,
        port,
        scheme: parsed.scheme().to_owned(),
    }))
}

fn valid_dns(value: &str) -> Result<Option<String>> {
    let value = value.trim();
    if value.is_empty() || value == "0.0.0.0" {
        return Ok(None);
    }
    let address = value
        .parse::<IpAddr>()
        .map_err(|_| Error("invalid L3 DNS address".into()))?;
    Ok(Some(address.to_string()))
}

pub fn parse_gateway_configuration(data: &[u8]) -> Result<GatewayConfiguration> {
    let document = parse_xml(data, "gateway configuration")?;
    let root = document.root_element();
    if root.tag_name().name() != "Conf" {
        return Err(Error("configuration root must be Conf".into()));
    }
    let l3 = direct_child(root, "L3VPN");
    let mut dns_values = Vec::new();
    if let Some(node) = l3 {
        for name in ["iptunDns", "iptunDnsBak"] {
            if let Some(value) = valid_dns(node.attribute(name).unwrap_or_default())?
                && !dns_values.contains(&value)
            {
                dns_values.push(value);
            }
        }
    }
    let mut vpn_lines = Vec::new();
    for node in root
        .children()
        .filter(|node| node.is_element() && node.tag_name().name() == "Vpnline")
    {
        for value in node
            .attribute("address")
            .unwrap_or_default()
            .replace(',', ";")
            .split(';')
        {
            if let Some(endpoint) = parse_endpoint(value, "https")?
                && !vpn_lines.contains(&endpoint)
            {
                vpn_lines.push(endpoint);
            }
        }
    }
    let web_vpn = if let Some(node) = direct_child(root, "WebVpn") {
        let host = node.attribute("hostname").unwrap_or_default().trim();
        let scheme = node
            .attribute("scheme")
            .unwrap_or("https")
            .trim()
            .to_lowercase();
        let port_value = node.attribute("port").unwrap_or_default().trim();
        if host.is_empty() || port_value.is_empty() {
            None
        } else {
            if !matches!(scheme.as_str(), "http" | "https") {
                return Err(Error("unsupported WebVpn scheme".into()));
            }
            Some(Endpoint {
                host: host.to_owned(),
                port: parse_port(port_value)?,
                scheme,
            })
        }
    } else {
        None
    };
    Ok(GatewayConfiguration {
        l3_dns: dns_values,
        vpn_lines,
        web_vpn,
        has_l3_configuration: l3.is_some(),
        has_tcp_configuration: direct_child(root, "TcpApplication").is_some(),
    })
}

pub fn parse_tunnel_bootstrap(data: &[u8]) -> Result<Option<TunnelBootstrap>> {
    let document = parse_xml(data, "gateway configuration")?;
    let root = document.root_element();
    if root.tag_name().name() != "Conf" {
        return Err(Error("configuration root must be Conf".into()));
    }
    let Some(other) = direct_child(root, "Other") else {
        return Ok(None);
    };
    let host = other.attribute("svpnhost").unwrap_or_default().trim();
    let port = other.attribute("svpnport").unwrap_or_default().trim();
    let session_identifier = other.attribute("svpnSessionID").unwrap_or_default().trim();
    let lan_address = other.attribute("svpnlanaddr").unwrap_or_default().trim();
    let sslctx = other.attribute("sslctx").unwrap_or_default().trim();
    if [host, port, session_identifier, lan_address, sslctx]
        .iter()
        .all(|value| value.is_empty())
    {
        return Ok(None);
    }
    if host.is_empty() != port.is_empty() {
        return Err(Error(
            "L3 tunnel server and port must appear together".into(),
        ));
    }
    let server = (!host.is_empty())
        .then(|| {
            host.parse::<IpAddr>()
                .map_err(|_| Error("L3 tunnel server is not a numeric IP address".into()))
        })
        .transpose()?;
    let port = (!port.is_empty()).then(|| parse_port(port)).transpose()?;
    let lan_address = (!lan_address.is_empty())
        .then(|| {
            lan_address
                .parse::<Ipv4Addr>()
                .map_err(|_| Error("L3 LAN address is not a numeric IPv4 address".into()))
        })
        .transpose()?;
    let session_identifier = if session_identifier.is_empty() {
        None
    } else {
        if session_identifier.len() > 32
            || !session_identifier
                .bytes()
                .all(|byte| byte.is_ascii_graphic())
        {
            return Err(Error("L3 session identifier has an invalid shape".into()));
        }
        let mut session_identifier_copy = session_identifier.to_owned();
        let value = Zeroizing::new(std::mem::take(&mut session_identifier_copy));
        session_identifier_copy.zeroize();
        Some(value)
    };
    let context = (!sslctx.is_empty())
        .then(|| SessionContext::from_sslctx_hex(sslctx))
        .transpose()?;
    Ok(Some(TunnelBootstrap {
        server,
        port,
        lan_address,
        session_identifier,
        context,
    }))
}

pub fn parse_resource_configuration(data: &[u8]) -> Result<ResourceConfiguration> {
    let document = parse_xml(data, "resource configuration")?;
    let root = document.root_element();
    if root.tag_name().name() != "Resource" {
        return Err(Error("resource root must be Resource".into()));
    }
    let mut resources = Vec::new();
    if let Some(rcs) = direct_child(root, "Rcs") {
        for node in rcs
            .children()
            .filter(|node| node.is_element() && node.tag_name().name() == "Rc")
        {
            resources.push(Resource {
                identifier: node.attribute("id").unwrap_or_default().trim().to_owned(),
                resource_type: node.attribute("type").unwrap_or_default().trim().to_owned(),
                protocol: node
                    .attribute("proto")
                    .unwrap_or_default()
                    .trim()
                    .to_lowercase(),
                host: node.attribute("host").unwrap_or_default().trim().to_owned(),
                ports: parse_port_policy(node.attribute("port").unwrap_or_default())?,
                service: node.attribute("svc").unwrap_or_default().trim().to_owned(),
                group_identifier: node
                    .attribute("rc_grp_id")
                    .unwrap_or_default()
                    .trim()
                    .to_owned(),
            });
        }
    }
    if resources.len() > 10_000 {
        return Err(Error("resource count exceeds limit".into()));
    }
    let default_resource_identifier = direct_child(root, "Other")
        .and_then(|node| node.attribute("defaultRcId"))
        .unwrap_or_default()
        .trim()
        .to_owned();
    Ok(ResourceConfiguration {
        resources,
        dns_policy_present: direct_child(root, "Dns").is_some(),
        default_resource_identifier,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const CONF: &[u8] = include_bytes!("../tests/fixtures/conf.xml");
    const RCLIST: &[u8] = include_bytes!("../tests/fixtures/rclist.xml");

    #[test]
    fn parses_only_transport_fields() {
        let config = parse_gateway_configuration(CONF).unwrap();
        assert_eq!(config.l3_dns, ["192.0.2.53", "198.51.100.53"]);
        assert_eq!(config.vpn_lines.len(), 2);
        assert_eq!(config.vpn_lines[1].port, 8443);
        let debug = format!("{config:?}");
        assert!(!debug.contains("synthetic-user"));
        assert!(!debug.contains("synthetic-password"));
        assert!(!config.safe_summary().to_string().contains("example.test"));
        let bootstrap = parse_tunnel_bootstrap(CONF).unwrap().unwrap();
        assert_eq!(
            bootstrap.server,
            Some("192.0.2.20".parse::<IpAddr>().unwrap())
        );
        assert_eq!(bootstrap.port, Some(443));
        assert_eq!(bootstrap.session_identifier().unwrap().len(), 32);
        assert!(!format!("{bootstrap:?}").contains("0123456789abcdef"));
        assert!(!bootstrap.safe_summary().to_string().contains("192.0.2.20"));
    }

    #[test]
    fn validates_ports() {
        assert!(
            parse_gateway_configuration(
                br#"<Conf><WebVpn hostname="x" port="70000" scheme="https"/></Conf>"#
            )
            .is_err()
        );
        let policy = parse_port_policy("22,80-82|443").unwrap();
        assert!(policy.allows(22));
        assert!(policy.allows(81));
        assert!(policy.allows(443));
        assert!(!policy.allows(23));
        let vendor_range = parse_port_policy("8000~8010").unwrap();
        assert!(vendor_range.allows(8005));
        assert!(parse_port_policy("0").unwrap().allows(65535));
    }

    #[test]
    fn resource_summary_is_sanitized() {
        let resources = parse_resource_configuration(RCLIST).unwrap();
        assert_eq!(resources.resources.len(), 2);
        assert!(resources.resources[0].ports.allows(22));
        assert!(!resources.resources[0].ports.allows(23));
        let summary = resources.safe_summary();
        assert_eq!(summary["protocol_counts"]["tcp"], 1);
        assert!(!summary.to_string().contains("host.example.test"));
        assert!(!format!("{resources:?}").contains("Synthetic SSH"));
        assert!(!format!("{resources:?}").contains("host.example.test"));
    }

    #[test]
    fn legacy_resource_debug_never_exposes_a_target_query() {
        let resources = parse_resource_configuration(
            br#"<Resource><Rcs><Rc id="private-id" type="token=private-type" proto="session=private-protocol" host="https://example.test/private?token=fixture-secret" svc="private-service"/></Rcs></Resource>"#,
        )
        .unwrap();
        let debug = format!("{resources:?} {:?}", resources.resources[0]);
        let summary = resources.safe_summary().to_string();
        for private in [
            "private-id",
            "example.test",
            "fixture-secret",
            "private-service",
            "private-type",
            "private-protocol",
        ] {
            assert!(!debug.contains(private));
            assert!(!summary.contains(private));
        }
        assert_eq!(resources.safe_summary()["protocol_counts"]["other"], 1);
        assert_eq!(resources.safe_summary()["type_counts"]["other"], 1);
    }
}
