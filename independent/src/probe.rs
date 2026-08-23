use crate::adapter::{ControlLayout, OfficialPrefaceAdapter};
use crate::auth::{AuthState, auth_summary, rsa_encrypt_hex, safe_int};
use crate::config::{parse_gateway_configuration, parse_tunnel_bootstrap};
pub use crate::credentials::{MAX_CREDENTIAL_BYTES, read_credentials};
use crate::gateway_auth::AuthenticatedSessionId;
use crate::gateway_http::{DEFAULT_TIMEOUT_SECONDS, GatewaySession};
use crate::modern::{
    parse_sha256_pin, probe_modern_empty_channels, probe_special_tls_contract, request_modern_token,
};
use crate::resource_catalogue::parse_resource_catalogue;
use crate::tunnel::{
    CLIENT_MESSAGE_LEN, ClientMessage, HandshakeEvent, Preface, SERVER_MESSAGE_LEN,
    SERVER_SYNC_LEN, ServerMessage, ServerReply, SessionContext, TunnelHandshake, TunnelKind,
    WINDOWS_CLIENT_MESSAGE_LEN, WINDOWS_SERVER_MESSAGE_LEN,
};
use crate::watch::{is_sensitive_field, utc_now};
use crate::xml::{first_descendant_text, parse_xml};
use crate::{Error, Result};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::path::Path;
use std::time::Duration;
use url::Url;
use zeroize::{Zeroize, Zeroizing};

const TUNNEL_PROBE_TIMEOUT_SECONDS: u64 = 10;
const SERVER_RESET_BACKOFF_SECONDS: u64 = 3;

#[derive(Default)]
struct Structure {
    fields: BTreeSet<String>,
    paths: BTreeSet<String>,
    attributes: BTreeMap<String, BTreeSet<String>>,
    element_count: usize,
    max_depth: usize,
}

fn walk_structure(
    node: roxmltree::Node<'_, '_>,
    depth: usize,
    parent_path: &str,
    structure: &mut Structure,
) {
    structure.element_count += 1;
    structure.max_depth = structure.max_depth.max(depth);
    let tag = node.tag_name().name();
    let path = format!("{parent_path}/{tag}");
    if !is_sensitive_field(tag) {
        structure.fields.insert(tag.to_owned());
        structure.paths.insert(path.clone());
        let safe_attributes = node
            .attributes()
            .map(|attribute| attribute.name())
            .filter(|name| !is_sensitive_field(name))
            .map(str::to_owned)
            .collect::<BTreeSet<_>>();
        if !safe_attributes.is_empty() {
            structure
                .attributes
                .entry(path.clone())
                .or_default()
                .extend(safe_attributes);
        }
    }
    for child in node.children().filter(roxmltree::Node::is_element) {
        walk_structure(child, depth + 1, &path, structure);
    }
}

pub fn structural_summary(data: &[u8], source: &str) -> Value {
    let Ok(document) = parse_xml(data, source) else {
        return json!({
            "format": "non_xml",
            "body_bytes": data.len(),
        });
    };
    let root = document.root_element();
    let mut structure = Structure::default();
    walk_structure(root, 0, "", &mut structure);
    json!({
        "format": "xml",
        "root": if is_sensitive_field(root.tag_name().name()) {
            "redacted"
        } else {
            root.tag_name().name()
        },
        "body_bytes": data.len(),
        "element_count": structure.element_count,
        "max_depth": structure.max_depth,
        "schema_fields": structure.fields,
        "schema_paths": structure.paths,
        "attribute_keys": structure.attributes,
    })
}

fn required_endpoint<'a>(config: &'a Value, name: &str) -> Result<&'a str> {
    let value = config["endpoints"][name]
        .as_str()
        .unwrap_or_default()
        .trim();
    if value.is_empty() {
        return Err(Error(format!("missing configured endpoint: {name}")));
    }
    Ok(value)
}

