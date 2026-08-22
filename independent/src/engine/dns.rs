use crate::engine::destination_policy::validate_tunnel_destination;
use crate::engine::netstack::VirtualNetstack;
use crate::engine::proxy::{NameResolver, ResolveFuture};
use crate::{Error, Result};
use rand::RngCore;
use rand::rngs::OsRng;
use std::collections::HashMap;
use std::future::Future;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::broadcast;

#[path = "dns/tcp.rs"]
mod tcp;

const DNS_HEADER_LEN: usize = 12;
const DNS_PORT: u16 = 53;
const DNS_MAX_UDP_RESPONSE: usize = 4096;
const DNS_TYPE_A: u16 = 1;
const DNS_CLASS_IN: u16 = 1;
const MAX_POINTER_JUMPS: usize = 16;
// A SOCKS5 client that lets the proxy resolve names sends the hostname on every
// CONNECT, so one page load asks for the same handful of hosts dozens of times.
// The floor keeps a zero or one-second gateway TTL from turning each of those
// into a fresh round trip through the tunnel; the ceiling keeps a long TTL from
// pinning a campus address across a whole session.
const MIN_CACHE_TTL: Duration = Duration::from_secs(10);
const MAX_CACHE_TTL: Duration = Duration::from_secs(300);
const MAX_CACHE_ENTRIES: usize = 512;
const MAX_VPN_DNS_SERVERS: usize = 8;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum VpnDnsSource {
    Gateway,
    Profile,
    GatewayAndProfile,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VpnDnsSelection {
    servers: Vec<Ipv4Addr>,
    source: VpnDnsSource,
}

impl VpnDnsSelection {
    pub fn servers(&self) -> &[Ipv4Addr] {
        &self.servers
    }

    pub fn source(&self) -> VpnDnsSource {
        self.source
    }

    pub fn into_servers(self) -> Vec<Ipv4Addr> {
        self.servers
    }
}

/// Combines authenticated gateway DNS with a reviewed deployment profile.
///
/// Authenticated gateway policy is authoritative. Profile addresses are used
/// only when the gateway supplies no DNS at all; they are never mixed into a
/// successfully downloaded policy. Every query still travels through
/// `VirtualNetstack`, so this function never introduces a system resolver or
/// changes the host operating system's DNS configuration.
pub fn select_vpn_dns_servers(
    gateway: &[Ipv4Addr],
    profile: &[Ipv4Addr],
) -> Result<Option<VpnDnsSelection>> {
    for source in [gateway, profile] {
        if source.len() > MAX_VPN_DNS_SERVERS {
            return Err(Error(
                "VPN DNS configuration contains too many servers".into(),
            ));
        }
        if !source.is_empty() {
            validate_dns_servers(source)?;
        }
    }
    let selected = if gateway.is_empty() { profile } else { gateway };
    let mut servers = Vec::with_capacity(selected.len());
    for server in selected {
        if !servers.contains(server) {
            servers.push(*server);
        }
    }
    if servers.is_empty() {
        return Ok(None);
    }
    let source = if gateway.is_empty() {
        VpnDnsSource::Profile
    } else {
        VpnDnsSource::Gateway
    };
    Ok(Some(VpnDnsSelection { servers, source }))
}

#[derive(Default)]
struct DnsCache {
    entries: Mutex<HashMap<String, (Ipv4Addr, Instant)>>,
}

impl DnsCache {
    fn get(&self, host: &str, now: Instant) -> Option<Ipv4Addr> {
        let entries = self.entries.lock().ok()?;
        entries
            .get(host)
            .filter(|(_, expires_at)| now < *expires_at)
            .map(|(address, _)| *address)
    }

    fn insert(&self, host: &str, address: Ipv4Addr, ttl_seconds: u32, now: Instant) {
        let ttl = Duration::from_secs(u64::from(ttl_seconds)).clamp(MIN_CACHE_TTL, MAX_CACHE_TTL);
        let Ok(mut entries) = self.entries.lock() else {
            return;
        };
        if entries.len() >= MAX_CACHE_ENTRIES {
            entries.retain(|_, (_, expires_at)| now < *expires_at);
            if entries.len() >= MAX_CACHE_ENTRIES {
                entries.clear();
            }
        }
        entries.insert(host.to_owned(), (address, now + ttl));
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.entries
            .lock()
            .map(|entries| entries.len())
            .unwrap_or(0)
    }
}

/// A shareable copy of a completed lookup. The error carries no detail because
/// only the caller that ran the query owns its diagnostics.
type SharedLookup = std::result::Result<Ipv4Addr, ()>;

enum Role {
    Leader,
    Waiter(broadcast::Receiver<SharedLookup>),
}

/// Collapses simultaneous lookups for the same host into one query.
///
/// A browser opens several connections to a host at once, and a SOCKS5 client
/// that resolves through the proxy sends the hostname on each of them. Without
/// this, the first visit to a host fans out into one tunnel round trip per
/// connection — the cache only helps once an answer exists.
#[derive(Default)]
struct SingleFlight {
    lookups: Mutex<HashMap<String, broadcast::Sender<SharedLookup>>>,
}

/// Frees the in-flight slot even if the leader's task is dropped mid-query, so a
/// cancelled leader cannot strand its waiters.
struct LeaderSlot<'a> {
    flight: &'a SingleFlight,
    host: &'a str,
}

