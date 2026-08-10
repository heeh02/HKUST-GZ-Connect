use serde_json::Value;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};

fn engine() -> Command {
    Command::new(env!("CARGO_BIN_EXE_ec-engine"))
}

fn events(output: &[u8]) -> Vec<Value> {
    std::str::from_utf8(output)
        .expect("engine stdout must be UTF-8 NDJSON")
        .lines()
        .map(|line| serde_json::from_str(line).expect("every stdout line must be one JSON event"))
        .collect()
}

#[test]
fn invalid_arguments_emit_only_bounded_machine_events_without_echoing_values() {
    let secret = "must-not-be-repeated";
    let output = engine()
        .args(["--password", secret])
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(!String::from_utf8_lossy(&output.stdout).contains(secret));
    assert!(!String::from_utf8_lossy(&output.stderr).contains(secret));

    let events = events(&output.stdout);
    assert_eq!(events[0]["type"], "hello");
    assert!(
        events.iter().any(|event| {
            event["type"] == "fatal_error" && event["code"] == "INVALID_ARGUMENTS"
        })
    );
    assert_eq!(events.last().unwrap()["type"], "stopped");
    assert!(events.iter().all(|event| event.to_string().len() < 1024));
}

#[test]
fn generation_flows_through_lifecycle_when_credentials_are_absent() {
    let config = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("config")
        .join("hkustgz.json");
    let output = engine()
        .args([
            "--config",
            config.to_str().unwrap(),
            "--credentials-stdin",
            "--socks-bind",
            "127.0.0.1:6180",
            "--generation",
            "77",
        ])
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert!(!output.status.success());

    let events = events(&output.stdout);
    let states = events
        .iter()
        .filter(|event| event["type"] == "state_changed")
        .collect::<Vec<_>>();
    assert_eq!(
        states
            .iter()
            .map(|event| event["state"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["connecting", "authenticating", "stopping", "stopped"]
    );
    assert!(states.iter().all(|event| event["generation"] == 77));
    assert!(
        events.iter().any(|event| {
            event["type"] == "fatal_error" && event["code"] == "CREDENTIALS_INVALID"
        })
    );
    let stopped = events.last().unwrap();
    assert_eq!(stopped["type"], "stopped");
    assert_eq!(stopped["generation"], 77);

    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(!stdout.contains("Client IP assigned"));
    assert!(!stdout.contains("ec-engine:"));
    assert!(String::from_utf8_lossy(&output.stderr).contains("ec-engine:"));
}

#[test]
fn configuration_failures_do_not_copy_local_paths_to_diagnostics_or_events() {
    let private_path = "/tmp/private-user-name/secret-profile.json";
    let output = engine()
        .args([
            "--config",
            private_path,
            "--credentials-stdin",
            "--socks-bind",
            "127.0.0.1:6180",
            "--generation",
            "8",
        ])
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(!String::from_utf8_lossy(&output.stdout).contains(private_path));
    assert!(!String::from_utf8_lossy(&output.stderr).contains(private_path));
    assert!(events(&output.stdout).iter().any(|event| {
        event["type"] == "fatal_error" && event["code"] == "CONFIGURATION_INVALID"
    }));
}

#[test]
fn strict_proxy_credentials_are_bounded_stdin_only_and_never_echoed() {
    let config = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("config")
        .join("hkustgz.json");
    let private_proxy_password = format!("private-proxy-secret-{}", "x".repeat(255));
    let mut child = engine()
        .args([
            "--config",
            config.to_str().unwrap(),
            "--credentials-stdin",
            "--socks-auth-stdin",
            "--socks-bind",
            "127.0.0.1:6180",
            "--generation",
            "91",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let input = format!("gateway-user\ngateway-password\nlocal-user\n{private_proxy_password}\n");
    child
        .stdin
        .take()
        .unwrap()
        .write_all(input.as_bytes())
        .unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(!output.status.success());
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(!stdout.contains(&private_proxy_password));
    assert!(!stderr.contains(&private_proxy_password));
    assert!(
        events(&output.stdout).iter().any(|event| {
            event["type"] == "fatal_error" && event["code"] == "CREDENTIALS_INVALID"
        })
    );
}

#[test]
fn optional_proxy_credentials_are_bounded_stdin_only_and_never_echoed() {
    let config = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("config")
        .join("hkustgz.json");
    let private_proxy_password = format!("private-optional-proxy-secret-{}", "x".repeat(255));
    let mut child = engine()
        .args([
            "--config",
            config.to_str().unwrap(),
            "--credentials-stdin",
            "--socks-auth-optional-stdin",
            "--socks-bind",
            "127.0.0.1:6180",
            "--generation",
            "92",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let input = format!("gateway-user\ngateway-password\nlocal-user\n{private_proxy_password}\n");
    child
        .stdin
        .take()
        .unwrap()
        .write_all(input.as_bytes())
        .unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(!output.status.success());
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(!stdout.contains(&private_proxy_password));
    assert!(!stderr.contains(&private_proxy_password));
    assert!(
        events(&output.stdout).iter().any(|event| {
            event["type"] == "fatal_error" && event["code"] == "CREDENTIALS_INVALID"
        })
    );
}

#[test]
fn strict_and_optional_proxy_authentication_flags_are_mutually_exclusive() {
    let output = engine()
        .args([
            "--config",
            "profile.json",
            "--credentials-stdin",
            "--socks-auth-stdin",
            "--socks-auth-optional-stdin",
            "--socks-bind",
            "127.0.0.1:6180",
        ])
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(
        events(&output.stdout).iter().any(|event| {
            event["type"] == "fatal_error" && event["code"] == "INVALID_ARGUMENTS"
        })
    );
}
