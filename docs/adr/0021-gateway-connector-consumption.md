# ADR-0021: Consume one Gateway connector across HTTP and Modern transport

- Status: Accepted for 2.0 P5b/P5c
- Scope: production password authentication and Modern L3
- Probe compatibility: retained outside the production provider path

## Decision

A profile-bound Engine resolves and validates one immutable
`GatewayConnectorGeneration` before reading credentials. The same reference is
then retained by the authenticated HTTP session and by the Modern token
acquisition. Production connections use it for:

1. discovery, password configuration and password login;
2. authenticated session configuration and resource-list DNS;
3. bounded logout and partial-authentication cleanup;
4. the PKI-verified Modern token socket;
5. the address-control, packet-send and packet-receive special-TLS sockets.

The token acquisition records the actual connected peer. All three special-TLS
channels must reconnect to that exact peer, and the peer must still be a member
of the immutable connector generation. They do not perform another system DNS
lookup and cannot substitute another Profile or Engine generation.

## TLS and protocol boundary

This decision does not alter the reviewed EasyConnect wire protocol. Modern
token TLS still uses standard WebPKI verification for the reviewed hostname.
The isolated TLS 1.1 implementation still verifies its certificate through
WebPKI, the verified HTTPS leaf binding, or an explicit reviewed pin. Host drift
is rejected before network I/O, and no certificate bypass is added.

The compatibility probe path retains its explicit legacy resolver and direct
socket constructor. Production provider composition is the only activated
path, and it always carries the profile-bound connector when launched by the
Desktop or reviewed CLI binding.

## Failure and timeout policy

The connector applies one total timeout across its bounded peer set rather than
granting the full timeout to each address. A requested or connected peer outside
the generation fails permanently. Ordinary connect refusal, reset, or timeout
remains a transient data-plane error and may use the existing bounded retry
policy. Protocol, certificate, host, Profile, revision, and generation drift do
not become retryable through diagnostic wording.

## Required evidence

- connector construction precedes credential input;
- HTTP and Cookie state retain the same connector reference;
- token acquisition retains Profile, revision, generation and exact peer;
- address-control, send and receive each use the token's connector and peer;
- special TLS rejects host drift before opening a socket;
- probe compatibility remains separate from production composition;
- password-only and lifecycle-fixture regressions stay green.
