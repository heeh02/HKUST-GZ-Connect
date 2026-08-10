//! Destinations that are safe to carry through the remote VPN gateway.
//!
//! This policy belongs below the SOCKS command parsers so TCP and UDP cannot
//! drift apart.  In particular, a local address sent through the tunnel means
//! the *gateway's* local machine, not the user's computer.  Some gateways treat
//! that as an attack and terminate the whole VPN session.

use crate::{Error, Result};
use std::net::{IpAddr, Ipv4Addr, SocketAddr};

/// Rejects destinations that must never leave the local proxy.
///
/// RFC 1918 and IPv6 unique-local addresses are intentionally allowed: campus
/// services commonly use private address space.  "Broadcast" here means the
/// IPv4 limited broadcast address; subnet-directed broadcasts cannot be
/// identified without the gateway-side subnet mask.
pub fn validate_tunnel_destination(remote: SocketAddr) -> Result<()> {
    if remote.port() == 0 || prohibited_ip(remote.ip()) {
        return Err(Error(format!(
            "tunnel destination is prohibited ({})",
            destination_class(remote.ip())
        )));
    }
    Ok(())
}

fn prohibited_ip(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(address) => prohibited_ipv4(address),
        IpAddr::V6(address) => {
            if let Some(mapped) = address.to_ipv4_mapped() {
                return prohibited_ipv4(mapped);
            }
            address.is_unspecified()
                || address.is_loopback()
                || address.is_unicast_link_local()
                || address.is_multicast()
        }
    }
}

fn prohibited_ipv4(address: Ipv4Addr) -> bool {
    // The whole 0/8 block is "this network", not only 0.0.0.0. Likewise,
    // 240/4 is reserved (with the limited broadcast inside it). Neither can be
    // a legitimate campus destination, and forwarding them could invoke
    // gateway-local or implementation-defined routing semantics.
    address.octets()[0] == 0
        || address.octets()[0] >= 240
        || address.is_loopback()
        || address.is_link_local()
        || address.is_multicast()
}

fn destination_class(address: IpAddr) -> &'static str {
    match address {
        IpAddr::V4(address) => destination_class_ipv4(address),
        IpAddr::V6(address) => {
            if let Some(mapped) = address.to_ipv4_mapped() {
                return destination_class_ipv4(mapped);
            }
            if address.is_unspecified() {
                "unspecified"
            } else if address.is_loopback() {
                "loopback"
            } else if address.is_unicast_link_local() {
                "link-local"
            } else if address.is_multicast() {
                "multicast"
            } else {
                "invalid port"
            }
        }
    }
}

fn destination_class_ipv4(address: Ipv4Addr) -> &'static str {
    if address.octets()[0] == 0 {
        "this-network"
    } else if address.is_loopback() {
        "loopback"
    } else if address.is_link_local() {
        "link-local"
    } else if address.is_multicast() {
        "multicast"
    } else if address == Ipv4Addr::BROADCAST {
        "broadcast"
    } else if address.octets()[0] >= 240 {
        "reserved"
    } else {
        "invalid port"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rejected(address: &str) -> bool {
        validate_tunnel_destination(address.parse().unwrap()).is_err()
    }

    #[test]
    fn rejects_special_ipv4_destinations() {
        for address in [
            "0.0.0.0:443",
            "0.0.0.1:443",
            "0.255.255.254:443",
            "127.0.0.1:443",
            "127.255.255.254:443",
            "169.254.12.34:443",
            "224.0.0.1:443",
            "239.255.255.250:443",
            "240.0.0.1:443",
            "254.255.255.254:443",
            "255.255.255.255:443",
            "103.189.154.38:0",
        ] {
            assert!(rejected(address), "{address} must stay out of the tunnel");
        }
    }

    #[test]
    fn rejects_special_ipv6_and_mapped_destinations() {
        for address in [
            "[::]:443",
            "[::1]:443",
            "[fe80::1]:443",
            "[ff02::1]:443",
            "[::ffff:127.0.0.1]:443",
            "[::ffff:169.254.1.1]:443",
        ] {
            assert!(rejected(address), "{address} must stay out of the tunnel");
        }
    }

    #[test]
    fn permits_campus_private_and_public_destinations() {
        for address in [
            "10.120.18.63:443",
            "172.16.0.1:443",
            "172.31.255.254:443",
            "192.168.50.1:443",
            "103.189.154.38:443",
            "[fd00::1234]:443",
            "[2001:db8::1]:443",
        ] {
            assert!(!rejected(address), "{address} is a valid tunnel target");
        }
    }
}
