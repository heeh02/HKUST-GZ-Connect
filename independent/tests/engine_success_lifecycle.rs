#![cfg(feature = "engine-lifecycle-fixture")]

use serde_json::Value;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

const FIXTURE_MARKER: &str = "HKUSTGZ_TEST_ONLY_ENGINE_LIFECYCLE_V1";
const FIXTURE_USERNAME: &str = "synthetic-lifecycle-user";
const FIXTURE_PASSWORD: &str = "synthetic-lifecycle-password";
const GENERATION: u64 = 901;
const TEST_DEADLINE: Duration = Duration::from_secs(8);

struct TemporaryConfig(PathBuf);

impl TemporaryConfig {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "hkustgz-engine-success-lifecycle-{}-{}.json",
            std::process::id(),
            GENERATION,
        ));
        let config = serde_json::json!({
            "proxy": {
                "allow_system_dns_fallback": false,
                "vpn_dns_servers": []
            },
            "tunnel": { "mtu": 1400 }
        });
        std::fs::write(&path, serde_json::to_vec(&config).unwrap()).unwrap();
        Self(path)
    }
}

impl Drop for TemporaryConfig {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

struct ChildGuard {
    child: Child,
}

impl Drop for ChildGuard {
    fn drop(&mut self) {
        if self.child.try_wait().ok().flatten().is_none() {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }
}

fn unused_loopback_port() -> u16 {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
    listener.local_addr().unwrap().port()
}

fn receive_event(
    receiver: &mpsc::Receiver<String>,
    deadline: Instant,
    observed: &mut Vec<Value>,
) -> Value {
    let remaining = deadline.saturating_duration_since(Instant::now());
    let line = receiver
        .recv_timeout(remaining)
        .expect("ec-engine did not emit the expected lifecycle event before the deadline");
    let event: Value = serde_json::from_str(&line).expect("ec-engine stdout must remain NDJSON");
    observed.push(event.clone());
    event
}

fn wait_for_event<F>(
    receiver: &mpsc::Receiver<String>,
    deadline: Instant,
    observed: &mut Vec<Value>,
    predicate: F,
) -> Value
where
    F: Fn(&Value) -> bool,
{
    loop {
        let event = receive_event(receiver, deadline, observed);
        if predicate(&event) {
            return event;
        }
    }
}

fn wait_for_exit(child: &mut Child, deadline: Instant) -> std::process::ExitStatus {
    loop {
        if let Some(status) = child.try_wait().unwrap() {
            return status;
        }
        assert!(
            Instant::now() < deadline,
            "ec-engine did not stop inside the subprocess lifecycle deadline"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn real_ec_engine_serves_and_stops_after_a_synthetic_transport_success() {
    let config = TemporaryConfig::new();
    let port = unused_loopback_port();
    let engine_path = env!("CARGO_BIN_EXE_ec-engine");
    let engine_binary = std::fs::read(engine_path).unwrap();
    assert!(
        engine_binary
            .windows(FIXTURE_MARKER.len())
            .any(|window| window == FIXTURE_MARKER.as_bytes()),
        "feature-enabled ec-engine must retain the package-rejection marker"
    );
    let mut child = ChildGuard {
        child: Command::new(engine_path)
            .args([
                "--config",
                config.0.to_str().unwrap(),
                "--credentials-stdin",
                "--control-api-v2-stdin",
                "--test-lifecycle-transport",
                "--socks-bind",
                &format!("127.0.0.1:{port}"),
                "--generation",
                &GENERATION.to_string(),
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap(),
    };
    let mut stdin = child.child.stdin.take().unwrap();
    let stdout = child.child.stdout.take().unwrap();
    let mut stderr = child.child.stderr.take().unwrap();

    let (line_sender, line_receiver) = mpsc::channel();
    let stdout_reader = std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            if line_sender.send(line.unwrap()).is_err() {
                break;
            }
        }
    });
    let stderr_reader = std::thread::spawn(move || {
        let mut output = String::new();
        stderr.read_to_string(&mut output).unwrap();
        output
    });

    writeln!(stdin, "{FIXTURE_USERNAME}").unwrap();
    writeln!(stdin, "{FIXTURE_PASSWORD}").unwrap();
    writeln!(stdin, r#"{{"type":"hello","requestId":1,"versions":[2]}}"#).unwrap();
    stdin.flush().unwrap();

    let deadline = Instant::now() + TEST_DEADLINE;
    let mut observed = Vec::new();
    wait_for_event(&line_receiver, deadline, &mut observed, |event| {
        event["type"] == "listener_ready" && event["port"] == port
    });
    wait_for_event(&line_receiver, deadline, &mut observed, |event| {
        event["type"] == "state_changed" && event["state"] == "connected"
    });

    let mut stalled_client = TcpStream::connect_timeout(
        &SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port),
        Duration::from_secs(1),
    )
    .expect("listener_ready must identify a real loopback listener");
    stalled_client
        .set_read_timeout(Some(Duration::from_secs(1)))
        .unwrap();
    stalled_client.write_all(&[5, 1, 0]).unwrap();
    let mut greeting = [0_u8; 2];
    stalled_client.read_exact(&mut greeting).unwrap();
    assert_eq!(greeting, [5, 0]);

    let stop_started = Instant::now();
    writeln!(
        stdin,
        r#"{{"type":"request","apiVersion":2,"requestId":2,"command":{{"name":"shutdown"}}}}"#
    )
    .unwrap();
    stdin.flush().unwrap();
    wait_for_event(&line_receiver, deadline, &mut observed, |event| {
        event["type"] == "stopped" && event["reason"] == "user_requested"
    });
    let status = wait_for_exit(&mut child.child, deadline);
    drop(stdin);
    drop(stalled_client);
    stdout_reader.join().unwrap();
    let diagnostics = stderr_reader.join().unwrap();

    assert!(
        status.success(),
        "synthetic success lifecycle must exit cleanly"
    );
    assert!(stop_started.elapsed() < Duration::from_secs(5));
    assert_eq!(diagnostics.matches(FIXTURE_MARKER).count(), 1);
    assert!(!diagnostics.contains(FIXTURE_USERNAME));
    assert!(!diagnostics.contains(FIXTURE_PASSWORD));
    assert!(!observed.iter().any(|event| event["type"] == "fatal_error"));

    let states = observed
        .iter()
        .filter(|event| event["type"] == "state_changed")
        .map(|event| event["state"].as_str().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(
        states,
        [
            "connecting",
            "authenticating",
            "preparing_tunnel",
            "connected",
            "stopping",
            "stopped",
        ]
    );
    assert!(observed.iter().any(|event| {
        event["type"] == "control_result"
            && event["requestId"] == 2
            && event["status"] == "accepted"
    }));
    assert!(
        observed
            .iter()
            .any(|event| { event["type"] == "dns_mode" && event["mode"] == "disabled" })
    );
    assert_eq!(
        observed
            .iter()
            .filter(|event| event["type"] == "stopped")
            .count(),
        1
    );
    assert_eq!(
        observed
            .iter()
            .filter(|event| { event["type"] == "state_changed" && event["state"] == "stopping" })
            .count(),
        1
    );

    let reconnect = TcpStream::connect_timeout(
        &SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port),
        Duration::from_millis(200),
    );
    assert!(
        reconnect.is_err(),
        "the listener must be gone after clean stop"
    );
    let rebound = TcpListener::bind((Ipv4Addr::LOCALHOST, port))
        .expect("the stopped Engine must release its exact loopback listener port");
    assert_eq!(rebound.local_addr().unwrap().port(), port);
}
