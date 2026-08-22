use crate::auth::{AuthState, auth_summary, rsa_encrypt_hex, safe_int};
use crate::config::{parse_gateway_configuration, parse_resource_dns_servers};
use crate::engine::auth_lifecycle::AuthenticationCancellation;
use crate::engine::data_plane::EasyConnectDataPlane;
use crate::engine::provider::{
    AuthOutcome, AuthProvider, AuthRequest, AuthenticationCapabilities, Capability,
    CapabilityModel, NoAuthChallenge, ProviderError, ProviderResult, TransportBackend,
    TransportCapabilities, require_supported,
};
use crate::gateway_auth::AuthenticatedSessionId;
use crate::gateway_http::{DEFAULT_TIMEOUT_SECONDS, GatewaySession};
use crate::modern::{parse_sha256_pin, request_modern_token};
use crate::xml::{first_descendant_text, parse_xml};
use crate::{Error, ErrorKind, Result};
use reqwest::Method;
use serde_json::Value;
use std::collections::BTreeMap;
use std::net::Ipv4Addr;
use std::time::{Duration, Instant};
use url::Url;
use zeroize::{Zeroize, Zeroizing};

const MODERN_ADDRESS_SETTLE_DELAY: Duration = Duration::from_secs(1);
const DATA_PLANE_SETUP_ATTEMPTS: usize = 3;
const DATA_PLANE_RETRY_STEP: Duration = Duration::from_secs(2);
// The desktop gives the engine a finite grace period after requesting
// shutdown.  Logout must retain the authenticated cookies while using a
// shorter, independent deadline, rather than inheriting the normal 15-second
// request timeout and colliding with that grace period.
const LOGOUT_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct UnsupportedAuthDecision {
    capability: Capability,
    logout_before_return: bool,
}

/// Password-authenticated gateway state.
///
/// This owns only the authenticated HTTP cookie jar, logout endpoint, and the
/// opaque gateway session identifier returned by login. It intentionally does
/// not contain a Modern L3 token, parsed L3 configuration, DNS result, tunnel
/// certificate pin, or data plane.
pub struct AuthenticatedGatewaySession {
    http: GatewaySession,
    logout_path: String,
    session_identifier: AuthenticatedSessionId,
}

/// Backward-compatible Rust name for existing engine consumers. New code
/// should use [`AuthenticatedGatewaySession`] to keep the auth-only boundary
/// explicit.
pub type AuthenticatedEngineSession = AuthenticatedGatewaySession;

pub struct ModernL3Connection {
    data_plane: EasyConnectDataPlane,
    dns_servers: Vec<Ipv4Addr>,
}

impl ModernL3Connection {
    pub fn dns_servers(&self) -> &[Ipv4Addr] {
        &self.dns_servers
    }

    pub fn into_data_plane(self) -> EasyConnectDataPlane {
        self.data_plane
    }
}

pub struct ModernL3TransportBackend {
    base_url: String,
    gateway_host: String,
    timeout: Duration,
    configuration_path: String,
    resource_list_path: String,
    configured_certificate_pin: Option<[u8; 32]>,
}

pub struct ProductionPasswordAuthProvider<'a> {
    config: &'a Value,
}

impl<'a> ProductionPasswordAuthProvider<'a> {
    pub const fn new(config: &'a Value) -> Self {
        Self { config }
    }
}

impl AuthProvider for ProductionPasswordAuthProvider<'_> {
    type Session = AuthenticatedGatewaySession;
    type Challenge = NoAuthChallenge;

    fn capabilities(&self) -> AuthenticationCapabilities {
        AuthenticationCapabilities::password_only()
    }

    fn authenticate(
        &self,
        request: AuthRequest<'_>,
    ) -> ProviderResult<AuthOutcome<Self::Session, Self::Challenge>> {
        match request {
            AuthRequest::Password { username, password } => {
                AuthenticatedGatewaySession::authenticate_password(self.config, username, password)
                    .map(AuthOutcome::Authenticated)
                    .map_err(|error| error.with_failure_kind(ErrorKind::Authentication))
            }
            AuthRequest::ChallengeResponse { method, .. } => {
                let capability = method.capability();
                require_supported(capability, self.capabilities().availability(method))?;
                Err(ProviderError::unavailable(capability))
            }
        }
    }
}

