//! Length-prefixed DNS-over-TCP exchange over an already validated tunnel
//! stream. DNS selection and response semantics remain in the parent resolver.

use crate::{Error, Result};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

const DNS_HEADER_LEN: usize = 12;
const DNS_MAX_TCP_RESPONSE: usize = 16 * 1024;

pub(super) async fn exchange<S>(stream: &mut S, query: &[u8]) -> Result<Vec<u8>>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let query_length = u16::try_from(query.len())
        .map_err(|_| Error("VPN DNS TCP query exceeds the wire limit".into()))?;
    stream
        .write_all(&query_length.to_be_bytes())
        .await
        .map_err(|_| Error("VPN DNS TCP query length write failed".into()))?;
    stream
        .write_all(query)
        .await
        .map_err(|_| Error("VPN DNS TCP query write failed".into()))?;
    stream
        .flush()
        .await
        .map_err(|_| Error("VPN DNS TCP query flush failed".into()))?;

    let mut length_bytes = [0_u8; 2];
    stream
        .read_exact(&mut length_bytes)
        .await
        .map_err(|_| Error("VPN DNS TCP response length is incomplete".into()))?;
    let response_length = usize::from(u16::from_be_bytes(length_bytes));
    if !(DNS_HEADER_LEN..=DNS_MAX_TCP_RESPONSE).contains(&response_length) {
        return Err(Error("VPN DNS TCP response length is invalid".into()));
    }
    let mut response = vec![0_u8; response_length];
    stream
        .read_exact(&mut response)
        .await
        .map_err(|_| Error("VPN DNS TCP response is incomplete".into()))?;
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[tokio::test]
    async fn handles_partial_length_and_body_reads() {
        let query = vec![7_u8; 32];
        let expected = vec![9_u8; 64];
        let (mut client, mut server) = tokio::io::duplex(DNS_MAX_TCP_RESPONSE * 2);
        let server_query = query.clone();
        let server_response = expected.clone();
        let server_task = tokio::spawn(async move {
            let mut length = [0_u8; 2];
            server.read_exact(&mut length).await.unwrap();
            let mut received = vec![0_u8; usize::from(u16::from_be_bytes(length))];
            server.read_exact(&mut received).await.unwrap();
            assert_eq!(received, server_query);
            let encoded_length = (server_response.len() as u16).to_be_bytes();
            server.write_all(&encoded_length[..1]).await.unwrap();
            tokio::task::yield_now().await;
            server.write_all(&encoded_length[1..]).await.unwrap();
            for chunk in server_response.chunks(3) {
                server.write_all(chunk).await.unwrap();
                tokio::task::yield_now().await;
            }
        });
        assert_eq!(exchange(&mut client, &query).await.unwrap(), expected);
        server_task.await.unwrap();
    }

    #[tokio::test]
    async fn rejects_oversize_partial_body_and_timeout() {
        let query = vec![7_u8; 32];
        let (mut oversized_client, mut oversized_server) = tokio::io::duplex(1024);
        let oversized = tokio::spawn(async move {
            read_request(&mut oversized_server).await;
            oversized_server
                .write_all(&((DNS_MAX_TCP_RESPONSE + 1) as u16).to_be_bytes())
                .await
                .unwrap();
        });
        assert!(exchange(&mut oversized_client, &query).await.is_err());
        oversized.await.unwrap();

        let (mut partial_client, mut partial_server) = tokio::io::duplex(1024);
        let partial = tokio::spawn(async move {
            read_request(&mut partial_server).await;
            partial_server
                .write_all(&20_u16.to_be_bytes())
                .await
                .unwrap();
            partial_server.write_all(&[0_u8; 10]).await.unwrap();
        });
        assert!(exchange(&mut partial_client, &query).await.is_err());
        partial.await.unwrap();

        let (mut stalled_client, _stalled_server) = tokio::io::duplex(1024);
        assert!(
            tokio::time::timeout(
                Duration::from_millis(20),
                exchange(&mut stalled_client, &query)
            )
            .await
            .is_err()
        );
    }

    async fn read_request(stream: &mut tokio::io::DuplexStream) {
        let mut length = [0_u8; 2];
        stream.read_exact(&mut length).await.unwrap();
        let mut request = vec![0_u8; usize::from(u16::from_be_bytes(length))];
        stream.read_exact(&mut request).await.unwrap();
    }
}
