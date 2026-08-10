//! Authenticated ordinary HTTP/WebSocket forwarding for the strict loopback
//! proxy contract.
//!
//! The CONNECT tunnel and this forwarder share one listener, but ordinary HTTP
//! needs a much narrower boundary: only an authenticated absolute-form request
//! is accepted, proxy credentials and hop-by-hop headers are removed, and the
//! origin receives one rebuilt origin-form request.  Normal HTTP connections
//! deliberately handle one request and close, so a pipelined second request can
//! never bypass parsing or leak a `Proxy-Authorization` header. WebSocket
//! upgrades switch to bounded-memory bidirectional streaming after the rebuilt
//! handshake has been written.

use crate::engine::socks_auth::ProxyAuthentication;
use crate::{Error, Result};
use std::fmt::{Debug, Formatter};
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use url::{Host, Url};
use zeroize::Zeroizing;

pub(super) const MAX_HTTP_HEADER_BYTES: usize = 16 * 1024;
const MAX_HTTP_HEADER_LINES: usize = 64;
const MAX_REWRITTEN_HEADER_BYTES: usize = MAX_HTTP_HEADER_BYTES + 512;
const MAX_HTTP_REQUEST_BODY_BYTES: u64 = 64 * 1024 * 1024;
const MAX_HTTP_CHUNKS: usize = 262_144;
const MAX_HTTP_CHUNK_LINE_BYTES: usize = 1_024;
const HTTP_STREAM_BUFFER_BYTES: usize = 16 * 1024;
const HTTP_REQUEST_BODY_TIMEOUT: Duration = Duration::from_secs(300);
const HTTP_RESPONSE_IDLE_TIMEOUT: Duration = Duration::from_secs(300);

pub(super) const HTTP_BAD_REQUEST: &[u8] =
    b"HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n";
pub(super) const HTTP_AUTHENTICATION_REQUIRED: &[u8] = b"HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm=\"HKUSTGZ Connect\"\r\nConnection: close\r\nContent-Length: 0\r\n\r\n";
pub(super) const HTTP_HEADER_TOO_LARGE: &[u8] = b"HTTP/1.1 431 Request Header Fields Too Large\r\nConnection: close\r\nContent-Length: 0\r\n\r\n";
pub(super) const HTTP_BAD_GATEWAY: &[u8] =
    b"HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n";
const HTTP_CONTINUE: &[u8] = b"HTTP/1.1 100 Continue\r\n\r\n";

pub(super) enum ParsedHttpProxyRequest {
    Connect { authority: Zeroizing<String> },
    Forward(HttpForwardRequest),
}

impl Debug for ParsedHttpProxyRequest {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Connect { .. } => formatter
                .debug_struct("Connect")
                .field("authority", &"<redacted>")
                .finish(),
            Self::Forward(request) => Debug::fmt(request, formatter),
        }
    }
}

#[derive(Eq, PartialEq)]
pub(super) struct HttpForwardRequest {
    host: Zeroizing<String>,
    port: u16,
    rewritten_head: Zeroizing<Vec<u8>>,
    body: HttpBody,
    expect_continue: bool,
    upgrade: bool,
}

impl HttpForwardRequest {
    pub(super) fn host(&self) -> &str {
        self.host.as_str()
    }

    pub(super) const fn port(&self) -> u16 {
        self.port
    }
}

