//! Non-shipped synthetic interactive-auth Engine harness.
//!
//! This binary performs no network I/O and encodes no vendor protocol. It is
//! compiled only for regression tests that exercise the inherited v2/v3 pipe.

use ec_compat::engine::auth_control::{
    AuthControlAction, AuthControlErrorCode, AuthControlSession, auth_error_response,
};
use ec_compat::engine::auth_transaction::{
    AuthGatewayRequestBudget, AuthProgress, AuthTransaction, AuthTransactionOwner, ChallengeKind,
    ChallengeView, DeliveryChannel, SecretBytes, TransactionId,
};
use ec_compat::engine::control::{ControlAction, ControlResponse, ControlSession};
use ec_compat::engine::control_mux::{InheritedControlFrameReader, InheritedControlRequest};
use ec_compat::engine::event::{EngineEvent, EngineEventEmitter, EngineState};
use ec_compat::{Error, ErrorKind, Result};
use std::io::Write;

struct SyntheticTransaction {
    id: TransactionId,
    view: ChallengeView,
    attempts_remaining: u32,
}

impl SyntheticTransaction {
    fn new() -> Result<Self> {
        let id = TransactionId::from_bytes([4; 16]);
        let attempts_remaining = 3;
        let view = synthetic_view(&id, 1, attempts_remaining)?;
        Ok(Self {
            id,
            view,
            attempts_remaining,
        })
    }

    fn update(&mut self, epoch: u32) -> Result<ChallengeView> {
        self.view = synthetic_view(&self.id, epoch, self.attempts_remaining)?;
        Ok(self.view.clone())
    }
}

impl AuthTransaction for SyntheticTransaction {
    type Session = ();

    fn public_challenge(&self) -> ChallengeView {
        self.view.clone()
    }

    fn respond(
        &mut self,
        response: SecretBytes,
        gateway_requests: &mut AuthGatewayRequestBudget<'_>,
    ) -> Result<AuthProgress<Self::Session, ChallengeView>> {
        gateway_requests.reserve_request()?;
        if response.as_bytes() == b"synthetic-accepted" {
            return Ok(AuthProgress::Authenticated(()));
        }
        self.attempts_remaining = self.attempts_remaining.saturating_sub(1);
        Ok(AuthProgress::ChallengeRequired(
            self.update(self.view.challenge_epoch())?,
        ))
    }

    fn resend(
        &mut self,
        gateway_requests: &mut AuthGatewayRequestBudget<'_>,
    ) -> Result<ChallengeView> {
        gateway_requests.reserve_request()?;
        self.update(self.view.challenge_epoch().saturating_add(1))
    }

    fn cancel(self) -> Result<()> {
        Ok(())
    }
}

fn synthetic_view(
    id: &TransactionId,
    epoch: u32,
    attempts_remaining: u32,
) -> Result<ChallengeView> {
    ChallengeView::new(id, epoch, ChallengeKind::Otp)?
        .with_delivery(DeliveryChannel::Unknown, Some("synthetic-fixture"))
        .map(|view| {
            view.with_resend(true, None)
                .with_attempts_remaining(Some(attempts_remaining))
        })
}

fn parse_generation() -> Result<u64> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    if args.len() != 2 || args[0] != "--generation" {
        return Err(Error::classified(
            ErrorKind::Configuration,
            "synthetic auth fixture arguments are invalid",
        ));
    }
    args[1]
        .parse::<u64>()
        .ok()
        .filter(|generation| *generation > 0)
        .ok_or_else(|| {
            Error::classified(
                ErrorKind::Configuration,
                "synthetic auth fixture generation is invalid",
            )
        })
}

fn run() -> Result<()> {
    let generation = parse_generation()?;
    let stdout = std::io::stdout();
    let mut output = EngineEventEmitter::new(stdout.lock());
    output.emit(&EngineEvent::hello())?;
    output.emit(&EngineEvent::StateChanged {
        state: EngineState::Authenticating,
        generation,
    })?;

    let stdin = std::io::stdin();
    let mut input = InheritedControlFrameReader::new(stdin.lock());
    let mut control = ControlSession::new();
    let mut auth = None;
    while let Some(request) = input.read_request()? {
        match request {
            InheritedControlRequest::V2(request) => {
                let exchange = control.handle(request);
                let negotiated = matches!(exchange.response, ControlResponse::Hello { .. });
                output.emit_control(&exchange.response)?;
                if negotiated && auth.is_none() {
                    let owner =
                        AuthTransactionOwner::new(generation, SyntheticTransaction::new()?)?;
                    let session = AuthControlSession::new(owner);
                    output.emit_auth_event(&session.initial_event()?)?;
                    auth = Some(session);
                }
                if matches!(
                    exchange.action,
                    Some(ControlAction::Shutdown { .. } | ControlAction::Close { .. })
                ) {
                    return Ok(());
                }
            }
            InheritedControlRequest::V3(request) => {
                let Some(session) = auth.as_mut() else {
                    output.emit_auth_control(&auth_error_response(
                        request.request_id(),
                        AuthControlErrorCode::TransactionClosed,
                    ))?;
                    continue;
                };
                let exchange = session.handle(request);
                output.emit_auth_control(&exchange.response)?;
                match exchange.action {
                    AuthControlAction::None => {}
                    AuthControlAction::Authenticated(()) => {
                        output.emit(&EngineEvent::StateChanged {
                            state: EngineState::Connected,
                            generation,
                        })?;
                        return Ok(());
                    }
                    AuthControlAction::Cancelled => return Ok(()),
                }
            }
        }
    }
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        let _ = writeln!(
            std::io::stderr(),
            "ec-auth-fixture: {}",
            error.kind().code()
        );
        std::process::exit(1);
    }
}