impl ModernL3TransportBackend {
    pub fn new(config: &Value) -> Result<Self> {
        let base_url = required_text(config, "base_url")?;
        let parsed_url = Url::parse(base_url).map_err(|_| {
            Error::classified(ErrorKind::Configuration, "engine base URL is invalid")
        })?;
        if parsed_url.scheme() != "https" {
            return Err(Error::classified(
                ErrorKind::Configuration,
                "engine base URL must use HTTPS",
            ));
        }
        let gateway_host = parsed_url
            .host_str()
            .ok_or_else(|| {
                Error::classified(ErrorKind::Configuration, "engine gateway host is missing")
            })?
            .to_owned();
        let timeout = Duration::from_secs(
            config["timeout_seconds"]
                .as_u64()
                .unwrap_or(DEFAULT_TIMEOUT_SECONDS),
        );
        let configuration_path = required_endpoint(config, "session_config")?.to_owned();
        let resource_list_path = config["endpoints"]["resource_list"]
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("/por/rclist.csp")
            .to_owned();
        let configured_certificate_pin = config["modern_tunnel"]["special_tls_leaf_sha256"]
            .as_str()
            .filter(|value| !value.is_empty())
            .map(|value| {
                parse_sha256_pin(value)
                    .map_err(|error| error.with_kind_if_unclassified(ErrorKind::Configuration))
            })
            .transpose()?;
        Ok(Self {
            base_url: base_url.to_owned(),
            gateway_host,
            timeout,
            configuration_path,
            resource_list_path,
            configured_certificate_pin,
        })
    }

    /// Establish Modern L3 and clean up the authenticated gateway session if
    /// any transport-only bootstrap or data-plane stage fails.
    pub fn connect_or_logout(
        &self,
        session: AuthenticatedGatewaySession,
    ) -> Result<(AuthenticatedGatewaySession, ModernL3Connection)> {
        match self.connect(&session) {
            Ok(connection) => Ok((session, connection)),
            Err(error) => {
                let error = Error::from(error);
                let _ = session.logout();
                Err(error)
            }
        }
    }

    fn establish_modern_l3(
        &self,
        session: &AuthenticatedGatewaySession,
    ) -> ProviderResult<ModernL3Connection> {
        let (configuration, _, _) =
            session
                .http
                .request(&self.configuration_path, Method::GET, None)?;
        let configuration = Zeroizing::new(configuration);
        let gateway_configuration = parse_gateway_configuration(&configuration)?;
        if !gateway_configuration.has_l3_configuration {
            return Err(ProviderError::unavailable(Capability::TransportL3));
        }
        let mut dns_servers = gateway_configuration
            .l3_dns
            .iter()
            .filter_map(|value| value.parse().ok())
            .collect::<Vec<Ipv4Addr>>();
        // The official client reads policy DNS from rclist.csp during the
        // first authenticated connection. This is independent of whether the
        // optional conf.csp L3 DNS attributes are populated.
        if let Ok((resource_list, _, _)) =
            session
                .http
                .request(&self.resource_list_path, Method::GET, None)
        {
            let resource_list = Zeroizing::new(resource_list);
            if let Ok(resource_dns) = parse_resource_dns_servers(&resource_list) {
                for server in resource_dns {
                    if !dns_servers.contains(&server) {
                        dns_servers.push(server);
                    }
                }
            }
        }
        let acquisition =
            request_modern_token(&self.base_url, &session.session_identifier, self.timeout)?;
        let data_plane_not_before = Instant::now() + MODERN_ADDRESS_SETTLE_DELAY;
        let mut attempt = 1;
        loop {
            // The gateway intermittently rejects an address request sent
            // immediately after token acquisition. Keep this transport pacing
            // inside the Modern backend rather than the auth session.
            std::thread::sleep(address_settle_delay(data_plane_not_before, Instant::now()));
            match EasyConnectDataPlane::connect(
                &self.gateway_host,
                &acquisition,
                self.timeout,
                self.configured_certificate_pin.as_ref(),
            ) {
                Ok(data_plane) => {
                    return Ok(ModernL3Connection {
                        data_plane,
                        dns_servers,
                    });
                }
                Err(error)
                    if attempt < DATA_PLANE_SETUP_ATTEMPTS
                        && retryable_data_plane_setup_error(&error) =>
                {
                    std::thread::sleep(DATA_PLANE_RETRY_STEP * attempt as u32);
                    attempt += 1;
                }
                Err(error) => {
                    let kind = data_plane_setup_error_kind(&error);
                    return Err(ProviderError::failed_with_kind(kind, error));
                }
            }
        }
    }
}

