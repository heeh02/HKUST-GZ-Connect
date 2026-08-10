//! Repeatable, offline netstack scheduling probe.
//!
//! Two userspace stacks are connected by an in-memory pipe. The matrix measures
//! scheduling and in-process TCP round-trip latency only; it never contacts an
//! EasyConnect gateway and must not be reported as VPN throughput.

use serde::Serialize;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::{Arc, Barrier};
use std::time::{Duration, Instant};
use ts_netstack_smoltcp::netcore::{Config, HasChannel, NetstackControl};
use ts_netstack_smoltcp::netsock::CreateSocket;
use ts_netstack_smoltcp::piped_pair;

const CLIENT_IP: IpAddr = IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1));
const SERVER: SocketAddr = SocketAddr::new(IpAddr::V4(Ipv4Addr::new(10, 0, 0, 2)), 9_100);
const FIRST_CLIENT_PORT: u16 = 40_000;
const CONCURRENCIES: [usize; 3] = [1, 8, 32];
const PAYLOAD_BYTES: [usize; 3] = [64, 512, 1_400];
const WARMUP_ROUND_TRIPS: usize = 2;
const MEASURED_ROUND_TRIPS: usize = 32;

// These intentionally broad limits catch hangs or second-scale scheduling
// regressions. They are not microbenchmark budgets and must not be tightened
// from one developer laptop's result.
const P95_DISASTER_LIMIT: Duration = Duration::from_secs(2);
const CELL_DISASTER_LIMIT: Duration = Duration::from_secs(30);

#[derive(Clone, Copy)]
enum RunnerMode {
    Threaded { poll: Duration, name: &'static str },
    EventDriven,
}

impl RunnerMode {
    fn name(self) -> &'static str {
        match self {
            Self::Threaded { name, .. } => name,
            Self::EventDriven => "event_driven_tokio",
        }
    }
}

