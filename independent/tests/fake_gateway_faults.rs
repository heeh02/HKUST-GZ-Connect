use ec_compat::engine::auth_control::{
    AuthControlAction, AuthControlErrorCode, AuthControlRequest, AuthControlResponse,
    AuthControlSession, decode_auth_control_request,
};
use ec_compat::engine::auth_transaction::{
    AuthProgress, AuthTransaction, AuthTransactionOwner, ChallengeKind, ChallengeView,
    DeliveryChannel, SecretBytes, TransactionId,
};
use ec_compat::{Error, ErrorKind, Result};
use std::fmt::{Debug, Formatter};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use zeroize::Zeroizing;

const GENERATION: u64 = 42;
const TRANSACTION_ID: &str = "0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b";

#[derive(Default)]
struct CleanupEvidence {
    transaction_cancels: AtomicUsize,
    authenticated_logouts: AtomicUsize,
}

struct OpaquePartialGatewayState {
    cookie: Zeroizing<Vec<u8>>,
    csrf: Zeroizing<Vec<u8>>,
    continuation: Zeroizing<Vec<u8>>,
}

impl OpaquePartialGatewayState {
    fn synthetic() -> Self {
        Self {
            cookie: Zeroizing::new(b"private-partial-cookie-fixture".to_vec()),
            csrf: Zeroizing::new(b"private-csrf-fixture".to_vec()),
            continuation: Zeroizing::new(b"private-continuation-fixture".to_vec()),
        }
    }
}

impl Debug for OpaquePartialGatewayState {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("OpaquePartialGatewayState(<engine-owned>)")
    }
}

#[derive(Clone, Copy)]
enum SyntheticFault {
    None,
    TerminalNetworkLoss,
}

struct FakeGatewayTransaction {
    view: ChallengeView,
    partial: OpaquePartialGatewayState,
    fault: SyntheticFault,
    cleanup: Arc<CleanupEvidence>,
}

impl FakeGatewayTransaction {
    fn new(fault: SyntheticFault, cleanup: Arc<CleanupEvidence>) -> Self {
        let id = TransactionId::from_bytes([11; 16]);
        let view = ChallengeView::new(&id, 1, ChallengeKind::Otp)
            .unwrap()
            .with_delivery(DeliveryChannel::Unknown, Some("synthetic-destination"))
            .unwrap()
            .with_attempts_remaining(Some(3));
        Self {
            view,
            partial: OpaquePartialGatewayState::synthetic(),
            fault,
            cleanup,
        }
    }
}

impl Debug for FakeGatewayTransaction {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("FakeGatewayTransaction")
            .field("view", &self.view)
            .field("partial", &self.partial)
            .field("fault", &"<synthetic>")
            .finish_non_exhaustive()
    }
}

struct FakeAuthenticatedSession {
    cleanup: Arc<CleanupEvidence>,
}

impl FakeAuthenticatedSession {
    fn logout(self) {
        self.cleanup
            .authenticated_logouts
            .fetch_add(1, Ordering::SeqCst);
    }
}

impl AuthTransaction for FakeGatewayTransaction {
    type Session = FakeAuthenticatedSession;

    fn public_challenge(&self) -> ChallengeView {
        self.view.clone()
    }

    fn respond(
        &mut self,
        response: SecretBytes,
    ) -> Result<AuthProgress<Self::Session, ChallengeView>> {
        if matches!(self.fault, SyntheticFault::TerminalNetworkLoss) {
            return Err(Error::classified(
                ErrorKind::Lifecycle,
                "synthetic terminal network loss",
            ));
        }
        // Access proves the opaque partial state remains owned by this Rust
        // transaction while the response is processed; no public DTO borrows it.
        assert!(!self.partial.cookie.is_empty());
        assert!(!self.partial.csrf.is_empty());
        assert!(!self.partial.continuation.is_empty());
        if response.as_bytes() == b"synthetic-accepted" {
            return Ok(AuthProgress::Authenticated(FakeAuthenticatedSession {
                cleanup: Arc::clone(&self.cleanup),
            }));
        }
        Ok(AuthProgress::ChallengeRequired(self.view.clone()))
    }

    fn resend(&mut self) -> Result<ChallengeView> {
        Err(Error::classified(
            ErrorKind::ResendUnavailable,
            "synthetic resend unavailable",
        ))
    }