fn open_tunnel_socket(
    address: SocketAddr,
    timeout: Duration,
    preface: Preface<'_>,
    kind: TunnelKind,
    client_binding: [u8; 16],
    network_order_auxiliary: u32,
) -> Result<(TcpStream, ServerMessage)> {
    preface.validate()?;
    let mut stream = TcpStream::connect_timeout(&address, timeout)?;
    stream.set_read_timeout(Some(timeout))?;
    stream.set_write_timeout(Some(timeout))?;

    let mut handshake = TunnelHandshake::default();
    handshake.advance(HandshakeEvent::TcpConnected)?;
    stream.write_all(preface.client_sync)?;
    handshake.advance(HandshakeEvent::ClientSyncSent)?;

    let mut server_sync = Zeroizing::new([0_u8; SERVER_SYNC_LEN]);
    stream.read_exact(server_sync.as_mut())?;
    handshake.advance(HandshakeEvent::ServerSyncReceived {
        bytes: server_sync.len(),
    })?;

    let client_message = ClientMessage::new(kind, client_binding, network_order_auxiliary);
    stream.write_all(preface.client_ack)?;
    stream.write_all(client_message.as_bytes())?;
    handshake.advance(HandshakeEvent::ClientAckAndMessageSent)?;

    let mut server_message_bytes = Zeroizing::new([0_u8; SERVER_MESSAGE_LEN]);
    stream.read_exact(server_message_bytes.as_mut())?;
    let server_message = ServerMessage::parse(server_message_bytes.as_ref())?;
    server_message.validate_for(kind)?;
    handshake.advance(HandshakeEvent::ServerMessageAccepted)?;
    Ok((stream, server_message))
}

fn open_windows_command_socket(
    address: SocketAddr,
    timeout: Duration,
    preface: Preface<'_>,
    context: &SessionContext,
    lan_address: std::net::Ipv4Addr,
) -> Result<(TcpStream, u32)> {
    preface.validate()?;
    let mut stream = TcpStream::connect_timeout(&address, timeout)
        .map_err(|_| Error("Windows command connect failed".into()))?;
    stream.set_read_timeout(Some(timeout))?;
    stream.set_write_timeout(Some(timeout))?;
    stream
        .write_all(preface.client_sync)
        .map_err(|_| Error("Windows client sync write failed".into()))?;
    let mut server_sync = Zeroizing::new([0_u8; SERVER_SYNC_LEN]);
    stream
        .read_exact(server_sync.as_mut())
        .map_err(|_| Error("Windows server sync read failed".into()))?;
    stream
        .write_all(preface.client_ack)
        .map_err(|_| Error("Windows client ack write failed".into()))?;
    let client_message = context.windows_command_message(true, lan_address);
    stream
        .write_all(client_message.as_ref())
        .map_err(|_| Error("Windows command message write failed".into()))?;
    let mut server_message = Zeroizing::new([0_u8; WINDOWS_SERVER_MESSAGE_LEN]);
    stream
        .read_exact(server_message.as_mut())
        .map_err(|_| Error("Windows command response read failed".into()))?;
    let status = u32::from_le_bytes(
        server_message[..4]
            .try_into()
            .expect("fixed Windows server message prefix"),
    );
    if status > 15 {
        return Err(Error("unsupported Windows command message type".into()));
    }
    Ok((stream, status))
}

fn probe_windows_command_tunnel(
    address: SocketAddr,
    timeout: Duration,
    preface: Preface<'_>,
    context: &SessionContext,
    lan_address: std::net::Ipv4Addr,
) -> Result<Value> {
    let (mut command_stream, mut status) =
        open_windows_command_socket(address, timeout, preface, context, lan_address)?;
    let reset_retry_attempted = status == 3;
    if reset_retry_attempted {
        drop(command_stream);
        std::thread::sleep(Duration::from_secs(SERVER_RESET_BACKOFF_SECONDS));
        (command_stream, status) =
            open_windows_command_socket(address, timeout, preface, context, lan_address)?;
    }
    let command_established = status == 0;
    drop(command_stream);
    Ok(json!({
        "attempted": true,
        "command": {
            "connected": true,
            "client_sync_bytes": preface.client_sync.len(),
            "server_sync_bytes": SERVER_SYNC_LEN,
            "client_ack_bytes": preface.client_ack.len(),
            "client_message_bytes": WINDOWS_CLIENT_MESSAGE_LEN,
            "server_message_bytes": WINDOWS_SERVER_MESSAGE_LEN,
            "reply_shape_valid": true,
            "message_type": status,
            "message_supported": command_established,
            "reset_retry_attempted": reset_retry_attempted,
            "transport_handshake_completed": true,
            "established": command_established,
        },
        "data_tunnels": {
            "attempted": false,
            "reason": if command_established {
                "current_layout_not_implemented"
            } else {
                "command_not_established"
            },
        },
        "established": false,
        "failure": if command_established {
            "data_layout_pending"
        } else {
            "unsupported_command_message"
        },
        "business_payload_sent": false,
        "sensitive_values_serialized": false,
    }))
}