impl Debug for HttpForwardRequest {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("HttpForwardRequest")
            .field("host", &"<redacted>")
            .field("port", &"<redacted>")
            .field("headers", &"<redacted>")
            .field("body", &self.body)
            .field("expect_continue", &self.expect_continue)
            .field("upgrade", &self.upgrade)
            .finish()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum HttpBody {
    None,
    ContentLength(u64),
    Chunked,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum HeaderError {
    AuthenticationRequired,
    Malformed,
}

/// Reads exactly one bounded HTTP header and authenticates it before exposing
/// any method- or target-specific result.
pub(super) async fn read_authenticated_request<S>(
    client: &mut S,
    first_byte: u8,
    authentication: &ProxyAuthentication,
) -> Result<ParsedHttpProxyRequest>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let mut header = Zeroizing::new(Vec::with_capacity(512));
    header.push(first_byte);
    while !header.ends_with(b"\r\n\r\n") {
        if header.len() >= MAX_HTTP_HEADER_BYTES {
            let _ = client.write_all(HTTP_HEADER_TOO_LARGE).await;
            return Err(Error("HTTP proxy request headers are too large".into()));
        }
        header.push(client.read_u8().await?);
    }

    match parse_authenticated_header(&header, authentication) {
        Ok(request) => Ok(request),
        Err(HeaderError::AuthenticationRequired) => {
            let _ = client.write_all(HTTP_AUTHENTICATION_REQUIRED).await;
            Err(Error("HTTP proxy authentication failed".into()))
        }
        Err(HeaderError::Malformed) => {
            let _ = client.write_all(HTTP_BAD_REQUEST).await;
            Err(Error(
                "HTTP proxy request is malformed or unsupported".into(),
            ))
        }
    }
}

fn parse_authenticated_header(
    header: &[u8],
    authentication: &ProxyAuthentication,
) -> std::result::Result<ParsedHttpProxyRequest, HeaderError> {
    if !header.ends_with(b"\r\n\r\n") || header.len() > MAX_HTTP_HEADER_BYTES {
        return Err(HeaderError::Malformed);
    }

    // Authenticate from a deliberately minimal raw scan before parsing the
    // method, target, or other header fields. This keeps missing, malformed,
    // duplicate, and incorrect credentials on one 407 path even when the
    // unauthenticated request contains syntax the forwarder would later reject.
    let (authorization_seen, authorization_shape_valid, basic_token) =
        scan_proxy_authorization(header);
    let credentials_match = authentication.verify_basic_token(basic_token);
    if !authorization_seen || !authorization_shape_valid || !credentials_match {
        return Err(HeaderError::AuthenticationRequired);
    }

    if header.iter().any(|byte| !byte.is_ascii() || *byte == 0x7f) {
        return Err(HeaderError::Malformed);
    }
    let text = std::str::from_utf8(header).map_err(|_| HeaderError::Malformed)?;
    let text = text
        .strip_suffix("\r\n\r\n")
        .ok_or(HeaderError::Malformed)?;
    let mut lines = text.split("\r\n");
    let request_line = lines.next().ok_or(HeaderError::Malformed)?;
    let mut headers = Vec::new();

    for line in lines {
        if headers.len() >= MAX_HTTP_HEADER_LINES || line.starts_with([' ', '\t']) {
            return Err(HeaderError::Malformed);
        }
        let (name, value) = line.split_once(':').ok_or(HeaderError::Malformed)?;
        if name.is_empty() || !name.bytes().all(is_header_name_byte) {
            return Err(HeaderError::Malformed);
        }
        let value = value.trim_matches([' ', '\t']);
        if value
            .bytes()
            .any(|byte| byte != b'\t' && !(b' '..=b'~').contains(&byte))
        {
            // In particular, reject bare CR/LF instead of copying it into the
            // rebuilt header and creating a header-injection boundary.
            return Err(HeaderError::Malformed);
        }
        headers.push((name, value));
    }

    if request_line
        .bytes()
        .any(|byte| byte != b' ' && !byte.is_ascii_graphic())
    {
        return Err(HeaderError::Malformed);
    }
    let mut request_parts = request_line.split(' ');
    let method = request_parts.next().ok_or(HeaderError::Malformed)?;
    let target = request_parts.next().ok_or(HeaderError::Malformed)?;
    let version = request_parts.next().ok_or(HeaderError::Malformed)?;
    if method.is_empty()
        || target.is_empty()
        || version.is_empty()
        || request_parts.next().is_some()
        || !method.bytes().all(is_method_byte)
        || !matches!(version, "HTTP/1.0" | "HTTP/1.1")
    {
        return Err(HeaderError::Malformed);
    }
    if method == "CONNECT" {
        if target.is_empty() {
            return Err(HeaderError::Malformed);
        }
        return Ok(ParsedHttpProxyRequest::Connect {
            authority: Zeroizing::new(target.to_owned()),
        });
    }

    parse_forward_request(method, target, version, &headers).map(ParsedHttpProxyRequest::Forward)
}

/// Extracts only the Basic credential needed for the authentication decision.
/// It intentionally does not validate unrelated syntax; a caller that has not
/// authenticated must not learn whether its requested method or headers would
/// otherwise be accepted.
fn scan_proxy_authorization(header: &[u8]) -> (bool, bool, &[u8]) {
    let mut lines = header.split(|byte| *byte == b'\n');
    let _ = lines.next();
    let mut seen = false;
    let mut shape_valid = false;
    let mut token = &[][..];

    for raw_line in lines {
        let line = raw_line.strip_suffix(b"\r").unwrap_or(raw_line);
        let Some(colon) = line.iter().position(|byte| *byte == b':') else {
            continue;
        };
        if !line[..colon].eq_ignore_ascii_case(b"proxy-authorization") {
            continue;
        }
        if seen {
            shape_valid = false;
            token = &[];
            continue;
        }
        seen = true;
        let value = trim_optional_whitespace(&line[colon + 1..]);
        let mut parts = value
            .split(|byte| byte.is_ascii_whitespace())
            .filter(|part| !part.is_empty());
        let scheme = parts.next().unwrap_or_default();
        let candidate = parts.next().unwrap_or_default();
        shape_valid = scheme.eq_ignore_ascii_case(b"basic")
            && !candidate.is_empty()
            && parts.next().is_none();
        if shape_valid {
            token = candidate;
        }
    }
    (seen, shape_valid, token)
}

fn trim_optional_whitespace(mut value: &[u8]) -> &[u8] {
    while value
        .first()
        .is_some_and(|byte| matches!(byte, b' ' | b'\t'))
    {
        value = &value[1..];
    }
    while value
        .last()
        .is_some_and(|byte| matches!(byte, b' ' | b'\t'))
    {
        value = &value[..value.len() - 1];
    }
    value
}

fn parse_forward_request(
    method: &str,
    target: &str,
    version: &str,
    headers: &[(&str, &str)],
) -> std::result::Result<HttpForwardRequest, HeaderError> {
    let parsed = Url::parse(target).map_err(|_| HeaderError::Malformed)?;
    let is_websocket = parsed.scheme() == "ws";
    if !matches!(parsed.scheme(), "http" | "ws")
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.fragment().is_some()
    {
        return Err(HeaderError::Malformed);
    }
    let host = match parsed.host().ok_or(HeaderError::Malformed)? {
        Host::Domain(host) => host.to_owned(),
        Host::Ipv4(address) => address.to_string(),
        Host::Ipv6(_) => return Err(HeaderError::Malformed),
    };
    let explicit_port = parsed.port();
    let port = explicit_port.unwrap_or(80);
    if port == 0 {
        return Err(HeaderError::Malformed);
    }
    let mut origin_form = Zeroizing::new(parsed.path().to_owned());
    if origin_form.is_empty() {
        origin_form.push('/');
    }
    if let Some(query) = parsed.query() {
        origin_form.push('?');
        origin_form.push_str(query);
    }
    // Consume the URL's normalized backing allocation into zeroizing storage;
    // the absolute target may contain internal paths or query values.
    let _normalized_target = Zeroizing::new(String::from(parsed));

    let mut content_length = None;
    let mut transfer_encoding = None;
    let mut expect_continue = false;
    let mut expect_seen = false;
    let mut upgrade_value = None;
    let mut connection_upgrade = false;
    let mut connection_tokens = Vec::new();
    for (name, value) in headers {
        if name.eq_ignore_ascii_case("content-length") {
            if content_length.is_some()
                || value.is_empty()
                || !value.bytes().all(|byte| byte.is_ascii_digit())
            {
                return Err(HeaderError::Malformed);
            }
            let length = value
                .parse::<u64>()
                .ok()
                .filter(|length| *length <= MAX_HTTP_REQUEST_BODY_BYTES)
                .ok_or(HeaderError::Malformed)?;
            content_length = Some(length);
        } else if name.eq_ignore_ascii_case("transfer-encoding") {
            if transfer_encoding.is_some()
                || version != "HTTP/1.1"
                || !value.trim().eq_ignore_ascii_case("chunked")
            {
                return Err(HeaderError::Malformed);
            }
            transfer_encoding = Some(HttpBody::Chunked);
        } else if name.eq_ignore_ascii_case("expect") {
            if expect_seen
                || version != "HTTP/1.1"
                || !value.trim().eq_ignore_ascii_case("100-continue")
            {
                return Err(HeaderError::Malformed);
            }
            expect_seen = true;
            expect_continue = true;
        } else if name.eq_ignore_ascii_case("upgrade") {
            if upgrade_value.is_some() || value.is_empty() {
                return Err(HeaderError::Malformed);
            }
            upgrade_value = Some(*value);
        } else if name.eq_ignore_ascii_case("connection") {
            for token in value.split(',').map(str::trim) {
                if token.is_empty() || !token.bytes().all(is_header_name_byte) {
                    return Err(HeaderError::Malformed);
                }
                connection_upgrade |= token.eq_ignore_ascii_case("upgrade");
                connection_tokens.push(token);
            }
        }
    }
    if content_length.is_some() && transfer_encoding.is_some() {
        return Err(HeaderError::Malformed);
    }
    let body = transfer_encoding.unwrap_or_else(|| {
        content_length
            .map(HttpBody::ContentLength)
            .unwrap_or(HttpBody::None)
    });
    let upgrade = upgrade_value.is_some() && connection_upgrade;
    if upgrade_value.is_some() != connection_upgrade
        || (is_websocket && !upgrade)
        || (upgrade && version != "HTTP/1.1")
        || (upgrade && (body != HttpBody::None || expect_continue))
        || (expect_continue && body == HttpBody::None)
    {
        return Err(HeaderError::Malformed);
    }

    let mut rewritten = Zeroizing::new(Vec::with_capacity(header_size_hint(headers)));
    append(&mut rewritten, method);
    rewritten.push(b' ');
    rewritten.extend_from_slice(origin_form.as_bytes());
    rewritten.push(b' ');
    append(&mut rewritten, version);
    rewritten.extend_from_slice(b"\r\nHost: ");
    append(&mut rewritten, &host);
    if let Some(port) = explicit_port {
        rewritten.push(b':');
        append(&mut rewritten, &port.to_string());
    }
    rewritten.extend_from_slice(b"\r\n");

    for (name, value) in headers {
        if is_removed_header(name)
            || connection_tokens
                .iter()
                .any(|token| name.eq_ignore_ascii_case(token))
        {
            continue;
        }
        append(&mut rewritten, name);
        rewritten.extend_from_slice(b": ");
        append(&mut rewritten, value);
        rewritten.extend_from_slice(b"\r\n");
    }
    match body {
        HttpBody::None => {}
        HttpBody::ContentLength(length) => {
            rewritten.extend_from_slice(b"Content-Length: ");
            append(&mut rewritten, &length.to_string());
            rewritten.extend_from_slice(b"\r\n");
        }
        HttpBody::Chunked => rewritten.extend_from_slice(b"Transfer-Encoding: chunked\r\n"),
    }
    if upgrade {
        rewritten.extend_from_slice(b"Connection: Upgrade\r\nUpgrade: ");
        append(&mut rewritten, upgrade_value.ok_or(HeaderError::Malformed)?);
        rewritten.extend_from_slice(b"\r\n");
    } else {
        rewritten.extend_from_slice(b"Connection: close\r\n");
    }
    rewritten.extend_from_slice(b"\r\n");
    if rewritten.len() > MAX_REWRITTEN_HEADER_BYTES {
        return Err(HeaderError::Malformed);
    }

    Ok(HttpForwardRequest {
        host: Zeroizing::new(host),
        port,
        rewritten_head: rewritten,
        body,
        expect_continue,
        upgrade,
    })
}

fn header_size_hint(headers: &[(&str, &str)]) -> usize {
    headers
        .iter()
        .map(|(name, value)| name.len().saturating_add(value.len()).saturating_add(4))
        .fold(128_usize, usize::saturating_add)
        .min(MAX_REWRITTEN_HEADER_BYTES)
}

fn append(output: &mut Vec<u8>, value: &str) {
    output.extend_from_slice(value.as_bytes());
}

fn is_header_name_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric()
        || matches!(
            byte,
            b'!' | b'#'
                | b'$'
                | b'%'
                | b'&'
                | b'\''
                | b'*'
                | b'+'
                | b'-'
                | b'.'
                | b'^'
                | b'_'
                | b'`'
                | b'|'
                | b'~'
        )
}

