//! Secret-bearing configuration for the loopback proxy frontend.
//!
//! Local proxy credentials enter through the same bounded stdin channel as the
//! gateway credentials. They are converted immediately to zeroizing, padded
//! verification material and are never exposed through command arguments,
//! events, or diagnostics.

use crate::probe::{MAX_CREDENTIAL_BYTES, read_credentials};
use crate::{Error, Result};
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use std::io::Read;
use subtle::{Choice, ConstantTimeEq};
use zeroize::Zeroizing;

pub const MAX_PROXY_CREDENTIAL_BYTES: usize = 255;
const MAX_BASIC_PLAINTEXT_BYTES: usize = MAX_PROXY_CREDENTIAL_BYTES * 2 + 1;
const MAX_BASIC_TOKEN_BYTES: usize = MAX_BASIC_PLAINTEXT_BYTES.div_ceil(3) * 4;
const MAX_AUTH_INPUT_BYTES: usize = MAX_CREDENTIAL_BYTES + (MAX_PROXY_CREDENTIAL_BYTES + 1) * 2;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProxyAuthenticationMode {
    None,
    Optional,
    Required,
}

pub struct EngineCredentials {
    pub gateway_username: Zeroizing<String>,
    pub gateway_password: Zeroizing<String>,
    pub proxy_authentication: ProxyAuthentication,
}

pub enum ProxyAuthentication {
    None,
    Optional(Box<ProxyCredentialVerifier>),
    Required(Box<ProxyCredentialVerifier>),
}

impl ProxyAuthentication {
    pub fn optional(username: &str, password: &str) -> Result<Self> {
        Ok(Self::Optional(Box::new(ProxyCredentialVerifier::new(
            username, password,
        )?)))
    }

    pub fn required(username: &str, password: &str) -> Result<Self> {
        Ok(Self::Required(Box::new(ProxyCredentialVerifier::new(
            username, password,
        )?)))
    }

    pub fn is_required(&self) -> bool {
        matches!(self, Self::Required(_))
    }

    pub fn is_optional(&self) -> bool {
        matches!(self, Self::Optional(_))
    }

    pub(crate) fn accepts_no_authentication(&self) -> bool {
        matches!(self, Self::None | Self::Optional(_))
    }

    pub(crate) fn accepts_rfc1929(&self) -> bool {
        matches!(self, Self::Optional(_) | Self::Required(_))
    }

    pub(crate) fn verify_rfc1929(&self, username: &[u8], password: &[u8]) -> bool {
        match self {
            Self::None => false,
            Self::Optional(verifier) | Self::Required(verifier) => {
                verifier.verify_rfc1929(username, password)
            }
        }
    }

    pub(crate) fn verify_basic_token(&self, token: &[u8]) -> bool {
        match self {
            Self::None => false,
            Self::Optional(verifier) | Self::Required(verifier) => {
                verifier.verify_basic_token(token)
            }
        }
    }
}

pub struct ProxyCredentialVerifier {
    username: Zeroizing<[u8; MAX_PROXY_CREDENTIAL_BYTES]>,
    username_length: u8,
    password: Zeroizing<[u8; MAX_PROXY_CREDENTIAL_BYTES]>,
    password_length: u8,
    basic_token: Zeroizing<[u8; MAX_BASIC_TOKEN_BYTES]>,
    basic_token_length: u16,
}

impl ProxyCredentialVerifier {
    fn new(username: &str, password: &str) -> Result<Self> {
        validate_proxy_credential(username, true)?;
        validate_proxy_credential(password, false)?;

        let mut basic_plaintext =
            Zeroizing::new(Vec::with_capacity(username.len() + password.len() + 1));
        basic_plaintext.extend_from_slice(username.as_bytes());
        basic_plaintext.push(b':');
        basic_plaintext.extend_from_slice(password.as_bytes());
        let basic_encoded = Zeroizing::new(BASE64_STANDARD.encode(basic_plaintext.as_slice()));

        Ok(Self {
            username: padded_secret(username.as_bytes()),
            username_length: username.len() as u8,
            password: padded_secret(password.as_bytes()),
            password_length: password.len() as u8,
            basic_token: padded_secret(basic_encoded.as_bytes()),
            basic_token_length: basic_encoded.len() as u16,
        })
    }