impl LeaderSlot<'_> {
    fn publish(&self, result: SharedLookup) {
        if let Some(sender) = self.flight.take(self.host) {
            let _ = sender.send(result);
        }
    }
}

impl Drop for LeaderSlot<'_> {
    fn drop(&mut self) {
        // A no-op after `publish`; on cancellation it drops the sender, which
        // wakes every waiter with a closed channel.
        let _ = self.flight.take(self.host);
    }
}

impl SingleFlight {
    fn join(&self, host: &str) -> Role {
        let Ok(mut lookups) = self.lookups.lock() else {
            return Role::Leader;
        };
        if let Some(sender) = lookups.get(host) {
            return Role::Waiter(sender.subscribe());
        }
        let (sender, _receiver) = broadcast::channel(1);
        lookups.insert(host.to_owned(), sender);
        Role::Leader
    }

    fn take(&self, host: &str) -> Option<broadcast::Sender<SharedLookup>> {
        self.lookups
            .lock()
            .ok()
            .and_then(|mut lookups| lookups.remove(host))
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.lookups
            .lock()
            .map(|lookups| lookups.len())
            .unwrap_or(0)
    }

    async fn run<F, Fut>(&self, host: &str, query: F) -> Result<Ipv4Addr>
    where
        F: Fn() -> Fut,
        Fut: Future<Output = Result<Ipv4Addr>>,
    {
        match self.join(host) {
            Role::Leader => {
                let slot = LeaderSlot { flight: self, host };
                let outcome = query().await;
                slot.publish(outcome.as_ref().map(|address| *address).map_err(|_| ()));
                outcome
            }
            Role::Waiter(mut receiver) => match receiver.recv().await {
                Ok(Ok(address)) => Ok(address),
                Ok(Err(())) => Err(Error("VPN DNS lookup failed".into())),
                // The leader went away without answering, so nobody resolved it.
                Err(_) => query().await,
            },
        }
    }
}

pub struct VpnDnsResolver {
    netstack: Arc<VirtualNetstack>,
    servers: Vec<Ipv4Addr>,
    timeout: Duration,
    cache: DnsCache,
    in_flight: SingleFlight,
}

impl VpnDnsResolver {
    pub fn new(
        netstack: Arc<VirtualNetstack>,
        servers: Vec<Ipv4Addr>,
        timeout: Duration,
    ) -> Result<Self> {
        validate_dns_servers(&servers)?;
        Ok(Self {
            netstack,
            servers,
            timeout,
            cache: DnsCache::default(),
            in_flight: SingleFlight::default(),
        })
    }