fn is_method_byte(byte: u8) -> bool {
    is_header_name_byte(byte)
}

fn is_removed_header(name: &str) -> bool {
    [
        "connection",
        "content-length",
        "expect",
        "host",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "proxy-connection",
        "te",
        "trailer",
        "transfer-encoding",
        "upgrade",
    ]
    .iter()
    .any(|removed| name.eq_ignore_ascii_case(removed))
}

/// Forwards exactly one rewritten HTTP request. A normal response is copied
/// until the origin closes; an authenticated Upgrade becomes a raw duplex
/// stream just like CONNECT. Memory use stays constant in both cases.
pub(super) async fn forward_request<C, U>(
    client: &mut C,
    upstream: &mut U,
    request: HttpForwardRequest,
) -> Result<()>
where
    C: AsyncRead + AsyncWrite + Unpin,
    U: AsyncRead + AsyncWrite + Unpin,
{
    upstream
        .write_all(&request.rewritten_head)
        .await
        .map_err(|_| Error("HTTP proxy upstream request write failed".into()))?;

    if request.upgrade {
        return match tokio::io::copy_bidirectional(client, upstream).await {
            Ok(_) => Ok(()),
            Err(error) if peer_departed(&error) => Ok(()),
            Err(_) => Err(Error("HTTP upgrade forwarding failed".into())),
        };
    }

    if request.expect_continue {
        // The Expect header is intentionally removed upstream. Generating the
        // interim response here prevents a client waiting for 100 Continue from
        // deadlocking with an origin waiting for the body.
        client
            .write_all(HTTP_CONTINUE)
            .await
            .map_err(|_| Error("HTTP proxy interim response write failed".into()))?;
    }
    tokio::time::timeout(
        HTTP_REQUEST_BODY_TIMEOUT,
        relay_request_body(client, upstream, request.body),
    )
    .await
    .map_err(|_| Error("HTTP proxy request body timed out".into()))??;

    // The request framing is fully consumed. Half-closing makes the
    // one-request lifecycle explicit without preventing the response from
    // being read; any pipelined bytes remain on the local side and cannot leak.
    let _ = upstream.shutdown().await;
    relay_response(upstream, client).await
}

