use crate::modern::{build_special_client_hello, connect_gateway_tcp, verify_special_certificates};
use crate::{Error, Result};
use hmac::{Hmac, Mac};
use md5::Md5;
use rand::RngCore;
use rand::rngs::OsRng;
use rc4::cipher::consts::U16;
use rc4::{KeyInit, Rc4, StreamCipher};
use rsa::pkcs8::DecodePublicKey;
use rsa::{Pkcs1v15Encrypt, RsaPublicKey};
use sha1::Sha1;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;
use subtle::ConstantTimeEq;
use x509_parser::parse_x509_certificate;
use zeroize::{Zeroize, Zeroizing};

const TLS11_VERSION: [u8; 2] = [0x03, 0x02];
const HANDSHAKE: u8 = 22;
const CHANGE_CIPHER_SPEC: u8 = 20;
const APPLICATION_DATA: u8 = 23;
const ALERT: u8 = 21;
const MAX_RECORD_PAYLOAD: usize = 18_432;
const MAX_SERVER_FLIGHT: usize = 64 * 1024;
const SHA1_MAC_LEN: usize = 20;
const TLS_RECORD_HEADER_LEN: usize = 5;

type HmacMd5 = Hmac<Md5>;
type HmacSha1 = Hmac<Sha1>;
type Rc4_128 = Rc4<U16>;

struct ServerFlight {
    transcript: Zeroizing<Vec<u8>>,
    server_random: [u8; 32],
    certificates: Zeroizing<Vec<Vec<u8>>>,
}

struct RecordCipher {
    mac_key: Zeroizing<[u8; SHA1_MAC_LEN]>,
    cipher: Rc4_128,
    sequence: u64,
}

impl RecordCipher {
    fn new(mac_key: [u8; SHA1_MAC_LEN], mut key: [u8; 16]) -> Self {
        let cipher = Rc4_128::new((&key).into());
        key.zeroize();
        Self {
            mac_key: Zeroizing::new(mac_key),
            cipher,
            sequence: 0,
        }
    }

    fn mac(&self, content_type: u8, plaintext: &[u8]) -> Result<[u8; SHA1_MAC_LEN]> {
        let mut mac = <HmacSha1 as Mac>::new_from_slice(self.mac_key.as_ref())
            .map_err(|_| Error("cannot initialize TLS record MAC".into()))?;
        mac.update(&self.sequence.to_be_bytes());
        mac.update(&[content_type]);
        mac.update(&TLS11_VERSION);
        mac.update(
            &u16::try_from(plaintext.len())
                .map_err(|_| Error("TLS plaintext is too large".into()))?
                .to_be_bytes(),
        );
        mac.update(plaintext);
        Ok(mac.finalize().into_bytes().into())
    }

    fn encrypt(&mut self, content_type: u8, plaintext: &[u8]) -> Result<Zeroizing<Vec<u8>>> {
        let mac = self.mac(content_type, plaintext)?;
        let mut ciphertext = Zeroizing::new(Vec::with_capacity(plaintext.len() + mac.len()));
        ciphertext.extend_from_slice(plaintext);
        ciphertext.extend_from_slice(&mac);
        self.cipher.apply_keystream(&mut ciphertext);
        self.sequence = self
            .sequence
            .checked_add(1)
            .ok_or_else(|| Error("TLS record sequence exhausted".into()))?;
        Ok(ciphertext)
    }

    fn decrypt(&mut self, content_type: u8, ciphertext: &[u8]) -> Result<Zeroizing<Vec<u8>>> {
        if ciphertext.len() < SHA1_MAC_LEN {
            return Err(Error("encrypted TLS record is too short".into()));
        }
        let mut decoded = Zeroizing::new(ciphertext.to_vec());
        self.cipher.apply_keystream(&mut decoded);
        let plaintext_length = decoded.len() - SHA1_MAC_LEN;
        let received_mac = decoded[plaintext_length..].to_vec();
        decoded.truncate(plaintext_length);
        let expected_mac = self.mac(content_type, &decoded)?;
        if !constant_time_equal(&received_mac, &expected_mac) {
            return Err(Error("TLS record MAC verification failed".into()));
        }
        self.sequence = self
            .sequence
            .checked_add(1)
            .ok_or_else(|| Error("TLS record sequence exhausted".into()))?;
        Ok(decoded)
    }
}

