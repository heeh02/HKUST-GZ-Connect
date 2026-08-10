use ec_compat::engine::dns::VpnDnsResolver;
use ec_compat::engine::event::{
    AddressFamily, DnsMode, EngineErrorCode, EngineEvent, EngineEventEmitter, EngineState,
    NetworkUnhealthyReason, StopReason,
};
use ec_compat::engine::ip_packet::stack_mtu;
use ec_compat::engine::netstack::VirtualNetstack;
use ec_compat::engine::provider::ProviderError;
use ec_compat::engine::proxy::{NameResolver, RejectDomainResolver, SystemDnsResolver};
use ec_compat::engine::session::AuthenticatedEngineSession;
use ec_compat::engine::socks::SocksServer;
use ec_compat::engine::socks_auth::{
    EngineCredentials, ProxyAuthenticationMode, read_engine_credentials,
};
use ec_compat::watch::load_json;
use ec_compat::{Error, Result};
use std::io::Write;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

struct EngineArguments {
    config: PathBuf,
    bind: SocketAddr,
    generation: u64,
    proxy_authentication_mode: ProxyAuthenticationMode,
}

struct EngineFailure {
    code: EngineErrorCode,
    stop_reason: StopReason,
    error: Error,
}

impl EngineFailure {
    fn new(code: EngineErrorCode, stop_reason: StopReason, error: Error) -> Self {
        Self {
            code,
            stop_reason,
            error,
        }
    }
}

type EngineResult<T> = std::result::Result<T, EngineFailure>;

struct EngineLifecycle<W> {
    events: EngineEventEmitter<W>,
    generation: u64,
    stopping: bool,
}

impl<W: Write> EngineLifecycle<W> {
    fn new(writer: W, generation: u64) -> Self {
        Self {
            events: EngineEventEmitter::new(writer),
            generation,
            stopping: false,
        }
    }

    fn emit(&mut self, event: EngineEvent) -> Result<()> {
        self.events.emit(&event)
    }

    fn state(&mut self, state: EngineState) -> Result<()> {
        self.emit(EngineEvent::StateChanged {
            state,
            generation: self.generation,
        })
    }

    fn begin_stopping(&mut self) -> Result<()> {
        if self.stopping {
            return Ok(());
        }
        self.stopping = true;
        self.state(EngineState::Stopping)
    }

    fn finish(&mut self, reason: StopReason) -> Result<()> {
        self.state(EngineState::Stopped)?;
        self.emit(EngineEvent::Stopped {
            reason,
            generation: self.generation,
        })
    }
}

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
    let mut generation_seen = false;
    let mut socks_auth_seen = false;
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--credentials-stdin" if !credentials_seen => {
                credentials_seen = true;
                index += 1;
            }
            "--config" if !config_seen => {
                config_seen = true;
                require_argument_value(args, index, "--config")?;
                index += 2;
            }
            "--socks-bind" if !socks_seen => {
                socks_seen = true;
                require_argument_value(args, index, "--socks-bind")?;
                index += 2;
            }
            "--generation" if !generation_seen => {
                generation_seen = true;
                require_argument_value(args, index, "--generation")?;
                index += 2;
            }
            "--socks-auth-stdin" | "--socks-auth-optional-stdin" if !socks_auth_seen => {
                socks_auth_seen = true;
                index += 1;
            }
            _ => {
                // Never echo an unexpected value: a caller that mistakenly
                // supplied a credential flag must not have its value copied to
                // diagnostics.
                return Err(Error("unsupported or duplicate engine argument".into()));
            }
        }
    }
    Ok(())
}

fn require_argument_value(args: &[String], index: usize, name: &str) -> Result<()> {
    if args
        .get(index + 1)
        .is_none_or(|value| value.starts_with("--"))
    {
        return Err(Error(format!("{name} requires one value")));
    }
    Ok(())
}

