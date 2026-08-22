use ec_compat::engine::auth_transaction::{
    AuthBudgetPolicy, AuthCommandContext, AuthGatewayRequestBudget, AuthProgress, AuthTransaction,
    AuthTransactionOwner, ChallengeKind, ChallengeView, DeliveryChannel, SecretBytes,
    TransactionId,
};
use ec_compat::engine::provider::{
    AuthOutcome, AuthProvider, AuthRequest, AuthenticationCapabilities, ProviderResult,
};
use ec_compat::{Error, ErrorKind, Result};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use zeroize::Zeroizing;

#[derive(Debug, Eq, PartialEq)]
struct FakeSession(&'static str);

#[derive(Clone, Copy)]
enum FakeMode {
    PasswordOnly,
    Otp,
    Unknown,
}

struct FakeAuthProvider {
    mode: FakeMode,
    now_ms: u64,
    dropped: Arc<AtomicBool>,
}

impl AuthProvider for FakeAuthProvider {
    type Session = FakeSession;
    type Challenge = FakeTransaction;

    fn capabilities(&self) -> AuthenticationCapabilities {
        AuthenticationCapabilities::password_only()
    }

    fn authenticate(
        &self,
        request: AuthRequest<'_>,
    ) -> ProviderResult<AuthOutcome<Self::Session, Self::Challenge>> {
        match request {
            AuthRequest::Password { .. } => match self.mode {
                FakeMode::PasswordOnly => Ok(AuthOutcome::Authenticated(FakeSession("password"))),
                FakeMode::Otp | FakeMode::Unknown => {
                    let kind = if matches!(self.mode, FakeMode::Unknown) {
                        ChallengeKind::Unknown
                    } else {
                        ChallengeKind::Otp
                    };
                    Ok(AuthOutcome::ChallengeRequired(FakeTransaction::new(
                        kind,
                        self.now_ms,
                        Arc::clone(&self.dropped),
                    )))
                }
            },
            AuthRequest::ChallengeResponse { .. } => {
                Err(ec_compat::engine::provider::ProviderError::unavailable(
                    ec_compat::engine::provider::Capability::AuthUnknownSecondary,
                ))
            }
            _ => Err(ec_compat::engine::provider::ProviderError::unavailable(
                ec_compat::engine::provider::Capability::AuthUnknownSecondary,
            )),
        }
    }
}

struct FakeTransaction {
    id: TransactionId,
    epoch: u32,
    now_ms: u64,
    expires_at_ms: u64,
    resend_after_ms: u64,
    expected: Zeroizing<Vec<u8>>,
    attempts: u32,
    kind: ChallengeKind,
    dropped: Arc<AtomicBool>,
}

impl FakeTransaction {
    fn new(kind: ChallengeKind, now_ms: u64, dropped: Arc<AtomicBool>) -> Self {
        Self {
            id: TransactionId::from_bytes([3; 16]),
            epoch: 1,
            now_ms,
            expires_at_ms: now_ms + 60_000,
            resend_after_ms: now_ms + 5_000,
            expected: Zeroizing::new(b"fixture-response".to_vec()),
            attempts: 3,
            kind,
            dropped,
        }
    }

    fn view(&self) -> ChallengeView {
        ChallengeView::new(&self.id, self.epoch, self.kind)
            .unwrap()
            .with_delivery(DeliveryChannel::Unknown, Some("masked-fixture"))
            .unwrap()
            .with_expiry(Some(self.expires_at_ms))
            .with_resend(true, Some(self.resend_after_ms))
            .with_attempts_remaining(Some(self.attempts))
    }
}

impl Drop for FakeTransaction {
    fn drop(&mut self) {
        self.dropped.store(true, Ordering::SeqCst);
    }
}

impl AuthTransaction for FakeTransaction {
    type Session = FakeSession;

    fn public_challenge(&self) -> ChallengeView {
        self.view()
    }

    fn respond(
        &mut self,
        response: SecretBytes,
        gateway_requests: &mut AuthGatewayRequestBudget<'_>,
    ) -> Result<AuthProgress<Self::Session, ChallengeView>> {
        gateway_requests.reserve_request()?;
        if self.now_ms >= self.expires_at_ms {
            return Err(Error::classified(
                ErrorKind::AuthenticationExpired,
                "fake challenge expired",
            ));
        }
        if response.as_bytes() == self.expected.as_slice() {
            return Ok(AuthProgress::Authenticated(FakeSession("mfa")));
        }
        self.attempts = self.attempts.saturating_sub(1);
        Ok(AuthProgress::ChallengeRequired(self.view()))
    }

    fn resend(
        &mut self,
        gateway_requests: &mut AuthGatewayRequestBudget<'_>,
    ) -> Result<ChallengeView> {
        gateway_requests.reserve_request()?;
        if self.now_ms < self.resend_after_ms {
            return Err(Error::classified(
                ErrorKind::Authentication,
                "fake resend cooldown",
            ));
        }
        self.epoch += 1;
        self.resend_after_ms = self.now_ms + 5_000;
        Ok(self.view())
    }

    fn cancel(self) -> Result<()> {
        Ok(())
    }
}

fn context<'a>(view: &'a ChallengeView, request_id: u64) -> AuthCommandContext<'a> {
    AuthCommandContext {
        generation: 42,
        transaction_id: view.transaction_id(),
        challenge_epoch: view.challenge_epoch(),
        request_id,
    }
}