fn probe_command_tunnel(
    base_url: &str,
    configuration: &[u8],
    official_executable: &Path,
) -> Result<Value> {
    let bootstrap = parse_tunnel_bootstrap(configuration)?
        .ok_or_else(|| Error("gateway did not provide an L3 session context".into()))?;
    let context = bootstrap
        .context
        .as_ref()
        .ok_or_else(|| Error("gateway did not provide an L3 session context".into()))?;
    let session_identifier = Zeroizing::new(context.handshake_session_identifier());
    let adapter = OfficialPrefaceAdapter::from_executable(official_executable)?;
    let materialized_preface = adapter.materialize_preface(Some(&session_identifier))?;
    let preface = materialized_preface.preface();
    preface.validate()?;

    let gateway = Url::parse(base_url).map_err(|_| Error("invalid base_url".into()))?;
    let host = gateway
        .host_str()
        .ok_or_else(|| Error("gateway host is missing".into()))?;
    let port = gateway.port_or_known_default().unwrap_or(443);
    let address = (host, port)
        .to_socket_addrs()?
        .find(SocketAddr::is_ipv4)
        .ok_or_else(|| Error("gateway has no IPv4 tunnel address".into()))?;
    let timeout = Duration::from_secs(TUNNEL_PROBE_TIMEOUT_SECONDS);
    if adapter.control_layout() == ControlLayout::Windows767 {
        let lan_address = bootstrap
            .lan_address
            .ok_or_else(|| Error("gateway did not provide an L3 LAN address".into()))?;
        return probe_windows_command_tunnel(address, timeout, preface, context, lan_address);
    }
    let (mut command_stream, mut command_message) = open_tunnel_socket(
        address,
        timeout,
        preface,
        TunnelKind::CommandNew,
        context.client_binding(),
        0,
    )?;
    let reply = command_message.validate_for(TunnelKind::CommandNew)?;
    if reply != ServerReply::CommandSpecific {
        return Err(Error("unexpected command tunnel reply type".into()));
    }
    let reset_retry_attempted = command_message.status() == 3;
    if reset_retry_attempted {
        drop(command_message);
        drop(command_stream);
        std::thread::sleep(Duration::from_secs(SERVER_RESET_BACKOFF_SECONDS));
        (command_stream, command_message) = open_tunnel_socket(
            address,
            timeout,
            preface,
            TunnelKind::CommandNew,
            context.client_binding(),
            0,
        )?;
    }
    if command_message.status() != 0 {
        return Ok(json!({
            "attempted": true,
            "command": {
                "connected": true,
                "client_sync_bytes": preface.client_sync.len(),
                "server_sync_bytes": SERVER_SYNC_LEN,
                "client_ack_bytes": preface.client_ack.len(),
                "client_message_bytes": CLIENT_MESSAGE_LEN,
                "server_message_bytes": SERVER_MESSAGE_LEN,
                "server_magic_valid": true,
                "reply_class": "command_specific",
                "message_type": command_message.status(),
                "message_supported": false,
                "reset_retry_attempted": reset_retry_attempted,
                "transport_handshake_completed": true,
                "established": false,
            },
            "data_tunnels": {
                "attempted": false,
            },
            "established": false,
            "failure": "unsupported_command_message",
            "business_payload_sent": false,
            "sensitive_values_serialized": false,
        }));
    }
    let _command_stream = command_stream;
    let command_open = command_message.command_open_reply()?;
    let virtual_ip_auxiliary = command_open.virtual_ip_auxiliary();

    let send_result = open_tunnel_socket(
        address,
        timeout,
        preface,
        TunnelKind::DataSendNew,
        context.client_binding(),
        virtual_ip_auxiliary,
    );
    let receive_result = open_tunnel_socket(
        address,
        timeout,
        preface,
        TunnelKind::DataReceiveNew,
        context.client_binding(),
        virtual_ip_auxiliary,
    );
    let send_established = send_result.is_ok();
    let receive_established = receive_result.is_ok();
    let data_failure = if send_established && receive_established {
        Value::Null
    } else {
        Value::String("connect_or_protocol".into())
    };

    Ok(json!({
        "attempted": true,
        "command": {
            "connected": true,
            "client_sync_bytes": preface.client_sync.len(),
            "server_sync_bytes": SERVER_SYNC_LEN,
            "client_ack_bytes": preface.client_ack.len(),
            "client_message_bytes": CLIENT_MESSAGE_LEN,
            "server_message_bytes": SERVER_MESSAGE_LEN,
            "server_magic_valid": true,
            "reply_class": "command_specific",
            "message_type": 0,
            "message_supported": true,
            "reset_retry_attempted": reset_retry_attempted,
            "established": true,
        },
        "network_parameters": {
            "virtual_ip_present": command_open.virtual_ip_present(),
            "lan_ip_present": command_open.lan_ip_present(),
            "encryption_enabled": command_open.encryption_enabled,
            "compression_enabled": command_open.compression_enabled,
            "udp_port_present": command_open.udp_port != 0,
            "addresses_serialized": false,
        },
        "data_tunnels": {
            "attempted": true,
            "send_established": send_established,
            "receive_established": receive_established,
            "failure": data_failure,
        },
        "established": send_established && receive_established,
        "business_payload_sent": false,
        "sensitive_values_serialized": false,
    }))
}

