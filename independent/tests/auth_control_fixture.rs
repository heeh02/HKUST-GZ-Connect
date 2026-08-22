use serde_json::Value;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

struct Fixture {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    observed: Vec<String>,
}

impl Fixture {
    fn start(generation: u64) -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_ec-auth-fixture"))
            .args(["--generation", &generation.to_string()])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let stdin = child.stdin.take().unwrap();
        let stdout = BufReader::new(child.stdout.take().unwrap());
        Self {
            child,
            stdin,
            stdout,
            observed: Vec::new(),
        }
    }

    fn send(&mut self, frame: &str) {
        self.stdin.write_all(frame.as_bytes()).unwrap();
        self.stdin.write_all(b"\n").unwrap();
        self.stdin.flush().unwrap();
    }

    fn read(&mut self) -> Value {
        let mut line = String::new();
        assert!(self.stdout.read_line(&mut line).unwrap() > 0);
        self.observed.push(line.clone());
        serde_json::from_str(&line).unwrap()
    }

    fn handshake(&mut self) -> Value {
        assert_eq!(self.read()["type"], "hello");
        assert_eq!(self.read()["state"], "authenticating");
        self.send(r#"{"type":"hello","requestId":1,"versions":[2]}"#);
        assert_eq!(self.read()["type"], "control_hello");
        let challenge = self.read();
        assert_eq!(challenge["type"], "auth_challenge_required");
        challenge
    }

    fn finish(mut self) -> Vec<String> {
        drop(self.stdin);
        assert!(self.child.wait().unwrap().success());
        self.observed
    }
}

#[test]
fn synthetic_password_challenge_response_produces_authenticated_state() {
    let mut fixture = Fixture::start(9);
    let challenge = fixture.handshake();
    assert_eq!(challenge["challenge"]["kind"], "otp");
    assert_eq!(challenge["challenge"]["attemptsRemaining"], 3);
    fixture.send(r#"{"type":"auth_request","apiVersion":3,"requestId":2,"generation":9,"transactionId":"04040404040404040404040404040404","challengeEpoch":1,"command":{"name":"respond","response":"synthetic-accepted"}}"#);
    assert_eq!(fixture.read()["type"], "auth_complete");
    let connected = fixture.read();
    assert_eq!(connected["type"], "state_changed");
    assert_eq!(connected["state"], "connected");
    let observed = fixture.finish().concat();
    assert!(!observed.contains("synthetic-accepted"));
    assert!(!observed.contains("response"));
}

#[test]
fn synthetic_wrong_response_resend_and_cancel_keep_one_bound_transaction() {
    let mut fixture = Fixture::start(12);
    fixture.handshake();
    fixture.send(r#"{"type":"auth_request","apiVersion":3,"requestId":2,"generation":12,"transactionId":"04040404040404040404040404040404","challengeEpoch":1,"command":{"name":"respond","response":"synthetic-wrong"}}"#);
    let pending = fixture.read();
    assert_eq!(pending["type"], "auth_challenge");
    assert_eq!(pending["challenge"]["challengeEpoch"], 1);
    assert_eq!(pending["challenge"]["attemptsRemaining"], 2);

    fixture.send(r#"{"type":"auth_request","apiVersion":3,"requestId":3,"generation":12,"transactionId":"04040404040404040404040404040404","challengeEpoch":1,"command":{"name":"resend"}}"#);
    let resent = fixture.read();
    assert_eq!(resent["type"], "auth_challenge");
    assert_eq!(resent["challenge"]["challengeEpoch"], 2);

    fixture.send(r#"{"type":"auth_request","apiVersion":3,"requestId":4,"generation":12,"transactionId":"04040404040404040404040404040404","challengeEpoch":2,"command":{"name":"cancel"}}"#);
    assert_eq!(fixture.read()["type"], "auth_cancelled");
    let observed = fixture.finish().concat();
    assert!(!observed.contains("synthetic-wrong"));
    assert!(!observed.contains("response"));
}
