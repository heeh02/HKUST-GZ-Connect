# ADR-0022: Credential-free public Gateway compatibility probe

- Status: Accepted for 2.0 P6a
- Scope: unreviewed `Other` Gateway compatibility check
- Profile creation, confirmation and credential entry: deferred to later P6 slices

## Decision

The first custom-Gateway operation is a separate Rust process and contains no
credential input. It accepts one normalized HTTPS root origin and executes one
compiled EasyConnect public discovery request:

```text
GET /por/login_auth.csp?apiversion=1
```

The path, method, headers, parser, timeout bounds and candidate family are
compiled code. Profile JSON, Renderer input and the Gateway response cannot
select another path or provider.

The probe constructs a fresh public-only `GatewayConnectorGeneration`, disables
environment proxies, redirects and Cookie persistence, retains hostname SNI and
standard PKI verification, limits the response body to 64 KiB and accepts only
bounded XML content types. Loopback, link-local, private, shared, multicast,
documentation, reserved and mixed-scope resolution sets remain rejected.

## Output boundary

The process returns only:

- normalized origin;
- whether the HTTPS identity was valid;
- `recognized_candidate`, `unsupported` or `unknown`;
- the one compiled candidate family, when recognized;
- a bounded sanitized version value, when present;
- HTTP status.

Raw XML, `TwfID`, CSRF material, RSA keys, Cookies, response headers and target
addresses never cross stdout. The response buffer is zeroized after parsing.
A recognized result is only a candidate public authentication surface; it does
not prove password acceptance, Modern L3, campus DNS, resources or MFA support.

## Deferred activation

This slice deliberately does not create a custom Profile, expose a Renderer
boolean as authorization, enable credential fields or launch the production
Engine. A later P6 slice must add a Main-owned, one-use, expiring confirmation
bound to exact origin, family, draft identity and active-context epoch before
creating isolated Profile/Account/Workspace state.
