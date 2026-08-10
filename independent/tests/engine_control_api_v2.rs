use ec_compat::engine::control::{
    ControlAction, ControlCapability, ControlFrameReader, ControlFrameWriter, ControlProtocolError,
    ControlResponse, ControlSession,
};
use ec_compat::engine::socks_auth::{ProxyAuthenticationMode, read_engine_credentials_prefix};
use std::io::Cursor;

#[test]
fn inherited_stdin_transitions_from_zeroizing_credentials_to_bounded_control_frames() {
    let private_user = "synthetic-private-user";
    let private_password = "synthetic-private-password";
    let input = format!(
        "{private_user}\n{private_password}\n{{\"type\":\"hello\",\"requestId\":1,\"versions\":[2]}}\n{{\"type\":\"request\",\"apiVersion\":2,\"requestId\":2,\"command\":{{\"name\":\"require_capability\",\"capability\":\"resource.catalogue\"}}}}\n{{\"type\":\"close\",\"apiVersion\":2,\"requestId\":3}}\n"
    );
    let mut inherited_stdin = Cursor::new(input.into_bytes());
    let credentials =
        read_engine_credentials_prefix(&mut inherited_stdin, ProxyAuthenticationMode::None)
            .unwrap();
    assert_eq!(credentials.gateway_username.as_str(), private_user);
    assert_eq!(credentials.gateway_password.as_str(), private_password);
    drop(credentials);

    let mut reader = ControlFrameReader::new(&mut inherited_stdin);
    let mut session = ControlSession::new();
    let mut output_bytes = Vec::new();
    {
        let mut output = ControlFrameWriter::new(&mut output_bytes);

        let hello = session.handle(reader.read_request().unwrap().unwrap());
        output.write_response(&hello.response).unwrap();
        let unsupported = session.handle(reader.read_request().unwrap().unwrap());
        assert!(matches!(
            unsupported.response,
            ControlResponse::Error {
                error: ControlProtocolError::UnsupportedCapability {
                    capability: ControlCapability::ResourceCatalogue,
                },
                ..
            }
        ));
        output.write_response(&unsupported.response).unwrap();
        let close = session.handle(reader.read_request().unwrap().unwrap());
        assert_eq!(close.action, Some(ControlAction::Close { request_id: 3 }));
        output.write_response(&close.response).unwrap();
        assert!(reader.read_request().unwrap().is_none());
    }

    for line in output_bytes
        .split(|byte| *byte == b'\n')
        .filter(|line| !line.is_empty())
    {
        serde_json::from_slice::<serde_json::Value>(line).unwrap();
    }
    let serialized = String::from_utf8(output_bytes).unwrap();
    assert!(!serialized.contains(private_user));
    assert!(!serialized.contains(private_password));
    assert!(!serialized.contains("destination"));
}