fn constant_time_equal(left: &[u8], right: &[u8]) -> bool {
    left.len() == right.len() && bool::from(left.ct_eq(right))
}

fn p_hash<M: Mac + Clone + hmac::digest::KeyInit>(
    secret: &[u8],
    seed: &[u8],
    length: usize,
) -> Result<Zeroizing<Vec<u8>>> {
    let mut a = {
        let mut mac = <M as Mac>::new_from_slice(secret)
            .map_err(|_| Error("cannot initialize TLS PRF".into()))?;
        mac.update(seed);
        Zeroizing::new(mac.finalize().into_bytes().to_vec())
    };
    let mut output = Zeroizing::new(Vec::with_capacity(length));
    while output.len() < length {
        let mut mac = <M as Mac>::new_from_slice(secret)
            .map_err(|_| Error("cannot initialize TLS PRF".into()))?;
        mac.update(&a);
        mac.update(seed);
        output.extend_from_slice(&mac.finalize().into_bytes());
        let mut next_a = <M as Mac>::new_from_slice(secret)
            .map_err(|_| Error("cannot initialize TLS PRF".into()))?;
        next_a.update(&a);
        a = Zeroizing::new(next_a.finalize().into_bytes().to_vec());
    }
    output.truncate(length);
    Ok(output)
}

fn tls10_prf(
    secret: &[u8],
    label: &[u8],
    seed: &[u8],
    length: usize,
) -> Result<Zeroizing<Vec<u8>>> {
    let split = secret.len().div_ceil(2);
    let mut label_seed = Zeroizing::new(Vec::with_capacity(label.len() + seed.len()));
    label_seed.extend_from_slice(label);
    label_seed.extend_from_slice(seed);
    let md5 = p_hash::<HmacMd5>(&secret[..split], &label_seed, length)?;
    let sha1 = p_hash::<HmacSha1>(&secret[secret.len() - split..], &label_seed, length)?;
    Ok(Zeroizing::new(
        md5.iter().zip(sha1.iter()).map(|(a, b)| a ^ b).collect(),
    ))
}

fn handshake_hash(transcript: &[u8]) -> Zeroizing<Vec<u8>> {
    use md5::Digest as _;
    let mut output = Zeroizing::new(Vec::with_capacity(36));
    output.extend_from_slice(&Md5::digest(transcript));
    output.extend_from_slice(&Sha1::digest(transcript));
    output
}

fn push_u24(output: &mut Vec<u8>, value: usize) -> Result<()> {
    if value > 0x00ff_ffff {
        return Err(Error("TLS handshake length exceeds 24 bits".into()));
    }
    output.extend_from_slice(&[
        ((value >> 16) & 0xff) as u8,
        ((value >> 8) & 0xff) as u8,
        (value & 0xff) as u8,
    ]);
    Ok(())
}

fn handshake_message(message_type: u8, body: &[u8]) -> Result<Zeroizing<Vec<u8>>> {
    let mut message = Zeroizing::new(Vec::with_capacity(body.len() + 4));
    message.push(message_type);
    push_u24(&mut message, body.len())?;
    message.extend_from_slice(body);
    Ok(message)
}

fn write_record<W: Write>(stream: &mut W, content_type: u8, payload: &[u8]) -> Result<()> {
    if payload.len() > MAX_RECORD_PAYLOAD {
        return Err(Error("TLS record payload exceeds limit".into()));
    }
    // Header and payload go out together. Writing the 5-byte header on its own
    // puts a small segment on the wire and then waits for the reply, which is
    // the write-write-read pattern that Nagle plus a delayed ACK stalls for tens
    // of milliseconds. On this transport every tunneled IP packet is one record,
    // so that stall would apply to every packet the client sends.
    let mut record = Zeroizing::new(Vec::with_capacity(TLS_RECORD_HEADER_LEN + payload.len()));
    record.extend_from_slice(&[content_type, TLS11_VERSION[0], TLS11_VERSION[1]]);
    record.extend_from_slice(
        &u16::try_from(payload.len())
            .map_err(|_| Error("TLS record payload exceeds limit".into()))?
            .to_be_bytes(),
    );
    record.extend_from_slice(payload);
    stream.write_all(&record)?;
    Ok(())
}