impl TransportBackend for ModernL3TransportBackend {
    type Session = AuthenticatedGatewaySession;
    type DataPlane = ModernL3Connection;

    fn capabilities(&self) -> TransportCapabilities {
        TransportCapabilities::modern_l3_only()
    }

    fn connect(&self, session: &Self::Session) -> ProviderResult<Self::DataPlane> {
        self.establish_modern_l3(session)
            .map_err(|error| error.with_failure_kind(ErrorKind::Transport))
    }
}

impl AuthenticatedGatewaySession {
    pub fn authenticate(config: &Value, username: &str, password: &str) -> Result<Self> {
        Self::authenticate_with_provider_error(config, username, password).map_err(Error::from)
    }

    pub fn authenticate_with_provider_error(
        config: &Value,
        username: &str,
        password: &str,
    ) -> ProviderResult<Self> {
        match ProductionPasswordAuthProvider::new(config)
            .authenticate(AuthRequest::Password { username, password })?
        {
            AuthOutcome::Authenticated(session) => Ok(session),
            AuthOutcome::ChallengeRequired(challenge) => match challenge {},
        }
    }

    pub fn authenticate_with_provider_error_cancellable(
        config: &Value,
        username: &str,
        password: &str,
        cancellation: &AuthenticationCancellation,
    ) -> ProviderResult<Self> {
        Self::authenticate_password_with_cancellation(
            config,
            username,
            password,
            Some(cancellation),
        )
    }

    pub const fn capability_model() -> CapabilityModel {
        CapabilityModel::production_password_l3()
    }

    fn authenticate_password(
        config: &Value,
        username: &str,
        password: &str,
    ) -> ProviderResult<Self> {
        Self::authenticate_password_with_cancellation(config, username, password, None)
    }