fn parse_arguments(args: &[String]) -> Result<EngineArguments> {
    validate_arguments(args)?;
    if !args
        .iter()
        .any(|argument| argument == "--credentials-stdin")
    {
        return Err(Error(
            "--credentials-stdin is required; credential flags do not exist".into(),
        ));
    }
    let config = PathBuf::from(argument_value(args, "--config")?);
    let bind = argument_value(args, "--socks-bind")?
        .parse::<SocketAddr>()
        .map_err(|_| Error("--socks-bind is not a valid socket address".into()))?;
    let generation = args
        .iter()
        .position(|argument| argument == "--generation")
        .map(|index| {
            args[index + 1]
                .parse::<u64>()
                .map_err(|_| Error("--generation must be an unsigned 64-bit integer".into()))
        })
        .transpose()?
        .unwrap_or(0);
    let proxy_authentication_mode = if args.iter().any(|argument| argument == "--socks-auth-stdin")
    {
        ProxyAuthenticationMode::Required
    } else if args
        .iter()
        .any(|argument| argument == "--socks-auth-optional-stdin")
    {
        ProxyAuthenticationMode::Optional
    } else {
        ProxyAuthenticationMode::None
    };
    Ok(EngineArguments {
        config,
        bind,
        generation,
        proxy_authentication_mode,
    })
}

fn generation_hint(args: &[String]) -> u64 {
    let matches = args
        .iter()
        .enumerate()
        .filter(|(_, argument)| argument.as_str() == "--generation")
        .collect::<Vec<_>>();
    if matches.len() != 1 {
        return 0;
    }
    args.get(matches[0].0 + 1)
        .and_then(|value| value.parse().ok())
        .unwrap_or(0)
}

fn failure(code: EngineErrorCode, stop_reason: StopReason, error: Error) -> EngineFailure {
    EngineFailure::new(code, stop_reason, error)
}

fn event_output_failure(error: Error) -> EngineFailure {
    failure(
        EngineErrorCode::EventOutputFailed,
        StopReason::EventOutputFailed,
        error,
    )
}

fn authentication_error_code(error: &ProviderError) -> EngineErrorCode {
    match error {
        ProviderError::Unsupported(capability) if capability.is_authentication() => {
            EngineErrorCode::UnsupportedAuthentication
        }
        _ => EngineErrorCode::AuthFailed,
    }
}

fn authentication_failure(error: ProviderError) -> EngineFailure {
    let code = authentication_error_code(&error);
    failure(code, StopReason::StartupFailed, Error::from(error))
}

#[tokio::main]
async fn main() {
    let exit_code = engine_main().await;
    if exit_code != 0 {
        std::process::exit(exit_code);
    }
}

async fn engine_main() -> i32 {
    let raw_args = std::env::args().skip(1).collect::<Vec<_>>();
    let parsed_args = parse_arguments(&raw_args);
    let generation = parsed_args
        .as_ref()
        .map(|arguments| arguments.generation)
        .unwrap_or_else(|_| generation_hint(&raw_args));
    let stdout = std::io::stdout();
    let mut lifecycle = EngineLifecycle::new(stdout.lock(), generation);
    if let Err(error) = lifecycle.emit(EngineEvent::hello()) {
        eprintln!("ec-engine: {error}");
        return 1;
    }

    let result = match parsed_args {
        Ok(arguments) => run_engine(&arguments, &mut lifecycle).await,
        Err(error) => Err(failure(
            EngineErrorCode::InvalidArguments,
            StopReason::StartupFailed,
            error,
        )),
    };
    match result {
        Ok(reason) => match lifecycle.finish(reason) {
            Ok(()) => 0,
            Err(error) => {
                eprintln!("ec-engine: {error}");
                1
            }
        },
        Err(failure) => {
            eprintln!("ec-engine: {}", failure.error);
            if let Err(error) = lifecycle.begin_stopping() {
                eprintln!("ec-engine: {error}");
            }
            if let Err(error) = lifecycle.emit(EngineEvent::FatalError { code: failure.code }) {
                eprintln!("ec-engine: {error}");
            }
            if let Err(error) = lifecycle.finish(failure.stop_reason) {
                eprintln!("ec-engine: {error}");
            }
            1
        }
    }
}