#[derive(Serialize)]
struct PerformanceRecord {
    schema: &'static str,
    benchmark: &'static str,
    scope: &'static str,
    runner: &'static str,
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

struct CellMeasurement {
    samples_us: Vec<u64>,
    elapsed: Duration,
}

#[test]
#[ignore = "offline performance matrix; run explicitly with --release --ignored --nocapture"]
fn offline_netstack_poll_latency_matrix() {
    let modes = [
        RunnerMode::Threaded {
            poll: Duration::from_millis(2),
            name: "threaded_poll_2ms",
        },
        RunnerMode::Threaded {
            poll: Duration::from_millis(1),
            name: "threaded_poll_1ms",
        },
        RunnerMode::EventDriven,
    ];
    let mut cell_count = 0_usize;
    let mut max_observed_p95_us = 0_u64;

    for mode in modes {
        for concurrency in CONCURRENCIES {
            for payload_bytes in PAYLOAD_BYTES {
                let measurement = match mode {
                    RunnerMode::Threaded { poll, .. } => {
                        measure_threaded_with_timeout(poll, concurrency, payload_bytes)
                    }
                    RunnerMode::EventDriven => measure_event_driven(concurrency, payload_bytes),
                };
                let mut samples = measurement.samples_us;
                let p50_us = percentile(&mut samples, 50);
                let p95_us = percentile(&mut samples, 95);
                let max_us = *samples.last().expect("matrix cells always have samples");
                let passed = Duration::from_micros(p95_us) <= P95_DISASTER_LIMIT
                    && measurement.elapsed <= CELL_DISASTER_LIMIT;
                max_observed_p95_us = max_observed_p95_us.max(p95_us);
                cell_count += 1;

                emit(&PerformanceRecord {
                    schema: "hkustgzconnect.offline-performance.v1",
                    benchmark: "netstack_poll_latency",
                    scope: "in_memory_userspace_tcp_round_trip",
                    runner: mode.name(),
                    concurrency,
                    payload_bytes,
                    samples: samples.len(),
                    p50_us,
                    p95_us,
                    max_us,
                    cell_elapsed_us: micros(measurement.elapsed),
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
        benchmark: "netstack_poll_latency_matrix_summary",
        cells: cell_count,
        max_observed_p95_us,
        passed: true,
        interpretation: "offline in-memory latency guard; not gateway or VPN throughput",
        gateway_traffic: false,
    });
}

fn config() -> Config {
    Config {
        mtu: 1_500,
        loopback: false,
        tcp_listen_backlog: 64,
        ..Default::default()
    }
}

fn measure_threaded_with_timeout(
    poll: Duration,
    concurrency: usize,
    payload_bytes: usize,
) -> CellMeasurement {
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let _ = sender.send(measure_threaded(poll, concurrency, payload_bytes));
    });
    receiver
        .recv_timeout(CELL_DISASTER_LIMIT)
        .expect("threaded netstack matrix cell failed or exceeded the disaster timeout")
}

fn measure_threaded(poll: Duration, concurrency: usize, payload_bytes: usize) -> CellMeasurement {
    use std::io::{Read, Write};

    let started = Instant::now();
    let (client_stack, server_stack) = piped_pair(config());
    let client_channel = client_stack.command_channel();
    let server_channel = server_stack.command_channel();
    // The runners must be live before set_ips_blocking sends its command.
    let _client_runner = client_stack.spawn_threaded(poll);
    let _server_runner = server_stack.spawn_threaded(poll);
    client_channel.set_ips_blocking([CLIENT_IP]).unwrap();
    server_channel.set_ips_blocking([SERVER.ip()]).unwrap();

    let listener = server_channel.tcp_listen_blocking(SERVER).unwrap();
    let echo_server = std::thread::spawn(move || {
        let mut workers = Vec::with_capacity(concurrency);
        for _ in 0..concurrency {
            let mut stream = listener.accept_blocking().unwrap();
            workers.push(std::thread::spawn(move || {
                let mut payload = vec![0_u8; payload_bytes];
                for _ in 0..(WARMUP_ROUND_TRIPS + MEASURED_ROUND_TRIPS) {
                    stream.read_exact(&mut payload).unwrap();
                    stream.write_all(&payload).unwrap();
                }
            }));
        }
        for worker in workers {
            worker.join().unwrap();
        }
    });

    let mut streams = Vec::with_capacity(concurrency);
    for index in 0..concurrency {
        let local = SocketAddr::new(CLIENT_IP, FIRST_CLIENT_PORT + index as u16);
        streams.push(client_channel.tcp_connect_blocking(local, SERVER).unwrap());
    }

    let barrier = Arc::new(Barrier::new(concurrency));
    let mut clients = Vec::with_capacity(concurrency);
    for (index, mut stream) in streams.into_iter().enumerate() {
        let barrier = Arc::clone(&barrier);
        clients.push(std::thread::spawn(move || {
            let payload = vec![index as u8; payload_bytes];
            let mut echoed = vec![0_u8; payload_bytes];
            barrier.wait();
            for _ in 0..WARMUP_ROUND_TRIPS {
                stream.write_all(&payload).unwrap();
                stream.read_exact(&mut echoed).unwrap();
                assert_eq!(echoed, payload);
            }
            let mut samples = Vec::with_capacity(MEASURED_ROUND_TRIPS);
            for _ in 0..MEASURED_ROUND_TRIPS {
                let round_trip_started = Instant::now();
                stream.write_all(&payload).unwrap();
                stream.read_exact(&mut echoed).unwrap();
                samples.push(micros(round_trip_started.elapsed()));
                assert_eq!(echoed, payload);
            }
            samples
        }));
    }

    let mut samples_us = Vec::with_capacity(concurrency * MEASURED_ROUND_TRIPS);
    for client in clients {
        samples_us.extend(client.join().unwrap());
    }
    echo_server.join().unwrap();
    CellMeasurement {
        samples_us,
        elapsed: started.elapsed(),
    }
}

fn measure_event_driven(concurrency: usize, payload_bytes: usize) -> CellMeasurement {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(4)
        .enable_all()
        .build()
        .unwrap();
    runtime.block_on(async move {
        tokio::time::timeout(CELL_DISASTER_LIMIT, async move {
            let started = Instant::now();
            let (client_stack, server_stack) = piped_pair(config());
            let client_channel = client_stack.command_channel();
            let server_channel = server_stack.command_channel();
            let _client_runner = client_stack.spawn_tokio();
            let _server_runner = server_stack.spawn_tokio();
            client_channel.set_ips([CLIENT_IP]).await.unwrap();
            server_channel.set_ips([SERVER.ip()]).await.unwrap();

            let listener = server_channel.tcp_listen(SERVER).await.unwrap();
            let mut client_streams = Vec::with_capacity(concurrency);
            let mut server_streams = Vec::with_capacity(concurrency);
            for index in 0..concurrency {
                let local = SocketAddr::new(CLIENT_IP, FIRST_CLIENT_PORT + index as u16);
                let (client, server) =
                    tokio::join!(client_channel.tcp_connect(local, SERVER), listener.accept());
                client_streams.push(client.unwrap());
                server_streams.push(server.unwrap());
            }

            let mut echo_tasks = Vec::with_capacity(concurrency);
            for mut stream in server_streams {
                echo_tasks.push(tokio::spawn(async move {
                    let mut payload = vec![0_u8; payload_bytes];
                    for _ in 0..(WARMUP_ROUND_TRIPS + MEASURED_ROUND_TRIPS) {
                        stream.read_exact(&mut payload).await.unwrap();
                        stream.write_all(&payload).await.unwrap();
                    }
                }));
            }

            let barrier = Arc::new(tokio::sync::Barrier::new(concurrency));
            let mut client_tasks = Vec::with_capacity(concurrency);
            for (index, mut stream) in client_streams.into_iter().enumerate() {
                let barrier = Arc::clone(&barrier);
                client_tasks.push(tokio::spawn(async move {
                    let payload = vec![index as u8; payload_bytes];
                    let mut echoed = vec![0_u8; payload_bytes];
                    barrier.wait().await;
                    for _ in 0..WARMUP_ROUND_TRIPS {
                        stream.write_all(&payload).await.unwrap();
                        stream.read_exact(&mut echoed).await.unwrap();
                        assert_eq!(echoed, payload);
                    }
                    let mut samples = Vec::with_capacity(MEASURED_ROUND_TRIPS);
                    for _ in 0..MEASURED_ROUND_TRIPS {
                        let round_trip_started = Instant::now();
                        stream.write_all(&payload).await.unwrap();
                        stream.read_exact(&mut echoed).await.unwrap();
                        samples.push(micros(round_trip_started.elapsed()));
                        assert_eq!(echoed, payload);
                    }
                    samples
                }));
            }

            let mut samples_us = Vec::with_capacity(concurrency * MEASURED_ROUND_TRIPS);
            for task in client_tasks {
                samples_us.extend(task.await.unwrap());
            }
            for task in echo_tasks {
                task.await.unwrap();
            }
            CellMeasurement {
                samples_us,
                elapsed: started.elapsed(),
            }
        })
        .await
        .expect("event-driven netstack matrix cell exceeded the disaster timeout")
    })
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