    fn verify_rfc1929(&self, username: &[u8], password: &[u8]) -> bool {
        let username_matches =
            constant_time_match(&self.username, usize::from(self.username_length), username);
        // Always compare both fields so a username mismatch does not create a
        // separate fast path from a password mismatch.
        let password_matches =
            constant_time_match(&self.password, usize::from(self.password_length), password);
        bool::from(username_matches & password_matches)
    }

    fn verify_basic_token(&self, token: &[u8]) -> bool {
        bool::from(constant_time_match(
            &self.basic_token,
            usize::from(self.basic_token_length),
            token,
        ))
    }
}

fn validate_proxy_credential(value: &str, is_username: bool) -> Result<()> {
    if value.is_empty()
        || value.len() > MAX_PROXY_CREDENTIAL_BYTES
        || value.chars().any(char::is_control)
        // HTTP Basic uses the first colon as the user/password delimiter.
        // Rejecting it in the username prevents two different credential pairs
        // from having the same wire representation.
        || (is_username && value.contains(':'))
    {
        return Err(Error("local proxy credentials are invalid".into()));
    }
    Ok(())
}

fn padded_secret<const N: usize>(value: &[u8]) -> Zeroizing<[u8; N]> {
    let mut padded = Zeroizing::new([0_u8; N]);
    padded[..value.len()].copy_from_slice(value);
    padded
}

fn constant_time_match<const N: usize>(
    expected: &[u8; N],
    expected_length: usize,
    candidate: &[u8],
) -> Choice {
    let mut padded_candidate = Zeroizing::new([0_u8; N]);
    let copied = candidate.len().min(N);
    padded_candidate[..copied].copy_from_slice(&candidate[..copied]);
    let candidate_length = u16::try_from(candidate.len()).unwrap_or(u16::MAX);
    let expected_length = expected_length as u16;
    let within_bound = Choice::from(u8::from(candidate.len() <= N));
    within_bound
        & expected_length.ct_eq(&candidate_length)
        & expected.as_slice().ct_eq(padded_candidate.as_slice())
}

pub fn read_engine_credentials<R: Read>(
    mut stream: R,
    proxy_authentication_mode: ProxyAuthenticationMode,
) -> Result<EngineCredentials> {
    if proxy_authentication_mode == ProxyAuthenticationMode::None {
        let (username, password) = read_credentials(stream)?;
        return Ok(EngineCredentials {
            gateway_username: Zeroizing::new(username),
            gateway_password: Zeroizing::new(password),
            proxy_authentication: ProxyAuthentication::None,
        });
    }

    let mut payload = Zeroizing::new(Vec::new());
    stream
        .by_ref()
        .take((MAX_AUTH_INPUT_BYTES + 1) as u64)
        .read_to_end(&mut payload)?;
    if payload.len() > MAX_AUTH_INPUT_BYTES {
        return Err(Error("credential input exceeds the size limit".into()));
    }
    let text = std::str::from_utf8(payload.as_slice())
        .map_err(|_| Error("credential input must be UTF-8".into()))?;
    let lines = text.lines().collect::<Vec<_>>();
    if lines.len() != 4 {
        return Err(Error(
            "proxy-auth credential input must contain exactly four lines".into(),
        ));
    }
    let gateway_encoded_bytes = lines[0]
        .len()
        .checked_add(lines[1].len())
        .and_then(|length| length.checked_add(2))
        .ok_or_else(|| Error("credential input exceeds the size limit".into()))?;
    if gateway_encoded_bytes > MAX_CREDENTIAL_BYTES
        || lines[0].is_empty()
        || lines[1].is_empty()
        || lines[0].contains('\0')
        || lines[1].contains('\0')
    {
        return Err(Error("gateway credential input is empty or invalid".into()));
    }

    let proxy_authentication = match proxy_authentication_mode {
        ProxyAuthenticationMode::None => unreachable!("handled above"),
        ProxyAuthenticationMode::Optional => ProxyAuthentication::optional(lines[2], lines[3])?,
        ProxyAuthenticationMode::Required => ProxyAuthentication::required(lines[2], lines[3])?,
    };
    Ok(EngineCredentials {
        gateway_username: Zeroizing::new(lines[0].to_owned()),
        gateway_password: Zeroizing::new(lines[1].to_owned()),
        proxy_authentication,
    })
}