async fn run_engine<W: Write>(
    arguments: &EngineArguments,
    lifecycle: &mut EngineLifecycle<W>,
) -> EngineResult<StopReason> {
    lifecycle
        .state(EngineState::Connecting)
        .map_err(event_output_failure)?;
    let config = load_json(Path::new(&arguments.config)).map_err(|_| {
        failure(
            EngineErrorCode::ConfigurationInvalid,
            StopReason::StartupFailed,
            Error("engine configuration could not be loaded or is invalid".into()),
        )
    })?;

    lifecycle
        .state(EngineState::Authenticating)
        .map_err(event_output_failure)?;
    let EngineCredentials {
        gateway_username,
        gateway_password,
        proxy_authentication,
    } = read_engine_credentials(std::io::stdin().lock(), arguments.proxy_authentication_mode)
        .map_err(|error| {
            failure(
                EngineErrorCode::CredentialsInvalid,
                StopReason::StartupFailed,
                error,
            )
        })?;
    let session = AuthenticatedEngineSession::authenticate_with_provider_error(
        &config,
        &gateway_username,
        &gateway_password,
    )
    .map_err(authentication_failure)?;
    drop(gateway_password);
    drop(gateway_username);

    let dns_servers = session.dns_servers();
    let (session, data_plane) = session.establish_data_plane_or_logout().map_err(|error| {
        failure(
            EngineErrorCode::DataPlaneSetupFailed,
            StopReason::StartupFailed,
            error,
        )
    })?;
    let mtu = stack_mtu(config["tunnel"]["mtu"].as_u64());
    let netstack = match VirtualNetstack::start(data_plane, mtu) {
        Ok(netstack) => Arc::new(netstack),
        Err(error) => {
            let _ = session.logout();
            return Err(failure(
                EngineErrorCode::DataPlaneSetupFailed,
                StopReason::StartupFailed,
                error,
            ));
        }
    };
    let health = Arc::clone(&netstack);
    let allow_system_dns_fallback = config["proxy"]["allow_system_dns_fallback"]
        .as_bool()
        .unwrap_or(false);
    let (resolver, dns_mode): (Arc<dyn NameResolver>, DnsMode) = if !dns_servers.is_empty() {
        let resolver =
            match VpnDnsResolver::new(Arc::clone(&netstack), dns_servers, Duration::from_secs(5)) {
                Ok(resolver) => resolver,
                Err(error) => {
                    let _ = session.logout();
                    return Err(failure(
                        EngineErrorCode::DataPlaneSetupFailed,
                        StopReason::StartupFailed,
                        error,
                    ));
                }
            };
        (Arc::new(resolver), DnsMode::Gateway)
    } else if allow_system_dns_fallback {
        (Arc::new(SystemDnsResolver), DnsMode::SystemFallback)
    } else {
        (Arc::new(RejectDomainResolver), DnsMode::Disabled)
    };
    let server = match SocksServer::new_with_authentication(
        arguments.bind,
        Arc::clone(&netstack),
        resolver,
        proxy_authentication,
    ) {
        Ok(server) => server,
        Err(error) => {
            let _ = session.logout();
            return Err(failure(
                EngineErrorCode::LocalListenerFailed,
                StopReason::StartupFailed,
                error,
            ));
        }
    };
    let server = match server.bind().await {
        Ok(server) => server,
        Err(error) => {
            let _ = session.logout();
            return Err(failure(
                EngineErrorCode::LocalListenerFailed,
                StopReason::StartupFailed,
                error,
            ));
        }
    };

    let metadata_result = (|| -> Result<()> {
        lifecycle.emit(EngineEvent::ClientIpAssigned {
            family: AddressFamily::Ipv4,
        })?;
        lifecycle.emit(EngineEvent::DnsMode { mode: dns_mode })?;
        lifecycle.emit(EngineEvent::ListenerReady {
            port: arguments.bind.port(),
        })?;
        Ok(())
    })();
    if let Err(error) = metadata_result {
        let _ = session.logout();
        return Err(event_output_failure(error));
    }

    // These preserve human-readable diagnostics and the old desktop fallback,
    // but stderr is never part of the NDJSON protocol.
    eprintln!("Client IP assigned");
    eprintln!("Proxy DNS mode: {}", dns_mode.diagnostic_name());
    eprintln!("Tunnel MTU: {mtu}");
    match arguments.proxy_authentication_mode {
        ProxyAuthenticationMode::Required => eprintln!(
            "local proxy listening on {} (authenticated SOCKS5 TCP + HTTP CONNECT/HTTP/WS; UDP ASSOCIATE disabled)",
            arguments.bind
        ),
        ProxyAuthenticationMode::Optional => eprintln!(
            "SOCKS5 server listening on {} (optional RFC 1929; NO_AUTH keeps UDP compatibility)",
            arguments.bind
        ),
        ProxyAuthenticationMode::None => eprintln!(
            "SOCKS5 server listening on {} (TCP CONNECT + UDP ASSOCIATE)",
            arguments.bind
        ),
    }

    let mut services = tokio::task::JoinSet::new();
    services.spawn(async move {
        server
            .serve()
            .await
            .map_err(|error| Error(format!("SOCKS5 service failed: {error}")))
    });
    if let Err(error) = lifecycle.state(EngineState::Connected) {
        services.abort_all();
        let _ = session.logout();
        return Err(event_output_failure(error));
    }

    let shutdown = {
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
            signal = shutdown_signal() => match signal {
                Ok(()) => ShutdownCause::UserRequested,
                Err(error) => ShutdownCause::SignalFailed(error),
            },
            error = &mut service_exit => ShutdownCause::LocalServiceFailed(error),
            _ = wait_for_unhealthy(health) => ShutdownCause::NetworkDisconnected,
        }
    };
    services.abort_all();

    let unhealthy_event_error = if matches!(&shutdown, ShutdownCause::NetworkDisconnected) {
        lifecycle
            .emit(EngineEvent::NetworkUnhealthy {
                reason: NetworkUnhealthyReason::DataPlaneDisconnected,
            })
            .err()
    } else {
        None
    };
    let stopping_error = lifecycle.begin_stopping().err();
    let logout = session.logout();
    if let Some(error) = unhealthy_event_error.or(stopping_error) {
        if let Err(logout_error) = logout {
            eprintln!("ec-engine: {logout_error}");
        }
        return Err(event_output_failure(error));
    }

    match shutdown {
        ShutdownCause::UserRequested => {
            logout.map(|_| StopReason::UserRequested).map_err(|error| {
                failure(
                    EngineErrorCode::LogoutFailed,
                    StopReason::LogoutFailed,
                    error,
                )
            })
        }
        ShutdownCause::SignalFailed(error) => {
            if let Err(logout_error) = logout {
                eprintln!("ec-engine: {logout_error}");
            }
            Err(failure(
                EngineErrorCode::ShutdownSignalFailed,
                StopReason::ShutdownFailed,
                error,
            ))
        }
        ShutdownCause::LocalServiceFailed(error) => {
            if let Err(logout_error) = logout {
                eprintln!("ec-engine: {logout_error}");
            }
            Err(failure(
                EngineErrorCode::LocalListenerFailed,
                StopReason::LocalServiceFailed,
                error,
            ))
        }
        ShutdownCause::NetworkDisconnected => {
            if let Err(logout_error) = logout {
                eprintln!("ec-engine: {logout_error}");
            }
            Err(failure(
                EngineErrorCode::NetworkDisconnected,
                StopReason::NetworkUnhealthy,
                Error("VPN data plane disconnected".into()),
            ))
        }
    }
}