fn safe_tunnel_failure(error: &Error) -> &'static str {
    let message = error.to_string();
    if message.contains("Windows command connect") {
        "windows_command_connect"
    } else if message.contains("Windows client sync") {
        "windows_client_sync"
    } else if message.contains("Windows server sync") {
        "windows_server_sync"
    } else if message.contains("Windows client ack") {
        "windows_client_ack"
    } else if message.contains("Windows command message write") {
        "windows_command_write"
    } else if message.contains("Windows command response") {
        "windows_command_response"
    } else if message.contains("command message type") {
        "command_message_type"
    } else if message.contains("transform flags") {
        "command_transform_flags"
    } else if message.contains("status") {
        "server_status"
    } else if message.contains("magic") {
        "server_magic"
    } else if message.contains("length") {
        "message_length"
    } else if message.contains("preface") || message.contains("executable") {
        "official_adapter"
    } else if message.contains("session context") || message.contains("session identifier") {
        "session_context"
    } else {
        "connect_or_protocol"
    }
}

fn safe_special_tls_failure(error: &Error) -> &'static str {
    let message = error.to_string();
    if message.contains("alert") {
        "server_alert"
    } else if message.contains("certificate verification") {
        "certificate_verification"
    } else if message.contains("certificate") {
        "certificate_contract"
    } else if message.contains("unsupported contract") {
        "unsupported_selection"
    } else if message.contains("ServerHello") {
        "server_hello_contract"
    } else if message.contains("server flight read") {
        "server_flight_read"
    } else if message.contains("server flight") {
        "server_flight_contract"
    } else if message.contains("ClientHello") {
        "client_hello_write"
    } else {
        "connect_or_protocol"
    }
}

fn safe_modern_channel_failure(error: &Error) -> &'static str {
    let message = error.to_string();
    if message.contains("address TLS") {
        "address_tls_handshake"
    } else if message.contains("address request") {
        "address_request"
    } else if message.contains("address reply") {
        "address_reply"
    } else if message.contains("send TLS") {
        "send_tls_handshake"
    } else if message.contains("send request") {
        "send_request"
    } else if message.contains("send reply") {
        "send_reply"
    } else if message.contains("receive TLS") {
        "receive_tls_handshake"
    } else if message.contains("receive request") {
        "receive_request"
    } else if message.contains("receive reply") {
        "receive_reply"
    } else if message.contains("channel reply") {
        "channel_status"
    } else {
        "modern_channel_contract"
    }
}

