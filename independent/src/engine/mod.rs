//! Production-engine building blocks.
//!
//! Protocol observation and compatibility probes live outside this module.
//! Runtime concerns are split by responsibility so a vendor protocol change
//! does not require modifying the local proxy or userspace TCP/IP stack.

pub mod auth_control;
pub mod auth_lifecycle;
pub mod auth_transaction;
pub mod control;
pub mod control_mux;
pub mod data_plane;
pub mod destination_policy;
pub mod dns;
pub mod event;
pub mod ip_packet;
pub mod netstack;
pub mod provider;
pub mod proxy;
pub mod session;
pub mod socks;
pub mod socks_auth;
