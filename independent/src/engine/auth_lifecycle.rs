//! Cancellable orchestration boundary for blocking connection stages.
//!
//! The currently verified password and Modern L3 setup paths use synchronous
//! network operations. Running them on Tokio's blocking pool keeps Engine
//! shutdown and private control input responsive without changing the observed
//! gateway protocol. The cancellation signal is checked between bounded
//! operations; callers remain responsible for cleaning up a session-bearing
//! result that completes after cancellation.

use crate::{Error, ErrorKind, Result};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Clone, Default)]
pub struct OperationCancellation {
    cancelled: Arc<AtomicBool>,
}

impl OperationCancellation {
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }
}

/// Backward-compatible name for the password-provider cancellation contract.
pub type AuthenticationCancellation = OperationCancellation;

/// A blocking connection-stage operation that remains owned by the async
/// process coordinator.
///
/// Cancelling is cooperative: the operation must inspect the supplied token
/// between bounded network operations. The process coordinator drains the
/// handle for a bounded interval; if an in-flight syscall does not return, it
/// terminates the Engine with cleanup-unconfirmed so no late result can be
/// promoted into another generation.
#[must_use = "a blocking connection operation must be cancelled or awaited"]
pub struct BlockingOperation<S, E> {
    cancellation: OperationCancellation,
    task: tokio::task::JoinHandle<std::result::Result<S, E>>,
}

impl<S, E> BlockingOperation<S, E>
where
    S: Send + 'static,
    E: Send + 'static,
{
    pub fn spawn<F>(operation: F) -> Self
    where
        F: FnOnce(OperationCancellation) -> std::result::Result<S, E> + Send + 'static,
    {
        let cancellation = OperationCancellation::default();
        let worker_cancellation = cancellation.clone();
        let task = tokio::task::spawn_blocking(move || operation(worker_cancellation));
        Self { cancellation, task }
    }

    pub fn cancel(&self) {
        self.cancellation.cancel();
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancellation.is_cancelled()
    }

    pub async fn wait(&mut self) -> Result<std::result::Result<S, E>> {
        (&mut self.task).await.map_err(|_| {
            Error::classified(
                ErrorKind::Lifecycle,
                "connection operation worker terminated unexpectedly",
            )
        })
    }
}

/// Backward-compatible name for the existing password-provider call sites.
/// New connection stages should use [`BlockingOperation`] directly.
pub type BlockingAuthentication<S, E> = BlockingOperation<S, E>;

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    #[tokio::test]
    async fn cancellation_reaches_a_blocking_provider_without_detaching_it() {
        let (started, started_rx) = mpsc::channel();
        let mut authentication = BlockingOperation::spawn(move |cancellation| {
            started.send(()).unwrap();
            while !cancellation.is_cancelled() {
                std::thread::yield_now();
            }
            Ok::<_, ()>("cancelled")
        });
        started_rx.recv_timeout(Duration::from_secs(1)).unwrap();
        authentication.cancel();
        assert!(authentication.is_cancelled());
        assert_eq!(authentication.wait().await.unwrap(), Ok("cancelled"));
    }

    #[tokio::test]
    async fn worker_failure_is_a_stable_lifecycle_error() {
        let mut authentication = BlockingOperation::<(), ()>::spawn(|_| panic!("fixture"));
        let error = authentication.wait().await.unwrap_err();
        assert_eq!(error.kind(), ErrorKind::Lifecycle);
        assert!(!error.to_string().contains("fixture"));
    }

    #[tokio::test]
    async fn cancellation_does_not_discard_a_late_result() {
        let (release, release_rx) = mpsc::channel();
        let mut operation = BlockingOperation::spawn(move |cancellation| {
            while !cancellation.is_cancelled() {
                std::thread::yield_now();
            }
            release_rx.recv_timeout(Duration::from_secs(1)).unwrap();
            Ok::<_, ()>("late-session")
        });
        operation.cancel();
        release.send(()).unwrap();
        assert_eq!(operation.wait().await.unwrap(), Ok("late-session"));
    }
}
