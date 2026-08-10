//! Explicitly-run offline measurements for the production SOCKS parser.
//!
//! The timer starts after the loopback TCP pair is established and covers the
//! SOCKS greeting, optional RFC 1929 exchange, CONNECT request/reply, and one
//! payload echo. No userspace netstack or gateway is involved.

use super::*;
use serde::Serialize;
use std::time::Instant;
use tokio::sync::Barrier;

const CONCURRENCIES: [usize; 3] = [1, 8, 32];
const PAYLOAD_BYTES: [usize; 3] = [64, 512, 1_400];
const WAVES: usize = 32;
const P95_DISASTER_LIMIT: Duration = Duration::from_secs(2);
const CELL_DISASTER_LIMIT: Duration = Duration::from_secs(30);
const BENCHMARK_USERNAME: &str = "offline-proxy-user";
const BENCHMARK_PASSWORD: &str = "offline-proxy-password";

#[derive(Clone, Copy)]
enum AuthenticationMode {
    NoAuth,
    Rfc1929,
}

impl AuthenticationMode {
    fn name(self) -> &'static str {
        match self {
            Self::NoAuth => "socks5_no_auth",
            Self::Rfc1929 => "socks5_rfc1929",
        }
    }

    fn server_authentication(self) -> ProxyAuthentication {
        match self {
            Self::NoAuth => ProxyAuthentication::None,
            Self::Rfc1929 => {
                ProxyAuthentication::required(BENCHMARK_USERNAME, BENCHMARK_PASSWORD).unwrap()
            }
        }
    }
}

#[derive(Serialize)]
struct PerformanceRecord {
    schema: &'static str,
    benchmark: &'static str,
    scope: &'static str,
    authentication: &'static str,
    concurrency: usize,
    payload_bytes: usize,
    samples: usize,
    p50_us: u64,
    p95_us: u64,
    max_us: u64,
    cell_elapsed_us: u64,
    p95_disaster_limit_us: u64,
    cell_disaster_limit_us: u64,
    passed: bool,
    build_profile: &'static str,
    target_os: &'static str,
    target_arch: &'static str,
    gateway_traffic: bool,
}

#[derive(Serialize)]
struct MatrixSummary {
    schema: &'static str,
    benchmark: &'static str,
    cells: usize,
    max_observed_p95_us: u64,
    passed: bool,
    interpretation: &'static str,
    gateway_traffic: bool,
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "offline performance matrix; run explicitly with --release --ignored --nocapture"]
async fn offline_socks5_frontend_matrix() {
    let modes = [AuthenticationMode::NoAuth, AuthenticationMode::Rfc1929];
    let mut cell_count = 0_usize;
    let mut max_observed_p95_us = 0_u64;

    for mode in modes {
        for concurrency in CONCURRENCIES {
            for payload_bytes in PAYLOAD_BYTES {
                let cell_started = Instant::now();
                let mut samples = tokio::time::timeout(
                    CELL_DISASTER_LIMIT,
                    measure_cell(mode, concurrency, payload_bytes),
                )
                .await
                .expect("SOCKS matrix cell exceeded the disaster timeout");
                let elapsed = cell_started.elapsed();
                let p50_us = percentile(&mut samples, 50);
                let p95_us = percentile(&mut samples, 95);
                let max_us = *samples.last().expect("matrix cells always have samples");
                let passed = Duration::from_micros(p95_us) <= P95_DISASTER_LIMIT
                    && elapsed <= CELL_DISASTER_LIMIT;
                max_observed_p95_us = max_observed_p95_us.max(p95_us);
                cell_count += 1;

                emit(&PerformanceRecord {
                    schema: "hkustgzconnect.offline-performance.v1",
                    benchmark: "socks5_local_protocol_round_trip",
                    scope: "established_loopback_handshake_connect_and_payload_echo",
                    authentication: mode.name(),
                    concurrency,
                    payload_bytes,
                    samples: samples.len(),
                    p50_us,
                    p95_us,
                    max_us,
                    cell_elapsed_us: micros(elapsed),
                    p95_disaster_limit_us: micros(P95_DISASTER_LIMIT),
                    cell_disaster_limit_us: micros(CELL_DISASTER_LIMIT),
                    passed,
                    build_profile: build_profile(),
                    target_os: std::env::consts::OS,
                    target_arch: std::env::consts::ARCH,
                    gateway_traffic: false,
                });
                assert!(
                    passed,
                    "{} concurrency={concurrency} payload={payload_bytes} exceeded the broad offline disaster threshold",
                    mode.name()
                );
            }
        }
    }

    emit(&MatrixSummary {
        schema: "hkustgzconnect.offline-performance.v1",
        benchmark: "socks5_local_protocol_matrix_summary",
        cells: cell_count,
        max_observed_p95_us,
        passed: true,
        interpretation: "offline loopback protocol guard; not gateway or VPN throughput",
        gateway_traffic: false,
    });
}

