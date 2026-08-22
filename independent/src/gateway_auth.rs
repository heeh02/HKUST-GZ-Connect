//! Secret-bearing artifacts of a completed Gateway authentication.
//!
//! This module is deliberately transport-neutral. A transport adapter may
//! consume the authenticated session identifier, but authentication does not
//! import or construct a Modern token/Data Plane object.

use crate::xml::{first_descendant_text, parse_xml};
use crate::{Error, ErrorKind, Result};
use std::fmt::{Debug, Formatter};
use zeroize::Zeroize;

pub const AUTHENTICATED_SESSION_ID_LEN: usize = 16;

pub struct AuthenticatedSessionId([u8; AUTHENTICATED_SESSION_ID_LEN]);

impl AuthenticatedSessionId {
    pub fn from_login_xml(data: &[u8]) -> Result<Self> {
        let document = parse_xml(data, "password login")
            .map_err(|error| error.with_kind_if_unclassified(ErrorKind::Authentication))?;
        let value = first_descendant_text(document.root_element(), "TwfID");
        Self::from_bytes(value.as_bytes())
    }

    pub fn from_bytes(value: &[u8]) -> Result<Self> {
        if value.len() != AUTHENTICATED_SESSION_ID_LEN
            || !value.iter().all(|byte| byte.is_ascii_graphic())
        {
            return Err(Error::classified(
                ErrorKind::Authentication,
                "authenticated session identifier must contain exactly 16 printable bytes",
            ));
        }
        Ok(Self(
            value.try_into().expect("validated session identifier"),
        ))
    }

    pub(crate) fn as_bytes(&self) -> &[u8; AUTHENTICATED_SESSION_ID_LEN] {
        &self.0
    }
}

impl Debug for AuthenticatedSessionId {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("AuthenticatedSessionId(<redacted>)")
    }
}

impl Drop for AuthenticatedSessionId {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn authenticated_identifier_is_bounded_typed_and_redacted() {
        let id = AuthenticatedSessionId::from_bytes(b"0123456789abcdef").unwrap();
        assert_eq!(format!("{id:?}"), "AuthenticatedSessionId(<redacted>)");
        let error = AuthenticatedSessionId::from_bytes(b"short").unwrap_err();
        assert_eq!(error.kind(), ErrorKind::Authentication);
        assert!(!error.to_string().contains("short"));
    }
}