    fn authenticate_password_with_cancellation(
        config: &Value,
        username: &str,
        password: &str,
        cancellation: Option<&AuthenticationCancellation>,
    ) -> ProviderResult<Self> {
        ensure_authentication_active(cancellation)?;
        let base_url = required_text(config, "base_url")?;
        let parsed_url = Url::parse(base_url).map_err(|_| {
            Error::classified(ErrorKind::Configuration, "engine base URL is invalid")
        })?;
        if parsed_url.scheme() != "https" {
            return Err(Error::classified(
                ErrorKind::Configuration,
                "engine base URL must use HTTPS",
            )
            .into());
        }
        parsed_url.host_str().ok_or_else(|| {
            Error::classified(ErrorKind::Configuration, "engine gateway host is missing")
        })?;
        let timeout_seconds = config["timeout_seconds"]
            .as_u64()
            .unwrap_or(DEFAULT_TIMEOUT_SECONDS);
        let user_agent = config["user_agent"]
            .as_str()
            .unwrap_or("EasyConnect_windows");
        let logout_path = required_endpoint(config, "logout")?.to_owned();
        let http =
            GatewaySession::new(base_url.to_owned(), user_agent.to_owned(), timeout_seconds)?;

        let discovery_path = required_endpoint(config, "discovery")?;
        let _ = http.request(discovery_path, Method::GET, None)?;
        cancel_partial_authentication_if_requested(&http, &logout_path, cancellation)?;
        let password_config_path = required_endpoint(config, "password_config")?;
        let (password_config, _, _) = http.request(password_config_path, Method::GET, None)?;
        cancel_partial_authentication_if_requested(&http, &logout_path, cancellation)?;
        let password_config = Zeroizing::new(password_config);
        let document = parse_xml(&password_config, "engine password configuration")
            .map_err(|error| ProviderError::failed_with_kind(ErrorKind::Authentication, error))?;
        let root = document.root_element();
        let modulus = Zeroizing::new(first_descendant_text(root, "RSA_ENCRYPT_KEY"));
        let csrf = Zeroizing::new(first_descendant_text(root, "CSRF_RAND_CODE"));
        let exponent = safe_int(&first_descendant_text(root, "RSA_ENCRYPT_EXP"), 65_537);
        let mid_attack = safe_int(&first_descendant_text(root, "MID_ATK_CHECK"), 0);
        if modulus.is_empty() || csrf.is_empty() || mid_attack != 0 {
            return Err(Error::classified(
                ErrorKind::Authentication,
                "gateway password configuration is unsupported",
            )
            .into());
        }
        let password_material = Zeroizing::new(format!("{password}_{}", csrf.as_str()));
        let encrypted_password = Zeroizing::new(
            rsa_encrypt_hex(password_material.as_bytes(), &modulus, exponent as u64).map_err(
                |error| ProviderError::failed_with_kind(ErrorKind::Authentication, error),
            )?,
        );
        let mut form = [
            ("mitm_result".into(), String::new()),
            ("svpn_req_randcode".into(), csrf.as_str().to_owned()),
            ("svpn_name".into(), username.to_owned()),
            (
                "svpn_password".into(),
                encrypted_password.as_str().to_owned(),
            ),
            ("svpn_rand_code".into(), String::new()),
        ]
        .into_iter()
        .collect::<BTreeMap<String, String>>();
        ensure_authentication_active(cancellation)?;
        let login_result = http.request(
            required_endpoint(config, "password_login")?,
            Method::POST,
            Some(&form),
        );
        form.values_mut().for_each(Zeroize::zeroize);
        let (login, _, _) = match login_result {
            Ok(response) => response,
            Err(error) => {
                // The POST may have reached the gateway and installed a cookie
                // even when reading/status validation failed locally. Always
                // close that possible partial session before another desktop
                // attempt competes with it.
                let _ = http.request_with_timeout(&logout_path, Method::GET, None, LOGOUT_TIMEOUT);
                return Err(ProviderError::failed_with_kind(
                    ErrorKind::Authentication,
                    error,
                ));
            }
        };
        let login = Zeroizing::new(login);
        cancel_partial_authentication_if_requested(&http, &logout_path, cancellation)?;
        let login_summary = match auth_summary(&login, "engine password login") {
            Ok(summary) => summary,
            Err(error) => {
                // A syntactically changed response can still represent a
                // successful server-side login. Parsing failure is therefore a
                // cleanup boundary, not proof that no session exists.
                let _ = http.request_with_timeout(&logout_path, Method::GET, None, LOGOUT_TIMEOUT);
                return Err(error.into());
            }
        };
        if login_summary.state != AuthState::Authenticated {
            if let Some(decision) = unsupported_auth_decision(login_summary.state) {
                if decision.logout_before_return {
                    // A secondary-authentication response may already own a
                    // server-side cookie/TwfID session. The provider cannot
                    // continue that challenge yet, but it must not strand the
                    // partial session and make the next attempt compete with it.
                    let _ =
                        http.request_with_timeout(&logout_path, Method::GET, None, LOGOUT_TIMEOUT);
                }
                return Err(ProviderError::unsupported(decision.capability));
            }
            // Password-required/failed/unknown states can also carry a cookie.
            // Logout is idempotent and is safer than leaving a session that
            // makes the next connection attempt race itself.
            let _ = http.request_with_timeout(&logout_path, Method::GET, None, LOGOUT_TIMEOUT);
            return Err(Error::classified(
                ErrorKind::Authentication,
                format!(
                    "gateway authentication failed (error_code={}, state={:?})",
                    login_summary.error_code, login_summary.state
                ),
            )
            .into());
        }
        let session_identifier = match AuthenticatedSessionId::from_login_xml(&login) {
            Ok(session) => session,
            Err(error) => {
                // A successful password login must still yield a usable opaque
                // gateway session handle. Clean it up if that auth artifact is
                // malformed, before any transport backend is involved.
                let _ = http.request_with_timeout(&logout_path, Method::GET, None, LOGOUT_TIMEOUT);
                return Err(ProviderError::failed_with_kind(
                    ErrorKind::Authentication,
                    error,
                ));
            }
        };
        let session = Self {
            http,
            logout_path,
            session_identifier,
        };
        if cancellation.is_some_and(AuthenticationCancellation::is_cancelled) {
            let _ = session.logout();
            return Err(authentication_cancelled_error());
        }
        Ok(session)
    }