/// Read exactly the credential prefix used by Engine Control API v2.
///
/// Unlike [`read_engine_credentials`], this function never reads past the
/// second or fourth LF. The caller can therefore retain the same inherited
/// stdin stream for bounded control frames without buffering control bytes in
/// a secret-bearing allocation. The old EOF-delimited contract remains the
/// default and is intentionally not changed by this opt-in helper.
pub fn read_engine_credentials_prefix<R: Read>(
    mut stream: R,
    proxy_authentication_mode: ProxyAuthenticationMode,
) -> Result<EngineCredentials> {
    let expected_lines = match proxy_authentication_mode {
        ProxyAuthenticationMode::None => 2,
        ProxyAuthenticationMode::Optional | ProxyAuthenticationMode::Required => 4,
    };
    let maximum_bytes = match proxy_authentication_mode {
        ProxyAuthenticationMode::None => MAX_CREDENTIAL_BYTES,
        ProxyAuthenticationMode::Optional | ProxyAuthenticationMode::Required => {
            MAX_AUTH_INPUT_BYTES
        }
    };
    let mut payload = Zeroizing::new(Vec::new());
    let mut complete_lines = 0;
    while complete_lines < expected_lines {
        if payload.len() >= maximum_bytes {
            return Err(Error("credential input exceeds the size limit".into()));
        }
        let mut byte = [0_u8; 1];
        let count = stream.read(&mut byte)?;
        if count == 0 {
            return Err(Error(
                "credential input ended before all lines arrived".into(),
            ));
        }
        payload.push(byte[0]);
        if byte[0] == b'\n' {
            complete_lines += 1;
        }
    }
    parse_engine_credential_payload(payload.as_slice(), proxy_authentication_mode)
}

