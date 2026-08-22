use ec_compat::engine::auth_control::{
    AuthControlErrorCode, AuthControlRequest, auth_error_response,
};
use ec_compat::engine::auth_lifecycle::BlockingAuthentication;
use ec_compat::engine::control::{
    ControlAction, ControlExchange, ControlSession, MAX_ACTIVE_REQUESTS,
};
use ec_compat::engine::control_mux::{InheritedControlFrameReader, InheritedControlRequest};
use ec_compat::engine::dns::{VpnDnsResolver, VpnDnsSource, select_vpn_dns_servers};
use ec_compat::engine::event::{
    AddressFamily, DnsMode, EngineErrorCode, EngineEvent, EngineEventEmitter, EngineState,
    NetworkUnhealthyReason, StopReason,
};
use ec_compat::engine::ip_packet::stack_mtu;
use ec_compat::engine::netstack::VirtualNetstack;
use ec_compat::engine::provider::ProviderError;
use ec_compat::engine::proxy::{NameResolver, RejectDomainResolver, SystemDnsResolver};
use ec_compat::engine::session::{AuthenticatedGatewaySession, ModernL3TransportBackend};
use ec_compat::engine::socks::SocksServer;
use ec_compat::engine::socks_auth::{
    EngineCredentials, ProxyAuthenticationMode, read_engine_credentials,
    read_engine_credentials_prefix,
};
use ec_compat::watch::load_json;
use ec_compat::{Error, ErrorKind, Result};
use std::io::Write;
use std::net::{Ipv4Addr, SocketAddr};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

const CONTROL_SHUTDOWN_CANCEL_WINDOW: Duration = Duration::from_millis(100);
const CONTROL_PREAUTH_HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(2);

struct EngineArguments {
    config: PathBuf,
    bind: SocketAddr,
    generation: u64,
    proxy_authentication_mode: ProxyAuthenticationMode,
    control_api_v2_stdin: bool,
}

struct EngineFailure {
    code: EngineErrorCode,
    stop_reason: StopReason,
    error: Error,
}

enum ControlInput {
    V2(ControlExchange),
    V3(AuthControlRequest),
}

#[derive(Default)]
struct PendingControlActions {
    shutdowns: std::collections::BTreeMap<u64, tokio::time::Instant>,
}

impl PendingControlActions {
    fn apply(&mut self, action: ControlAction, now: tokio::time::Instant) -> bool {
        match action {
            ControlAction::Shutdown { request_id } => {
                self.shutdowns
                    .insert(request_id, now + CONTROL_SHUTDOWN_CANCEL_WINDOW);
                false
            }
            ControlAction::Cancel {
                request_to_cancel, ..
            } => {
                self.shutdowns.remove(&request_to_cancel);
                false
            }
            ControlAction::Close { .. } => true,
        }
    }

    fn next_shutdown_deadline(&self) -> Option<tokio::time::Instant> {
        self.shutdowns.values().copied().min()
    }
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

    fn emit_control(&mut self, exchange: &ControlExchange) -> Result<()> {
        self.events.emit_control(&exchange.response)
    }