enum ShutdownCause {
    UserRequested,
    SignalFailed(Error),
    LocalServiceFailed(Error),
    NetworkDisconnected,
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

    fn valid_arguments() -> Vec<String> {
        [
            "--config",
            "profile.json",
            "--credentials-stdin",
            "--socks-bind",
            "127.0.0.1:1080",
        ]
        .map(str::to_owned)
        .to_vec()
    }

    #[test]
    fn engine_accepts_only_the_single_socks_listener_contract() {
        assert!(parse_arguments(&valid_arguments()).is_ok());

        let mut extra_listener = valid_arguments();
        extra_listener.extend(["--http-bind".into(), "127.0.0.1:1081".into()]);
        assert!(parse_arguments(&extra_listener).is_err());
    }

    #[test]
    fn generation_is_optional_and_defaults_to_zero() {
        let parsed = parse_arguments(&valid_arguments()).unwrap();
        assert_eq!(parsed.generation, 0);
        assert_eq!(
            parsed.proxy_authentication_mode,
            ProxyAuthenticationMode::None
        );
    }

    #[test]
    fn strict_local_proxy_authentication_is_an_optional_flag() {
        let mut arguments = valid_arguments();
        arguments.push("--socks-auth-stdin".into());
        assert_eq!(
            parse_arguments(&arguments)
                .unwrap()
                .proxy_authentication_mode,
            ProxyAuthenticationMode::Required
        );

        arguments.push("--socks-auth-stdin".into());
        assert!(parse_arguments(&arguments).is_err());
    }