fn parse_engine_credential_payload(
    payload: &[u8],
    proxy_authentication_mode: ProxyAuthenticationMode,
) -> Result<EngineCredentials> {
    let text =
        std::str::from_utf8(payload).map_err(|_| Error("credential input must be UTF-8".into()))?;
    let lines = text.lines().collect::<Vec<_>>();
    let expected_lines = match proxy_authentication_mode {
        ProxyAuthenticationMode::None => 2,
        ProxyAuthenticationMode::Optional | ProxyAuthenticationMode::Required => 4,
    };
    if lines.len() != expected_lines {
        return Err(Error(format!(
            "credential input must contain exactly {expected_lines} lines"
        )));
    }
    let gateway_encoded_bytes = lines[0]
        .len()
        .checked_add(lines[1].len())
        .and_then(|length| length.checked_add(2))
        .ok_or_else(|| Error("credential input exceeds the size limit".into()))?;
    if gateway_encoded_bytes > MAX_CREDENTIAL_BYTES
        || lines[0].is_empty()
        || lines[1].is_empty()
        || lines[0].contains('\0')
        || lines[1].contains('\0')
    {
        return Err(Error("gateway credential input is empty or invalid".into()));
    }
    let proxy_authentication = match proxy_authentication_mode {
        ProxyAuthenticationMode::None => ProxyAuthentication::None,
        ProxyAuthenticationMode::Optional => ProxyAuthentication::optional(lines[2], lines[3])?,
        ProxyAuthenticationMode::Required => ProxyAuthentication::required(lines[2], lines[3])?,
    };
    Ok(EngineCredentials {
        gateway_username: Zeroizing::new(lines[0].to_owned()),
        gateway_password: Zeroizing::new(lines[1].to_owned()),
        proxy_authentication,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_input_remains_the_two_line_contract() {
        let credentials = read_engine_credentials(
            "gateway-user\ngateway-pass\n".as_bytes(),
            ProxyAuthenticationMode::None,
        )
        .unwrap();
        assert_eq!(credentials.gateway_username.as_str(), "gateway-user");
        assert_eq!(credentials.gateway_password.as_str(), "gateway-pass");
        assert!(!credentials.proxy_authentication.is_required());
    }

    #[test]
    fn strict_input_requires_four_lines_and_builds_both_verifiers() {
        let credentials = read_engine_credentials(
            "gateway-user\ngateway-pass\nproxy-user\nproxy-pass\n".as_bytes(),
            ProxyAuthenticationMode::Required,
        )
        .unwrap();
        assert!(credentials.proxy_authentication.is_required());
        assert!(
            credentials
                .proxy_authentication
                .verify_rfc1929(b"proxy-user", b"proxy-pass")
        );
        let token = BASE64_STANDARD.encode(b"proxy-user:proxy-pass");
        assert!(
            credentials
                .proxy_authentication
                .verify_basic_token(token.as_bytes())
        );
        assert!(
            read_engine_credentials(
                "gateway-user\ngateway-pass\n".as_bytes(),
                ProxyAuthenticationMode::Required,
            )
            .is_err()
        );
        assert!(
            read_engine_credentials(
                "gateway-user\ngateway-pass\nproxy-user\nproxy-pass\nextra\n".as_bytes(),
                ProxyAuthenticationMode::Required,
            )
            .is_err()
        );
    }

    #[test]
    fn optional_input_uses_the_same_bounded_four_line_contract() {
        let credentials = read_engine_credentials(
            "gateway-user\ngateway-pass\nproxy-user\nproxy-pass\n".as_bytes(),
            ProxyAuthenticationMode::Optional,
        )
        .unwrap();
        assert!(credentials.proxy_authentication.is_optional());
        assert!(!credentials.proxy_authentication.is_required());
        assert!(credentials.proxy_authentication.accepts_no_authentication());
        assert!(credentials.proxy_authentication.accepts_rfc1929());
        assert!(
            credentials
                .proxy_authentication
                .verify_rfc1929(b"proxy-user", b"proxy-pass")
        );
    }

    #[test]
    fn control_mode_reads_only_the_credential_prefix() {
        let mut input =
            "gateway-user\ngateway-pass\n{\"type\":\"hello\",\"requestId\":1,\"versions\":[2]}\n"
                .as_bytes();
        let credentials =
            read_engine_credentials_prefix(&mut input, ProxyAuthenticationMode::None).unwrap();
        assert_eq!(credentials.gateway_username.as_str(), "gateway-user");
        assert_eq!(credentials.gateway_password.as_str(), "gateway-pass");
        let mut remainder = String::new();
        input.read_to_string(&mut remainder).unwrap();
        assert_eq!(
            remainder,
            "{\"type\":\"hello\",\"requestId\":1,\"versions\":[2]}\n"
        );

        let mut strict = b"u\np\nproxy-user\nproxy-pass\ncontrol\n".as_slice();
        let credentials =
            read_engine_credentials_prefix(&mut strict, ProxyAuthenticationMode::Required).unwrap();
        assert!(credentials.proxy_authentication.is_required());
        let mut remainder = String::new();
        strict.read_to_string(&mut remainder).unwrap();
        assert_eq!(remainder, "control\n");
    }

    #[test]
    fn control_mode_credentials_remain_bounded_and_complete() {
        assert!(
            read_engine_credentials_prefix(
                b"gateway-user\n".as_slice(),
                ProxyAuthenticationMode::None
            )
            .is_err()
        );
        let oversized = format!("{}\np\n", "u".repeat(MAX_CREDENTIAL_BYTES));
        assert!(
            read_engine_credentials_prefix(oversized.as_bytes(), ProxyAuthenticationMode::None)
                .is_err()
        );
    }

    #[test]
    fn verification_checks_lengths_username_and_password() {
        let authentication = ProxyAuthentication::required("proxy-user", "proxy-pass").unwrap();
        assert!(!authentication.verify_rfc1929(b"proxy-user", b"wrong"));
        assert!(!authentication.verify_rfc1929(b"wrong", b"proxy-pass"));
        assert!(!authentication.verify_rfc1929(b"proxy-user\0", b"proxy-pass"));
        assert!(!authentication.verify_basic_token(b"not-the-token"));
    }

    #[test]
    fn local_credentials_are_byte_bounded_and_reject_controls_and_ambiguous_users() {
        assert!(ProxyAuthentication::required("u", "p").is_ok());
        assert!(ProxyAuthentication::required("", "p").is_err());
        assert!(ProxyAuthentication::required("u", "").is_err());
        assert!(ProxyAuthentication::required("user:name", "p").is_err());
        assert!(ProxyAuthentication::required("user", "pass\tword").is_err());
        assert!(
            ProxyAuthentication::required(&"u".repeat(MAX_PROXY_CREDENTIAL_BYTES), "p").is_ok()
        );
        assert!(
            ProxyAuthentication::required(
                &"u".repeat(MAX_PROXY_CREDENTIAL_BYTES),
                &"p".repeat(MAX_PROXY_CREDENTIAL_BYTES),
            )
            .is_ok()
        );
        assert!(
            ProxyAuthentication::required(&"u".repeat(MAX_PROXY_CREDENTIAL_BYTES + 1), "p")
                .is_err()
        );
        // Bounds are bytes, not Unicode scalar counts.
        assert!(ProxyAuthentication::required(&"界".repeat(86), "p").is_err());
    }
}