async fn relay_request_body<C, U>(client: &mut C, upstream: &mut U, body: HttpBody) -> Result<()>
where
    C: AsyncRead + Unpin,
    U: AsyncWrite + Unpin,
{
    match body {
        HttpBody::None => Ok(()),
        HttpBody::ContentLength(length) => copy_exact_body(client, upstream, length).await,
        HttpBody::Chunked => relay_chunked_body(client, upstream).await,
    }
}

async fn copy_exact_body<R, W>(reader: &mut R, writer: &mut W, remaining: u64) -> Result<()>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin,
{
    let mut buffer = Zeroizing::new([0_u8; HTTP_STREAM_BUFFER_BYTES]);
    copy_exact_body_with_buffer(reader, writer, remaining, &mut *buffer).await
}

async fn copy_exact_body_with_buffer<R, W>(
    reader: &mut R,
    writer: &mut W,
    mut remaining: u64,
    buffer: &mut [u8],
) -> Result<()>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin,
{
    while remaining != 0 {
        let wanted = usize::try_from(remaining.min(buffer.len() as u64))
            .map_err(|_| Error("HTTP proxy request body is invalid".into()))?;
        let read = reader
            .read(&mut buffer[..wanted])
            .await
            .map_err(|_| Error("HTTP proxy request body read failed".into()))?;
        if read == 0 {
            return Err(Error("HTTP proxy request body is truncated".into()));
        }
        writer
            .write_all(&buffer[..read])
            .await
            .map_err(|_| Error("HTTP proxy request body forwarding failed".into()))?;
        remaining -= read as u64;
    }
    Ok(())
}