fn read_record(stream: &mut TcpStream) -> Result<(u8, Zeroizing<Vec<u8>>)> {
    let mut header = [0_u8; 5];
    stream.read_exact(&mut header)?;
    if header[1..3] != TLS11_VERSION {
        return Err(Error("special TLS record has an unexpected version".into()));
    }
    let length = u16::from_be_bytes([header[3], header[4]]) as usize;
    if length > MAX_RECORD_PAYLOAD {
        return Err(Error("special TLS record exceeds limit".into()));
    }
    let mut payload = Zeroizing::new(vec![0_u8; length]);
    stream.read_exact(&mut payload)?;
    if header[0] == ALERT {
        return Err(Error("special TLS server returned an alert".into()));
    }
    Ok((header[0], payload))
}

fn parse_server_flight(stream: &mut TcpStream) -> Result<ServerFlight> {
    let mut transcript = Zeroizing::new(Vec::new());
    let mut server_random = None;
    let mut certificates = Zeroizing::new(Vec::new());
    let mut consumed = 0;
    let mut offset = 0;
    loop {
        let (content_type, payload) = read_record(stream)?;
        if content_type != HANDSHAKE {
            return Err(Error("unexpected record before ServerHelloDone".into()));
        }
        consumed += payload.len();
        if consumed > MAX_SERVER_FLIGHT {
            return Err(Error("TLS server flight exceeds limit".into()));
        }
        transcript.extend_from_slice(&payload);
        while transcript.len().saturating_sub(offset) >= 4 {
            let length = ((transcript[offset + 1] as usize) << 16)
                | ((transcript[offset + 2] as usize) << 8)
                | transcript[offset + 3] as usize;
            let body_start = offset + 4;
            let body_end = body_start
                .checked_add(length)
                .ok_or_else(|| Error("TLS handshake length overflow".into()))?;
            if body_end > transcript.len() {
                break;
            }
            let body = &transcript[body_start..body_end];
            match transcript[offset] {
                2 => {
                    if body.len() < 38 {
                        return Err(Error("TLS ServerHello is too short".into()));
                    }
                    let session_length = body[34] as usize;
                    let suffix = 35_usize
                        .checked_add(session_length)
                        .ok_or_else(|| Error("TLS session length overflow".into()))?;
                    if body[..2] != TLS11_VERSION
                        || session_length > 32
                        || body.len() < suffix + 3
                        || body[suffix..suffix + 2] != [0, 5]
                        || body[suffix + 2] != 0
                    {
                        return Err(Error(
                            "TLS ServerHello selected an unsupported contract".into(),
                        ));
                    }
                    server_random = Some(body[2..34].try_into().expect("validated random"));
                }
                11 => {
                    if body.len() < 3 {
                        return Err(Error("TLS certificate list is truncated".into()));
                    }
                    let declared_list_length =
                        ((body[0] as usize) << 16) | ((body[1] as usize) << 8) | body[2] as usize;
                    if declared_list_length != body.len() - 3 {
                        return Err(Error("TLS certificate list length is invalid".into()));
                    }
                    let mut certificate_offset = 3;
                    while certificate_offset < body.len() {
                        if body.len() - certificate_offset < 3 {
                            return Err(Error("TLS certificate length is truncated".into()));
                        }
                        let certificate_length = ((body[certificate_offset] as usize) << 16)
                            | ((body[certificate_offset + 1] as usize) << 8)
                            | body[certificate_offset + 2] as usize;
                        certificate_offset += 3;
                        let end = certificate_offset + certificate_length;
                        if end > body.len() || certificate_length == 0 {
                            return Err(Error("TLS certificate is truncated".into()));
                        }
                        certificates.push(body[certificate_offset..end].to_vec());
                        certificate_offset = end;
                    }
                }
                12 => {
                    return Err(Error(
                        "TLS RSA handshake unexpectedly included ServerKeyExchange".into(),
                    ));
                }
                14 => {
                    if !body.is_empty() {
                        return Err(Error("TLS ServerHelloDone must be empty".into()));
                    }
                    return Ok(ServerFlight {
                        transcript,
                        server_random: server_random
                            .ok_or_else(|| Error("TLS ServerHello is missing".into()))?,
                        certificates,
                    });
                }
                _ => {}
            }
            offset = body_end;
        }
    }
}

pub struct SpecialTls11Stream {
    stream: TcpStream,
    client_cipher: RecordCipher,
    server_cipher: RecordCipher,
}