    async fn resolve(&self, host: &str) -> Result<Ipv4Addr> {
        if let Some(address) = self.cache.get(host, Instant::now()) {
            return Ok(address);
        }
        self.in_flight.run(host, || self.query_servers(host)).await
    }

    async fn query_servers(&self, host: &str) -> Result<Ipv4Addr> {
        // Re-check under the in-flight slot: a leader that just finished may have
        // filled the cache while this caller was waiting to become one.
        if let Some(address) = self.cache.get(host, Instant::now()) {
            return Ok(address);
        }
        // Ask every configured server at once. Trying them in order makes an
        // unresponsive first server cost its full timeout on every lookup that
        // misses the cache, which is seconds added to the first visit to a host.
        let attempts = self
            .servers
            .iter()
            .map(|server| {
                let netstack = Arc::clone(&self.netstack);
                let host = host.to_owned();
                let (server, timeout) = (*server, self.timeout);
                async move { query_one_server(netstack, host, server, timeout).await }
            })
            .collect::<Vec<_>>();
        let (address, ttl_seconds) = race_to_first_success(attempts).await?;
        self.cache
            .insert(host, address, ttl_seconds, Instant::now());
        Ok(address)
    }
}

fn validate_dns_servers(servers: &[Ipv4Addr]) -> Result<()> {
    if servers.is_empty() {
        return Err(Error(
            "VPN DNS configuration contains no valid server".into(),
        ));
    }
    for server in servers {
        // Gateway configuration is authenticated input, not trusted routing
        // authority. Apply the same destination policy as SOCKS TCP/UDP so a
        // bad profile cannot make the client contact gateway-loopback,
        // link-local, multicast, or reserved addresses through raw UDP.
        validated_dns_endpoint(*server)?;
    }
    Ok(())
}

fn validated_dns_endpoint(server: Ipv4Addr) -> Result<SocketAddr> {
    let endpoint = SocketAddr::new(IpAddr::V4(server), DNS_PORT);
    validate_tunnel_destination(endpoint)
        .map_err(|_| Error("VPN DNS configuration contains a prohibited server".into()))?;
    Ok(endpoint)
}

/// Runs every attempt concurrently and yields the first success.
///
/// Dropping the set on an early return aborts the attempts still outstanding.
async fn race_to_first_success<Fut>(attempts: Vec<Fut>) -> Result<(Ipv4Addr, u32)>
where
    Fut: Future<Output = Result<(Ipv4Addr, u32)>> + Send + 'static,
{
    let mut running = tokio::task::JoinSet::new();
    for attempt in attempts {
        running.spawn(attempt);
    }
    let mut last_error = Error("VPN DNS lookup failed".into());
    while let Some(joined) = running.join_next().await {
        match joined {
            Ok(Ok(answer)) => return Ok(answer),
            Ok(Err(error)) => last_error = error,
            Err(_) => last_error = Error("VPN DNS query task failed".into()),
        }
    }
    Err(last_error)
}

async fn query_one_server(
    netstack: Arc<VirtualNetstack>,
    host: String,
    server: Ipv4Addr,
    timeout: Duration,
) -> Result<(Ipv4Addr, u32)> {
    VpnDnsResolver::resolve_with_server(&netstack, &host, server, timeout).await
}

impl VpnDnsResolver {
    async fn resolve_with_server(
        netstack: &VirtualNetstack,
        host: &str,
        server: Ipv4Addr,
        timeout: Duration,
    ) -> Result<(Ipv4Addr, u32)> {
        tokio::time::timeout(
            timeout,
            Self::resolve_with_server_before_deadline(netstack, host, server),
        )
        .await
        .map_err(|_| Error("VPN DNS query timed out".into()))?
    }