pub fn run_probe_with_tunnel(
    config: &Value,
    username: &str,
    password: &str,
    official_executable: Option<&Path>,
    modern_tunnel_probe: bool,
) -> Result<(Value, bool)> {
    let base_url = config["base_url"].as_str().unwrap_or_default().trim();
    let target = config["target"].as_str().unwrap_or_default().trim();
    let user_agent = config["user_agent"]
        .as_str()
        .unwrap_or("EasyConnect_windows")
        .trim();
    if !base_url.starts_with("https://") || target.is_empty() {
        return Err(Error("config requires an HTTPS base_url and target".into()));
    }
    let configured_special_pin = if modern_tunnel_probe {
        config["modern_tunnel"]["special_tls_leaf_sha256"]
            .as_str()
            .filter(|value| !value.is_empty())
            .map(parse_sha256_pin)
            .transpose()?
    } else {
        None
    };
    let session = GatewaySession::new(
        base_url.to_owned(),
        user_agent.to_owned(),
        config["timeout_seconds"]
            .as_u64()
            .unwrap_or(DEFAULT_TIMEOUT_SECONDS),
    )?;
    let mut evidence = json!({
        "schema_version": 1,
        "collected_at": utc_now(),
        "target": target,
        "base_url": base_url,
        "credentials": {
            "source": "stdin",
            "serialized": false,
        },
        "stages": {},
    });

    let (discovery_data, _, discovery_status) = session.request(
        required_endpoint(config, "discovery")?,
        reqwest::Method::GET,
        None,
    )?;
    let discovery_data = Zeroizing::new(discovery_data);
    let discovery_document = parse_xml(&discovery_data, "auth discovery")?;
    let discovery_root = discovery_document.root_element();
    evidence["stages"]["discovery"] = json!({
        "http_status": discovery_status,
        "error_code": safe_int(&first_descendant_text(discovery_root, "ErrorCode"), 0),
        "start_auth": safe_int(&first_descendant_text(discovery_root, "StartAuth"), 0),
        "captcha": safe_int(&first_descendant_text(discovery_root, "RndImg"), 0),
    });

    let (password_config_data, _, password_config_status) = session.request(
        required_endpoint(config, "password_config")?,
        reqwest::Method::GET,
        None,
    )?;
    let password_config_data = Zeroizing::new(password_config_data);
    let password_config_summary = auth_summary(&password_config_data, "password configuration")?;
    let password_document = parse_xml(&password_config_data, "password configuration")?;
    let password_root = password_document.root_element();
    let modulus = Zeroizing::new(first_descendant_text(password_root, "RSA_ENCRYPT_KEY"));
    let exponent = safe_int(
        &first_descendant_text(password_root, "RSA_ENCRYPT_EXP"),
        65_537,
    );
    let csrf = Zeroizing::new(first_descendant_text(password_root, "CSRF_RAND_CODE"));
    let mid_attack = safe_int(&first_descendant_text(password_root, "MID_ATK_CHECK"), 0);
    if modulus.is_empty() || csrf.is_empty() {
        return Err(Error("gateway password configuration is incomplete".into()));
    }
    if mid_attack != 0 {
        return Err(Error(
            "gateway requires an unsupported anti-MITM helper".into(),
        ));
    }
    let mut password_config_json = serde_json::to_value(password_config_summary)?;
    password_config_json
        .as_object_mut()
        .expect("summary is an object")
        .remove("state");
    password_config_json["http_status"] = Value::from(password_config_status);
    password_config_json["rsa_key_bits"] = Value::from(modulus.len() * 4);
    password_config_json["csrf_present"] = Value::Bool(true);
    password_config_json["mid_attack_check"] = Value::from(mid_attack);
    evidence["stages"]["password_config"] = password_config_json;

    let material = Zeroizing::new(format!("{password}_{}", csrf.as_str()));
    let encrypted_password = Zeroizing::new(rsa_encrypt_hex(
        material.as_bytes(),
        &modulus,
        exponent as u64,
    )?);
    let mut form = [
        ("mitm_result".into(), String::new()),
        ("svpn_req_randcode".into(), csrf.as_str().to_owned()),
        ("svpn_name".into(), username.to_owned()),
        (
            "svpn_password".into(),
            encrypted_password.as_str().to_owned(),
        ),
        ("svpn_rand_code".into(), String::new()),
    ]
    .into_iter()
    .collect::<BTreeMap<String, String>>();
    let login_result = session.request(
        required_endpoint(config, "password_login")?,
        reqwest::Method::POST,
        Some(&form),
    );
    form.values_mut().for_each(Zeroize::zeroize);
    let (login_data, _, login_status) = login_result?;
    let login_data = Zeroizing::new(login_data);
    let login_summary = auth_summary(&login_data, "password login")?;
    let authenticated = login_summary.state == AuthState::Authenticated;
    let mut login_json = serde_json::to_value(login_summary)?;
    login_json["http_status"] = Value::from(login_status);
    evidence["stages"]["password_login"] = login_json;
    evidence["session"] = session.cookie_summary();
    if authenticated {
        if modern_tunnel_probe {
            evidence["stages"]["modern_tunnel"] = match AuthenticatedSessionId::from_login_xml(
                &login_data,
            )
            .and_then(|session_id| {
                request_modern_token(
                    base_url,
                    &session_id,
                    Duration::from_secs(TUNNEL_PROBE_TIMEOUT_SECONDS),
                )
            }) {
                Ok(acquisition) => {
                    match probe_special_tls_contract(
                        base_url,
                        Duration::from_secs(TUNNEL_PROBE_TIMEOUT_SECONDS),
                        acquisition.verified_leaf_sha256(),
                        configured_special_pin.as_ref(),
                    ) {
                        Ok(contract) => {
                            let channels = contract.certificate_verified.then(|| {
                                probe_modern_empty_channels(
                                    base_url,
                                    &acquisition,
                                    Duration::from_secs(TUNNEL_PROBE_TIMEOUT_SECONDS),
                                    configured_special_pin.as_ref(),
                                )
                            });
                            let (channel_summary, established) = match channels {
                                Some(Ok(channels)) => (
                                    json!({
                                        "address_control_attempted": true,
                                        "address_control_established":
                                            channels.address_control_established,
                                        "assigned_address_present":
                                            channels.assigned_address_present,
                                        "assigned_address_serialized": false,
                                        "send_channel_attempted": true,
                                        "send_channel_established":
                                            channels.send_channel_established,
                                        "receive_channel_attempted": true,
                                        "receive_channel_established":
                                            channels.receive_channel_established,
                                    }),
                                    true,
                                ),
                                Some(Err(error)) => (
                                    json!({
                                        "address_control_attempted": true,
                                        "send_channel_attempted": false,
                                        "receive_channel_attempted": false,
                                        "channel_failure": safe_modern_channel_failure(&error),
                                    }),
                                    false,
                                ),
                                None => (
                                    json!({
                                        "address_control_attempted": false,
                                        "send_channel_attempted": false,
                                        "receive_channel_attempted": false,
                                        "channel_failure": "certificate_pin_required",
                                    }),
                                    false,
                                ),
                            };
                            let mut summary = json!({
                                "attempted": true,
                                "token_established": true,
                                "token_bytes": crate::modern::MODERN_TOKEN_LEN,
                                "control_request_bytes": crate::modern::MODERN_CONTROL_REQUEST_LEN,
                                "special_tls_server_flight": true,
                                "special_tls_version":
                                    format!("0x{:04x}", contract.protocol_version),
                                "special_tls_cipher":
                                    format!("0x{:04x}", contract.cipher_suite),
                                "special_tls_compression": contract.compression_method,
                                "certificate_count": contract.certificate_count,
                                "certificate_verified": contract.certificate_verified,
                                "certificate_verification":
                                    contract.certificate_verification,
                                "presented_leaf_sha256":
                                    hex::encode(contract.presented_leaf_sha256),
                                "pin_update_required": !contract.certificate_verified,
                                "transport_backend": "isolated_native_tls11_rc4",
                                "established": established,
                                "business_payload_sent": false,
                                "sensitive_values_serialized": false,
                            });
                            summary
                                .as_object_mut()
                                .expect("modern summary is an object")
                                .extend(
                                    channel_summary
                                        .as_object()
                                        .expect("channel summary is an object")
                                        .clone(),
                                );
                            summary
                        }
                        Err(error) => json!({
                                "attempted": true,
                                "token_established": true,
                                "special_tls_server_flight": false,
                                "failure": safe_special_tls_failure(&error),
                            "address_control_attempted": false,
                            "send_channel_attempted": false,
                            "receive_channel_attempted": false,
                            "business_payload_sent": false,
                            "sensitive_values_serialized": false,
                        }),
                    }
                }
                Err(_) => json!({
                    "attempted": true,
                    "token_established": false,
                    "failure": "verified_token_transport_or_contract",
                    "business_payload_sent": false,
                    "sensitive_values_serialized": false,
                }),
            };
        }
        for (stage_name, endpoint_name) in [
            ("configuration", "session_config"),
            ("resources", "resource_list"),
        ] {
            let attempt = required_endpoint(config, endpoint_name)
                .and_then(|path| session.request(path, reqwest::Method::GET, None));
            match attempt {
                Ok((data, headers, status)) => {
                    let data = Zeroizing::new(data);
                    let mut summary = structural_summary(&data, stage_name);
                    summary["http_status"] = Value::from(status);
                    summary["content_type"] =
                        Value::String(headers.get("content-type").cloned().unwrap_or_default());
                    let parser_summary = if stage_name == "configuration" {
                        parse_gateway_configuration(&data).and_then(|value| {
                            let bootstrap = parse_tunnel_bootstrap(&data)?;
                            let mut summary = value.safe_summary();
                            summary["tunnel_bootstrap"] = bootstrap
                                .as_ref()
                                .map(|value| value.safe_summary())
                                .unwrap_or_else(|| json!({"present": false}));
                            Ok(("transport_parser", summary))
                        })
                    } else {
                        parse_resource_catalogue(&data)
                            .map(|value| ("resource_parser", value.safe_summary()))
                    };
                    match parser_summary {
                        Ok((key, value)) => {
                            summary[key] = value;
                            summary["parser_compatible"] = Value::Bool(true);
                        }
                        Err(error) => {
                            summary["parser_compatible"] = Value::Bool(false);
                            summary["parser_error"] = Value::String(error.to_string());
                        }
                    }
                    if stage_name == "configuration"
                        && let Some(official_executable) = official_executable
                    {
                        evidence["stages"]["tunnel_handshake"] =
                            match probe_command_tunnel(base_url, &data, official_executable) {
                                Ok(value) => value,
                                Err(error) => json!({
                                    "attempted": true,
                                    "established": false,
                                    "failure": safe_tunnel_failure(&error),
                                    "business_payload_sent": false,
                                    "sensitive_values_serialized": false,
                                }),
                            };
                    }
                    evidence["stages"][stage_name] = summary;
                }
                Err(_) => {
                    evidence["stages"][stage_name] = json!({
                        "available": false,
                        "failure": "request_or_format",
                    });
                }
            }
        }
        let logout_status = required_endpoint(config, "logout")
            .and_then(|path| session.request(path, reqwest::Method::GET, None))
            .map(|(_, _, status)| status)
            .unwrap_or(0);
        evidence["stages"]["logout"] = json!({
            "attempted": true,
            "http_status": logout_status,
        });
    }
    evidence["authenticated"] = Value::Bool(authenticated);
    Ok((evidence, authenticated))
}