impl SpecialTls11Stream {
    pub fn connect(
        address: SocketAddr,
        host: &str,
        timeout: Duration,
        verified_https_leaf_sha256: &[u8; 32],
        configured_special_leaf_sha256: Option<&[u8; 32]>,
    ) -> Result<Self> {
        let mut stream = connect_gateway_tcp(address, timeout)?;
        let mut client_random = [0_u8; 32];
        OsRng.fill_bytes(&mut client_random);
        let client_hello = build_special_client_hello(client_random)?;
        stream.write_all(&client_hello)?;
        let mut transcript = Zeroizing::new(client_hello[5..].to_vec());
        let server_flight = parse_server_flight(&mut stream)?;
        transcript.extend_from_slice(&server_flight.transcript);
        let (verified, _, _) = verify_special_certificates(
            host,
            &server_flight.certificates,
            verified_https_leaf_sha256,
            configured_special_leaf_sha256,
        )?;
        if !verified {
            return Err(Error(
                "special TLS certificate requires administrator pin".into(),
            ));
        }

        let leaf = server_flight
            .certificates
            .first()
            .ok_or_else(|| Error("TLS server certificate is missing".into()))?;
        let (_, certificate) = parse_x509_certificate(leaf)
            .map_err(|_| Error("TLS server certificate is invalid".into()))?;
        let public_key = RsaPublicKey::from_public_key_der(certificate.public_key().raw)
            .map_err(|_| Error("TLS server certificate has no supported RSA key".into()))?;
        let mut premaster = Zeroizing::new([0_u8; 48]);
        premaster[..2].copy_from_slice(&TLS11_VERSION);
        OsRng.fill_bytes(&mut premaster[2..]);
        let encrypted_premaster = Zeroizing::new(
            public_key
                .encrypt(&mut OsRng, Pkcs1v15Encrypt, premaster.as_ref())
                .map_err(|_| Error("TLS RSA key exchange failed".into()))?,
        );
        let mut key_exchange_body =
            Zeroizing::new(Vec::with_capacity(encrypted_premaster.len() + 2));
        key_exchange_body.extend_from_slice(
            &u16::try_from(encrypted_premaster.len())
                .map_err(|_| Error("TLS RSA ciphertext is too large".into()))?
                .to_be_bytes(),
        );
        key_exchange_body.extend_from_slice(&encrypted_premaster);
        let key_exchange = handshake_message(16, &key_exchange_body)?;
        write_record(&mut stream, HANDSHAKE, &key_exchange)?;
        transcript.extend_from_slice(&key_exchange);

        let mut master_seed = Zeroizing::new(Vec::with_capacity(64));
        master_seed.extend_from_slice(&client_random);
        master_seed.extend_from_slice(&server_flight.server_random);
        let master = tls10_prf(premaster.as_ref(), b"master secret", &master_seed, 48)?;
        premaster.zeroize();
        let mut key_seed = Zeroizing::new(Vec::with_capacity(64));
        key_seed.extend_from_slice(&server_flight.server_random);
        key_seed.extend_from_slice(&client_random);
        client_random.zeroize();
        let key_block = tls10_prf(&master, b"key expansion", &key_seed, 72)?;
        let client_mac = key_block[0..20].try_into().expect("fixed key block");
        let server_mac = key_block[20..40].try_into().expect("fixed key block");
        let mut client_key: [u8; 16] = key_block[40..56].try_into().expect("fixed key block");
        let mut server_key: [u8; 16] = key_block[56..72].try_into().expect("fixed key block");
        let mut client_cipher = RecordCipher::new(client_mac, client_key);
        let mut server_cipher = RecordCipher::new(server_mac, server_key);
        client_key.zeroize();
        server_key.zeroize();

        write_record(&mut stream, CHANGE_CIPHER_SPEC, &[1])?;
        let client_verify = tls10_prf(
            &master,
            b"client finished",
            &handshake_hash(&transcript),
            12,
        )?;
        let client_finished = handshake_message(20, &client_verify)?;
        let encrypted_finished = client_cipher.encrypt(HANDSHAKE, &client_finished)?;
        write_record(&mut stream, HANDSHAKE, &encrypted_finished)?;
        transcript.extend_from_slice(&client_finished);

        let (content_type, change_cipher_spec) = read_record(&mut stream)?;
        if content_type != CHANGE_CIPHER_SPEC || change_cipher_spec.as_slice() != [1] {
            return Err(Error("TLS server ChangeCipherSpec is invalid".into()));
        }
        let (content_type, encrypted_server_finished) = read_record(&mut stream)?;
        if content_type != HANDSHAKE {
            return Err(Error("TLS server Finished record is missing".into()));
        }
        let server_finished = server_cipher.decrypt(HANDSHAKE, &encrypted_server_finished)?;
        let expected_server_verify = tls10_prf(
            &master,
            b"server finished",
            &handshake_hash(&transcript),
            12,
        )?;
        let expected_finished = handshake_message(20, &expected_server_verify)?;
        if !constant_time_equal(&server_finished, &expected_finished) {
            return Err(Error("TLS server Finished verification failed".into()));
        }
        Ok(Self {
            stream,
            client_cipher,
            server_cipher,
        })
    }