    async fn resolve_with_server_before_deadline(
        netstack: &VirtualNetstack,
        host: &str,
        server: Ipv4Addr,
    ) -> Result<(Ipv4Addr, u32)> {
        let endpoint = validated_dns_endpoint(server)?;
        let mut id_bytes = [0_u8; 2];
        OsRng.fill_bytes(&mut id_bytes);
        let id = u16::from_be_bytes(id_bytes);
        let query = build_query(host, id)?;
        let socket = netstack.bind_udp().await?;
        socket
            .send_to(endpoint, &query)
            .await
            .map_err(|_| Error("VPN DNS query send failed".into()))?;
        let mut response = vec![0_u8; DNS_MAX_UDP_RESPONSE];
        let receive = socket
            .recv_from(&mut response)
            .await
            .map_err(|_| Error("VPN DNS response failed".into()))?;
        let (source, length) = receive;
        if source != endpoint {
            return Err(Error(
                "VPN DNS response came from an unexpected server".into(),
            ));
        }
        response.truncate(length);
        match parse_dns_response(&response, &query)? {
            ParsedDnsResponse::Answer(answer) => Ok(answer),
            ParsedDnsResponse::Truncated => {
                let mut stream = netstack.connect_tcp(endpoint).await?;
                let response = tcp::exchange(&mut stream, &query).await?;
                match parse_dns_response(&response, &query)? {
                    ParsedDnsResponse::Answer(answer) => Ok(answer),
                    ParsedDnsResponse::Truncated => {
                        Err(Error("VPN DNS TCP response is still truncated".into()))
                    }
                }
            }
        }
    }
}

impl NameResolver for VpnDnsResolver {
    fn resolve_ipv4<'a>(&'a self, host: &'a str) -> ResolveFuture<'a> {
        Box::pin(async move { self.resolve(host).await })
    }
}

fn build_query(host: &str, id: u16) -> Result<Vec<u8>> {
    let mut query = Vec::with_capacity(DNS_HEADER_LEN + host.len() + 6);
    query.extend_from_slice(&id.to_be_bytes());
    query.extend_from_slice(&0x0100_u16.to_be_bytes());
    query.extend_from_slice(&1_u16.to_be_bytes());
    query.extend_from_slice(&0_u16.to_be_bytes());
    query.extend_from_slice(&0_u16.to_be_bytes());
    query.extend_from_slice(&0_u16.to_be_bytes());
    for label in host.split('.') {
        if label.is_empty()
            || label.len() > 63
            || !label
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        {
            return Err(Error("DNS name has an invalid label".into()));
        }
        query.push(label.len() as u8);
        query.extend_from_slice(label.as_bytes());
    }
    query.push(0);
    query.extend_from_slice(&DNS_TYPE_A.to_be_bytes());
    query.extend_from_slice(&DNS_CLASS_IN.to_be_bytes());
    Ok(query)
}

fn read_u16(data: &[u8], offset: usize) -> Result<u16> {
    let bytes = data
        .get(offset..offset + 2)
        .ok_or_else(|| Error("DNS message is truncated".into()))?;
    Ok(u16::from_be_bytes([bytes[0], bytes[1]]))
}

fn skip_name(data: &[u8], mut offset: usize) -> Result<usize> {
    let start = offset;
    let mut consumed = None;
    let mut jumps = 0;
    loop {
        let length = *data
            .get(offset)
            .ok_or_else(|| Error("DNS name is truncated".into()))?;
        if length & 0xc0 == 0xc0 {
            let suffix = *data
                .get(offset + 1)
                .ok_or_else(|| Error("DNS compression pointer is truncated".into()))?;
            let target = (usize::from(length & 0x3f) << 8) | usize::from(suffix);
            if target >= data.len() || target >= offset || jumps >= MAX_POINTER_JUMPS {
                return Err(Error("DNS compression pointer is invalid".into()));
            }
            consumed.get_or_insert(offset + 2);
            offset = target;
            jumps += 1;
        } else if length == 0 {
            return Ok(consumed.unwrap_or(offset + 1).max(start + 1));
        } else {
            if length > 63 || length & 0xc0 != 0 {
                return Err(Error("DNS label length is invalid".into()));
            }
            offset = offset
                .checked_add(1 + usize::from(length))
                .ok_or_else(|| Error("DNS label length overflow".into()))?;
            if offset > data.len() {
                return Err(Error("DNS label is truncated".into()));
            }
        }
    }
}

