//! Real child-process pipes: memory writers cannot detect stdout buffering.
#![cfg(unix)]

use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::os::unix::fs::OpenOptionsExt;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

struct ChildGuard(Child);
impl Drop for ChildGuard {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

#[test]
fn downstream_binary_data_is_visible_before_newline_or_eof() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let path = std::env::temp_dir().join(format!(
        "ec-proxy-pipe-{}-{}",
        std::process::id(),
        listener.local_addr().unwrap().port()
    ));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&path)
        .unwrap();
    writeln!(
        file,
        "{}\nfixture-user\nfixture-password",
        listener.local_addr().unwrap()
    )
    .unwrap();
    drop(file);
    let mut child = ChildGuard(
        Command::new(env!("CARGO_BIN_EXE_ec-proxy-command"))
            .args(["--credential-file"])
            .arg(&path)
            .args(["--", "fixture.invalid", "22"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap(),
    );
    listener.set_nonblocking(true).unwrap();
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    let mut peer = loop {
        match listener.accept() {
            Ok((peer, _)) => break peer,
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                assert!(
                    std::time::Instant::now() < deadline,
                    "helper did not connect"
                );
                std::thread::sleep(Duration::from_millis(10));
            }
            Err(error) => panic!("fixture accept: {error}"),
        }
    };
    fs::remove_file(path).unwrap();
    peer.set_nonblocking(false).unwrap();
    peer.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
    peer.set_write_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    let mut greeting = [0; 4];
    peer.read_exact(&mut greeting).unwrap();
    assert_eq!(greeting, [5, 2, 0, 2]);
    peer.write_all(&[5, 0]).unwrap();
    let mut request = [0; 22];
    peer.read_exact(&mut request).unwrap();
    assert_eq!(&request[..5], &[5, 1, 0, 3, 15]);
    peer.write_all(&[5, 0, 0, 1, 127, 0, 0, 1, 0, 22]).unwrap();
    let mut stdout = child.0.stdout.take().unwrap();
    let (tx, rx) = mpsc::channel();
    let reader = std::thread::spawn(move || {
        let mut bytes = [0; 4];
        let result = stdout.read_exact(&mut bytes).map(|()| bytes);
        let _ = tx.send(result);
    });
    // Keep stdin and the peer open: neither EOF nor a newline may flush this payload.
    peer.write_all(&[0, 255, 1, 128]).unwrap();
    let result = rx.recv_timeout(Duration::from_secs(2));
    drop(peer);
    drop(child);
    reader.join().unwrap();
    assert_eq!(
        result.expect("binary data was buffered until EOF").unwrap(),
        [0, 255, 1, 128]
    );
}
