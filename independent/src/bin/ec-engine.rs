use ec_compat::engine::dns::VpnDnsResolver;
use ec_compat::engine::ip_packet::stack_mtu;
use ec_compat::engine::netstack::VirtualNetstack;
use ec_compat::engine::proxy::{NameResolver, RejectDomainResolver, SystemDnsResolver};
use ec_compat::engine::session::AuthenticatedEngineSession;
use ec_compat::engine::socks::SocksServer;
use ec_compat::probe::read_credentials;
use ec_compat::watch::load_json;
use ec_compat::{Error, Result};
use std::net::SocketAddr;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
use zeroize::Zeroizing;

fn argument_value<'a>(args: &'a [String], name: &str) -> Result<&'a str> {
    args.iter()
        .position(|argument| argument == name)
        .and_then(|index| args.get(index + 1))
        .map(String::as_str)
        .ok_or_else(|| Error(format!("missing required argument: {name}")))
}

fn validate_arguments(args: &[String]) -> Result<()> {
    let mut config_seen = false;
    let mut credentials_seen = false;
    let mut socks_seen = false;
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--credentials-stdin" if !credentials_seen => {
                credentials_seen = true;
                index += 1;
            }
            "--config" if !config_seen => {
                config_seen = true;
                if args
                    .get(index + 1)
                    .is_none_or(|value| value.starts_with("--"))
                {
                    return Err(Error("--config requires one value".into()));
                }
                index += 2;
            }
            "--socks-bind" if !socks_seen => {
                socks_seen = true;
                if args
                    .get(index + 1)
                    .is_none_or(|value| value.starts_with("--"))
                {
                    return Err(Error("--socks-bind requires one value".into()));
                }
                index += 2;
            }
            argument => {
                return Err(Error(format!(
                    "unsupported or duplicate engine argument: {argument}"
                )));
            }
        }
    }
    Ok(())
}

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("ec-engine: {error}");
        std::process::exit(1);
    }
}

async fn run() -> Result<()> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    validate_arguments(&args)?;
    if !args
        .iter()
        .any(|argument| argument == "--credentials-stdin")
    {
        return Err(Error(
            "--credentials-stdin is required; credential flags do not exist".into(),
        ));
    }
    let config = load_json(Path::new(argument_value(&args, "--config")?))?;
    let bind = argument_value(&args, "--socks-bind")?
        .parse::<SocketAddr>()
        .map_err(|_| Error("--socks-bind is not a valid socket address".into()))?;
    let (username, password) = read_credentials(std::io::stdin().lock())?;
    let username = Zeroizing::new(username);
    let password = Zeroizing::new(password);

    let session = AuthenticatedEngineSession::authenticate(&config, &username, &password)?;
    drop(password);
    drop(username);
    let dns_servers = session.dns_servers();
    let data_plane = session.establish_data_plane()?;
    // Lowering this makes campus servers use smaller segments, which is what
    // reaches destinations whose path cannot carry a full-size packet.
    let mtu = stack_mtu(config["tunnel"]["mtu"].as_u64());
    let netstack = Arc::new(VirtualNetstack::start(data_plane, mtu)?);
    let health = Arc::clone(&netstack);
    let allow_system_dns_fallback = config["proxy"]["allow_system_dns_fallback"]
        .as_bool()
        .unwrap_or(false);
    let (resolver, dns_mode): (Arc<dyn NameResolver>, &str) = if !dns_servers.is_empty() {
        (
            Arc::new(VpnDnsResolver::new(
                Arc::clone(&netstack),
                dns_servers.clone(),
                Duration::from_secs(5),
            )?),
            "gateway",
        )
    } else if allow_system_dns_fallback {
        (Arc::new(SystemDnsResolver), "system fallback")
    } else {
        (Arc::new(RejectDomainResolver), "disabled")
    };
    let server = SocksServer::new(bind, Arc::clone(&netstack), Arc::clone(&resolver))?
        .bind()
        .await?;
    println!("Client IP assigned");
    println!("Proxy DNS mode: {dns_mode}");
    println!("Tunnel MTU: {mtu}");
    println!("SOCKS5 server listening on {bind} (TCP CONNECT + UDP ASSOCIATE)");
    let mut services = tokio::task::JoinSet::new();
    services.spawn(async move {
        server
            .serve()
            .await
            .map_err(|error| Error(format!("SOCKS5 service failed: {error}")))
    });
    let shutdown_reason = {
        let service_exit = async {
            match services.join_next().await {
                Some(Ok(Ok(()))) => Error("local proxy service stopped unexpectedly".into()),
                Some(Ok(Err(error))) => error,
                Some(Err(_)) => Error("local proxy service task failed".into()),
                None => Error("all local proxy services stopped unexpectedly".into()),
            }
        };
        tokio::pin!(service_exit);
        tokio::select! {
            signal = shutdown_signal() => {
                signal?;
                None
            }
            error = &mut service_exit => Some(error),
            _ = wait_for_unhealthy(health) => {
                Some(Error("VPN data plane disconnected".into()))
            }
        }
    };
    services.abort_all();
    let logout = session.logout();
    if let Some(error) = shutdown_reason {
        return Err(error);
    }
    logout
}

#[cfg(unix)]
async fn shutdown_signal() -> Result<()> {
    use tokio::signal::unix::{SignalKind, signal};

    let mut terminate = signal(SignalKind::terminate())
        .map_err(|_| Error("cannot install termination signal handler".into()))?;
    tokio::select! {
        signal = tokio::signal::ctrl_c() => {
            signal.map_err(|_| Error("cannot install interrupt signal handler".into()))
        }
        _ = terminate.recv() => Ok(()),
    }
}

#[cfg(not(unix))]
async fn shutdown_signal() -> Result<()> {
    tokio::signal::ctrl_c()
        .await
        .map_err(|_| Error("cannot install interrupt signal handler".into()))
}

async fn wait_for_unhealthy(netstack: Arc<VirtualNetstack>) {
    while netstack.is_healthy() {
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn engine_accepts_only_the_single_socks_listener_contract() {
        let valid = [
            "--config",
            "profile.json",
            "--credentials-stdin",
            "--socks-bind",
            "127.0.0.1:1080",
        ]
        .map(str::to_owned);
        assert!(validate_arguments(&valid).is_ok());

        let extra_listener = [
            "--config",
            "profile.json",
            "--credentials-stdin",
            "--socks-bind",
            "127.0.0.1:1080",
            "--http-bind",
            "127.0.0.1:1081",
        ]
        .map(str::to_owned);
        assert!(validate_arguments(&extra_listener).is_err());
    }
}