async fn relay_chunked_body<R, W>(reader: &mut R, writer: &mut W) -> Result<()>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin,
{
    let mut decoded_bytes = 0_u64;
    let mut chunks = 0_usize;
    let mut buffer = Zeroizing::new([0_u8; HTTP_STREAM_BUFFER_BYTES]);
    loop {
        let line = read_crlf_line(reader, MAX_HTTP_CHUNK_LINE_BYTES).await?;
        if line
            .iter()
            .any(|byte| byte != &b'\t' && !(b' '..=b'~').contains(byte))
        {
            return Err(Error("HTTP proxy chunk framing is malformed".into()));
        }
        let size_text = line
            .split(|byte| *byte == b';')
            .next()
            .map(trim_optional_whitespace)
            .filter(|value| !value.is_empty() && value.iter().all(u8::is_ascii_hexdigit))
            .ok_or_else(|| Error("HTTP proxy chunk framing is malformed".into()))?;
        let size_text = std::str::from_utf8(size_text)
            .map_err(|_| Error("HTTP proxy chunk framing is malformed".into()))?;
        let size = u64::from_str_radix(size_text, 16)
            .map_err(|_| Error("HTTP proxy chunk framing is malformed".into()))?;
        if size == 0 {
            // Trailers are uncommon in browser uploads and can reintroduce the
            // very proxy/hop-by-hop headers stripped above. Accept only the
            // terminating blank line and emit a normalized final chunk.
            if !read_crlf_line(reader, MAX_HTTP_HEADER_BYTES)
                .await?
                .is_empty()
            {
                return Err(Error("HTTP proxy chunk trailers are unsupported".into()));
            }
            writer
                .write_all(b"0\r\n\r\n")
                .await
                .map_err(|_| Error("HTTP proxy request body forwarding failed".into()))?;
            return Ok(());
        }
        chunks += 1;
        if chunks > MAX_HTTP_CHUNKS {
            return Err(Error("HTTP proxy request contains too many chunks".into()));
        }
        decoded_bytes = decoded_bytes
            .checked_add(size)
            .filter(|total| *total <= MAX_HTTP_REQUEST_BODY_BYTES)
            .ok_or_else(|| Error("HTTP proxy request body is too large".into()))?;

        let encoded_size = Zeroizing::new(format!("{size:X}\r\n"));
        writer
            .write_all(encoded_size.as_bytes())
            .await
            .map_err(|_| Error("HTTP proxy request body forwarding failed".into()))?;
        copy_exact_body_with_buffer(reader, writer, size, &mut *buffer).await?;
        let mut terminator = Zeroizing::new([0_u8; 2]);
        reader
            .read_exact(&mut *terminator)
            .await
            .map_err(|_| Error("HTTP proxy chunk framing is truncated".into()))?;
        if *terminator != *b"\r\n" {
            return Err(Error("HTTP proxy chunk framing is malformed".into()));
        }
        writer
            .write_all(b"\r\n")
            .await
            .map_err(|_| Error("HTTP proxy request body forwarding failed".into()))?;
    }
}

async fn read_crlf_line<R>(reader: &mut R, limit: usize) -> Result<Zeroizing<Vec<u8>>>
where
    R: AsyncRead + Unpin,
{
    let mut line = Zeroizing::new(Vec::with_capacity(limit.min(128)));
    while !line.ends_with(b"\r\n") {
        if line.len() >= limit {
            return Err(Error("HTTP proxy body framing line is too large".into()));
        }
        line.push(
            reader
                .read_u8()
                .await
                .map_err(|_| Error("HTTP proxy body framing is truncated".into()))?,
        );
    }
    let content_length = line.len() - 2;
    line.truncate(content_length);
    Ok(line)
}

async fn relay_response<R, W>(reader: &mut R, writer: &mut W) -> Result<()>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin,
{
    let mut buffer = Zeroizing::new([0_u8; HTTP_STREAM_BUFFER_BYTES]);
    loop {
        let read = match tokio::time::timeout(HTTP_RESPONSE_IDLE_TIMEOUT, reader.read(&mut *buffer))
            .await
        {
            Ok(Ok(read)) => read,
            Ok(Err(error)) if peer_departed(&error) => return Ok(()),
            Ok(Err(_)) => return Err(Error("HTTP proxy response read failed".into())),
            Err(_) => return Err(Error("HTTP proxy response timed out".into())),
        };
        if read == 0 {
            return Ok(());
        }
        match tokio::time::timeout(
            HTTP_RESPONSE_IDLE_TIMEOUT,
            writer.write_all(&buffer[..read]),
        )
        .await
        {
            Ok(Ok(())) => {}
            Ok(Err(error)) if peer_departed(&error) => return Ok(()),
            Ok(Err(_)) => return Err(Error("HTTP proxy response forwarding failed".into())),
            Err(_) => return Err(Error("HTTP proxy response forwarding timed out".into())),
        }
    }
}

