//! Cancellable orchestration boundary for blocking gateway authentication.
//!
//! The currently verified password provider uses synchronous HTTPS. Running it
//! on Tokio's blocking pool keeps Engine shutdown and private control input
//! responsive without changing the observed gateway protocol. The cancellation
//! signal is checked by the provider between bounded requests; callers remain
//! responsible for cleaning up a session that completes after cancellation.

use crate::{Error, ErrorKind, Result};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Clone, Default)]
pub struct AuthenticationCancellation {
    cancelled: Arc<AtomicBool>,
}

impl AuthenticationCancellation {
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }
}

pub struct BlockingAuthentication<S, E> {
    cancellation: AuthenticationCancellation,
    task: tokio::task::JoinHandle<std::result::Result<S, E>>,
}

impl<S, E> BlockingAuthentication<S, E>
where
    S: Send + 'static,
    E: Send + 'static,
{
    pub fn spawn<F>(authenticate: F) -> Self
    where
        F: FnOnce(AuthenticationCancellation) -> std::result::Result<S, E> + Send + 'static,
    {
        let cancellation = AuthenticationCancellation::default();
        let worker_cancellation = cancellation.clone();
        let task = tokio::task::spawn_blocking(move || authenticate(worker_cancellation));
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
                "authentication worker terminated unexpectedly",
            )
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    #[tokio::test]
    async fn cancellation_reaches_a_blocking_provider_without_detaching_it() {
        let (started, started_rx) = mpsc::channel();
        let mut authentication = BlockingAuthentication::spawn(move |cancellation| {
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
        let mut authentication = BlockingAuthentication::<(), ()>::spawn(|_| panic!("fixture"));
        let error = authentication.wait().await.unwrap_err();
        assert_eq!(error.kind(), ErrorKind::Lifecycle);
        assert!(!error.to_string().contains("fixture"));
    }
}
