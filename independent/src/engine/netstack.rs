use crate::engine::data_plane::EasyConnectDataPlane;
use crate::{Error, Result};
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};
use std::thread::JoinHandle;
use std::time::Duration;
use ts_netstack_smoltcp::netcore::{Channel, HasChannel, NetstackControl};
use ts_netstack_smoltcp::netsock::{CreateSocket, TcpStream, UdpSocket};
use ts_netstack_smoltcp::{WakingPipe, piped};

const FIRST_EPHEMERAL_PORT: u16 = 49_152;
const LAST_EPHEMERAL_PORT: u16 = 65_535;
const TCP_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

pub struct VirtualNetstack {
    channel: Channel,
    assigned_address: Ipv4Addr,
    next_ephemeral_port: AtomicU16,
    healthy: Arc<AtomicBool>,
    _runner: tokio::task::JoinHandle<()>,
    _bridges: [JoinHandle<()>; 2],
}

impl VirtualNetstack {
    /// Starts the userspace stack over an established data plane.
    ///
    /// Must be called from inside a Tokio runtime: the stack is driven by an
    /// event-driven runner spawned onto it.
    pub fn start(data_plane: EasyConnectDataPlane, mtu: usize) -> Result<Self> {
        let assigned_address = data_plane.assigned_address();
        let config = ts_netstack_smoltcp::netcore::Config {
            command_channel_capacity: Some(256),
            mtu,
            loopback: false,
            udp_buffer_size: 64 * 1024,
            udp_message_count: 128,
            tcp_buffer_size: 256 * 1024,
            tcp_keep_alive_interval: Some(Duration::from_secs(60)),
            tcp_timeout: Some(Duration::from_secs(120)),
            tcp_listen_backlog: 128,
            raw_buffer_size: 64 * 1024,
            raw_message_count: 128,
        };
        let (stack, pipe) = piped(config);
        let channel = stack.command_channel();
        // The event-driven runner wakes on device readiness. The threaded runner
        // only wakes on a command or its poll timer, so every packet arriving from
        // the tunnel waits out the poll interval before the stack processes it —
        // measured at ~4.6ms per round trip with a 2ms interval against ~0.09ms
        // here (see tests/poll_latency_probe.rs). That delay applies to every
        // round trip of every connection the campus browser makes.
        let runner = stack.spawn_tokio();
        channel
            .set_ips_blocking([IpAddr::V4(assigned_address)])
            .map_err(|_| Error("cannot assign the VPN address to the userspace stack".into()))?;

        let (lease, mut sender, mut receiver) = data_plane.split();
        let WakingPipe { mut rx, tx } = pipe;
        let healthy = Arc::new(AtomicBool::new(true));
        let receive_health = Arc::clone(&healthy);
        let receive_bridge = std::thread::spawn(move || {
            let _lease = lease;
            while let Ok(packet) = receiver.receive_ipv4() {
                tx.send(&packet);
            }
            receive_health.store(false, Ordering::Release);
        });
        let send_health = Arc::clone(&healthy);
        let send_bridge = std::thread::spawn(move || {
            while let Some(packet) = rx.recv() {
                if sender.send_ipv4(&packet).is_err() {
                    send_health.store(false, Ordering::Release);
                    break;
                }
            }
        });

        Ok(Self {
            channel,
            assigned_address,
            next_ephemeral_port: AtomicU16::new(FIRST_EPHEMERAL_PORT),
            healthy,
            _runner: runner,
            _bridges: [receive_bridge, send_bridge],
        })
    }

    pub fn assigned_address(&self) -> Ipv4Addr {
        self.assigned_address
    }

    pub fn is_healthy(&self) -> bool {
        self.healthy.load(Ordering::Acquire)
    }

    pub async fn connect_tcp(&self, remote: SocketAddr) -> Result<TcpStream> {
        if !self.is_healthy() {
            return Err(Error("VPN data plane is unavailable".into()));
        }
        if !remote.is_ipv4() || remote.port() == 0 {
            return Err(Error(
                "userspace TCP currently requires a valid IPv4 endpoint".into(),
            ));
        }
        let local = SocketAddr::new(
            IpAddr::V4(self.assigned_address),
            self.allocate_ephemeral_port(),
        );
        tokio::time::timeout(TCP_CONNECT_TIMEOUT, self.channel.tcp_connect(local, remote))
            .await
            .map_err(|_| Error("userspace TCP connection timed out".into()))?
            .map_err(|_| Error("userspace TCP connection failed".into()))
    }

    pub async fn bind_udp(&self) -> Result<UdpSocket> {
        if !self.is_healthy() {
            return Err(Error("VPN data plane is unavailable".into()));
        }
        let local = SocketAddr::new(
            IpAddr::V4(self.assigned_address),
            self.allocate_ephemeral_port(),
        );
        self.channel
            .udp_bind(local)
            .await
            .map_err(|_| Error("userspace UDP bind failed".into()))
    }

    fn allocate_ephemeral_port(&self) -> u16 {
        loop {
            let current = self.next_ephemeral_port.load(Ordering::Relaxed);
            let next = if current == LAST_EPHEMERAL_PORT {
                FIRST_EPHEMERAL_PORT
            } else {
                current + 1
            };
            if self
                .next_ephemeral_port
                .compare_exchange_weak(current, next, Ordering::Relaxed, Ordering::Relaxed)
                .is_ok()
            {
                return current;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ephemeral_ports_wrap_inside_iana_dynamic_range() {
        let port = AtomicU16::new(LAST_EPHEMERAL_PORT);
        let current = port.load(Ordering::Relaxed);
        let next = if current == LAST_EPHEMERAL_PORT {
            FIRST_EPHEMERAL_PORT
        } else {
            current + 1
        };
        assert_eq!(next, FIRST_EPHEMERAL_PORT);
    }
}