    pub fn logout(self) -> Result<()> {
        self.http
            .request_with_timeout(&self.logout_path, Method::GET, None, LOGOUT_TIMEOUT)
            .map(|_| ())
            .map_err(|error| {
                Error::classified(
                    ErrorKind::Lifecycle,
                    format!("gateway logout failed: {error}"),
                )
            })
    }
}

fn ensure_authentication_active(
    cancellation: Option<&AuthenticationCancellation>,
) -> ProviderResult<()> {
    if cancellation.is_some_and(AuthenticationCancellation::is_cancelled) {
        return Err(authentication_cancelled_error());
    }
    Ok(())
}

fn cancel_partial_authentication_if_requested(
    http: &GatewaySession,
    logout_path: &str,
    cancellation: Option<&AuthenticationCancellation>,
) -> ProviderResult<()> {
    if cancellation.is_none_or(|cancellation| !cancellation.is_cancelled()) {
        return Ok(());
    }
    let _ = http.request_with_timeout(logout_path, Method::GET, None, LOGOUT_TIMEOUT);
    Err(authentication_cancelled_error())
}

fn authentication_cancelled_error() -> ProviderError {
    ProviderError::failed_with_kind(
        ErrorKind::Lifecycle,
        Error::classified(ErrorKind::Lifecycle, "authentication was cancelled"),
    )
}

fn unsupported_auth_decision(state: AuthState) -> Option<UnsupportedAuthDecision> {
    let capability = match state {
        AuthState::CaptchaRequired => Capability::AuthCaptcha,
        AuthState::SmsRequired => Capability::AuthSms,
        AuthState::TokenRequired => Capability::AuthToken,
        AuthState::CertificateRequired => Capability::AuthCertificate,
        AuthState::HidRequired => Capability::AuthHid,
        AuthState::SsoRequired => Capability::AuthSso,
        AuthState::SecondaryUnknown => Capability::AuthUnknownSecondary,
        AuthState::Authenticated | AuthState::PasswordRequired | AuthState::Failed => return None,
    };
    Some(UnsupportedAuthDecision {
        capability,
        logout_before_return: true,
    })
}

fn address_settle_delay(deadline: Instant, now: Instant) -> Duration {
    deadline.checked_duration_since(now).unwrap_or_default()
}

fn retryable_data_plane_setup_error(error: &Error) -> bool {
    data_plane_setup_error_kind(error).is_retryable()
}

fn data_plane_setup_error_kind(error: &Error) -> ErrorKind {
    let message = error.to_string();
    if message.contains("failed to fill whole buffer")
        || message.contains("modern address reply rejected the request (status=3)")
        || message.contains("Connection reset by peer")
        || message.contains("connection reset by peer")
        || message.contains("unexpected end of file")
    {
        ErrorKind::DataPlaneTransient
    } else {
        ErrorKind::DataPlane
    }
}