async fn measure_cell(
    mode: AuthenticationMode,
    concurrency: usize,
    payload_bytes: usize,
) -> Vec<u64> {
    let mut samples = Vec::with_capacity(concurrency * WAVES);
    for wave in 0..WAVES {
        let pairs = connected_pairs(concurrency).await;
        let barrier = Arc::new(Barrier::new(concurrency + 1));
        let mut server_tasks = Vec::with_capacity(concurrency);
        let mut client_tasks = Vec::with_capacity(concurrency);

        for (index, (mut client, mut server)) in pairs.into_iter().enumerate() {
            configure_client_socket(&server).unwrap();
            let authentication = mode.server_authentication();
            server_tasks.push(tokio::spawn(async move {
                let request = bounded_handshake(
                    &mut server,
                    &crate::engine::proxy::RejectDomainResolver,
                    &authentication,
                    Duration::from_secs(5),
                    Duration::from_secs(5),
                )
                .await
                .unwrap()
                .expect("benchmark client must complete its handshake");
                let ProxyRequest::Connect { frontend, remote } = request else {
                    panic!("benchmark sends only TCP CONNECT");
                };
                assert_eq!(remote, "10.20.30.40:443".parse().unwrap());
                send_connect_reply(&mut server, frontend, true)
                    .await
                    .unwrap();
                let mut payload = vec![0_u8; payload_bytes];
                server.read_exact(&mut payload).await.unwrap();
                server.write_all(&payload).await.unwrap();
            }));

            let barrier = Arc::clone(&barrier);
            client_tasks.push(tokio::spawn(async move {
                let payload = vec![(wave ^ index) as u8; payload_bytes];
                let mut echoed = vec![0_u8; payload_bytes];
                barrier.wait().await;
                let started = Instant::now();
                run_client_exchange(&mut client, mode, &payload, &mut echoed).await;
                assert_eq!(echoed, payload);
                micros(started.elapsed())
            }));
        }

        barrier.wait().await;
        for task in client_tasks {
            samples.push(task.await.unwrap());
        }
        for task in server_tasks {
            task.await.unwrap();
        }
    }
    samples
}

async fn connected_pairs(count: usize) -> Vec<(TcpStream, TcpStream)> {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let mut pairs = Vec::with_capacity(count);
    for _ in 0..count {
        let (client, accepted) = tokio::join!(TcpStream::connect(address), listener.accept());
        let (server, peer) = accepted.unwrap();
        assert!(peer.ip().is_loopback());
        pairs.push((client.unwrap(), server));
    }
    pairs
}

async fn run_client_exchange(
    client: &mut TcpStream,
    mode: AuthenticationMode,
    payload: &[u8],
    echoed: &mut [u8],
) {
    let method = match mode {
        AuthenticationMode::NoAuth => NO_AUTHENTICATION,
        AuthenticationMode::Rfc1929 => USERNAME_PASSWORD_AUTHENTICATION,
    };
    client.write_all(&[SOCKS_VERSION, 1, method]).await.unwrap();
    let mut method_reply = [0_u8; 2];
    client.read_exact(&mut method_reply).await.unwrap();
    assert_eq!(method_reply, [SOCKS_VERSION, method]);

    if matches!(mode, AuthenticationMode::Rfc1929) {
        let username = BENCHMARK_USERNAME.as_bytes();
        let password = BENCHMARK_PASSWORD.as_bytes();
        let mut credentials = Vec::with_capacity(username.len() + password.len() + 3);
        credentials.extend_from_slice(&[RFC1929_VERSION, username.len() as u8]);
        credentials.extend_from_slice(username);
        credentials.push(password.len() as u8);
        credentials.extend_from_slice(password);
        client.write_all(&credentials).await.unwrap();
        let mut authentication_reply = [0_u8; 2];
        client.read_exact(&mut authentication_reply).await.unwrap();
        assert_eq!(authentication_reply, [RFC1929_VERSION, RFC1929_SUCCESS]);
    }

    client
        .write_all(&[
            SOCKS_VERSION,
            CONNECT_COMMAND,
            0,
            ADDRESS_IPV4,
            10,
            20,
            30,
            40,
            1,
            187,
        ])
        .await
        .unwrap();
    let mut connect_reply = [0_u8; 10];
    client.read_exact(&mut connect_reply).await.unwrap();
    assert_eq!(connect_reply[..4], [SOCKS_VERSION, 0, 0, ADDRESS_IPV4]);

    client.write_all(payload).await.unwrap();
    client.read_exact(echoed).await.unwrap();
}

fn percentile(samples: &mut [u64], percentile: usize) -> u64 {
    samples.sort_unstable();
    let rank = (samples.len() * percentile).div_ceil(100);
    let index = rank.saturating_sub(1);
    samples[index]
}

fn micros(duration: Duration) -> u64 {
    u64::try_from(duration.as_micros()).unwrap_or(u64::MAX)
}

fn build_profile() -> &'static str {
    if cfg!(debug_assertions) {
        "debug"
    } else {
        "release"
    }
}

fn emit<T: Serialize>(record: &T) {
    println!(
        "\nHKUSTGZ_PERF_JSON {}",
        serde_json::to_string(record).expect("performance record must serialize")
    );
}
