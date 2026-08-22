//! Bounded credential input shared by production Engine and compatibility tools.
//!
//! This module owns only the local stdin shape. It has no gateway, probe, or
//! transport dependency, so production authentication never imports a
//! diagnostic workflow merely to parse its credential prefix.

use crate::{Error, ErrorKind, Result};
use std::io::Read;
use zeroize::Zeroizing;

pub const MAX_CREDENTIAL_BYTES: usize = 16 * 1024;

fn credential_error(message: impl Into<String>) -> Error {
    Error::classified(ErrorKind::Credentials, message)
}

pub fn read_credentials<R: Read>(mut stream: R) -> Result<(String, String)> {
    let mut payload = Zeroizing::new(Vec::new());
    stream
        .by_ref()
        .take((MAX_CREDENTIAL_BYTES + 1) as u64)
        .read_to_end(&mut payload)?;
    if payload.len() > MAX_CREDENTIAL_BYTES {
        return Err(credential_error("credential input exceeds the size limit"));
    }
    // Keep the complete stdin allocation zeroizing across success, oversize,
    // UTF-8, and shape failures. Callers separately zeroize the returned copies.
    let text = std::str::from_utf8(payload.as_slice())
        .map_err(|_| credential_error("credential input must be UTF-8"))?;
    let lines = text.lines().collect::<Vec<_>>();
    if lines.len() != 2 {
        return Err(credential_error(
            "credential input must contain exactly username and password lines",
        ));
    }
    if lines[0].is_empty()
        || lines[1].is_empty()
        || lines[0].contains('\0')
        || lines[1].contains('\0')
    {
        return Err(credential_error("credential input is empty or invalid"));
    }
    Ok((lines[0].to_owned(), lines[1].to_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credentials_require_exactly_two_bounded_lines() {
        let (username, password) =
            read_credentials("synthetic-user\nsynthetic-pass\n".as_bytes()).unwrap();
        assert_eq!(username, "synthetic-user");
        assert_eq!(password, "synthetic-pass");
        assert!(read_credentials("user\npass\nextra\n".as_bytes()).is_err());
        assert!(read_credentials(b"user\npass\0word\n".as_slice()).is_err());
        assert!(read_credentials(b"user\npass\xff\n".as_slice()).is_err());
        assert!(read_credentials(vec![b'x'; MAX_CREDENTIAL_BYTES + 1].as_slice()).is_err());
        assert_eq!(
            read_credentials("user\n".as_bytes()).unwrap_err().kind(),
            ErrorKind::Credentials
        );
    }
}
