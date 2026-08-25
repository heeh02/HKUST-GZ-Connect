# ADR-0016: Generation-bound Gateway connector

- Status: Accepted for 2.0 P5a
- Production routing activation: deferred to P5b/P5c
- Scope: reviewed Profile Gateway origin, resolution and peer policy

## Decision

Every credential-bearing Gateway operation will consume one immutable
`GatewayConnectorGeneration`. A generation binds:

- reviewed `profileId` and Profile revision;
- a positive connector generation;
- one normalized credential-free HTTPS root origin;
- the origin host and effective port;
- one bounded, deduplicated DNS result set;
- the reviewed private-Gateway exception decision.

The connector resolves once. HTTP clients receive the same addresses through
Reqwest's explicit resolver override and disable implicit system/environment
proxies. Direct sockets verify that the connected peer belongs to the exact
generation set. A later network or Profile generation does not mutate an old
connector or its authenticated Cookie/token state.

## Address policy

The default reviewed policy accepts only public peers. It rejects:

- unspecified, loopback, link-local, multicast and broadcast addresses;
- documentation, benchmarking and reserved ranges;
- RFC1918, shared-address and IPv6 ULA results;
- a DNS response that mixes public and private scopes;
- a port different from the immutable Gateway origin;
- an IP-literal origin whose exact address does not match the peer set.

A reviewed built-in Profile may set `reviewedPrivateGatewayAllowed`. This
permits an all-private RFC1918/shared/ULA set, but never permits local,
link-local, multicast, unspecified, documentation or mixed-scope results.
Custom/local Profiles do not inherit this exception.

## Security boundary

The connector contains no credentials, Cookie, authentication transaction,
transport token or Browser data. It does not import authentication providers,
Modern L3, special TLS, DNS inside the VPN, SOCKS, probes or Renderer code.

Gateway TLS continues to use the reviewed hostname and standard PKI. P5a does
not add certificate bypass, a user-controlled resolver, a public probe, TUN,
system proxy mutation or a second transport route.

## Migration order

1. **P5a:** establish this contract and offline address/peer tests without
   changing current HKUST traffic.
2. **P5b:** construct one connector before authentication and route every
   Gateway HTTP request through its Reqwest builder. Cookie/session state is
   owned by the same generation.
3. **P5c:** route Modern token, address-control, send and receive sockets
   through the same connector; reject server-provided outer endpoints that do
   not match the authenticated connector policy.
4. **P6:** allow a second reviewed Profile only after cross-profile isolation
   and real deployment evidence pass. Experimental custom onboarding remains
   later and receives no private-Gateway exception by default.

## Required evidence

- exact origin normalization and endpoint binding;
- empty, oversized, port-drift and IP-literal mismatch rejection;
- public/private/mixed IPv4 and IPv6 address corpus;
- no implicit proxy discovery;
- exact peer membership;
- Profile/revision/generation immutability;
- HKUST password/Modern L3 behavior unchanged until P5b/P5c explicitly land.