fn owner_at(transaction: FakeTransaction, now_ms: u64) -> AuthTransactionOwner<FakeTransaction> {
    AuthTransactionOwner::new_with_clock(42, transaction, move || now_ms).unwrap()
}

#[test]
fn password_only_path_never_constructs_a_transaction() {
    let provider = FakeAuthProvider {
        mode: FakeMode::PasswordOnly,
        now_ms: 1_000,
        dropped: Arc::new(AtomicBool::new(false)),
    };
    assert!(matches!(
        provider.begin("user", "password").unwrap(),
        AuthProgress::Authenticated(FakeSession("password"))
    ));
}

#[test]
fn response_is_generation_transaction_epoch_and_request_bound() {
    let dropped = Arc::new(AtomicBool::new(false));
    let provider = FakeAuthProvider {
        mode: FakeMode::Otp,
        now_ms: 1_000,
        dropped: Arc::clone(&dropped),
    };
    let transaction = match provider.begin("user", "password").unwrap() {
        AuthProgress::ChallengeRequired(transaction) => transaction,
        AuthProgress::Authenticated(_) => panic!("fake OTP must challenge"),
    };
    let mut owner = owner_at(transaction, 1_000);
    let view = owner.public_challenge().clone();
    let stale = AuthCommandContext {
        generation: 41,
        ..context(&view, 1)
    };
    assert_eq!(
        owner
            .respond(stale, SecretBytes::new(b"fixture-response").unwrap())
            .unwrap_err()
            .kind(),
        ErrorKind::AuthenticationStaleContext
    );
    let invalid = owner
        .respond(
            context(&view, 2),
            SecretBytes::new(b"wrong-response").unwrap(),
        )
        .unwrap();
    assert!(matches!(invalid, AuthProgress::ChallengeRequired(_)));
    assert!(owner.is_active());
    let current = owner.public_challenge().clone();
    let authenticated = owner
        .respond(
            context(&current, 3),
            SecretBytes::new(b"fixture-response").unwrap(),
        )
        .unwrap();
    assert!(matches!(
        authenticated,
        AuthProgress::Authenticated(FakeSession("mfa"))
    ));
    assert!(!owner.is_active());
    assert!(dropped.load(Ordering::SeqCst));
}

#[test]
fn duplicate_resend_cooldown_cancel_and_unknown_are_fail_closed() {
    let dropped = Arc::new(AtomicBool::new(false));
    let mut transaction = FakeTransaction::new(ChallengeKind::Otp, 10_000, Arc::clone(&dropped));
    transaction.now_ms = 16_000;
    let mut owner = owner_at(transaction, 16_000);
    let first = owner.public_challenge().clone();
    let resent = owner.resend(context(&first, 7)).unwrap();
    assert_eq!(resent.challenge_epoch(), 2);
    let duplicate = AuthCommandContext {
        challenge_epoch: resent.challenge_epoch(),
        transaction_id: resent.transaction_id(),
        ..context(&resent, 7)
    };
    assert!(owner.resend(duplicate).is_err());
    let cancel_view = owner.public_challenge().clone();
    owner.cancel(context(&cancel_view, 8)).unwrap();
    assert!(dropped.load(Ordering::SeqCst));

    let unknown_provider = FakeAuthProvider {
        mode: FakeMode::Unknown,
        now_ms: 1_000,
        dropped: Arc::new(AtomicBool::new(false)),
    };
    let unknown = match unknown_provider.begin("user", "password").unwrap() {
        AuthProgress::ChallengeRequired(transaction) => transaction,
        AuthProgress::Authenticated(_) => panic!("unknown method must not authenticate"),
    };
    let mut unknown_owner = owner_at(unknown, 1_000);
    let unknown_view = unknown_owner.public_challenge().clone();
    let error = unknown_owner
        .respond(
            context(&unknown_view, 9),
            SecretBytes::new(b"anything").unwrap(),
        )
        .unwrap_err();
    assert_eq!(error.kind(), ErrorKind::UnsupportedCapability);
}