fn required_text<'a>(config: &'a Value, name: &str) -> Result<&'a str> {
    config[name]
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            Error::classified(
                ErrorKind::Configuration,
                format!("engine configuration is missing {name}"),
            )
        })
}

fn required_endpoint<'a>(config: &'a Value, name: &str) -> Result<&'a str> {
    config["endpoints"][name]
        .as_str()
        .map(str::trim)
        .filter(|value| value.starts_with('/'))
        .ok_or_else(|| {
            Error::classified(
                ErrorKind::Configuration,
                format!("engine endpoint is missing {name}"),
            )
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn modern_address_pacing_waits_only_until_the_deadline() {
        let now = Instant::now();
        assert_eq!(
            address_settle_delay(now + MODERN_ADDRESS_SETTLE_DELAY, now),
            MODERN_ADDRESS_SETTLE_DELAY
        );
        assert_eq!(
            address_settle_delay(now, now + Duration::from_millis(1)),
            Duration::ZERO
        );
    }

    #[test]
    fn only_transient_data_plane_failures_are_retried() {
        let send = Error("modern send reply: failed to fill whole buffer".into());
        let address = Error("modern address reply rejected the request (status=3)".into());
        let certificate =
            Error("special TLS certificate does not match verified HTTPS leaf".into());
        let channel = Error("modern channel reply has an unexpected status".into());
        assert!(retryable_data_plane_setup_error(&send));
        assert!(retryable_data_plane_setup_error(&address));
        assert!(!retryable_data_plane_setup_error(&certificate));
        assert!(!retryable_data_plane_setup_error(&channel));
        assert_eq!(
            data_plane_setup_error_kind(&send),
            ErrorKind::DataPlaneTransient
        );
        assert_eq!(
            data_plane_setup_error_kind(&certificate),
            ErrorKind::DataPlane
        );
    }

    #[test]
    fn logout_deadline_is_short_and_independent() {
        assert!(LOGOUT_TIMEOUT < Duration::from_secs(DEFAULT_TIMEOUT_SECONDS));
        assert!(!LOGOUT_TIMEOUT.is_zero());
    }

    #[test]
    fn secondary_authentication_states_map_to_explicit_capabilities() {
        for (state, capability) in [
            (AuthState::CaptchaRequired, Capability::AuthCaptcha),
            (AuthState::SmsRequired, Capability::AuthSms),
            (AuthState::TokenRequired, Capability::AuthToken),
            (AuthState::CertificateRequired, Capability::AuthCertificate),
            (AuthState::HidRequired, Capability::AuthHid),
            (AuthState::SsoRequired, Capability::AuthSso),
            (
                AuthState::SecondaryUnknown,
                Capability::AuthUnknownSecondary,
            ),
        ] {
            assert_eq!(
                unsupported_auth_decision(state),
                Some(UnsupportedAuthDecision {
                    capability,
                    logout_before_return: true,
                })
            );
        }
        for state in [
            AuthState::Authenticated,
            AuthState::PasswordRequired,
            AuthState::Failed,
        ] {
            assert_eq!(unsupported_auth_decision(state), None);
        }
    }

    #[test]
    fn password_adapter_preserves_existing_configuration_errors() {
        let config = serde_json::json!({});
        let provider_error =
            match ProductionPasswordAuthProvider::new(&config).authenticate(AuthRequest::Password {
                username: "synthetic-user",
                password: "synthetic-password",
            }) {
                Err(error) => Error::from(error),
                Ok(_) => panic!("an empty config cannot authenticate"),
            };
        let wrapper_error = AuthenticatedEngineSession::authenticate(
            &config,
            "synthetic-user",
            "synthetic-password",
        )
        .err()
        .expect("an empty config cannot authenticate");
        assert_eq!(provider_error.kind(), ErrorKind::Configuration);
        assert_eq!(wrapper_error.kind(), ErrorKind::Configuration);
        assert_eq!(provider_error.to_string(), wrapper_error.to_string());
        assert_eq!(
            wrapper_error.to_string(),
            "engine configuration is missing base_url"
        );
    }
}
