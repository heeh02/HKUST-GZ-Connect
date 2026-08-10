use ec_compat::engine::provider::{
    AuthMethod, AuthOutcome, AuthProvider, AuthRequest, AuthenticationCapabilities, Capability,
    CapabilityAvailability, CapabilityModel, OfflineResourceDocumentProvider, ProviderError,
    ProviderResult, ResourceCapabilities, ResourceProvider, TransportBackend,
    TransportCapabilities, UnsupportedResourceProvider, UnsupportedWebVpnBackend,
    require_supported,
};
use ec_compat::engine::session::{ModernL3TransportBackend, ProductionPasswordAuthProvider};
use serde_json::json;

#[derive(Eq, PartialEq)]
struct MockSession;

struct MockAuthProvider;

#[derive(Eq, PartialEq)]
enum MockChallenge {
    Sms,
}

impl AuthProvider for MockAuthProvider {
    type Session = MockSession;
    type Challenge = MockChallenge;

    fn capabilities(&self) -> AuthenticationCapabilities {
        let mut capabilities = AuthenticationCapabilities::password_only();
        capabilities.sms = CapabilityAvailability::Supported;
        capabilities
    }

    fn authenticate(
        &self,
        request: AuthRequest<'_>,
    ) -> ProviderResult<AuthOutcome<Self::Session, Self::Challenge>> {
        let method = request.method();
        let capability = method.capability();
        require_supported(capability, self.capabilities().availability(method))?;
        match request {
            AuthRequest::Password { .. } => Ok(AuthOutcome::ChallengeRequired(MockChallenge::Sms)),
            AuthRequest::ChallengeResponse {
                method: AuthMethod::Sms,
                ..
            } => Ok(AuthOutcome::Authenticated(MockSession)),
            _ => Err(ProviderError::unavailable(capability)),
        }
    }
}

struct MockResourceProvider;

impl ResourceProvider for MockResourceProvider {
    type Catalogue = Vec<&'static str>;

    fn capabilities(&self) -> ResourceCapabilities {
        ResourceCapabilities {
            catalogue: CapabilityAvailability::Supported,
            authorization_decision: CapabilityAvailability::Unavailable,
        }
    }

    fn load_catalogue(&self) -> ProviderResult<Self::Catalogue> {
        Ok(vec!["sanitized-resource"])
    }
}

struct MockTransportBackend;

impl TransportBackend for MockTransportBackend {
    type Session = bool;
    type DataPlane = &'static str;

    fn capabilities(&self) -> TransportCapabilities {
        TransportCapabilities {
            l3: CapabilityAvailability::Supported,
            web_vpn: CapabilityAvailability::Unsupported,
        }
    }

    fn connect(&self, session: &Self::Session) -> ProviderResult<Self::DataPlane> {
        if *session {
            Ok("mock-l3")
        } else {
            Err(ProviderError::unavailable(Capability::TransportL3))
        }
    }
}

fn authenticate_password<P: AuthProvider>(
    provider: &P,
) -> ProviderResult<AuthOutcome<P::Session, P::Challenge>> {
    provider.authenticate(AuthRequest::Password {
        username: "synthetic-user",
        password: "synthetic-password",
    })
}

fn load_resources<P: ResourceProvider>(provider: &P) -> ProviderResult<P::Catalogue> {
    provider.load_catalogue()
}

fn connect_transport<B: TransportBackend>(
    backend: &B,
    session: &B::Session,
) -> ProviderResult<B::DataPlane> {
    backend.connect(session)
}