#[test]
fn owner_enforces_public_expiry_and_resend_times_before_provider_calls() {
    let cooldown_drop = Arc::new(AtomicBool::new(false));
    let cooldown = FakeTransaction::new(ChallengeKind::Otp, 10_000, Arc::clone(&cooldown_drop));
    let mut owner = owner_at(cooldown, 14_000);
    let view = owner.public_challenge().clone();
    let error = owner.resend(context(&view, 20)).unwrap_err();
    assert_eq!(error.kind(), ErrorKind::ResendUnavailable);
    owner.cancel(context(&view, 21)).unwrap();
    assert!(cooldown_drop.load(Ordering::SeqCst));

    let expired_drop = Arc::new(AtomicBool::new(false));
    let expired = FakeTransaction::new(ChallengeKind::Otp, 10_000, Arc::clone(&expired_drop));
    let result = AuthTransactionOwner::new_with_clock(42, expired, || 70_000);
    assert_eq!(
        result.err().unwrap().kind(),
        ErrorKind::AuthenticationExpired
    );
    assert!(expired_drop.load(Ordering::SeqCst));
}

#[test]
fn expiry_fails_closed_and_cancel_drops_the_pending_secret_state() {
    let dropped = Arc::new(AtomicBool::new(false));
    let mut transaction = FakeTransaction::new(ChallengeKind::Otp, 1_000, Arc::clone(&dropped));
    transaction.now_ms = transaction.expires_at_ms;
    let now = Arc::new(AtomicU64::new(1_000));
    let owner_clock = Arc::clone(&now);
    let mut owner = AuthTransactionOwner::new_with_clock(42, transaction, move || {
        owner_clock.load(Ordering::SeqCst)
    })
    .unwrap();
    now.store(
        owner.public_challenge().expires_at_unix_ms().unwrap(),
        Ordering::SeqCst,
    );
    let view = owner.public_challenge().clone();
    let error = owner
        .respond(
            context(&view, 11),
            SecretBytes::new(b"fixture-response").unwrap(),
        )
        .unwrap_err();
    assert_eq!(error.kind(), ErrorKind::AuthenticationExpired);
    assert!(owner.is_active());
    let cancel_view = owner.public_challenge().clone();
    owner.cancel(context(&cancel_view, 12)).unwrap();
    assert!(dropped.load(Ordering::SeqCst));
}

struct BudgetTransaction {
    id: TransactionId,
    epoch: u32,
    network_calls: Arc<AtomicU64>,
    resend_calls: Arc<AtomicU64>,
    cancels: Arc<AtomicU64>,
}

impl BudgetTransaction {
    fn new(
        network_calls: Arc<AtomicU64>,
        resend_calls: Arc<AtomicU64>,
        cancels: Arc<AtomicU64>,
    ) -> Self {
        Self {
            id: TransactionId::from_bytes([5; 16]),
            epoch: 1,
            network_calls,
            resend_calls,
            cancels,
        }
    }

    fn view(&self) -> ChallengeView {
        ChallengeView::new(&self.id, self.epoch, ChallengeKind::Otp)
            .unwrap()
            .with_resend(true, None)
    }
}

impl AuthTransaction for BudgetTransaction {
    type Session = ();

    fn public_challenge(&self) -> ChallengeView {
        self.view()
    }

    fn respond(
        &mut self,
        _response: SecretBytes,
        gateway_requests: &mut AuthGatewayRequestBudget<'_>,
    ) -> Result<AuthProgress<Self::Session, ChallengeView>> {
        gateway_requests.reserve_request()?;
        self.network_calls.fetch_add(1, Ordering::SeqCst);
        Ok(AuthProgress::ChallengeRequired(self.view()))
    }

    fn resend(
        &mut self,
        gateway_requests: &mut AuthGatewayRequestBudget<'_>,
    ) -> Result<ChallengeView> {
        gateway_requests.reserve_request()?;
        self.network_calls.fetch_add(1, Ordering::SeqCst);
        self.resend_calls.fetch_add(1, Ordering::SeqCst);
        self.epoch += 1;
        Ok(self.view())
    }