#[derive(Debug, Eq, PartialEq)]
enum ParsedDnsResponse {
    Answer((Ipv4Addr, u32)),
    Truncated,
}

fn validate_response_question(data: &[u8], query: &[u8]) -> Result<usize> {
    if read_u16(data, 4)? != 1 {
        return Err(Error("DNS response question count is invalid".into()));
    }
    let question_end = skip_name(data, DNS_HEADER_LEN)?
        .checked_add(4)
        .ok_or_else(|| Error("DNS response question length overflow".into()))?;
    let actual = data
        .get(DNS_HEADER_LEN..question_end)
        .ok_or_else(|| Error("DNS response question is truncated".into()))?;
    let expected = query
        .get(DNS_HEADER_LEN..)
        .ok_or_else(|| Error("DNS query question is missing".into()))?;
    if actual.len() != expected.len() || !actual.eq_ignore_ascii_case(expected) {
        return Err(Error(
            "DNS response question does not match the query".into(),
        ));
    }
    Ok(question_end)
}

fn parse_dns_response(data: &[u8], query: &[u8]) -> Result<ParsedDnsResponse> {
    if data.len() < DNS_HEADER_LEN
        || query.len() < DNS_HEADER_LEN
        || read_u16(data, 0)? != read_u16(query, 0)?
    {
        return Err(Error("DNS response header is invalid".into()));
    }
    let flags = read_u16(data, 2)?;
    if flags & 0x8000 == 0 || flags & 0x000f != 0 {
        return Err(Error("DNS response status is not successful".into()));
    }
    let mut offset = validate_response_question(data, query)?;
    if flags & 0x0200 != 0 {
        return Ok(ParsedDnsResponse::Truncated);
    }
    let answer_count = usize::from(read_u16(data, 6)?);
    if answer_count == 0 {
        return Err(Error("DNS response contains no answer".into()));
    }
    for _ in 0..answer_count {
        offset = skip_name(data, offset)?;
        let record = data
            .get(offset..offset + 10)
            .ok_or_else(|| Error("DNS answer is truncated".into()))?;
        let record_type = u16::from_be_bytes([record[0], record[1]]);
        let class = u16::from_be_bytes([record[2], record[3]]);
        let ttl_seconds = u32::from_be_bytes([record[4], record[5], record[6], record[7]]);
        let data_length = usize::from(u16::from_be_bytes([record[8], record[9]]));
        offset += 10;
        let record_data = data
            .get(offset..offset + data_length)
            .ok_or_else(|| Error("DNS answer data is truncated".into()))?;
        if record_type == DNS_TYPE_A && class == DNS_CLASS_IN && data_length == 4 {
            return Ok(ParsedDnsResponse::Answer((
                Ipv4Addr::new(
                    record_data[0],
                    record_data[1],
                    record_data[2],
                    record_data[3],
                ),
                ttl_seconds,
            )));
        }
        offset += data_length;
    }
    Err(Error("DNS response contains no IPv4 address".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gateway_dns_servers_obey_the_shared_destination_policy() {
        assert!(validate_dns_servers(&[Ipv4Addr::new(10, 20, 30, 53)]).is_ok());
        for prohibited in [
            Ipv4Addr::UNSPECIFIED,
            Ipv4Addr::LOCALHOST,
            Ipv4Addr::new(169, 254, 1, 1),
            Ipv4Addr::new(224, 0, 0, 1),
            Ipv4Addr::new(240, 0, 0, 1),
            Ipv4Addr::BROADCAST,
        ] {
            let error = validate_dns_servers(&[prohibited]).unwrap_err();
            assert_eq!(
                error.to_string(),
                "VPN DNS configuration contains a prohibited server"
            );
            assert!(!error.to_string().contains(&prohibited.to_string()));
        }
        assert!(validate_dns_servers(&[]).is_err());
        assert_eq!(
            validated_dns_endpoint(Ipv4Addr::new(10, 20, 30, 53)).unwrap(),
            SocketAddr::new(IpAddr::V4(Ipv4Addr::new(10, 20, 30, 53)), DNS_PORT)
        );
    }

    #[test]
    fn profile_dns_fills_missing_gateway_dns_without_using_the_system_resolver() {
        let profile = [Ipv4Addr::new(10, 90, 63, 2), Ipv4Addr::new(10, 90, 63, 3)];
        let selection = select_vpn_dns_servers(&[], &profile).unwrap().unwrap();
        assert_eq!(selection.source(), VpnDnsSource::Profile);
        assert_eq!(selection.servers(), profile);
    }

    #[test]
    fn authenticated_gateway_dns_replaces_the_profile_fallback() {
        let gateway = [Ipv4Addr::new(10, 90, 63, 2), Ipv4Addr::new(10, 90, 63, 4)];
        let profile = [Ipv4Addr::new(10, 90, 63, 2), Ipv4Addr::new(10, 90, 63, 3)];
        let selection = select_vpn_dns_servers(&gateway, &profile).unwrap().unwrap();
        assert_eq!(selection.source(), VpnDnsSource::Gateway);
        assert_eq!(
            selection.servers(),
            [Ipv4Addr::new(10, 90, 63, 2), Ipv4Addr::new(10, 90, 63, 4),]
        );

        let too_many = (1..=9)
            .map(|last| Ipv4Addr::new(10, 90, 63, last))
            .collect::<Vec<_>>();
        assert_eq!(
            select_vpn_dns_servers(&too_many, &[])
                .unwrap_err()
                .to_string(),
            "VPN DNS configuration contains too many servers"
        );

        let full_gateway = (1..=8)
            .map(|last| Ipv4Addr::new(10, 90, 63, last))
            .collect::<Vec<_>>();
        let selection = select_vpn_dns_servers(&full_gateway, &[Ipv4Addr::new(10, 90, 64, 1)])
            .unwrap()
            .unwrap();
        assert_eq!(selection.source(), VpnDnsSource::Gateway);
        assert_eq!(selection.servers(), full_gateway);
    }

    #[test]
    fn query_encoding_is_bounded() {
        let query = build_query("hpc3.internal.example", 0x1234).unwrap();
        assert_eq!(&query[..2], &[0x12, 0x34]);
        assert!(query.ends_with(&[0, 0, 1, 0, 1]));
        assert!(build_query("bad..name", 1).is_err());
    }

    #[test]
    fn parses_compressed_a_answer() {
        let query = build_query("host.example", 0x1234).unwrap();
        let mut response = query.clone();
        response[2..4].copy_from_slice(&0x8180_u16.to_be_bytes());
        response[6..8].copy_from_slice(&1_u16.to_be_bytes());
        response.extend_from_slice(&[0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 30, 0, 4, 10, 20, 30, 40]);
        assert_eq!(
            parse_dns_response(&response, &query).unwrap(),
            ParsedDnsResponse::Answer((Ipv4Addr::new(10, 20, 30, 40), 30))
        );
        assert!(parse_dns_response(&response, &build_query("host.example", 7).unwrap()).is_err());
    }

    #[test]
    fn truncated_udp_requires_matching_transaction_and_question() {
        let query = build_query("host.example", 0x1234).unwrap();
        let mut truncated = query.clone();
        truncated[2..4].copy_from_slice(&0x8380_u16.to_be_bytes());
        assert_eq!(
            parse_dns_response(&truncated, &query).unwrap(),
            ParsedDnsResponse::Truncated
        );

        let mut wrong_question = truncated.clone();
        wrong_question[DNS_HEADER_LEN + 1] = b'x';
        assert!(parse_dns_response(&wrong_question, &query).is_err());
        let wrong_id = build_query("host.example", 0x4321).unwrap();
        assert!(parse_dns_response(&truncated, &wrong_id).is_err());
    }

    #[test]
    fn repeated_lookups_reuse_the_cache_until_the_ttl_expires() {
        // A SOCKS5 client that resolves through the proxy sends the hostname on
        // every CONNECT, so one page load asks for the same host dozens of times.
        // Without a cache each of those is a full round trip through the tunnel.
        let cache = DnsCache::default();
        let now = Instant::now();
        let address = Ipv4Addr::new(10, 1, 2, 3);
        assert_eq!(cache.get("onestop.example", now), None);
        cache.insert("onestop.example", address, 60, now);
        assert_eq!(cache.get("onestop.example", now), Some(address));
        assert_eq!(
            cache.get("onestop.example", now + Duration::from_secs(59)),
            Some(address)
        );
        assert_eq!(
            cache.get("onestop.example", now + Duration::from_secs(61)),
            None
        );
        assert_eq!(cache.get("other.example", now), None);
    }

    async fn wait_for_in_flight(flight: &SingleFlight, expected: usize) {
        for _ in 0..200 {
            if flight.len() == expected {
                return;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        panic!("in-flight lookups never reached {expected}");
    }

    #[tokio::test]
    async fn simultaneous_lookups_for_one_host_share_a_single_query() {
        // A browser opens several connections to a host at once and a SOCKS5
        // proxy resolves for each of them, so a cold cache would otherwise fan
        // out into one tunnel round trip per connection.
        use std::sync::atomic::{AtomicUsize, Ordering};
        let flight = Arc::new(SingleFlight::default());
        let queries = Arc::new(AtomicUsize::new(0));
        let gate = Arc::new(tokio::sync::Semaphore::new(0));

        let leader = tokio::spawn({
            let (flight, queries, gate) = (flight.clone(), queries.clone(), gate.clone());
            async move {
                flight
                    .run("onestop.example", || {
                        queries.fetch_add(1, Ordering::SeqCst);
                        let gate = gate.clone();
                        async move {
                            let _ = gate.acquire().await;
                            Ok(Ipv4Addr::new(10, 1, 2, 3))
                        }
                    })
                    .await
            }
        });
        wait_for_in_flight(&flight, 1).await;

        let mut waiters = Vec::new();
        for _ in 0..5 {
            let (flight, queries) = (flight.clone(), queries.clone());
            waiters.push(tokio::spawn(async move {
                flight
                    .run("onestop.example", || {
                        queries.fetch_add(1, Ordering::SeqCst);
                        async { Ok(Ipv4Addr::new(9, 9, 9, 9)) }
                    })
                    .await
            }));
        }
        tokio::time::sleep(Duration::from_millis(30)).await;
        gate.add_permits(1);

        assert_eq!(leader.await.unwrap().unwrap(), Ipv4Addr::new(10, 1, 2, 3));
        for waiter in waiters {
            assert_eq!(waiter.await.unwrap().unwrap(), Ipv4Addr::new(10, 1, 2, 3));
        }
        assert_eq!(queries.load(Ordering::SeqCst), 1);
        assert_eq!(flight.len(), 0, "the slot must not leak");
    }

    #[tokio::test]
    async fn a_failed_lookup_reaches_every_waiter_and_frees_the_slot() {
        let flight = Arc::new(SingleFlight::default());
        let gate = Arc::new(tokio::sync::Semaphore::new(0));
        let leader = tokio::spawn({
            let (flight, gate) = (flight.clone(), gate.clone());
            async move {
                flight
                    .run("dead.example", || {
                        let gate = gate.clone();
                        async move {
                            let _ = gate.acquire().await;
                            Err(Error("gateway DNS refused".into()))
                        }
                    })
                    .await
            }
        });
        wait_for_in_flight(&flight, 1).await;
        let waiter = tokio::spawn({
            let flight = flight.clone();
            async move {
                flight
                    .run("dead.example", || async { Ok(Ipv4Addr::new(9, 9, 9, 9)) })
                    .await
            }
        });
        tokio::time::sleep(Duration::from_millis(30)).await;
        gate.add_permits(1);

        assert!(leader.await.unwrap().is_err());
        assert!(waiter.await.unwrap().is_err());
        assert_eq!(flight.len(), 0);
    }

    #[tokio::test]
    async fn an_abandoned_leader_lets_a_waiter_resolve_for_itself() {
        // The leader's task is dropped when its SOCKS client disconnects. Waiters
        // must not be stranded on a result that will never arrive.
        let flight = Arc::new(SingleFlight::default());
        let leader = tokio::spawn({
            let flight = flight.clone();
            async move {
                flight
                    .run("cancelled.example", || async {
                        std::future::pending::<()>().await;
                        unreachable!()
                    })
                    .await
            }
        });
        wait_for_in_flight(&flight, 1).await;
        leader.abort();
        let _ = leader.await;
        wait_for_in_flight(&flight, 0).await;

        let resolved = flight
            .run("cancelled.example", || async {
                Ok(Ipv4Addr::new(10, 4, 5, 6))
            })
            .await
            .unwrap();
        assert_eq!(resolved, Ipv4Addr::new(10, 4, 5, 6));
        assert_eq!(flight.len(), 0);
    }

    type Attempt = std::pin::Pin<Box<dyn Future<Output = Result<(Ipv4Addr, u32)>> + Send>>;

    fn attempt<F>(future: F) -> Attempt
    where
        F: Future<Output = Result<(Ipv4Addr, u32)>> + Send + 'static,
    {
        Box::pin(future)
    }

    #[tokio::test]
    async fn an_unresponsive_server_does_not_delay_a_working_one() {
        // Sequentially, a first server that never answers costs its whole timeout
        // on every lookup that misses the cache. Racing them means the healthy
        // server's answer arrives on its own schedule.
        let started = Instant::now();
        let answer = race_to_first_success(vec![
            attempt(async {
                std::future::pending::<()>().await;
                Err(Error("a stalled server never answers".into()))
            }),
            attempt(async {
                tokio::time::sleep(Duration::from_millis(20)).await;
                Ok((Ipv4Addr::new(10, 7, 8, 9), 120_u32))
            }),
        ])
        .await
        .unwrap();
        assert_eq!(answer, (Ipv4Addr::new(10, 7, 8, 9), 120));
        assert!(
            started.elapsed() < Duration::from_secs(1),
            "a stalled server must not hold up the result"
        );
    }

    #[tokio::test]
    async fn racing_reports_an_error_only_when_every_server_fails() {
        assert!(
            race_to_first_success(vec![
                attempt(async { Err(Error("first refused".into())) }),
                attempt(async { Err(Error("second refused".into())) }),
            ])
            .await
            .is_err()
        );

        let single = race_to_first_success(vec![attempt(async {
            Ok((Ipv4Addr::new(10, 1, 1, 1), 30_u32))
        })])
        .await
        .unwrap();
        assert_eq!(single, (Ipv4Addr::new(10, 1, 1, 1), 30));

        assert!(
            race_to_first_success(Vec::<Attempt>::new()).await.is_err(),
            "no configured server must fail rather than hang"
        );
    }

    #[test]
    fn cache_clamps_gateway_ttls_and_stays_bounded() {
        let cache = DnsCache::default();
        let now = Instant::now();
        let address = Ipv4Addr::new(10, 1, 2, 3);

        // A zero or one-second TTL must still absorb one page load's burst.
        cache.insert("zero.example", address, 0, now);
        assert_eq!(
            cache.get("zero.example", now + MIN_CACHE_TTL - Duration::from_secs(1)),
            Some(address)
        );
        assert_eq!(cache.get("zero.example", now + MIN_CACHE_TTL), None);

        // A week-long TTL must not pin a stale campus address.
        cache.insert("huge.example", address, 7 * 86_400, now);
        assert_eq!(cache.get("huge.example", now + MAX_CACHE_TTL), None);

        for index in 0..MAX_CACHE_ENTRIES + 40 {
            cache.insert(&format!("host{index}.example"), address, 60, now);
        }
        assert!(cache.len() <= MAX_CACHE_ENTRIES);
        assert_eq!(
            cache.get(&format!("host{}.example", MAX_CACHE_ENTRIES + 39), now),
            Some(address)
        );
    }
}
