use crate::auth::{AuthState, auth_summary, rsa_encrypt_hex, safe_int};
use crate::config::{GatewayConfiguration, parse_gateway_configuration};
use crate::engine::data_plane::EasyConnectDataPlane;
use crate::engine::provider::{
    AuthOutcome, AuthProvider, AuthRequest, AuthenticationCapabilities, Capability,
    CapabilityModel, NoAuthChallenge, ProviderError, ProviderResult, TransportBackend,
    TransportCapabilities, engine_result, require_supported,
};
use crate::modern::{
    ModernSessionId, ModernTokenAcquisition, parse_sha256_pin, request_modern_token,
};
use crate::probe::{DEFAULT_TIMEOUT_SECONDS, GatewaySession};
use crate::xml::{first_descendant_text, parse_xml};
use crate::{Error, Result};
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

pub struct AuthenticatedEngineSession {
    http: GatewaySession,
    logout_path: String,
    gateway_host: String,
    timeout: Duration,
    acquisition: ModernTokenAcquisition,
    data_plane_not_before: Instant,
    gateway_configuration: GatewayConfiguration,
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
    type Session = AuthenticatedEngineSession;
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
                AuthenticatedEngineSession::authenticate_password(self.config, username, password)
                    .map(AuthOutcome::Authenticated)
            }
            AuthRequest::ChallengeResponse { method, .. } => {
                let capability = method.capability();
                require_supported(capability, self.capabilities().availability(method))?;
                Err(ProviderError::unavailable(capability))
            }
        }
    }
}

pub struct ModernL3TransportBackend;

impl TransportBackend for ModernL3TransportBackend {
    type Session = AuthenticatedEngineSession;
    type DataPlane = EasyConnectDataPlane;

    fn capabilities(&self) -> TransportCapabilities {
        TransportCapabilities::modern_l3_only()
    }

    fn connect(&self, session: &Self::Session) -> ProviderResult<Self::DataPlane> {
        engine_result(session.establish_modern_l3_data_plane())
    }
}

impl AuthenticatedEngineSession {
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

    pub const fn capability_model() -> CapabilityModel {
        CapabilityModel::production_password_l3()
    }