    #[test]
    fn optional_local_proxy_authentication_is_mutually_exclusive_with_strict() {
        let mut optional = valid_arguments();
        optional.push("--socks-auth-optional-stdin".into());
        assert_eq!(
            parse_arguments(&optional)
                .unwrap()
                .proxy_authentication_mode,
            ProxyAuthenticationMode::Optional
        );

        optional.push("--socks-auth-stdin".into());
        assert!(parse_arguments(&optional).is_err());

        let mut strict_then_optional = valid_arguments();
        strict_then_optional.extend([
            "--socks-auth-stdin".into(),
            "--socks-auth-optional-stdin".into(),
        ]);
        assert!(parse_arguments(&strict_then_optional).is_err());
    }

    #[test]
    fn generation_accepts_the_full_unsigned_range() {
        let mut arguments = valid_arguments();
        arguments.extend(["--generation".into(), u64::MAX.to_string()]);
        let parsed = parse_arguments(&arguments).unwrap();
        assert_eq!(parsed.generation, u64::MAX);
        assert_eq!(generation_hint(&arguments), u64::MAX);
    }

    #[test]
    fn malformed_missing_and_duplicate_generations_are_rejected() {
        for suffix in [
            vec!["--generation".into()],
            vec!["--generation".into(), "-1".into()],
            vec!["--generation".into(), "not-a-number".into()],
            vec![
                "--generation".into(),
                "1".into(),
                "--generation".into(),
                "2".into(),
            ],
        ] {
            let mut arguments = valid_arguments();
            arguments.extend(suffix);
            assert!(parse_arguments(&arguments).is_err());
        }
    }

    #[test]
    fn unsupported_argument_diagnostic_does_not_echo_its_value() {
        let mut arguments = valid_arguments();
        arguments.extend(["--password".into(), "do-not-repeat-me".into()]);
        let error = match parse_arguments(&arguments) {
            Err(error) => error.to_string(),
            Ok(_) => panic!("credential flags must be rejected"),
        };
        assert!(!error.contains("password"));
        assert!(!error.contains("do-not-repeat-me"));
    }

    #[test]
    fn unsupported_authentication_has_a_distinct_stable_machine_code() {
        use ec_compat::engine::provider::Capability;

        assert_eq!(
            authentication_error_code(&ProviderError::unsupported(Capability::AuthSms)),
            EngineErrorCode::UnsupportedAuthentication
        );
        assert_eq!(
            authentication_error_code(&ProviderError::unsupported(Capability::TransportWebVpn)),
            EngineErrorCode::AuthFailed
        );
        assert_eq!(
            authentication_error_code(&ProviderError::Failed(Error("redacted failure".into()))),
            EngineErrorCode::AuthFailed
        );
    }
}