fn peer_departed(error: &std::io::Error) -> bool {
    matches!(
        error.kind(),
        std::io::ErrorKind::BrokenPipe
            | std::io::ErrorKind::ConnectionReset
            | std::io::ErrorKind::ConnectionAborted
            | std::io::ErrorKind::NotConnected
            | std::io::ErrorKind::UnexpectedEof
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine as _;
    use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
    use tokio::io::{DuplexStream, duplex};
    use tokio::net::{TcpListener, TcpStream};

    const USERNAME: &str = "proxy-user";
    const PASSWORD: &str = "proxy-pass";

    fn authentication() -> ProxyAuthentication {
        ProxyAuthentication::required(USERNAME, PASSWORD).unwrap()
    }

    fn authorization() -> String {
        BASE64_STANDARD.encode(format!("{USERNAME}:{PASSWORD}"))
    }

    fn parse(request: &str) -> ParsedHttpProxyRequest {
        parse_authenticated_header(request.as_bytes(), &authentication()).unwrap()
    }

    fn connected_pair() -> (DuplexStream, DuplexStream) {
        duplex(128 * 1024)
    }

    async fn read_head<S>(stream: &mut S) -> Vec<u8>
    where
        S: AsyncRead + Unpin,
    {
        let mut head = Vec::new();
        while !head.ends_with(b"\r\n\r\n") {
            head.push(stream.read_u8().await.unwrap());
        }
        head
    }

    async fn loopback_pair() -> (TcpStream, TcpStream) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let client = TcpStream::connect(address).await.unwrap();
        let (server, _) = listener.accept().await.unwrap();
        (client, server)
    }

    #[tokio::test]
    async fn missing_and_wrong_credentials_receive_the_same_407_before_method_checks() {
        let requests = [
            b"TRACE not-an-absolute-url HTTP/1.1\r\nMalformed header\r\n\r\n".as_slice(),
            b"GET http://campus.example/ HTTP/1.1\r\nProxy-Authorization: Basic d3Jvbmc=\r\n\r\n"
                .as_slice(),
        ];
        let mut responses = Vec::new();
        for request in requests {
            let (mut client, mut server) = connected_pair();
            let task = tokio::spawn(async move {
                let first = server.read_u8().await.unwrap();
                read_authenticated_request(&mut server, first, &authentication()).await
            });
            client.write_all(request).await.unwrap();
            client.shutdown().await.unwrap();
            let mut response = Vec::new();
            client.read_to_end(&mut response).await.unwrap();
            assert!(task.await.unwrap().is_err());
            responses.push(response);
        }
        assert_eq!(responses[0], HTTP_AUTHENTICATION_REQUIRED);
        assert_eq!(responses[1], responses[0]);
    }

    #[test]
    fn get_is_rewritten_to_origin_form_with_one_host_and_no_proxy_secrets() {
        let private_token = authorization();
        let request = format!(
            "GET http://campus.example/private?q=1 HTTP/1.1\r\n\
             Host: attacker.invalid\r\n\
             Host: duplicate.invalid\r\n\
             Proxy-Authorization: Basic {private_token}\r\n\
             Proxy-Connection: keep-alive\r\n\
             Connection: X-Local-Hop\r\n\
             X-Local-Hop: do-not-forward\r\n\
             Cookie: local-session=value\r\n\r\n"
        );
        let ParsedHttpProxyRequest::Forward(parsed) = parse(&request) else {
            panic!("ordinary GET must use forwarding");
        };
        let rewritten = std::str::from_utf8(&parsed.rewritten_head).unwrap();
        assert!(rewritten.starts_with("GET /private?q=1 HTTP/1.1\r\n"));
        assert_eq!(rewritten.matches("Host:").count(), 1);
        assert!(rewritten.contains("Host: campus.example\r\n"));
        assert!(rewritten.contains("Cookie: local-session=value\r\n"));
        assert!(rewritten.contains("Connection: close\r\n"));
        assert!(!rewritten.contains("X-Local-Hop"));
        assert!(!rewritten.contains("do-not-forward"));
        assert!(!rewritten.to_ascii_lowercase().contains("proxy-"));
        assert!(!rewritten.contains(&private_token));
        assert!(!format!("{parsed:?}").contains("campus.example"));
    }

    #[tokio::test]
    async fn post_body_is_preserved_but_a_pipelined_request_is_not_forwarded() {
        let request = format!(
            "POST http://10.20.30.40:8080/submit HTTP/1.1\r\n\
             Proxy-Authorization: Basic {}\r\n\
             Content-Type: text/plain\r\n\
             Content-Length: 4\r\n\r\n",
            authorization()
        );
        let ParsedHttpProxyRequest::Forward(parsed) = parse(&request) else {
            panic!("POST must use forwarding");
        };
        let (mut browser, mut proxy_client) = connected_pair();
        let (mut origin, mut proxy_upstream) = connected_pair();
        let forward = tokio::spawn(async move {
            forward_request(&mut proxy_client, &mut proxy_upstream, parsed).await
        });
        let origin_task = tokio::spawn(async move {
            let head = read_head(&mut origin).await;
            assert!(head.starts_with(b"POST /submit HTTP/1.1\r\n"));
            let expected_host = b"Host: 10.20.30.40:8080";
            assert!(
                head.windows(expected_host.len())
                    .any(|part| part == expected_host)
            );
            let mut body = [0_u8; 4];
            origin.read_exact(&mut body).await.unwrap();
            assert_eq!(&body, b"data");
            let mut extra = Vec::new();
            origin.read_to_end(&mut extra).await.unwrap();
            assert!(extra.is_empty());
            origin
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nOK")
                .await
                .unwrap();
        });
        browser
            .write_all(b"dataGET http://private.invalid/ HTTP/1.1\r\n\r\n")
            .await
            .unwrap();
        let mut response = Vec::new();
        browser.read_to_end(&mut response).await.unwrap();
        assert!(response.ends_with(b"\r\n\r\nOK"));
        origin_task.await.unwrap();
        forward.await.unwrap().unwrap();
    }

    #[tokio::test]
    async fn chunked_post_is_validated_normalized_and_bounded() {
        let request = format!(
            "POST http://campus.example/upload HTTP/1.1\r\n\
             Proxy-Authorization: Basic {}\r\n\
             Transfer-Encoding: chunked\r\n\r\n",
            authorization()
        );
        let ParsedHttpProxyRequest::Forward(parsed) = parse(&request) else {
            panic!("chunked POST must use forwarding");
        };
        let (mut browser, mut proxy_client) = connected_pair();
        let (mut origin, mut proxy_upstream) = connected_pair();
        let forward = tokio::spawn(async move {
            forward_request(&mut proxy_client, &mut proxy_upstream, parsed).await
        });
        let origin_task = tokio::spawn(async move {
            let head = read_head(&mut origin).await;
            assert!(head.starts_with(b"POST /upload HTTP/1.1\r\n"));
            assert!(
                head.windows(b"Transfer-Encoding: chunked".len())
                    .any(|part| part == b"Transfer-Encoding: chunked")
            );
            let mut encoded_body = Vec::new();
            origin.read_to_end(&mut encoded_body).await.unwrap();
            assert_eq!(encoded_body, b"4\r\ndata\r\n3\r\nend\r\n0\r\n\r\n");
            origin
                .write_all(b"HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n")
                .await
                .unwrap();
        });
        browser
            .write_all(
                b"4;synthetic=extension\r\ndata\r\n3\r\nend\r\n0\r\n\r\n\
                  GET http://must-not-forward.invalid/ HTTP/1.1\r\n\r\n",
            )
            .await
            .unwrap();
        let mut response = Vec::new();
        browser.read_to_end(&mut response).await.unwrap();
        assert!(response.starts_with(b"HTTP/1.1 204"));
        origin_task.await.unwrap();
        forward.await.unwrap().unwrap();
    }

    #[tokio::test]
    async fn expect_continue_is_answered_before_the_content_length_body() {
        let request = format!(
            "POST http://campus.example/upload HTTP/1.1\r\n\
             Proxy-Authorization: Basic {}\r\n\
             Expect: 100-continue\r\n\
             Content-Length: 4\r\n\r\n",
            authorization()
        );
        let ParsedHttpProxyRequest::Forward(parsed) = parse(&request) else {
            panic!("Expect request must use forwarding");
        };
        let (mut browser, mut proxy_client) = connected_pair();
        let (mut origin, mut proxy_upstream) = connected_pair();
        let forward = tokio::spawn(async move {
            forward_request(&mut proxy_client, &mut proxy_upstream, parsed).await
        });
        let origin_task = tokio::spawn(async move {
            let head = read_head(&mut origin).await;
            assert!(
                !head
                    .windows(b"Expect:".len())
                    .any(|part| part.eq_ignore_ascii_case(b"Expect:"))
            );
            let mut body = [0_u8; 4];
            origin.read_exact(&mut body).await.unwrap();
            assert_eq!(&body, b"data");
            origin
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                .await
                .unwrap();
        });
        let interim = read_head(&mut browser).await;
        assert_eq!(interim, HTTP_CONTINUE);
        browser.write_all(b"data").await.unwrap();
        let final_response = read_head(&mut browser).await;
        assert!(final_response.starts_with(b"HTTP/1.1 200"));
        browser.shutdown().await.unwrap();
        origin_task.await.unwrap();
        forward.await.unwrap().unwrap();
    }

    #[tokio::test]
    async fn websocket_upgrade_preserves_handshake_and_becomes_duplex() {
        let request = format!(
            "GET ws://campus.example/socket HTTP/1.1\r\n\
             Proxy-Authorization: Basic {}\r\n\
             Connection: keep-alive, Upgrade\r\n\
             Upgrade: websocket\r\n\
             Sec-WebSocket-Key: synthetic-key\r\n\r\n",
            authorization()
        );
        let ParsedHttpProxyRequest::Forward(parsed) = parse(&request) else {
            panic!("WebSocket must use forwarding");
        };
        assert!(parsed.upgrade);
        let (mut browser, mut proxy_client) = connected_pair();
        let (mut origin, mut proxy_upstream) = connected_pair();
        let forward = tokio::spawn(async move {
            forward_request(&mut proxy_client, &mut proxy_upstream, parsed).await
        });
        let origin_task = tokio::spawn(async move {
            let head = read_head(&mut origin).await;
            let head = std::str::from_utf8(&head).unwrap();
            assert!(head.starts_with("GET /socket HTTP/1.1\r\n"));
            assert!(head.contains("Connection: Upgrade\r\nUpgrade: websocket\r\n"));
            assert!(!head.to_ascii_lowercase().contains("proxy-"));
            origin
                .write_all(b"HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n")
                .await
                .unwrap();
            let mut frame = [0_u8; 4];
            origin.read_exact(&mut frame).await.unwrap();
            origin.write_all(&frame).await.unwrap();
            origin.shutdown().await.unwrap();
        });
        browser.write_all(b"ping").await.unwrap();
        let head = read_head(&mut browser).await;
        assert!(head.starts_with(b"HTTP/1.1 101"));
        let mut echoed = [0_u8; 4];
        browser.read_exact(&mut echoed).await.unwrap();
        assert_eq!(&echoed, b"ping");
        browser.shutdown().await.unwrap();
        origin_task.await.unwrap();
        forward.await.unwrap().unwrap();
    }

    #[tokio::test]
    async fn real_loopback_http_and_websocket_streams_follow_the_same_forwarder() {
        let http_request = format!(
            "POST http://campus.example/loopback HTTP/1.1\r\n\
             Proxy-Authorization: Basic {}\r\n\
             Content-Length: 4\r\n\r\n",
            authorization()
        );
        let ParsedHttpProxyRequest::Forward(http_request) = parse(&http_request) else {
            panic!("loopback POST must use forwarding");
        };
        let (mut browser, mut proxy_client) = loopback_pair().await;
        let (mut origin, mut proxy_upstream) = loopback_pair().await;
        let forward = tokio::spawn(async move {
            forward_request(&mut proxy_client, &mut proxy_upstream, http_request).await
        });
        let origin_task = tokio::spawn(async move {
            assert!(
                read_head(&mut origin)
                    .await
                    .starts_with(b"POST /loopback HTTP/1.1\r\n")
            );
            let mut body = [0_u8; 4];
            origin.read_exact(&mut body).await.unwrap();
            assert_eq!(&body, b"data");
            origin
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nOK")
                .await
                .unwrap();
            origin.shutdown().await.unwrap();
        });
        browser.write_all(b"data").await.unwrap();
        let mut response = Vec::new();
        browser.read_to_end(&mut response).await.unwrap();
        assert!(response.ends_with(b"\r\n\r\nOK"));
        origin_task.await.unwrap();
        forward.await.unwrap().unwrap();

        let websocket_request = format!(
            "GET ws://campus.example/loopback-ws HTTP/1.1\r\n\
             Proxy-Authorization: Basic {}\r\n\
             Connection: Upgrade\r\n\
             Upgrade: websocket\r\n\r\n",
            authorization()
        );
        let ParsedHttpProxyRequest::Forward(websocket_request) = parse(&websocket_request) else {
            panic!("loopback WebSocket must use forwarding");
        };
        let (mut browser, mut proxy_client) = loopback_pair().await;
        let (mut origin, mut proxy_upstream) = loopback_pair().await;
        let forward = tokio::spawn(async move {
            forward_request(&mut proxy_client, &mut proxy_upstream, websocket_request).await
        });
        let origin_task = tokio::spawn(async move {
            assert!(
                read_head(&mut origin)
                    .await
                    .starts_with(b"GET /loopback-ws HTTP/1.1\r\n")
            );
            origin
                .write_all(b"HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n")
                .await
                .unwrap();
            let mut frame = [0_u8; 4];
            origin.read_exact(&mut frame).await.unwrap();
            origin.write_all(&frame).await.unwrap();
            origin.shutdown().await.unwrap();
        });
        browser.write_all(b"ping").await.unwrap();
        assert!(read_head(&mut browser).await.starts_with(b"HTTP/1.1 101"));
        let mut echoed = [0_u8; 4];
        browser.read_exact(&mut echoed).await.unwrap();
        assert_eq!(&echoed, b"ping");
        browser.shutdown().await.unwrap();
        origin_task.await.unwrap();
        forward.await.unwrap().unwrap();
    }

    #[test]
    fn ambiguous_framing_trailers_oversized_and_non_http_targets_fail_closed() {
        let auth = authorization();
        for request in [
            format!(
                "POST http://campus.example/ HTTP/1.1\r\nProxy-Authorization: Basic {auth}\r\nTransfer-Encoding: gzip, chunked\r\n\r\n"
            ),
            format!(
                "POST http://campus.example/ HTTP/1.1\r\nProxy-Authorization: Basic {auth}\r\nTransfer-Encoding: chunked\r\nContent-Length: 1\r\n\r\n"
            ),
            format!(
                "POST http://campus.example/ HTTP/1.1\r\nProxy-Authorization: Basic {auth}\r\nContent-Length: {}\r\n\r\n",
                MAX_HTTP_REQUEST_BODY_BYTES + 1
            ),
            format!(
                "GET https://campus.example/ HTTP/1.1\r\nProxy-Authorization: Basic {auth}\r\n\r\n"
            ),
        ] {
            assert!(matches!(
                parse_authenticated_header(request.as_bytes(), &authentication()),
                Err(HeaderError::Malformed)
            ));
        }
    }
}
