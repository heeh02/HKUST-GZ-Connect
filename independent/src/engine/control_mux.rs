//! Zeroizing multiplexer for secret-free Control v2 and interactive-auth v3.

use crate::engine::auth_control::{
    AuthControlRequest, MAX_AUTH_CONTROL_FRAME_BYTES, decode_auth_control_request,
};
use crate::engine::control::{ControlRequest, decode_control_request};
use crate::{Error, ErrorKind, Result};
use std::io::Read;
use zeroize::Zeroizing;

#[derive(Debug)]
pub enum InheritedControlRequest {
    V2(ControlRequest),
    V3(AuthControlRequest),
}

pub struct InheritedControlFrameReader<R> {
    reader: R,
    buffered: Zeroizing<Vec<u8>>,
}

impl<R: Read> InheritedControlFrameReader<R> {
    pub fn new(reader: R) -> Self {
        Self {
            reader,
            buffered: Zeroizing::new(Vec::with_capacity(256)),
        }
    }

    pub fn read_request(&mut self) -> Result<Option<InheritedControlRequest>> {
        loop {
            if let Some(newline) = self.buffered.iter().position(|byte| *byte == b'\n') {
                if newline + 1 > MAX_AUTH_CONTROL_FRAME_BYTES {
                    self.buffered.clear();
                    return Err(mux_error("inherited control frame exceeds the wire limit"));
                }
                let mut frame = Zeroizing::new(self.buffered.drain(..=newline).collect::<Vec<_>>());
                frame.pop();
                return decode_muxed_request(frame.as_slice()).map(Some);
            }
            if self.buffered.len() >= MAX_AUTH_CONTROL_FRAME_BYTES {
                self.buffered.clear();
                return Err(mux_error("inherited control frame exceeds the wire limit"));
            }
            let mut chunk = Zeroizing::new([0_u8; 256]);
            let remaining = MAX_AUTH_CONTROL_FRAME_BYTES - self.buffered.len();
            let capacity = remaining.min(chunk.len());
            let read = self
                .reader
                .read(&mut chunk[..capacity])
                .map_err(|_| mux_error("cannot read inherited control frame"))?;
            if read == 0 {
                if self.buffered.is_empty() {
                    return Ok(None);
                }
                self.buffered.clear();
                return Err(mux_error("inherited control frame is truncated"));
            }
            self.buffered.extend_from_slice(&chunk[..read]);
        }
    }
}

pub fn decode_muxed_request(frame: &[u8]) -> Result<InheritedControlRequest> {
    if let Ok(request) = decode_control_request(frame) {
        return Ok(InheritedControlRequest::V2(request));
    }
    if let Ok(request) = decode_auth_control_request(frame) {
        return Ok(InheritedControlRequest::V3(request));
    }
    Err(mux_error("inherited control frame is invalid"))
}

fn mux_error(message: impl Into<String>) -> Error {
    Error::classified(ErrorKind::Credentials, message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn mixed_v2_v3_frames_keep_order_and_never_echo_secret_errors() {
        let input = b"{\"type\":\"hello\",\"requestId\":1,\"versions\":[2]}\n{\"type\":\"auth_request\",\"apiVersion\":3,\"requestId\":2,\"generation\":9,\"transactionId\":\"04040404040404040404040404040404\",\"challengeEpoch\":1,\"command\":{\"name\":\"respond\",\"response\":\"private-fixture\"}}\n";
        let mut reader = InheritedControlFrameReader::new(Cursor::new(input));
        assert!(matches!(
            reader.read_request().unwrap().unwrap(),
            InheritedControlRequest::V2(_)
        ));
        let v3 = reader.read_request().unwrap().unwrap();
        assert!(matches!(v3, InheritedControlRequest::V3(_)));
        assert!(!format!("{}", mux_error("generic")).contains("private-fixture"));
        assert!(reader.read_request().unwrap().is_none());
    }

    #[test]
    fn malformed_frame_has_one_fixed_typed_error() {
        let error = decode_muxed_request(b"private-fixture").unwrap_err();
        assert_eq!(error.kind(), ErrorKind::Credentials);
        assert_eq!(error.to_string(), "inherited control frame is invalid");
    }
}
