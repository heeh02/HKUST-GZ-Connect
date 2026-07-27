//! Temporary measurement: does the threaded netstack runner's poll interval add
//! latency to every inbound round trip, and does the event-driven runner remove it?
//!
//! Two stacks are connected by an in-memory pipe, so the only latency between them
//! is the runner's scheduling granularity.

use std::net::SocketAddr;
use std::time::{Duration, Instant};
use ts_netstack_smoltcp::netcore::{Config, HasChannel, NetstackControl};
use ts_netstack_smoltcp::netsock::CreateSocket;
use ts_netstack_smoltcp::piped_pair;

const CLIENT: &str = "10.0.0.1:40000";
const SERVER: &str = "10.0.0.2:9100";
const ROUND_TRIPS: usize = 60;

fn config() -> Config {
    Config {
        mtu: 1500,
        loopback: false,
        ..Default::default()
    }
}

fn percentile(samples: &mut [f64], fraction: f64) -> f64 {
    samples.sort_by(|a, b| a.partial_cmp(b).unwrap());
    samples[((samples.len() as f64 * fraction) as usize).min(samples.len() - 1)]
}

#[test]
#[ignore = "measurement probe, run explicitly"]
fn threaded_poll_interval_versus_event_driven() {
    for poll_ms in [2_u64, 1] {
        let mut samples = measure_threaded(Duration::from_millis(poll_ms));
        println!(
            "threaded poll={poll_ms}ms   median {:.3}ms  p90 {:.3}ms",
            percentile(&mut samples, 0.5),
            percentile(&mut samples, 0.9),
        );
    }
    let mut samples = measure_tokio();
    println!(
        "event-driven (tokio) median {:.3}ms  p90 {:.3}ms",
        percentile(&mut samples, 0.5),
        percentile(&mut samples, 0.9),
    );
}

fn endpoints() -> (SocketAddr, SocketAddr) {
    (CLIENT.parse().unwrap(), SERVER.parse().unwrap())
}

fn measure_threaded(poll: Duration) -> Vec<f64> {
    use std::io::{Read, Write};

    let (client_stack, server_stack) = piped_pair(config());
    let (client, server) = endpoints();
    let client_channel = client_stack.command_channel();
    let server_channel = server_stack.command_channel();
    // The runner must be live first: set_ips is a command the runner consumes.
    let _client_runner = client_stack.spawn_threaded(poll);
    let _server_runner = server_stack.spawn_threaded(poll);
    client_channel.set_ips_blocking([client.ip()]).unwrap();
    server_channel.set_ips_blocking([server.ip()]).unwrap();

    let listener = server_channel.tcp_listen_blocking(server).unwrap();
    std::thread::spawn(move || {
        let mut accepted = listener.accept_blocking().unwrap();
        let mut byte = [0_u8; 1];
        while accepted.read_exact(&mut byte).is_ok() {
            if accepted.write_all(&byte).is_err() {
                break;
            }
        }
    });

    let mut stream = client_channel.tcp_connect_blocking(client, server).unwrap();
    let mut samples = Vec::with_capacity(ROUND_TRIPS);
    for _ in 0..ROUND_TRIPS {
        let started = Instant::now();
        stream.write_all(b"x").unwrap();
        let mut echoed = [0_u8; 1];
        stream.read_exact(&mut echoed).unwrap();
        samples.push(started.elapsed().as_secs_f64() * 1000.0);
    }
    samples
}

fn measure_tokio() -> Vec<f64> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let runtime = tokio::runtime::Runtime::new().unwrap();
    runtime.block_on(async {
        let (client_stack, server_stack) = piped_pair(config());
        let (client, server) = endpoints();
        let client_channel = client_stack.command_channel();
        let server_channel = server_stack.command_channel();
        let _client_runner = client_stack.spawn_tokio();
        let _server_runner = server_stack.spawn_tokio();
        client_channel.set_ips([client.ip()]).await.unwrap();
        server_channel.set_ips([server.ip()]).await.unwrap();

        let listener = server_channel.tcp_listen(server).await.unwrap();
        tokio::spawn(async move {
            let mut accepted = listener.accept().await.unwrap();
            let mut byte = [0_u8; 1];
            while accepted.read_exact(&mut byte).await.is_ok() {
                if accepted.write_all(&byte).await.is_err() {
                    break;
                }
            }
        });

        let mut stream = client_channel.tcp_connect(client, server).await.unwrap();
        let mut samples = Vec::with_capacity(ROUND_TRIPS);
        for _ in 0..ROUND_TRIPS {
            let started = Instant::now();
            stream.write_all(b"x").await.unwrap();
            let mut echoed = [0_u8; 1];
            stream.read_exact(&mut echoed).await.unwrap();
            samples.push(started.elapsed().as_secs_f64() * 1000.0);
        }
        samples
    })
}