#[test]
fn generic_consumers_can_swap_mock_providers_without_vendor_protocol_types() {
    let challenge = match authenticate_password(&MockAuthProvider).unwrap() {
        AuthOutcome::ChallengeRequired(challenge) => challenge,
        AuthOutcome::Authenticated(_) => panic!("mock should exercise the challenge contract"),
    };
    assert!(challenge == MockChallenge::Sms);
    let session = MockAuthProvider
        .authenticate(AuthRequest::ChallengeResponse {
            method: AuthMethod::Sms,
            challenge_id: b"mock-challenge",
            response: b"mock-response",
        })
        .unwrap();
    assert!(matches!(session, AuthOutcome::Authenticated(MockSession)));
    assert_eq!(
        load_resources(&MockResourceProvider).unwrap(),
        ["sanitized-resource"]
    );
    assert_eq!(
        connect_transport(&MockTransportBackend, &true).unwrap(),
        "mock-l3"
    );
    assert!(matches!(
        connect_transport(&MockTransportBackend, &false),
        Err(ProviderError::Unavailable(Capability::TransportL3))
    ));
}

#[test]
fn current_production_adapters_advertise_only_password_and_l3() {
    let config = json!({});
    let auth = ProductionPasswordAuthProvider::new(&config);
    let transport_config = json!({
        "base_url": "https://gateway.example.test",
        "endpoints": { "session_config": "/por/conf.csp" }
    });
    let transport = ModernL3TransportBackend::new(&transport_config).unwrap();
    assert_eq!(
        auth.capabilities(),
        AuthenticationCapabilities::password_only()
    );
    assert_eq!(
        transport.capabilities(),
        TransportCapabilities::modern_l3_only()
    );
    assert_eq!(
        CapabilityModel::production_password_l3().availability(Capability::ResourceCatalogue),
        CapabilityAvailability::Unsupported
    );
    assert_eq!(
        CapabilityModel::production_password_l3()
            .availability(Capability::ResourceAuthorizationDecision),
        CapabilityAvailability::Unsupported
    );
}

#[test]
fn offline_catalogue_provider_is_supported_without_claiming_authorization_semantics() {
    let document = include_bytes!("fixtures/resource_catalogue.xml");
    let provider = OfflineResourceDocumentProvider::from_bytes(document).unwrap();
    assert_eq!(
        provider.capabilities(),
        ResourceCapabilities::offline_catalogue()
    );
    let catalogue = provider.load_catalogue().unwrap();
    assert_eq!(catalogue.sanitized_view().groups.len(), 2);
    assert_eq!(catalogue.sanitized_view().resources.len(), 3);
    assert!(!catalogue.sanitized_view().authorization_decisions_available);
    let output = serde_json::to_string(catalogue.sanitized_view()).unwrap();
    for private in [
        "catalogue.example.test",
        "fixture-access-token",
        "vendor-resource-one",
        "synthetic-user",
    ] {
        assert!(!output.contains(private));
        assert!(!format!("{provider:?}").contains(private));
    }
}

#[test]
fn production_mfa_rejection_is_typed_and_does_not_touch_the_network() {
    let config = json!({});
    let auth = ProductionPasswordAuthProvider::new(&config);
    let private_response = b"private-mfa-response";
    let result = auth.authenticate(AuthRequest::ChallengeResponse {
        method: AuthMethod::Sms,
        challenge_id: b"opaque-id",
        response: private_response,
    });
    let error = match result {
        Err(error) => error,
        Ok(_) => panic!("unsupported MFA must not return a session"),
    };
    assert!(matches!(
        &error,
        ProviderError::Unsupported(Capability::AuthSms)
    ));
    assert!(!error.to_string().contains("private-mfa-response"));
}

#[test]
fn absent_resource_and_webvpn_backends_are_explicit_hard_failures() {
    let resources = UnsupportedResourceProvider;
    assert_eq!(
        resources.capabilities().catalogue,
        CapabilityAvailability::Unsupported
    );
    assert!(matches!(
        resources.load_catalogue(),
        Err(ProviderError::Unsupported(Capability::ResourceCatalogue))
    ));

    let web_vpn = UnsupportedWebVpnBackend;
    assert_eq!(
        web_vpn.capabilities().web_vpn,
        CapabilityAvailability::Unsupported
    );
    assert!(matches!(
        web_vpn.connect(&()),
        Err(ProviderError::Unsupported(Capability::TransportWebVpn))
    ));
}