    fn reject_auth_control(&mut self, request: &AuthControlRequest) -> Result<()> {
        self.events.emit_auth_control(&auth_error_response(
            request.request_id(),
            AuthControlErrorCode::TransactionClosed,
        ))
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
    let mut control_api_seen = false;
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
            "--control-api-v2-stdin" if !control_api_seen => {
                control_api_seen = true;
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
    let control_api_v2_stdin = args
        .iter()
        .any(|argument| argument == "--control-api-v2-stdin");
    Ok(EngineArguments {
        config,
        bind,
        generation,
        proxy_authentication_mode,
        control_api_v2_stdin,
    })
}

fn start_control_reader() -> Result<tokio::sync::mpsc::Receiver<ControlInput>> {
    let (sender, receiver) = tokio::sync::mpsc::channel(MAX_ACTIVE_REQUESTS);
    std::thread::Builder::new()
        .name("ec-engine-control".into())
        .spawn(move || {
            let stdin = std::io::stdin();
            if control_reader_loop(stdin.lock(), sender).is_err() {
                // Framing errors are intentionally generic: never echo a raw
                // control line that might have been supplied by a faulty
                // caller. EOF is a normal control-channel close and does not
                // reach this branch or stop the engine.
                eprintln!("ec-engine: invalid engine control frame; control channel closed");
            }
        })
        .map_err(|_| Error("engine control reader could not start".into()))?;
    Ok(receiver)
}

fn control_reader_loop<R: std::io::Read>(
    reader: R,
    sender: tokio::sync::mpsc::Sender<ControlInput>,
) -> Result<()> {
    let mut reader = InheritedControlFrameReader::new(reader);
    let mut session = ControlSession::new();
    while let Some(request) = reader.read_request()? {
        let (input, closes_channel) = match request {
            InheritedControlRequest::V2(request) => {
                let exchange = session.handle(request);
                let closes_channel = matches!(exchange.action, Some(ControlAction::Close { .. }));
                (ControlInput::V2(exchange), closes_channel)
            }
            InheritedControlRequest::V3(request) => (ControlInput::V3(request), false),
        };
        if sender.blocking_send(input).is_err() {
            return Ok(());
        }
        if closes_channel {
            return Ok(());
        }
    }
    Ok(())
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
        ProviderError::Failed(error) if error.kind() == ErrorKind::Configuration => {
            EngineErrorCode::ConfigurationInvalid
        }
        ProviderError::Failed(error) if error.kind() == ErrorKind::Credentials => {
            EngineErrorCode::CredentialsInvalid
        }
        _ => EngineErrorCode::AuthFailed,
    }
}

fn authentication_failure(error: ProviderError) -> EngineFailure {
    let code = authentication_error_code(&error);
    failure(code, StopReason::StartupFailed, Error::from(error))
}

fn data_plane_setup_error_code(error: &Error) -> EngineErrorCode {
    match error.kind() {
        ErrorKind::Configuration => EngineErrorCode::ConfigurationInvalid,
        _ => EngineErrorCode::DataPlaneSetupFailed,
    }
}

fn configured_vpn_dns_servers(config: &serde_json::Value) -> Result<Vec<Ipv4Addr>> {
    let Some(value) = config.pointer("/proxy/vpn_dns_servers") else {
        return Ok(Vec::new());
    };
    let entries = value
        .as_array()
        .ok_or_else(|| Error("configured VPN DNS servers must be an array".into()))?;
    let mut servers = Vec::with_capacity(entries.len());
    for entry in entries {
        let server = entry
            .as_str()
            .and_then(|value| value.parse::<Ipv4Addr>().ok())
            .ok_or_else(|| Error("configured VPN DNS server is not a valid IPv4 address".into()))?;
        if !servers.contains(&server) {
            servers.push(server);
        }
    }
    // Validate the deployment profile before authentication so a malformed or
    // unsafe packaged address cannot open a remote session first.
    let _ = select_vpn_dns_servers(&[], &servers)?;
    Ok(servers)
}

fn dns_mode_for_source(source: VpnDnsSource) -> DnsMode {
    match source {
        VpnDnsSource::Gateway => DnsMode::Gateway,
        VpnDnsSource::Profile => DnsMode::VpnProfile,
        VpnDnsSource::GatewayAndProfile => DnsMode::GatewayProfile,
    }
}

enum AuthenticationCancellationCause {
    UserRequested,
    SignalFailed(Error),
    ControlOutputFailed(Error),
}

async fn authenticate_password_with_lifecycle<W: Write>(
    config: &serde_json::Value,
    gateway_username: zeroize::Zeroizing<String>,
    gateway_password: zeroize::Zeroizing<String>,
    control_receiver: &mut Option<tokio::sync::mpsc::Receiver<ControlInput>>,
    lifecycle: &mut EngineLifecycle<W>,
) -> EngineResult<Option<AuthenticatedGatewaySession>> {
    let worker_config = config.clone();
    let mut authentication = BlockingAuthentication::spawn(move |cancellation| {
        AuthenticatedGatewaySession::authenticate_with_provider_error_cancellable(
            &worker_config,
            &gateway_username,
            &gateway_password,
            &cancellation,
        )
    });
    let signal = shutdown_signal();
    tokio::pin!(signal);
    let mut pending_control_actions = PendingControlActions::default();
    let cancellation_cause = loop {
        let control_shutdown_deadline = pending_control_actions.next_shutdown_deadline();
        tokio::select! {
            completion = authentication.wait() => {
                let provider_result = completion.map_err(|error| {
                    failure(
                        EngineErrorCode::AuthFailed,
                        StopReason::StartupFailed,
                        error,
                    )
                })?;
                return provider_result
                    .map(Some)
                    .map_err(authentication_failure);
            }
            signal = &mut signal => {
                break match signal {
                    Ok(()) => AuthenticationCancellationCause::UserRequested,
                    Err(error) => AuthenticationCancellationCause::SignalFailed(error),
                };
            }
            _ = wait_for_control_shutdown(control_shutdown_deadline), if control_shutdown_deadline.is_some() => {
                break AuthenticationCancellationCause::UserRequested;
            }
            input = receive_control(control_receiver), if control_receiver.is_some() => {
                let Some(input) = input else {
                    // During authentication the private pipe is part of the
                    // transaction owner boundary. Losing it cannot leave a
                    // background login attempt running without a controller.
                    *control_receiver = None;
                    break AuthenticationCancellationCause::UserRequested;
                };
                match input {
                    ControlInput::V2(exchange) => {
                        if let Err(error) = lifecycle.emit_control(&exchange) {
                            break AuthenticationCancellationCause::ControlOutputFailed(error);
                        }
                        if let Some(action) = exchange.action {
                            if pending_control_actions.apply(action, tokio::time::Instant::now()) {
                                *control_receiver = None;
                                break AuthenticationCancellationCause::UserRequested;
                            }
                        }
                    }
                    ControlInput::V3(request) => {
                        if let Err(error) = lifecycle.reject_auth_control(&request) {
                            break AuthenticationCancellationCause::ControlOutputFailed(error);
                        }
                    }
                }
            }
        }
    };

    authentication.cancel();
    if let Err(error) = lifecycle.begin_stopping() {
        let _ = authentication.wait().await;
        return Err(event_output_failure(error));
    }
    // The verified synchronous provider has bounded per-request timeouts and
    // checks cancellation between requests. Awaiting it here prevents an
    // authenticated session from escaping after its generation was stopped.
    let completion = authentication.wait().await;
    if let Ok(Ok(session)) = completion {
        let _ = session.logout();
    }
    match cancellation_cause {
        AuthenticationCancellationCause::UserRequested => Ok(None),
        AuthenticationCancellationCause::SignalFailed(error) => Err(failure(
            EngineErrorCode::ShutdownSignalFailed,
            StopReason::ShutdownFailed,
            error,
        )),
        AuthenticationCancellationCause::ControlOutputFailed(error) => {
            Err(event_output_failure(error))
        }
    }
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
    let profile_dns_servers = configured_vpn_dns_servers(&config).map_err(|_| {
        failure(
            EngineErrorCode::ConfigurationInvalid,
            StopReason::StartupFailed,
            Error("engine VPN DNS configuration is invalid".into()),
        )
    })?;

    lifecycle
        .state(EngineState::Authenticating)
        .map_err(event_output_failure)?;
    let credentials = if arguments.control_api_v2_stdin {
        read_engine_credentials_prefix(std::io::stdin().lock(), arguments.proxy_authentication_mode)
    } else {
        read_engine_credentials(std::io::stdin().lock(), arguments.proxy_authentication_mode)
    }
    .map_err(|error| {
        failure(
            EngineErrorCode::CredentialsInvalid,
            StopReason::StartupFailed,
            error,
        )
    })?;
    let mut control_receiver = if arguments.control_api_v2_stdin {
        Some(start_control_reader().map_err(|error| {
            failure(
                EngineErrorCode::LocalListenerFailed,
                StopReason::StartupFailed,
                error,
            )
        })?)
    } else {
        None
    };
    let had_control_channel = control_receiver.is_some();
    emit_initial_control_exchange(&mut control_receiver, lifecycle).await?;
    if had_control_channel && control_receiver.is_none() {
        lifecycle.begin_stopping().map_err(event_output_failure)?;
        return Ok(StopReason::UserRequested);
    }
    let EngineCredentials {
        gateway_username,
        gateway_password,
        proxy_authentication,
    } = credentials;
    let Some(session) = authenticate_password_with_lifecycle(
        &config,
        gateway_username,
        gateway_password,
        &mut control_receiver,
        lifecycle,
    )
    .await?
    else {
        return Ok(StopReason::UserRequested);
    };

    let transport_backend = match ModernL3TransportBackend::new(&config) {
        Ok(backend) => backend,
        Err(error) => {
            let _ = session.logout();
            return Err(failure(
                data_plane_setup_error_code(&error),
                StopReason::StartupFailed,
                error,
            ));
        }
    };
    let (session, transport) = transport_backend
        .connect_or_logout(session)
        .map_err(|error| {
            failure(
                data_plane_setup_error_code(&error),
                StopReason::StartupFailed,
                error,
            )
        })?;
    let gateway_dns_servers = transport.dns_servers().to_vec();
    let data_plane = transport.into_data_plane();
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
    let vpn_dns = match select_vpn_dns_servers(&gateway_dns_servers, &profile_dns_servers) {
        Ok(selection) => selection,
        Err(error) => {
            let _ = session.logout();
            return Err(failure(
                EngineErrorCode::DataPlaneSetupFailed,
                StopReason::StartupFailed,
                error,
            ));
        }
    };
    let (resolver, dns_mode): (Arc<dyn NameResolver>, DnsMode) = if let Some(selection) = vpn_dns {
        let dns_mode = dns_mode_for_source(selection.source());
        let resolver = match VpnDnsResolver::new(
            Arc::clone(&netstack),
            selection.into_servers(),
            Duration::from_secs(5),
        ) {
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
        (Arc::new(resolver), dns_mode)
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
        let signal = shutdown_signal();
        tokio::pin!(signal);
        let unhealthy = wait_for_unhealthy(health);
        tokio::pin!(unhealthy);
        let mut pending_control_actions = PendingControlActions::default();
        loop {
            let control_shutdown_deadline = pending_control_actions.next_shutdown_deadline();
            tokio::select! {
                signal = &mut signal => break match signal {
                    Ok(()) => ShutdownCause::UserRequested,
                    Err(error) => ShutdownCause::SignalFailed(error),
                },
                error = &mut service_exit => break ShutdownCause::LocalServiceFailed(error),
                _ = &mut unhealthy => break ShutdownCause::NetworkDisconnected,
                _ = wait_for_control_shutdown(control_shutdown_deadline), if control_shutdown_deadline.is_some() => {
                    break ShutdownCause::UserRequested;
                }
                exchange = receive_control(&mut control_receiver), if control_receiver.is_some() => {
                    let Some(input) = exchange else {
                        // Closing the inherited stdin control stream is not a
                        // request to stop the VPN. Signal/process supervision
                        // remains the legacy-compatible shutdown path.
                        control_receiver = None;
                        continue;
                    };
                    match input {
                        ControlInput::V2(exchange) => {
                            if let Err(error) = lifecycle.emit_control(&exchange) {
                                break ShutdownCause::ControlOutputFailed(error);
                            }
                            if exchange.action.is_some_and(|action| {
                                pending_control_actions.apply(action, tokio::time::Instant::now())
                            }) {
                                control_receiver = None;
                            }
                        }
                        ControlInput::V3(request) => {
                            // The production provider is password-only today.
                            // A v3 frame is accepted by the private transport,
                            // but cannot manufacture or resume a transaction.
                            if let Err(error) = lifecycle.reject_auth_control(&request) {
                                break ShutdownCause::ControlOutputFailed(error);
                            }
                        }
                    }
                }
            }
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
        ShutdownCause::ControlOutputFailed(error) => {
            if let Err(logout_error) = logout {
                eprintln!("ec-engine: {logout_error}");
            }
            Err(event_output_failure(error))
        }
    }
}

async fn receive_control(
    receiver: &mut Option<tokio::sync::mpsc::Receiver<ControlInput>>,
) -> Option<ControlInput> {
    match receiver {
        Some(receiver) => receiver.recv().await,
        None => std::future::pending().await,
    }
}

async fn emit_initial_control_exchange<W: Write>(
    receiver: &mut Option<tokio::sync::mpsc::Receiver<ControlInput>>,
    lifecycle: &mut EngineLifecycle<W>,
) -> EngineResult<()> {
    let Some(active) = receiver.as_mut() else {
        return Ok(());
    };
    let deadline = tokio::time::Instant::now() + CONTROL_PREAUTH_HANDSHAKE_TIMEOUT;
    loop {
        match tokio::time::timeout_at(deadline, active.recv()).await {
            Ok(Some(ControlInput::V2(exchange))) => {
                lifecycle
                    .emit_control(&exchange)
                    .map_err(event_output_failure)?;
                if matches!(exchange.action, Some(ControlAction::Close { .. })) {
                    *receiver = None;
                }
                return Ok(());
            }
            Ok(Some(ControlInput::V3(request))) => lifecycle
                .reject_auth_control(&request)
                .map_err(event_output_failure)?,
            Ok(None) => {
                *receiver = None;
                return Ok(());
            }
            // Control v2 remains optional for the password-only production
            // provider. A future interactive provider must promote this to a
            // fail-closed requirement before exposing an auth challenge.
            Err(_) => return Ok(()),
        }
    }
}

async fn wait_for_control_shutdown(deadline: Option<tokio::time::Instant>) {
    match deadline {
        Some(deadline) => tokio::time::sleep_until(deadline).await,
        None => std::future::pending().await,
    }
}

enum ShutdownCause {
    UserRequested,
    SignalFailed(Error),
    LocalServiceFailed(Error),
    NetworkDisconnected,
    ControlOutputFailed(Error),
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
        assert!(!parsed.control_api_v2_stdin);
        assert_eq!(
            parsed.proxy_authentication_mode,
            ProxyAuthenticationMode::None
        );
    }

    #[test]
    fn deployment_profile_dns_is_strict_bounded_and_source_typed() {
        let config = serde_json::json!({
            "proxy": {
                "vpn_dns_servers": ["10.90.63.2", "10.90.63.3", "10.90.63.2"]
            }
        });
        assert_eq!(
            configured_vpn_dns_servers(&config).unwrap(),
            [Ipv4Addr::new(10, 90, 63, 2), Ipv4Addr::new(10, 90, 63, 3),]
        );
        assert_eq!(
            dns_mode_for_source(VpnDnsSource::Profile),
            DnsMode::VpnProfile
        );
        assert_eq!(
            dns_mode_for_source(VpnDnsSource::GatewayAndProfile),
            DnsMode::GatewayProfile
        );

        for invalid in [
            serde_json::json!({"proxy": {"vpn_dns_servers": "10.90.63.2"}}),
            serde_json::json!({"proxy": {"vpn_dns_servers": ["not-an-address"]}}),
            serde_json::json!({"proxy": {"vpn_dns_servers": ["127.0.0.1"]}}),
        ] {
            assert!(configured_vpn_dns_servers(&invalid).is_err());
        }
    }

    #[test]
    fn hkustgz_production_profile_keeps_split_dns_inside_the_vpn() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../../config/hkustgz.json")).unwrap();
        assert_eq!(
            config.pointer("/proxy/allow_system_dns_fallback"),
            Some(&serde_json::Value::Bool(false))
        );
        assert_eq!(
            configured_vpn_dns_servers(&config).unwrap(),
            [Ipv4Addr::new(10, 90, 63, 2), Ipv4Addr::new(10, 90, 63, 3),]
        );
    }

    #[test]
    fn control_v2_stdin_is_opt_in_and_duplicate_safe() {
        let mut arguments = valid_arguments();
        arguments.push("--control-api-v2-stdin".into());
        assert!(parse_arguments(&arguments).unwrap().control_api_v2_stdin);
        arguments.push("--control-api-v2-stdin".into());
        assert!(parse_arguments(&arguments).is_err());
    }

    #[test]
    fn synthetic_control_reader_preserves_eof_and_typed_actions() {
        let wire = b"{\"type\":\"hello\",\"requestId\":1,\"versions\":[2]}\n{\"type\":\"request\",\"apiVersion\":2,\"requestId\":2,\"command\":{\"name\":\"require_capability\",\"capability\":\"transport.web_vpn\"}}\n{\"type\":\"request\",\"apiVersion\":2,\"requestId\":3,\"command\":{\"name\":\"shutdown\"}}\n{\"type\":\"cancel\",\"apiVersion\":2,\"requestId\":4,\"requestToCancel\":3}\n{\"type\":\"close\",\"apiVersion\":2,\"requestId\":5}\n";
        let (sender, mut receiver) = tokio::sync::mpsc::channel(MAX_ACTIVE_REQUESTS);
        control_reader_loop(wire.as_slice(), sender).unwrap();

        let hello = receiver.blocking_recv().unwrap();
        let ControlInput::V2(hello) = hello else {
            panic!("expected v2 hello");
        };
        assert!(matches!(
            hello.response,
            ec_compat::engine::control::ControlResponse::Hello { .. }
        ));
        let unsupported = receiver.blocking_recv().unwrap();
        let ControlInput::V2(unsupported) = unsupported else {
            panic!("expected v2 capability response");
        };
        assert!(matches!(
            unsupported.response,
            ec_compat::engine::control::ControlResponse::Error {
                error: ec_compat::engine::control::ControlProtocolError::UnsupportedCapability {
                    capability: ec_compat::engine::control::ControlCapability::TransportWebVpn,
                },
                ..
            }
        ));
        assert_eq!(unsupported.action, None);
        let shutdown = receiver.blocking_recv().unwrap();
        let ControlInput::V2(shutdown) = shutdown else {
            panic!("expected v2 shutdown");
        };
        assert_eq!(
            shutdown.action,
            Some(ControlAction::Shutdown { request_id: 3 })
        );
        let cancel = receiver.blocking_recv().unwrap();
        let ControlInput::V2(cancel) = cancel else {
            panic!("expected v2 cancel");
        };
        assert_eq!(
            cancel.action,
            Some(ControlAction::Cancel {
                request_id: 4,
                request_to_cancel: 3,
            })
        );
        let close = receiver.blocking_recv().unwrap();
        let ControlInput::V2(close) = close else {
            panic!("expected v2 close");
        };
        assert_eq!(close.action, Some(ControlAction::Close { request_id: 5 }));
        // Reader EOF/close drops only this bounded channel. There is no
        // synthesized Shutdown action.
        assert!(receiver.blocking_recv().is_none());
    }

    #[test]
    fn control_reader_multiplexes_v3_without_changing_v2_session_state() {
        let wire = b"{\"type\":\"auth_request\",\"apiVersion\":3,\"requestId\":7,\"generation\":9,\"transactionId\":\"04040404040404040404040404040404\",\"challengeEpoch\":1,\"command\":{\"name\":\"respond\",\"response\":\"private-fixture\"}}\n{\"type\":\"hello\",\"requestId\":8,\"versions\":[2]}\n{\"type\":\"close\",\"apiVersion\":2,\"requestId\":9}\n";
        let (sender, mut receiver) = tokio::sync::mpsc::channel(MAX_ACTIVE_REQUESTS);
        control_reader_loop(wire.as_slice(), sender).unwrap();

        let ControlInput::V3(request) = receiver.blocking_recv().unwrap() else {
            panic!("expected v3 auth request");
        };
        assert_eq!(request.request_id(), 7);
        assert!(!format!("{request:?}").contains("private-fixture"));
        let ControlInput::V2(hello) = receiver.blocking_recv().unwrap() else {
            panic!("expected v2 hello");
        };
        assert!(matches!(
            hello.response,
            ec_compat::engine::control::ControlResponse::Hello { .. }
        ));
        let ControlInput::V2(close) = receiver.blocking_recv().unwrap() else {
            panic!("expected v2 close");
        };
        assert_eq!(close.action, Some(ControlAction::Close { request_id: 9 }));
        assert!(receiver.blocking_recv().is_none());
    }

    #[test]
    fn queued_shutdown_is_cancellable_before_its_bounded_commit_window() {
        let now = tokio::time::Instant::now();
        let mut pending = PendingControlActions::default();
        assert!(!pending.apply(ControlAction::Shutdown { request_id: 41 }, now));
        assert_eq!(
            pending.next_shutdown_deadline(),
            Some(now + CONTROL_SHUTDOWN_CANCEL_WINDOW)
        );
        assert!(!pending.apply(
            ControlAction::Cancel {
                request_id: 42,
                request_to_cancel: 41,
            },
            now,
        ));
        assert_eq!(pending.next_shutdown_deadline(), None);
        assert!(pending.apply(ControlAction::Close { request_id: 43 }, now));
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
        assert_eq!(
            authentication_error_code(&ProviderError::Failed(Error::classified(
                ErrorKind::Configuration,
                "redacted configuration failure",
            ))),
            EngineErrorCode::ConfigurationInvalid
        );
        assert_eq!(
            data_plane_setup_error_code(&Error::classified(
                ErrorKind::Configuration,
                "redacted configuration failure",
            )),
            EngineErrorCode::ConfigurationInvalid
        );
        assert_eq!(
            data_plane_setup_error_code(&Error::classified(
                ErrorKind::DataPlaneTransient,
                "redacted transient failure",
            )),
            EngineErrorCode::DataPlaneSetupFailed
        );
    }
}