    fn cancel(self) -> Result<()> {
        self.cancels.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
}

fn budget_owner(
    policy: AuthBudgetPolicy,
    monotonic_ms: Arc<AtomicU64>,
    network_calls: Arc<AtomicU64>,
    resend_calls: Arc<AtomicU64>,
    cancels: Arc<AtomicU64>,
) -> AuthTransactionOwner<BudgetTransaction> {
    let clock = Arc::clone(&monotonic_ms);
    AuthTransactionOwner::new_with_clocks_and_policy(
        42,
        BudgetTransaction::new(network_calls, resend_calls, cancels),
        || 1_000,
        move || clock.load(Ordering::SeqCst),
        policy,
    )
    .unwrap()
}

#[test]
fn submit_and_gateway_request_budgets_fail_before_additional_network_work() {
    let monotonic = Arc::new(AtomicU64::new(10));
    let network_calls = Arc::new(AtomicU64::new(0));
    let cancels = Arc::new(AtomicU64::new(0));
    let mut submit_owner = budget_owner(
        AuthBudgetPolicy::new(1_000, 5, 2, 2, 10).unwrap(),
        Arc::clone(&monotonic),
        Arc::clone(&network_calls),
        Arc::new(AtomicU64::new(0)),
        Arc::clone(&cancels),
    );
    for request_id in 1..=2 {
        let view = submit_owner.public_challenge().clone();
        submit_owner
            .respond(
                context(&view, request_id),
                SecretBytes::new(b"wrong").unwrap(),
            )
            .unwrap();
    }
    let view = submit_owner.public_challenge().clone();
    assert_eq!(
        submit_owner
            .respond(context(&view, 3), SecretBytes::new(b"wrong").unwrap())
            .unwrap_err()
            .kind(),
        ErrorKind::AuthenticationLimitExceeded
    );
    assert_eq!(network_calls.load(Ordering::SeqCst), 2);
    submit_owner.abort().unwrap();
    assert_eq!(cancels.load(Ordering::SeqCst), 1);

    let gateway_calls = Arc::new(AtomicU64::new(0));
    let gateway_cancels = Arc::new(AtomicU64::new(0));
    let mut gateway_owner = budget_owner(
        AuthBudgetPolicy::new(1_000, 5, 4, 2, 2).unwrap(),
        monotonic,
        Arc::clone(&gateway_calls),
        Arc::new(AtomicU64::new(0)),
        Arc::clone(&gateway_cancels),
    );
    for request_id in 10..=11 {
        let view = gateway_owner.public_challenge().clone();
        gateway_owner
            .respond(
                context(&view, request_id),
                SecretBytes::new(b"wrong").unwrap(),
            )
            .unwrap();
    }
    let view = gateway_owner.public_challenge().clone();
    assert_eq!(
        gateway_owner
            .respond(context(&view, 12), SecretBytes::new(b"wrong").unwrap())
            .unwrap_err()
            .kind(),
        ErrorKind::AuthenticationLimitExceeded
    );
    assert_eq!(gateway_calls.load(Ordering::SeqCst), 2);
    gateway_owner.abort().unwrap();
    assert_eq!(gateway_cancels.load(Ordering::SeqCst), 1);
}

#[test]
fn resend_step_budget_and_monotonic_deadline_are_engine_authoritative() {
    let monotonic = Arc::new(AtomicU64::new(100));
    let resend_calls = Arc::new(AtomicU64::new(0));
    let cancels = Arc::new(AtomicU64::new(0));
    let mut owner = budget_owner(
        AuthBudgetPolicy::new(50, 2, 3, 3, 10).unwrap(),
        Arc::clone(&monotonic),
        Arc::new(AtomicU64::new(0)),
        Arc::clone(&resend_calls),
        Arc::clone(&cancels),
    );
    assert_eq!(
        owner.remaining_lifetime().unwrap(),
        std::time::Duration::from_millis(50)
    );
    let first = owner.public_challenge().clone();
    let second = owner.resend(context(&first, 20)).unwrap();
    assert_eq!(second.challenge_epoch(), 2);
    assert_eq!(resend_calls.load(Ordering::SeqCst), 1);
    assert_eq!(
        owner.resend(context(&second, 21)).unwrap_err().kind(),
        ErrorKind::AuthenticationLimitExceeded
    );
    assert_eq!(resend_calls.load(Ordering::SeqCst), 1);

    monotonic.store(150, Ordering::SeqCst);
    assert!(owner.remaining_lifetime().unwrap().is_zero());
    assert!(owner.expire_if_due().unwrap());
    assert!(!owner.is_active());
    assert_eq!(cancels.load(Ordering::SeqCst), 1);
}