    fn authenticate_password(
        config: &Value,
        username: &str,
        password: &str,
    ) -> ProviderResult<Self> {
        let base_url = required_text(config, "base_url")?;
        let parsed_url =
            Url::parse(base_url).map_err(|_| Error("engine base URL is invalid".into()))?;
        if parsed_url.scheme() != "https" {
            return Err(Error("engine base URL must use HTTPS".into()).into());
        }
        let gateway_host = parsed_url
            .host_str()
            .ok_or_else(|| Error("engine gateway host is missing".into()))?
            .to_owned();
        let timeout_seconds = config["timeout_seconds"]
            .as_u64()
            .unwrap_or(DEFAULT_TIMEOUT_SECONDS);
        let timeout = Duration::from_secs(timeout_seconds);
        let user_agent = config["user_agent"]
            .as_str()
            .unwrap_or("EasyConnect_windows");
        let logout_path = required_endpoint(config, "logout")?.to_owned();
        let http =
            GatewaySession::new(base_url.to_owned(), user_agent.to_owned(), timeout_seconds)?;

        let discovery_path = required_endpoint(config, "discovery")?;
        let _ = http.request(discovery_path, Method::GET, None)?;
        let password_config_path = required_endpoint(config, "password_config")?;
        let (password_config, _, _) = http.request(password_config_path, Method::GET, None)?;
        let password_config = Zeroizing::new(password_config);
        let document = parse_xml(&password_config, "engine password configuration")?;
        let root = document.root_element();
        let modulus = Zeroizing::new(first_descendant_text(root, "RSA_ENCRYPT_KEY"));
        let csrf = Zeroizing::new(first_descendant_text(root, "CSRF_RAND_CODE"));
        let exponent = safe_int(&first_descendant_text(root, "RSA_ENCRYPT_EXP"), 65_537);
        let mid_attack = safe_int(&first_descendant_text(root, "MID_ATK_CHECK"), 0);
        if modulus.is_empty() || csrf.is_empty() || mid_attack != 0 {
            return Err(Error("gateway password configuration is unsupported".into()).into());
        }
        let password_material = Zeroizing::new(format!("{password}_{}", csrf.as_str()));
        let encrypted_password = Zeroizing::new(rsa_encrypt_hex(
            password_material.as_bytes(),
            &modulus,
            exponent as u64,
        )?);
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
                return Err(error.into());
            }
        };
        let login = Zeroizing::new(login);
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
            return Err(Error(format!(
                "gateway authentication failed (error_code={}, state={:?})",
                login_summary.error_code, login_summary.state
            ))
            .into());
        }
        let authenticated_setup: ProviderResult<_> = (|| {
            let modern_session = ModernSessionId::from_login_xml(&login)?;
            let configuration_path = required_endpoint(config, "session_config")?;
            let (configuration, _, _) = http.request(configuration_path, Method::GET, None)?;
            let configuration = Zeroizing::new(configuration);
            let gateway_configuration = parse_gateway_configuration(&configuration)?;
            if !gateway_configuration.has_l3_configuration {
                return Err(ProviderError::unavailable(Capability::TransportL3));
            }
            let acquisition = request_modern_token(base_url, &modern_session, timeout)?;
            let data_plane_not_before = Instant::now() + MODERN_ADDRESS_SETTLE_DELAY;
            let configured_certificate_pin = config["modern_tunnel"]["special_tls_leaf_sha256"]
                .as_str()
                .filter(|value| !value.is_empty())
                .map(parse_sha256_pin)
                .transpose()?;
            Ok((
                acquisition,
                data_plane_not_before,
                gateway_configuration,
                configured_certificate_pin,
            ))
        })();
        let (acquisition, data_plane_not_before, gateway_configuration, configured_certificate_pin) =
            match authenticated_setup {
                Ok(setup) => setup,
                Err(error) => {
                    // Authentication already succeeded. Avoid leaking a
                    // server-side session when any later bootstrap stage
                    // fails; keep the original error as the useful cause.
                    let _ =
                        http.request_with_timeout(&logout_path, Method::GET, None, LOGOUT_TIMEOUT);
                    return Err(error);
                }
            };
        Ok(Self {
            http,
            logout_path,
            gateway_host,
            timeout,
            acquisition,
            data_plane_not_before,
            gateway_configuration,
            configured_certificate_pin,
        })
    }

    pub fn establish_data_plane(&self) -> Result<EasyConnectDataPlane> {
        ModernL3TransportBackend.connect(self).map_err(Error::from)
    }

    fn establish_modern_l3_data_plane(&self) -> Result<EasyConnectDataPlane> {
        // The gateway intermittently rejects an address request sent
        // immediately after token acquisition. Keep this pacing rule beside
        // the session transition so every frontend gets identical behavior.
        std::thread::sleep(address_settle_delay(
            self.data_plane_not_before,
            Instant::now(),
        ));
        EasyConnectDataPlane::connect(
            &self.gateway_host,
            &self.acquisition,
            self.timeout,
            self.configured_certificate_pin.as_ref(),
        )
    }

    pub fn dns_servers(&self) -> Vec<Ipv4Addr> {
        self.gateway_configuration
            .l3_dns
            .iter()
            .filter_map(|value| value.parse().ok())
            .collect()
    }

    pub fn logout(self) -> Result<()> {
        self.http
            .request_with_timeout(&self.logout_path, Method::GET, None, LOGOUT_TIMEOUT)
            .map(|_| ())
            .map_err(|error| Error(format!("gateway logout failed: {error}")))
    }

    /// Establish the data plane while preserving the gateway's one-session
    /// invariant. A failed address/send/receive setup happens after login, so
    /// returning without logout would leave a server-side session behind and
    /// make the desktop retry compete with its own stale session.
    pub fn establish_data_plane_or_logout(self) -> Result<(Self, EasyConnectDataPlane)> {
        let mut attempt = 1;
        loop {
            match self.establish_data_plane() {
                Ok(data_plane) => return Ok((self, data_plane)),
                Err(error)
                    if attempt < DATA_PLANE_SETUP_ATTEMPTS
                        && retryable_data_plane_setup_error(&error) =>
                {
                    std::thread::sleep(DATA_PLANE_RETRY_STEP * attempt as u32);
                    attempt += 1;
                }
                Err(error) => {
                    let _ = self.logout();
                    return Err(error);
                }
            }
        }
    }
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
    let message = error.to_string();
    message.contains("failed to fill whole buffer")
        || message.contains("modern address reply rejected the request (status=3)")
        || message.contains("Connection reset by peer")
        || message.contains("connection reset by peer")
        || message.contains("unexpected end of file")
}

fn required_text<'a>(config: &'a Value, name: &str) -> Result<&'a str> {
    config[name]
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| Error(format!("engine configuration is missing {name}")))
}

fn required_endpoint<'a>(config: &'a Value, name: &str) -> Result<&'a str> {
    config["endpoints"][name]
        .as_str()
        .map(str::trim)
        .filter(|value| value.starts_with('/'))
        .ok_or_else(|| Error(format!("engine endpoint is missing {name}")))
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
        assert!(retryable_data_plane_setup_error(&Error(
            "modern send reply: failed to fill whole buffer".into()
        )));
        assert!(retryable_data_plane_setup_error(&Error(
            "modern address reply rejected the request (status=3)".into()
        )));
        assert!(!retryable_data_plane_setup_error(&Error(
            "special TLS certificate does not match verified HTTPS leaf".into()
        )));
        assert!(!retryable_data_plane_setup_error(&Error(
            "modern channel reply has an unexpected status".into()
        )));
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
                Err(error) => Error::from(error).to_string(),
                Ok(_) => panic!("an empty config cannot authenticate"),
            };
        let wrapper_error = AuthenticatedEngineSession::authenticate(
            &config,
            "synthetic-user",
            "synthetic-password",
        )
        .err()
        .expect("an empty config cannot authenticate")
        .to_string();
        assert_eq!(provider_error, wrapper_error);
        assert_eq!(wrapper_error, "engine configuration is missing base_url");
    }
}
