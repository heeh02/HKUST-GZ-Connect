use ec_compat::engine::dns::VpnDnsResolver;
use ec_compat::engine::netstack::VirtualNetstack;
use ec_compat::engine::session::AuthenticatedEngineSession;
use ec_compat::engine::socks::{NameResolver, RejectDomainResolver, SocksServer};
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

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("ec-engine: {error}");
        std::process::exit(1);
    }
}

async fn run() -> Result<()> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
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
    let netstack = Arc::new(VirtualNetstack::start(data_plane)?);
    let health = Arc::clone(&netstack);
    let resolver: Arc<dyn NameResolver> = if dns_servers.is_empty() {
        Arc::new(RejectDomainResolver)
    } else {
        Arc::new(VpnDnsResolver::new(
            Arc::clone(&netstack),
            dns_servers,
            Duration::from_secs(5),
        )?)
    };
    let server = SocksServer::new(bind, netstack, resolver)?;
    println!("Client IP assigned");
    println!("SOCKS5 server listening on {bind}");
    let mut task = tokio::spawn(server.serve());
    let shutdown_reason = tokio::select! {
        signal = shutdown_signal() => {
            signal?;
            None
        }
        result = &mut task => {
            Some(match result {
                Ok(Ok(())) => Error("SOCKS5 server stopped unexpectedly".into()),
                Ok(Err(error)) => error,
                Err(_) => Error("SOCKS5 server task failed".into()),
            })
        }
        _ = wait_for_unhealthy(health) => {
            Some(Error("VPN data plane disconnected".into()))
        }
    };
    task.abort();
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
