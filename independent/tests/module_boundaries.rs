use std::fs;
use std::path::PathBuf;

fn source(path: &str) -> String {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    fs::read_to_string(root.join(path)).expect("source file must be readable")
}

fn rust_sources(directory: PathBuf) -> Vec<PathBuf> {
    let mut sources = Vec::new();
    for entry in fs::read_dir(directory).expect("source directory") {
        let path = entry.expect("source entry").path();
        if path.is_dir() {
            sources.extend(rust_sources(path));
        } else if path.extension().and_then(|value| value.to_str()) == Some("rs") {
            sources.push(path);
        }
    }
    sources
}

#[test]
fn production_engine_never_imports_probe_workflows() {
    let engine = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/engine");
    for path in rust_sources(engine) {
        let contents = fs::read_to_string(&path).expect("engine source");
        assert!(
            !contents.contains("crate::probe"),
            "production engine depends on probe workflow: {}",
            path.display()
        );
    }
}

#[test]
fn production_engine_composes_one_closed_provider_set_instead_of_concrete_adapters() {
    let engine = source("src/bin/ec-engine.rs");
    assert!(engine.contains("ProductionProviderSet::from_config"));
    assert!(engine.contains("providers.authentication_provider()"));
    assert!(engine.contains("providers.transport_backend()"));
    assert!(!engine.contains("ModernL3TransportBackend::new"));
    assert!(
        !engine
            .contains("AuthenticatedGatewaySession::authenticate_with_provider_error_cancellable")
    );

    let composition = source("src/engine/provider_composition.rs").to_ascii_lowercase();
    assert!(composition.contains("easyconnect-password-modern-l3-v1"));
    for forbidden in ["libloading", "dlopen", "library::new", "loadlibrary"] {
        assert!(
            !composition.contains(forbidden),
            "composition contains {forbidden}"
        );
    }
}

#[test]
fn gateway_http_is_neutral_to_probe_transport_and_local_frontends() {
    let gateway = source("src/gateway_http.rs");
    for forbidden in [
        "crate::probe",
        "crate::modern",
        "crate::special_tls11",
        "crate::engine::socks",
        "crate::engine::dns",
        "crate::engine::data_plane",
        "crate::watch",
    ] {
        assert!(
            !gateway.contains(forbidden),
            "gateway HTTP imports {forbidden}"
        );
    }
}

#[test]
fn credential_input_is_neutral_to_gateway_and_protocol_layers() {
    let credentials = source("src/credentials.rs");
    for forbidden in [
        "gateway_http",
        "crate::probe",
        "crate::engine",
        "crate::modern",
    ] {
        assert!(
            !credentials.contains(forbidden),
            "credential input imports {forbidden}"
        );
    }
}

#[test]
fn authenticated_gateway_artifacts_are_transport_neutral() {
    let authentication = source("src/gateway_auth.rs");
    for forbidden in [
        "crate::modern",
        "crate::special_tls11",
        "crate::engine::data_plane",
        "crate::engine::dns",
        "crate::engine::socks",
    ] {
        assert!(
            !authentication.contains(forbidden),
            "gateway auth artifact imports {forbidden}"
        );
    }
    let session = source("src/engine/session.rs");
    assert!(!session.contains("modern_session:"));
    assert!(session.contains("session_identifier: AuthenticatedSessionId"));
}

#[test]
fn auth_transaction_contract_contains_no_vendor_endpoint_or_fixed_otp_shape() {
    let transaction = source("src/engine/auth_transaction.rs").to_ascii_lowercase();
    for forbidden in [
        "/auth/sms",
        "/auth/token",
        "svpn_rand_code",
        "nextservice",
        "otp_length",
        "six_digit",
        "reqwest",
        "first_descendant_text",
    ] {
        assert!(
            !transaction.contains(forbidden),
            "generic transaction hard-codes {forbidden}"
        );
    }
    assert!(transaction.contains("authgatewayrequestbudget"));
    assert!(transaction.contains("authenticationlimitexceeded"));
}

#[test]
fn auth_control_v3_is_private_bounded_and_has_no_vendor_protocol_fields() {
    let control = source("src/engine/auth_control.rs").to_ascii_lowercase();
    for forbidden in [
        "tcp::bind",
        "tcplistener",
        "127.0.0.1",
        "/auth/",
        "svpn_",
        "nextservice",
        "twfid",
        "csrf_rand_code",
        "six_digit",
    ] {
        assert!(
            !control.contains(forbidden),
            "auth control hard-codes {forbidden}"
        );
    }
    assert!(control.contains("max_auth_control_frame_bytes"));
    assert!(control.contains("zeroizing"));
}