    pub fn write_application_data(&mut self, plaintext: &[u8]) -> Result<()> {
        if plaintext.is_empty() || plaintext.len() > 16 * 1024 {
            return Err(Error(
                "TLS application payload has an invalid length".into(),
            ));
        }
        let encrypted = self.client_cipher.encrypt(APPLICATION_DATA, plaintext)?;
        write_record(&mut self.stream, APPLICATION_DATA, &encrypted)
    }

    pub fn peer_address(&self) -> std::io::Result<SocketAddr> {
        self.stream.peer_addr()
    }

    pub fn set_read_timeout(&self, timeout: Option<Duration>) -> Result<()> {
        self.stream.set_read_timeout(timeout)?;
        Ok(())
    }

    pub fn read_application_data(&mut self, maximum: usize) -> Result<Zeroizing<Vec<u8>>> {
        let (content_type, ciphertext) = read_record(&mut self.stream)?;
        if content_type != APPLICATION_DATA {
            return Err(Error("expected TLS application data".into()));
        }
        let plaintext = self.server_cipher.decrypt(APPLICATION_DATA, &ciphertext)?;
        if plaintext.is_empty() || plaintext.len() > maximum {
            return Err(Error(
                "TLS application response has an invalid length".into(),
            ));
        }
        Ok(plaintext)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prf_is_deterministic_and_label_bound() {
        let first = tls10_prf(b"synthetic secret", b"label", b"seed", 64).unwrap();
        let second = tls10_prf(b"synthetic secret", b"label", b"seed", 64).unwrap();
        let other = tls10_prf(b"synthetic secret", b"other", b"seed", 64).unwrap();
        assert_eq!(first, second);
        assert_ne!(first, other);
        assert_eq!(first.len(), 64);
        assert_eq!(
            hex::encode(first),
            "8793ea16237fa3610209e587fe37b081db6453f77b4b0364e942a81c3cfcd861\
             505f4a1f078c89bd2da86f982e1295938a1f743f2d653fd05ab7498d6c603e18"
                .replace(' ', "")
        );
    }

    #[test]
    fn each_record_reaches_the_socket_in_a_single_write() {
        // A separate header write makes every tunneled packet a small segment
        // followed by a dependent read, which Nagle plus the gateway's delayed
        // ACK turns into a stall of tens of milliseconds per packet.
        struct CountingWriter {
            writes: Vec<usize>,
        }
        impl Write for CountingWriter {
            fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
                self.writes.push(buffer.len());
                Ok(buffer.len())
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        let mut writer = CountingWriter { writes: Vec::new() };
        write_record(&mut writer, APPLICATION_DATA, b"one tunneled packet").unwrap();
        assert_eq!(writer.writes, vec![TLS_RECORD_HEADER_LEN + 19]);
        write_record(&mut writer, HANDSHAKE, &[7; 300]).unwrap();
        assert_eq!(
            writer.writes,
            vec![TLS_RECORD_HEADER_LEN + 19, TLS_RECORD_HEADER_LEN + 300]
        );
    }

    #[test]
    fn record_cipher_round_trips_with_independent_states() {
        let mut sender = RecordCipher::new([3; 20], [7; 16]);
        let mut receiver = RecordCipher::new([3; 20], [7; 16]);
        let ciphertext = sender
            .encrypt(APPLICATION_DATA, b"bounded payload")
            .unwrap();
        assert_eq!(
            receiver
                .decrypt(APPLICATION_DATA, &ciphertext)
                .unwrap()
                .as_slice(),
            b"bounded payload"
        );
        assert!(receiver.decrypt(APPLICATION_DATA, &ciphertext).is_err());
    }
}