pub fn run_probe(config: &Value, username: &str, password: &str) -> Result<(Value, bool)> {
    run_probe_with_tunnel(config, username, password, None, false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credentials_require_exactly_two_lines() {
        let (username, password) =
            read_credentials("synthetic-user\nsynthetic-pass\n".as_bytes()).unwrap();
        assert_eq!(username, "synthetic-user");
        assert_eq!(password, "synthetic-pass");
        assert!(read_credentials("user\npass\nextra\n".as_bytes()).is_err());
        assert!(read_credentials(b"user\npass\0word\n".as_slice()).is_err());
        assert!(read_credentials(b"user\npass\xff\n".as_slice()).is_err());
        assert!(read_credentials(vec![b'x'; MAX_CREDENTIAL_BYTES + 1].as_slice()).is_err());
    }

    #[test]
    fn structural_summary_omits_sensitive_names() {
        let summary = structural_summary(
            br#"<root public="yes" password="no"><Route family="ipv4"/>
                <PASSWORD/><CSRF_RAND_CODE/></root>"#,
            "test",
        );
        assert_eq!(summary["schema_fields"], json!(["Route", "root"]));
        assert_eq!(summary["schema_paths"], json!(["/root", "/root/Route"]));
        assert_eq!(
            summary["attribute_keys"],
            json!({
                "/root": ["public"],
                "/root/Route": ["family"],
            })
        );
    }
}