    fn cancel(self) -> Result<()> {
        self.cleanup
            .transaction_cancels
            .fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
}

struct FakeL3Transport {
    fail_after_authentication: bool,
}

impl FakeL3Transport {
    fn connect_or_logout(&self, session: FakeAuthenticatedSession) -> Result<()> {
        if self.fail_after_authentication {
            session.logout();
            return Err(Error::classified(
                ErrorKind::DataPlane,
                "synthetic L3 setup failure",
            ));
        }
        Ok(())
    }
}

fn session(
    fault: SyntheticFault,
    cleanup: Arc<CleanupEvidence>,
) -> AuthControlSession<FakeGatewayTransaction> {
    let owner =
        AuthTransactionOwner::new(GENERATION, FakeGatewayTransaction::new(fault, cleanup)).unwrap();
    AuthControlSession::new(owner)
}

fn request(request_id: u64, command: &str) -> AuthControlRequest {
    let wire = format!(
        "{{\"type\":\"auth_request\",\"apiVersion\":3,\"requestId\":{request_id},\"generation\":{GENERATION},\"transactionId\":\"{TRANSACTION_ID}\",\"challengeEpoch\":1,\"command\":{command}}}"
    );
    decode_auth_control_request(wire.as_bytes()).unwrap()
}

#[test]
fn opaque_partial_gateway_state_never_enters_public_events_or_debug() {
    let cleanup = Arc::new(CleanupEvidence::default());
    let transaction = FakeGatewayTransaction::new(SyntheticFault::None, Arc::clone(&cleanup));
    let debug = format!("{transaction:?}");
    let mut control = session(SyntheticFault::None, Arc::clone(&cleanup));
    let event = serde_json::to_string(&control.initial_event().unwrap()).unwrap();
    for forbidden in [
        "private-partial-cookie-fixture",
        "private-csrf-fixture",
        "private-continuation-fixture",
        "cookie",
        "csrf",
        "continuation",
    ] {
        assert!(!debug.contains(forbidden));
        assert!(!event.contains(forbidden));
    }
    let exchange = control.handle(request(
        1,
        "{\"name\":\"respond\",\"response\":\"synthetic-wrong\"}",
    ));
    assert!(matches!(exchange.action, AuthControlAction::None));
    assert!(matches!(
        exchange.response,
        AuthControlResponse::Challenge { .. }
    ));
}

#[test]
fn restart_cancel_and_terminal_network_loss_all_cleanup_the_partial_transaction() {
    let restarted = Arc::new(CleanupEvidence::default());
    drop(session(SyntheticFault::None, Arc::clone(&restarted)));
    assert_eq!(restarted.transaction_cancels.load(Ordering::SeqCst), 1);

    let cancelled = Arc::new(CleanupEvidence::default());
    let mut cancellation = session(SyntheticFault::None, Arc::clone(&cancelled));
    let exchange = cancellation.handle(request(2, "{\"name\":\"cancel\"}"));
    assert!(matches!(exchange.action, AuthControlAction::Cancelled));
    assert_eq!(cancelled.transaction_cancels.load(Ordering::SeqCst), 1);

    let disconnected = Arc::new(CleanupEvidence::default());
    let mut network_loss = session(
        SyntheticFault::TerminalNetworkLoss,
        Arc::clone(&disconnected),
    );
    let exchange = network_loss.handle(request(
        3,
        "{\"name\":\"respond\",\"response\":\"synthetic-response\"}",
    ));
    assert!(matches!(
        exchange.response,
        AuthControlResponse::Error {
            code: AuthControlErrorCode::TransactionClosed,
            ..
        }
    ));
    assert_eq!(disconnected.transaction_cancels.load(Ordering::SeqCst), 1);
}

#[test]
fn l3_failure_after_challenge_authentication_logs_out_the_completed_session() {
    let cleanup = Arc::new(CleanupEvidence::default());
    let mut control = session(SyntheticFault::None, Arc::clone(&cleanup));
    let exchange = control.handle(request(
        4,
        "{\"name\":\"respond\",\"response\":\"synthetic-accepted\"}",
    ));
    let AuthControlAction::Authenticated(authenticated) = exchange.action else {
        panic!("synthetic challenge must authenticate");
    };
    assert!(matches!(
        exchange.response,
        AuthControlResponse::Complete { .. }
    ));
    let transport = FakeL3Transport {
        fail_after_authentication: true,
    };
    let error = transport.connect_or_logout(authenticated).unwrap_err();
    assert_eq!(error.kind(), ErrorKind::DataPlane);
    assert_eq!(cleanup.authenticated_logouts.load(Ordering::SeqCst), 1);
    assert_eq!(cleanup.transaction_cancels.load(Ordering::SeqCst), 0);
}
