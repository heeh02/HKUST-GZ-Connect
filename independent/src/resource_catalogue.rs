//! Bounded, offline parsing for the vendor resource catalogue document.
//!
//! A catalogue can contain internal host names, per-session URLs, query
//! parameters, user information, and authorization hints.  This module keeps
//! launch material behind a non-serializable handle and exposes a stable
//! presentation view that never contains a host, URL path, query, fragment,
//! vendor identifier, or raw authorization value.
//!
//! Parsing a document is deliberately separate from retrieving it.  The
//! production engine must not fetch or advertise the authenticated catalogue
//! until that request lifecycle and the vendor authorization semantics have
//! their own approved canary evidence.

use crate::config::{PortPolicy, parse_port_policy};
use crate::xml::{MAX_XML_BYTES, parse_xml};
use crate::{Error, Result};
use serde::Serialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt::{Debug, Formatter};
use url::{Host, Url};
use zeroize::Zeroizing;

pub const RESOURCE_CATALOGUE_SCHEMA_VERSION: u64 = 1;
pub const MAX_CATALOGUE_GROUPS: usize = 2_048;
pub const MAX_CATALOGUE_RESOURCES: usize = 10_000;

const MAX_IDENTIFIER_BYTES: usize = 256;
const MAX_LABEL_BYTES: usize = 512;
const MAX_TARGET_BYTES: usize = 4_096;
const MAX_SERVICE_BYTES: usize = 4_096;
const MAX_AUTHORIZATION_BYTES: usize = 512;
const MAX_PORT_POLICY_BYTES: usize = 4_096;
const MAX_PORT_RANGES: usize = 256;
const MAX_CATALOGUE_ELEMENTS: usize = 50_000;
const MAX_CATALOGUE_DEPTH: usize = 64;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CatalogueResourceKind {
    Web,
    Tcp,
    Udp,
    Application,
    Folder,
    Other,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CatalogueProtocol {
    Http,
    Https,
    Tcp,
    Udp,
    Other,
}

/// This status intentionally describes only whether the server supplied an
/// authorization field.  It is not an allow/deny decision.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CatalogueAuthorizationStatus {
    NotDeclared,
    DeclaredUnverified,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CatalogueTargetLocation {
    None,
    Host,
    AbsoluteUrl,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CatalogueHostKind {
    None,
    Domain,
    Ipv4,
    Ipv6,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
pub struct CataloguePortRange {
    pub start: u16,
    pub end: u16,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct CataloguePortPolicy {
    pub unrestricted: bool,
    pub ranges: Vec<CataloguePortRange>,
}

impl From<&PortPolicy> for CataloguePortPolicy {
    fn from(policy: &PortPolicy) -> Self {
        Self {
            unrestricted: policy.unrestricted,
            ranges: policy
                .ranges
                .iter()
                .map(|range| CataloguePortRange {
                    start: range.start,
                    end: range.end,
                })
                .collect(),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct CatalogueTargetShape {
    pub location: CatalogueTargetLocation,
    pub host_kind: CatalogueHostKind,
    pub explicit_port: bool,
    pub path_present: bool,
    pub query_present: bool,
    pub fragment_present: bool,
    pub ports: CataloguePortPolicy,
}

#[derive(Clone, Eq, PartialEq, Serialize)]
pub struct CatalogueGroupView {
    /// Opaque, deterministic handle derived from the vendor identifier.
    pub handle: String,
    /// Server-provided presentation label. It is intended for UI display and
    /// must not be copied into diagnostics or telemetry.
    pub label: String,
    pub resource_count: usize,
}

impl Debug for CatalogueGroupView {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("CatalogueGroupView")
            .field("handle", &self.handle)
            .field("label", &"<presentation-only>")
            .field("resource_count", &self.resource_count)
            .finish()
    }
}

#[derive(Clone, Eq, PartialEq, Serialize)]
pub struct CatalogueResourceView {
    /// Opaque, deterministic handle derived from the vendor identifier.
    pub handle: String,
    /// Server-provided presentation label. It is intended for UI display and
    /// must not be copied into diagnostics or telemetry.
    pub label: String,
    pub group_handle: Option<String>,
    pub kind: CatalogueResourceKind,
    pub protocol: CatalogueProtocol,
    pub authorization: CatalogueAuthorizationStatus,
    /// `false` until a reviewed gateway-specific adapter interprets the raw
    /// authorization policy. Callers must not infer permission from presence.
    pub authorization_decision_available: bool,
    pub target: CatalogueTargetShape,
}

impl Debug for CatalogueResourceView {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("CatalogueResourceView")
            .field("handle", &self.handle)
            .field("label", &"<presentation-only>")
            .field("group_handle", &self.group_handle)
            .field("kind", &self.kind)
            .field("protocol", &self.protocol)
            .field("authorization", &self.authorization)
            .field(
                "authorization_decision_available",
                &self.authorization_decision_available,
            )
            .field("target", &self.target)
            .finish()
    }
}

#[derive(Clone, Eq, PartialEq, Serialize)]
pub struct SanitizedResourceCatalogue {
    pub schema_version: u64,
    pub groups: Vec<CatalogueGroupView>,
    pub resources: Vec<CatalogueResourceView>,
    pub default_resource_handle: Option<String>,
    pub dns_policy_present: bool,
    pub authorization_decisions_available: bool,
}

impl Debug for SanitizedResourceCatalogue {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("SanitizedResourceCatalogue")
            .field("schema_version", &self.schema_version)
            .field("group_count", &self.groups.len())
            .field("resource_count", &self.resources.len())
            .field(
                "default_resource_present",
                &self.default_resource_handle.is_some(),
            )
            .field("dns_policy_present", &self.dns_policy_present)
            .field(
                "authorization_decisions_available",
                &self.authorization_decisions_available,
            )
            .finish()
    }
}

/// Exact server launch material. This type is intentionally neither
/// serializable nor displayable, and its debug output never includes values.
pub struct ResourceLaunchTarget {
    host: Zeroizing<String>,
    service: Zeroizing<String>,
    protocol: CatalogueProtocol,
    ports: PortPolicy,
}

impl ResourceLaunchTarget {
    pub fn host(&self) -> &str {
        self.host.as_str()
    }

    pub fn service(&self) -> &str {
        self.service.as_str()
    }

    pub const fn protocol(&self) -> CatalogueProtocol {
        self.protocol
    }

    pub fn ports(&self) -> &PortPolicy {
        &self.ports
    }
}

impl Debug for ResourceLaunchTarget {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ResourceLaunchTarget")
            .field("host", &"<redacted>")
            .field("service", &"<redacted>")
            .field("protocol", &self.protocol)
            .field("ports", &"<redacted>")
            .finish()
    }
}

/// Parsed catalogue plus exact launch targets keyed by opaque handles.
pub struct ResourceCatalogue {
    view: SanitizedResourceCatalogue,
    targets: BTreeMap<String, ResourceLaunchTarget>,
}

impl ResourceCatalogue {
    pub fn sanitized_view(&self) -> &SanitizedResourceCatalogue {
        &self.view
    }

    pub fn resolve_target(&self, handle: &str) -> Option<&ResourceLaunchTarget> {
        self.targets.get(handle)
    }

    /// Log/diagnostic-safe aggregate. Labels, handles, targets, paths, query
    /// markers, ports, and raw authorization fields are intentionally absent.
    pub fn safe_summary(&self) -> Value {
        let mut kinds = BTreeMap::<&'static str, usize>::new();
        let mut protocols = BTreeMap::<&'static str, usize>::new();
        let mut declared_authorization_count = 0_usize;
        for resource in &self.view.resources {
            let kind = match resource.kind {
                CatalogueResourceKind::Web => "web",
                CatalogueResourceKind::Tcp => "tcp",
                CatalogueResourceKind::Udp => "udp",
                CatalogueResourceKind::Application => "application",
                CatalogueResourceKind::Folder => "folder",
                CatalogueResourceKind::Other => "other",
            };
            let protocol = match resource.protocol {
                CatalogueProtocol::Http => "http",
                CatalogueProtocol::Https => "https",
                CatalogueProtocol::Tcp => "tcp",
                CatalogueProtocol::Udp => "udp",
                CatalogueProtocol::Other => "other",
            };
            *kinds.entry(kind).or_default() += 1;
            *protocols.entry(protocol).or_default() += 1;
            declared_authorization_count += usize::from(matches!(
                resource.authorization,
                CatalogueAuthorizationStatus::DeclaredUnverified
            ));
        }
        json!({
            "schema_version": self.view.schema_version,
            "group_count": self.view.groups.len(),
            "resource_count": self.view.resources.len(),
            "default_resource_present": self.view.default_resource_handle.is_some(),
            "dns_policy_present": self.view.dns_policy_present,
            "authorization_decisions_available": false,
            "declared_authorization_count": declared_authorization_count,
            "kind_counts": kinds,
            "protocol_counts": protocols,
            "serialized_launch_material": false,
        })
    }
}

impl Debug for ResourceCatalogue {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ResourceCatalogue")
            .field("summary", &self.view)
            .field("launch_targets", &self.targets.len())
            .finish()
    }
}

fn bounded_value(
    value: Option<&str>,
    maximum: usize,
    field: &'static str,
    required: bool,
) -> Result<String> {
    let value = value.unwrap_or_default().trim();
    if required && value.is_empty() {
        return Err(Error(format!("resource catalogue {field} is missing")));
    }
    if value.len() > maximum {
        return Err(Error(format!(
            "resource catalogue {field} exceeds the size limit"
        )));
    }
    if value.chars().any(char::is_control) {
        return Err(Error(format!(
            "resource catalogue {field} contains a control character"
        )));
    }
    Ok(value.to_owned())
}

fn opaque_handle(prefix: &str, identifier: &str) -> String {
    let digest = Sha256::digest(identifier.as_bytes());
    format!("{prefix}-{}", hex::encode(&digest[..12]))
}

fn resource_kind(value: &str) -> CatalogueResourceKind {
    match value.trim().to_ascii_lowercase().as_str() {
        "web" | "url" => CatalogueResourceKind::Web,
        "tcp" => CatalogueResourceKind::Tcp,
        "udp" => CatalogueResourceKind::Udp,
        "app" | "application" | "remote_app" | "remoteapp" => CatalogueResourceKind::Application,
        "folder" | "group" => CatalogueResourceKind::Folder,
        _ => CatalogueResourceKind::Other,
    }
}

fn resource_protocol(value: &str) -> CatalogueProtocol {
    match value.trim().to_ascii_lowercase().as_str() {
        "http" => CatalogueProtocol::Http,
        "https" => CatalogueProtocol::Https,
        "tcp" => CatalogueProtocol::Tcp,
        "udp" => CatalogueProtocol::Udp,
        _ => CatalogueProtocol::Other,
    }
}

fn host_kind<T>(host: Host<T>) -> CatalogueHostKind {
    match host {
        Host::Domain(_) => CatalogueHostKind::Domain,
        Host::Ipv4(_) => CatalogueHostKind::Ipv4,
        Host::Ipv6(_) => CatalogueHostKind::Ipv6,
    }
}

fn target_shape(host: &str, ports: &PortPolicy) -> Result<CatalogueTargetShape> {
    let mut shape = CatalogueTargetShape {
        location: CatalogueTargetLocation::None,
        host_kind: CatalogueHostKind::None,
        explicit_port: false,
        path_present: false,
        query_present: false,
        fragment_present: false,
        ports: CataloguePortPolicy::from(ports),
    };
    if host.is_empty() {
        return Ok(shape);
    }
    if host.contains("://") {
        let parsed = Url::parse(host)
            .map_err(|_| Error("resource catalogue target URL is invalid".into()))?;
        if !matches!(parsed.scheme(), "http" | "https") {
            return Err(Error(
                "resource catalogue target URL scheme is unsupported".into(),
            ));
        }
        if !parsed.username().is_empty() || parsed.password().is_some() {
            return Err(Error(
                "resource catalogue target URL contains user information".into(),
            ));
        }
        let host = parsed
            .host()
            .ok_or_else(|| Error("resource catalogue target URL has no host".into()))?;
        shape.location = CatalogueTargetLocation::AbsoluteUrl;
        shape.host_kind = host_kind(host);
        shape.explicit_port = parsed.port().is_some();
        shape.path_present = parsed.path() != "/" && !parsed.path().is_empty();
        shape.query_present = parsed.query().is_some();
        shape.fragment_present = parsed.fragment().is_some();
        // `Url` owns a normalized copy which may still contain a per-session
        // query. Consume that allocation into a zeroizing string before the
        // parser returns instead of dropping it as ordinary heap memory.
        let _normalized_target: Zeroizing<String> = Zeroizing::new(parsed.into());
        return Ok(shape);
    }
    if host
        .bytes()
        .any(|byte| byte.is_ascii_whitespace() || matches!(byte, b'/' | b'?' | b'#' | b'@'))
    {
        return Err(Error(
            "resource catalogue bare target has an invalid shape".into(),
        ));
    }
    let parsed = Host::parse(host)
        .map_err(|_| Error("resource catalogue bare target host is invalid".into()))?;
    shape.location = CatalogueTargetLocation::Host;
    shape.host_kind = host_kind(parsed);
    Ok(shape)
}

fn validate_structure(root: roxmltree::Node<'_, '_>) -> Result<()> {
    let mut element_count = 0_usize;
    for node in root.descendants().filter(roxmltree::Node::is_element) {
        element_count += 1;
        if element_count > MAX_CATALOGUE_ELEMENTS {
            return Err(Error(
                "resource catalogue element count exceeds the limit".into(),
            ));
        }
        if node.ancestors().take(MAX_CATALOGUE_DEPTH + 2).count() > MAX_CATALOGUE_DEPTH + 1 {
            return Err(Error(
                "resource catalogue nesting depth exceeds the limit".into(),
            ));
        }
    }
    Ok(())
}

fn unique_direct_child<'a, 'input>(
    node: roxmltree::Node<'a, 'input>,
    name: &str,
) -> Result<Option<roxmltree::Node<'a, 'input>>> {
    let mut matches = node
        .children()
        .filter(|candidate| candidate.is_element() && candidate.tag_name().name() == name);
    let first = matches.next();
    if matches.next().is_some() {
        return Err(Error(format!(
            "resource catalogue contains multiple {name} sections"
        )));
    }
    Ok(first)
}

/// Parses a resource document without performing network access.
pub fn parse_resource_catalogue(data: &[u8]) -> Result<ResourceCatalogue> {
    if data.len() > MAX_XML_BYTES {
        return Err(Error("resource catalogue exceeds the size limit".into()));
    }
    let document = parse_xml(data, "resource catalogue")?;
    let root = document.root_element();
    if root.tag_name().name() != "Resource" {
        return Err(Error("resource catalogue root must be Resource".into()));
    }
    validate_structure(root)?;

    let mut groups = Vec::new();
    let mut group_handles = BTreeMap::new();
    let mut handles = BTreeSet::new();
    if let Some(group_nodes) = unique_direct_child(root, "RcGroups")? {
        for node in group_nodes
            .children()
            .filter(|node| node.is_element() && node.tag_name().name() == "Group")
        {
            if groups.len() >= MAX_CATALOGUE_GROUPS {
                return Err(Error(
                    "resource catalogue group count exceeds the limit".into(),
                ));
            }
            let identifier = bounded_value(
                node.attribute("id"),
                MAX_IDENTIFIER_BYTES,
                "group identifier",
                true,
            )?;
            if group_handles.contains_key(&identifier) {
                return Err(Error(
                    "resource catalogue contains a duplicate group identifier".into(),
                ));
            }
            let handle = opaque_handle("group", &identifier);
            if !handles.insert(handle.clone()) {
                return Err(Error("resource catalogue group handle collision".into()));
            }
            let label = bounded_value(
                node.attribute("name"),
                MAX_LABEL_BYTES,
                "group label",
                false,
            )?;
            group_handles.insert(identifier, handle.clone());
            groups.push(CatalogueGroupView {
                handle,
                label,
                resource_count: 0,
            });
        }
    }

    let mut resources = Vec::new();
    let mut resource_handles = BTreeMap::new();
    let mut targets = BTreeMap::new();
    let mut group_resource_counts = BTreeMap::<String, usize>::new();
    if let Some(resource_nodes) = unique_direct_child(root, "Rcs")? {
        for node in resource_nodes
            .children()
            .filter(|node| node.is_element() && node.tag_name().name() == "Rc")
        {
            if resources.len() >= MAX_CATALOGUE_RESOURCES {
                return Err(Error(
                    "resource catalogue resource count exceeds the limit".into(),
                ));
            }
            let identifier = bounded_value(
                node.attribute("id"),
                MAX_IDENTIFIER_BYTES,
                "resource identifier",
                true,
            )?;
            if resource_handles.contains_key(&identifier) {
                return Err(Error(
                    "resource catalogue contains a duplicate resource identifier".into(),
                ));
            }
            let handle = opaque_handle("resource", &identifier);
            if targets.contains_key(&handle) {
                return Err(Error("resource catalogue resource handle collision".into()));
            }
            let label = bounded_value(
                node.attribute("name"),
                MAX_LABEL_BYTES,
                "resource label",
                false,
            )?;
            let resource_type = bounded_value(
                node.attribute("type"),
                MAX_IDENTIFIER_BYTES,
                "resource type",
                false,
            )?;
            let protocol_value = bounded_value(
                node.attribute("proto"),
                MAX_IDENTIFIER_BYTES,
                "resource protocol",
                false,
            )?;
            let host = Zeroizing::new(bounded_value(
                node.attribute("host"),
                MAX_TARGET_BYTES,
                "resource target",
                false,
            )?);
            let service = Zeroizing::new(bounded_value(
                node.attribute("svc"),
                MAX_SERVICE_BYTES,
                "resource service",
                false,
            )?);
            let authorization = Zeroizing::new(bounded_value(
                node.attribute("authorization"),
                MAX_AUTHORIZATION_BYTES,
                "resource authorization",
                false,
            )?);
            let group_identifier = bounded_value(
                node.attribute("rc_grp_id"),
                MAX_IDENTIFIER_BYTES,
                "resource group reference",
                false,
            )?;
            let group_handle = if group_identifier.is_empty() {
                None
            } else {
                Some(
                    group_handles
                        .get(&group_identifier)
                        .cloned()
                        .ok_or_else(|| {
                            Error("resource catalogue group reference is unresolved".into())
                        })?,
                )
            };
            if let Some(handle) = &group_handle {
                *group_resource_counts.entry(handle.clone()).or_default() += 1;
            }
            let port_value = bounded_value(
                node.attribute("port"),
                MAX_PORT_POLICY_BYTES,
                "resource port policy",
                false,
            )?;
            let ports = parse_port_policy(&port_value)?;
            if ports.ranges.len() > MAX_PORT_RANGES {
                return Err(Error(
                    "resource catalogue port range count exceeds the limit".into(),
                ));
            }
            let protocol = resource_protocol(&protocol_value);
            let shape = target_shape(host.as_str(), &ports)?;
            let authorization = if authorization.is_empty() {
                CatalogueAuthorizationStatus::NotDeclared
            } else {
                CatalogueAuthorizationStatus::DeclaredUnverified
            };
            resources.push(CatalogueResourceView {
                handle: handle.clone(),
                label,
                group_handle: group_handle.clone(),
                kind: resource_kind(&resource_type),
                protocol,
                authorization,
                authorization_decision_available: false,
                target: shape,
            });
            resource_handles.insert(identifier, handle.clone());
            targets.insert(
                handle,
                ResourceLaunchTarget {
                    host,
                    service,
                    protocol,
                    ports,
                },
            );
        }
    }

    for group in &mut groups {
        group.resource_count = group_resource_counts
            .get(&group.handle)
            .copied()
            .unwrap_or_default();
    }

    let default_identifier =
        unique_direct_child(root, "Other")?.and_then(|node| node.attribute("defaultRcId"));
    let default_identifier = bounded_value(
        default_identifier,
        MAX_IDENTIFIER_BYTES,
        "default resource reference",
        false,
    )?;
    let default_resource_handle = if default_identifier.is_empty() {
        None
    } else {
        Some(
            resource_handles
                .get(&default_identifier)
                .cloned()
                .ok_or_else(|| {
                    Error("resource catalogue default resource reference is unresolved".into())
                })?,
        )
    };

    Ok(ResourceCatalogue {
        view: SanitizedResourceCatalogue {
            schema_version: RESOURCE_CATALOGUE_SCHEMA_VERSION,
            groups,
            resources,
            default_resource_handle,
            dns_policy_present: unique_direct_child(root, "Dns")?.is_some(),
            authorization_decisions_available: false,
        },
        targets,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::PortRange;

    const CATALOGUE: &[u8] = include_bytes!("../tests/fixtures/resource_catalogue.xml");

    #[test]
    fn parses_a_bounded_sanitized_directory_without_exposing_launch_material() {
        let catalogue = parse_resource_catalogue(CATALOGUE).unwrap();
        let view = catalogue.sanitized_view();
        assert_eq!(view.schema_version, RESOURCE_CATALOGUE_SCHEMA_VERSION);
        assert_eq!(view.groups.len(), 2);
        assert_eq!(view.groups[0].resource_count, 2);
        assert_eq!(view.resources.len(), 3);
        assert_eq!(
            view.resources[0].authorization,
            CatalogueAuthorizationStatus::DeclaredUnverified
        );
        assert!(!view.resources[0].authorization_decision_available);
        assert!(view.resources[0].target.query_present);
        assert!(view.resources[0].target.path_present);
        assert_eq!(
            view.resources[0].target.host_kind,
            CatalogueHostKind::Domain
        );
        let json = serde_json::to_string(view).unwrap();
        let summary = catalogue.safe_summary().to_string();
        for private in [
            "catalogue.example.test",
            "/launch/private",
            "fixture-access-token",
            "fixture-session",
            "vendor-resource-one",
            "vendor-group-one",
            "synthetic-user",
            "synthetic-password",
        ] {
            assert!(!json.contains(private), "leaked {private}");
            assert!(!format!("{catalogue:?}").contains(private));
            assert!(!format!("{:?}", view.groups[0]).contains(private));
            assert!(!format!("{:?}", view.resources[0]).contains(private));
            assert!(!summary.contains(private));
        }
        assert!(!format!("{:?}", view.groups[0]).contains("教学资源"));
        assert!(!format!("{:?}", view.resources[0]).contains("合成教学门户"));
        assert_eq!(catalogue.safe_summary()["kind_counts"]["web"], 1);
        let target = catalogue.resolve_target(&view.resources[0].handle).unwrap();
        assert!(target.host().contains("fixture-access-token"));
        assert!(!format!("{target:?}").contains("fixture-access-token"));
    }

    #[test]
    fn authorization_is_never_invented_from_an_opaque_vendor_value() {
        let catalogue = parse_resource_catalogue(CATALOGUE).unwrap();
        assert!(!catalogue.sanitized_view().authorization_decisions_available);
        assert!(
            catalogue
                .sanitized_view()
                .resources
                .iter()
                .all(|resource| !resource.authorization_decision_available)
        );
    }

    #[test]
    fn rejects_ambiguous_or_unsafe_catalogue_shapes_without_echoing_values() {
        for document in [
            br#"<Resource><Rcs><Rc id="one" host="https://user:secret@example.test/"/></Rcs></Resource>"#.as_slice(),
            br#"<Resource><Rcs><Rc id="one" host="https://example.test/"/><Rc id="one"/></Rcs></Resource>"#.as_slice(),
            br#"<Resource><Rcs><Rc id="one" rc_grp_id="private-group"/></Rcs></Resource>"#.as_slice(),
            br#"<Resource><Other defaultRcId="private-resource"/></Resource>"#.as_slice(),
            br#"<Resource><Rcs><Rc id="one" host="example.test/private?token=secret"/></Rcs></Resource>"#.as_slice(),
        ] {
            let error = parse_resource_catalogue(document).unwrap_err().to_string();
            for private in ["secret", "private-group", "private-resource"] {
                assert!(!error.contains(private));
            }
        }
    }

    #[test]
    fn limits_group_and_resource_identifiers() {
        let oversized = "x".repeat(MAX_IDENTIFIER_BYTES + 1);
        let document =
            format!("<Resource><RcGroups><Group id=\"{oversized}\"/></RcGroups></Resource>");
        let error = parse_resource_catalogue(document.as_bytes()).unwrap_err();
        assert!(error.to_string().contains("size limit"));
        assert!(!error.to_string().contains(&oversized));
    }

    #[test]
    fn rejects_duplicate_sections_and_oversized_port_policies() {
        for document in [
            br#"<Resource><Rcs/><Rcs/></Resource>"#.as_slice(),
            br#"<Resource><RcGroups/><RcGroups/></Resource>"#.as_slice(),
            br#"<Resource><Other/><Other/></Resource>"#.as_slice(),
            br#"<Resource><Dns/><Dns/></Resource>"#.as_slice(),
        ] {
            assert!(parse_resource_catalogue(document).is_err());
        }

        let ranges = std::iter::repeat_n("1", MAX_PORT_RANGES + 1).collect::<Vec<_>>();
        let document = format!(
            "<Resource><Rcs><Rc id=\"one\" port=\"{}\"/></Rcs></Resource>",
            ranges.join(",")
        );
        let error = parse_resource_catalogue(document.as_bytes()).unwrap_err();
        assert!(error.to_string().contains("range count"));
        assert!(!error.to_string().contains(&ranges.join(",")));

        let oversized = "1,".repeat(MAX_PORT_POLICY_BYTES);
        let document =
            format!("<Resource><Rcs><Rc id=\"one\" port=\"{oversized}\"/></Rcs></Resource>");
        let error = parse_resource_catalogue(document.as_bytes()).unwrap_err();
        assert!(error.to_string().contains("size limit"));
        assert!(!error.to_string().contains(&oversized));
    }

    #[test]
    fn structural_group_and_resource_limits_are_enforced() {
        let nested = format!(
            "<Resource>{}{}</Resource>",
            "<Nested>".repeat(MAX_CATALOGUE_DEPTH + 1),
            "</Nested>".repeat(MAX_CATALOGUE_DEPTH + 1)
        );
        assert!(
            parse_resource_catalogue(nested.as_bytes())
                .unwrap_err()
                .to_string()
                .contains("nesting depth")
        );

        let elements = format!(
            "<Resource>{}</Resource>",
            "<Ignored/>".repeat(MAX_CATALOGUE_ELEMENTS)
        );
        assert!(
            parse_resource_catalogue(elements.as_bytes())
                .unwrap_err()
                .to_string()
                .contains("element count")
        );

        let groups = (0..=MAX_CATALOGUE_GROUPS)
            .map(|index| format!("<Group id=\"g{index}\"/>"))
            .collect::<String>();
        let document = format!("<Resource><RcGroups>{groups}</RcGroups></Resource>");
        assert!(
            parse_resource_catalogue(document.as_bytes())
                .unwrap_err()
                .to_string()
                .contains("group count")
        );

        let resources = (0..=MAX_CATALOGUE_RESOURCES)
            .map(|index| format!("<Rc id=\"r{index}\"/>"))
            .collect::<String>();
        let document = format!("<Resource><Rcs>{resources}</Rcs></Resource>");
        assert!(
            parse_resource_catalogue(document.as_bytes())
                .unwrap_err()
                .to_string()
                .contains("resource count")
        );
    }

    #[test]
    fn port_ranges_are_presented_without_private_targets() {
        let catalogue = parse_resource_catalogue(CATALOGUE).unwrap();
        let resource = &catalogue.sanitized_view().resources[1];
        assert_eq!(
            resource.target.ports.ranges,
            [
                CataloguePortRange { start: 22, end: 22 },
                CataloguePortRange { start: 80, end: 90 }
            ]
        );
        let raw_target = catalogue.resolve_target(&resource.handle).unwrap();
        assert!(raw_target.ports().allows(85));
    }

    #[test]
    fn port_range_conversion_is_explicit() {
        let policy = PortPolicy {
            unrestricted: false,
            ranges: vec![PortRange {
                start: 443,
                end: 443,
            }],
        };
        assert_eq!(
            CataloguePortPolicy::from(&policy).ranges,
            [CataloguePortRange {
                start: 443,
                end: 443
            }]
        );
    }
}
