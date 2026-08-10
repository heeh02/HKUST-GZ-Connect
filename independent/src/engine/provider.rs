//! Stable extension contracts between gateway capabilities and the engine.
//!
//! These interfaces deliberately describe only proven product boundaries. A
//! provider must advertise an unavailable or unsupported capability instead of
//! returning a successful placeholder. Vendor-specific HTTP and tunnel wire
//! formats remain in their production adapters.

use crate::resource_catalogue::{ResourceCatalogue, parse_resource_catalogue};
use crate::xml::MAX_XML_BYTES;
use crate::{Error, Result};
use std::fmt::{Display, Formatter};
use zeroize::Zeroizing;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CapabilityAvailability {
    /// The provider has an implemented path for this capability.
    Supported,
    /// The capability is known but no reviewed implementation exists.
    Unsupported,
    /// The implementation exists but cannot be used in this provider/profile.
    Unavailable,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum Capability {
    AuthPassword,
    AuthCaptcha,
    AuthSms,
    AuthToken,
    AuthCertificate,
    AuthHid,
    AuthSso,
    AuthDevice,
    AuthUnknownSecondary,
    ResourceCatalogue,
    ResourceAuthorizationDecision,
    TransportL3,
    TransportWebVpn,
}

impl Capability {
    pub const ALL: [Self; 13] = [
        Self::AuthPassword,
        Self::AuthCaptcha,
        Self::AuthSms,
        Self::AuthToken,
        Self::AuthCertificate,
        Self::AuthHid,
        Self::AuthSso,
        Self::AuthDevice,
        Self::AuthUnknownSecondary,
        Self::ResourceCatalogue,
        Self::ResourceAuthorizationDecision,
        Self::TransportL3,
        Self::TransportWebVpn,
    ];

    pub const fn name(self) -> &'static str {
        match self {
            Self::AuthPassword => "auth.password",
            Self::AuthCaptcha => "auth.captcha",
            Self::AuthSms => "auth.sms",
            Self::AuthToken => "auth.token",
            Self::AuthCertificate => "auth.certificate",
            Self::AuthHid => "auth.hid",
            Self::AuthSso => "auth.sso",
            Self::AuthDevice => "auth.device",
            Self::AuthUnknownSecondary => "auth.unknown_secondary",
            Self::ResourceCatalogue => "resource.catalogue",
            Self::ResourceAuthorizationDecision => "resource.authorization_decision",
            Self::TransportL3 => "transport.l3",
            Self::TransportWebVpn => "transport.web_vpn",
        }
    }

    pub const fn is_authentication(self) -> bool {
        matches!(
            self,
            Self::AuthPassword
                | Self::AuthCaptcha
                | Self::AuthSms
                | Self::AuthToken
                | Self::AuthCertificate
                | Self::AuthHid
                | Self::AuthSso
                | Self::AuthDevice
                | Self::AuthUnknownSecondary
        )
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct AuthenticationCapabilities {
    pub password: CapabilityAvailability,
    pub captcha: CapabilityAvailability,
    pub sms: CapabilityAvailability,
    pub token: CapabilityAvailability,
    pub certificate: CapabilityAvailability,
    pub hid: CapabilityAvailability,
    pub sso: CapabilityAvailability,
    pub device: CapabilityAvailability,
    pub unknown_secondary: CapabilityAvailability,
}

impl AuthenticationCapabilities {
    pub const fn password_only() -> Self {
        Self {
            password: CapabilityAvailability::Supported,
            captcha: CapabilityAvailability::Unsupported,
            sms: CapabilityAvailability::Unsupported,
            token: CapabilityAvailability::Unsupported,
            certificate: CapabilityAvailability::Unsupported,
            hid: CapabilityAvailability::Unsupported,
            sso: CapabilityAvailability::Unsupported,
            device: CapabilityAvailability::Unsupported,
            unknown_secondary: CapabilityAvailability::Unsupported,
        }
    }

    pub const fn availability(self, method: AuthMethod) -> CapabilityAvailability {
        match method {
            AuthMethod::Password => self.password,
            AuthMethod::Captcha => self.captcha,
            AuthMethod::Sms => self.sms,
            AuthMethod::Token => self.token,
            AuthMethod::Certificate => self.certificate,
            AuthMethod::Hid => self.hid,
            AuthMethod::Sso => self.sso,
            AuthMethod::Device => self.device,
            AuthMethod::UnknownSecondary => self.unknown_secondary,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ResourceCapabilities {
    pub catalogue: CapabilityAvailability,
    pub authorization_decision: CapabilityAvailability,
}

impl ResourceCapabilities {
    pub const fn unsupported() -> Self {
        Self {
            catalogue: CapabilityAvailability::Unsupported,
            authorization_decision: CapabilityAvailability::Unsupported,
        }
    }

    /// A document can be parsed offline, but its opaque authorization values
    /// still cannot be interpreted as allow/deny decisions.
    pub const fn offline_catalogue() -> Self {
        Self {
            catalogue: CapabilityAvailability::Supported,
            authorization_decision: CapabilityAvailability::Unavailable,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct TransportCapabilities {
    pub l3: CapabilityAvailability,
    pub web_vpn: CapabilityAvailability,
}

impl TransportCapabilities {
    pub const fn modern_l3_only() -> Self {
        Self {
            l3: CapabilityAvailability::Supported,
            web_vpn: CapabilityAvailability::Unsupported,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CapabilityModel {
    pub authentication: AuthenticationCapabilities,
    pub resources: ResourceCapabilities,
    pub transport: TransportCapabilities,
}

impl CapabilityModel {
    pub const fn production_password_l3() -> Self {
        Self {
            authentication: AuthenticationCapabilities::password_only(),
            resources: ResourceCapabilities::unsupported(),
            transport: TransportCapabilities::modern_l3_only(),
        }
    }

    pub const fn availability(self, capability: Capability) -> CapabilityAvailability {
        match capability {
            Capability::AuthPassword => self.authentication.password,
            Capability::AuthCaptcha => self.authentication.captcha,
            Capability::AuthSms => self.authentication.sms,
            Capability::AuthToken => self.authentication.token,
            Capability::AuthCertificate => self.authentication.certificate,
            Capability::AuthHid => self.authentication.hid,
            Capability::AuthSso => self.authentication.sso,
            Capability::AuthDevice => self.authentication.device,
            Capability::AuthUnknownSecondary => self.authentication.unknown_secondary,
            Capability::ResourceCatalogue => self.resources.catalogue,
            Capability::ResourceAuthorizationDecision => self.resources.authorization_decision,
            Capability::TransportL3 => self.transport.l3,
            Capability::TransportWebVpn => self.transport.web_vpn,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AuthMethod {
    Password,
    Captcha,
    Sms,
    Token,
    Certificate,
    Hid,
    Sso,
    Device,
    UnknownSecondary,
}

impl AuthMethod {
    pub const fn capability(self) -> Capability {
        match self {
            Self::Password => Capability::AuthPassword,
            Self::Captcha => Capability::AuthCaptcha,
            Self::Sms => Capability::AuthSms,
            Self::Token => Capability::AuthToken,
            Self::Certificate => Capability::AuthCertificate,
            Self::Hid => Capability::AuthHid,
            Self::Sso => Capability::AuthSso,
            Self::Device => Capability::AuthDevice,
            Self::UnknownSecondary => Capability::AuthUnknownSecondary,
        }
    }
}

/// Authentication input deliberately has no `Debug` implementation: every
/// variant may contain a credential or challenge secret.
#[non_exhaustive]
pub enum AuthRequest<'a> {
    Password {
        username: &'a str,
        password: &'a str,
    },
    ChallengeResponse {
        method: AuthMethod,
        challenge_id: &'a [u8],
        response: &'a [u8],
    },
}

impl AuthRequest<'_> {
    pub const fn method(&self) -> AuthMethod {
        match self {
            Self::Password { .. } => AuthMethod::Password,
            Self::ChallengeResponse { method, .. } => *method,
        }
    }
}

/// Authentication can complete or request another provider-owned challenge.
/// The challenge type is an associated type, so this stable boundary does not
/// invent vendor challenge fields before evidence exists.
pub enum AuthOutcome<S, C> {
    Authenticated(S),
    ChallengeRequired(C),
}

/// Uninhabited challenge type for providers that implement no continuation.
pub enum NoAuthChallenge {}

#[derive(Debug)]
pub enum ProviderError {
    Unsupported(Capability),
    Unavailable(Capability),
    Failed(Error),
}

impl ProviderError {
    pub const fn unsupported(capability: Capability) -> Self {
        Self::Unsupported(capability)
    }

    pub const fn unavailable(capability: Capability) -> Self {
        Self::Unavailable(capability)
    }

    pub const fn capability(&self) -> Option<Capability> {
        match self {
            Self::Unsupported(capability) | Self::Unavailable(capability) => Some(*capability),
            Self::Failed(_) => None,
        }
    }
}

impl Display for ProviderError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unsupported(capability) => {
                write!(formatter, "{} is unsupported", capability.name())
            }
            Self::Unavailable(capability) => {
                write!(formatter, "{} is unavailable", capability.name())
            }
            Self::Failed(error) => Display::fmt(error, formatter),
        }
    }
}

impl std::error::Error for ProviderError {}

impl From<Error> for ProviderError {
    fn from(error: Error) -> Self {
        Self::Failed(error)
    }
}

impl From<ProviderError> for Error {
    fn from(error: ProviderError) -> Self {
        match error {
            ProviderError::Failed(error) => error,
            other => Self(other.to_string()),
        }
    }
}

pub type ProviderResult<T> = std::result::Result<T, ProviderError>;

pub trait AuthProvider: Send + Sync {
    type Session;
    type Challenge;

    fn capabilities(&self) -> AuthenticationCapabilities;
    fn authenticate(
        &self,
        request: AuthRequest<'_>,
    ) -> ProviderResult<AuthOutcome<Self::Session, Self::Challenge>>;
}

pub trait ResourceProvider: Send + Sync {
    type Catalogue;

    fn capabilities(&self) -> ResourceCapabilities;
    fn load_catalogue(&self) -> ProviderResult<Self::Catalogue>;
}

pub trait TransportBackend: Send + Sync {
    type Session;
    type DataPlane;

    fn capabilities(&self) -> TransportCapabilities;
    fn connect(&self, session: &Self::Session) -> ProviderResult<Self::DataPlane>;
}

/// The parser exists, but the production engine has no reviewed authenticated
/// resource-fetch/provider contract. Returning a catalogue would be a false
/// claim of feature support.
pub struct UnsupportedResourceProvider;

impl ResourceProvider for UnsupportedResourceProvider {
    type Catalogue = ResourceCatalogue;

    fn capabilities(&self) -> ResourceCapabilities {
        ResourceCapabilities::unsupported()
    }

    fn load_catalogue(&self) -> ProviderResult<Self::Catalogue> {
        Err(ProviderError::unsupported(Capability::ResourceCatalogue))
    }
}

/// Offline-only provider for an already acquired resource document.
///
/// This provider performs no network access and owns a zeroizing copy because
/// the XML can contain authenticated URLs and user information. It must not be
/// substituted for a production authenticated-fetch provider.
pub struct OfflineResourceDocumentProvider {
    document: Zeroizing<Vec<u8>>,
}

impl OfflineResourceDocumentProvider {
    pub fn from_bytes(document: &[u8]) -> Result<Self> {
        if document.len() > MAX_XML_BYTES {
            return Err(Error("resource catalogue exceeds the size limit".into()));
        }
        Ok(Self {
            document: Zeroizing::new(document.to_vec()),
        })
    }
}

impl std::fmt::Debug for OfflineResourceDocumentProvider {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("OfflineResourceDocumentProvider")
            .field("document", &"<redacted>")
            .finish()
    }
}

impl ResourceProvider for OfflineResourceDocumentProvider {
    type Catalogue = ResourceCatalogue;

    fn capabilities(&self) -> ResourceCapabilities {
        ResourceCapabilities::offline_catalogue()
    }

    fn load_catalogue(&self) -> ProviderResult<Self::Catalogue> {
        engine_result(parse_resource_catalogue(self.document.as_slice()))
    }
}

/// Explicit placeholder for the observed WebVPN configuration family. It is a
/// hard failure until sanitized fixtures and an approved implementation exist.
pub struct UnsupportedWebVpnBackend;

impl TransportBackend for UnsupportedWebVpnBackend {
    type Session = ();
    type DataPlane = ();

    fn capabilities(&self) -> TransportCapabilities {
        TransportCapabilities {
            l3: CapabilityAvailability::Unavailable,
            web_vpn: CapabilityAvailability::Unsupported,
        }
    }

    fn connect(&self, _session: &Self::Session) -> ProviderResult<Self::DataPlane> {
        Err(ProviderError::unsupported(Capability::TransportWebVpn))
    }
}

/// Converts a capability declaration into a fail-closed provider result.
pub fn require_supported(
    capability: Capability,
    availability: CapabilityAvailability,
) -> ProviderResult<()> {
    match availability {
        CapabilityAvailability::Supported => Ok(()),
        CapabilityAvailability::Unsupported => Err(ProviderError::unsupported(capability)),
        CapabilityAvailability::Unavailable => Err(ProviderError::unavailable(capability)),
    }
}

/// Preserves existing engine errors at the provider boundary.
pub fn engine_result<T>(result: Result<T>) -> ProviderResult<T> {
    result.map_err(ProviderError::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn production_capabilities_are_explicit_and_fail_closed() {
        let model = CapabilityModel::production_password_l3();
        assert_eq!(
            model.availability(Capability::AuthPassword),
            CapabilityAvailability::Supported
        );
        assert_eq!(
            model.availability(Capability::TransportL3),
            CapabilityAvailability::Supported
        );
        for capability in Capability::ALL {
            if !matches!(
                capability,
                Capability::AuthPassword | Capability::TransportL3
            ) {
                assert_eq!(
                    model.availability(capability),
                    CapabilityAvailability::Unsupported,
                    "{} must not look implemented",
                    capability.name()
                );
            }
        }
    }

    #[test]
    fn unsupported_resource_and_webvpn_providers_never_fake_success() {
        let resources = UnsupportedResourceProvider;
        let error = resources.load_catalogue().unwrap_err();
        assert_eq!(error.capability(), Some(Capability::ResourceCatalogue));

        let web_vpn = UnsupportedWebVpnBackend;
        let error = web_vpn.connect(&()).unwrap_err();
        assert_eq!(error.capability(), Some(Capability::TransportWebVpn));
    }

    #[test]
    fn unavailable_and_unsupported_remain_distinct() {
        assert!(matches!(
            require_supported(
                Capability::TransportWebVpn,
                CapabilityAvailability::Unsupported
            ),
            Err(ProviderError::Unsupported(Capability::TransportWebVpn))
        ));
        assert!(matches!(
            require_supported(Capability::TransportL3, CapabilityAvailability::Unavailable),
            Err(ProviderError::Unavailable(Capability::TransportL3))
        ));
    }

    #[test]
    fn authentication_capabilities_are_stably_classified() {
        for capability in Capability::ALL {
            assert_eq!(
                capability.is_authentication(),
                matches!(
                    capability,
                    Capability::AuthPassword
                        | Capability::AuthCaptcha
                        | Capability::AuthSms
                        | Capability::AuthToken
                        | Capability::AuthCertificate
                        | Capability::AuthHid
                        | Capability::AuthSso
                        | Capability::AuthDevice
                        | Capability::AuthUnknownSecondary
                ),
                "{}",
                capability.name()
            );
        }
    }
}
