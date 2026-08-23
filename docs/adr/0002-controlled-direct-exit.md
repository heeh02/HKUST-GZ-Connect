# ADR-0002: Campus Browser direct-route address safety

- Status: Accepted limitation for 1.x; ControlledDirectExit deferred to 2.0
- Date: 2026-08-23

## Context

Campus Browser supports user-approved direct domains such as Microsoft 365 and
Canvas. Chromium PAC returns `DIRECT` for those hosts. The current pre-resolution
guard rejects literal loopback, link-local and private targets, but Chromium—not
this application—resolves an ordinary direct hostname. A hostname that later
resolves or rebinds to a local/private address therefore cannot be rechecked by
the current PAC layer.

The campus-tunnel path does not have this limitation: SOCKS/HTTP destinations
pass the Engine's resolved destination policy. External PAC users are also
outside an application-controlled direct dialer.

## Decision

For 1.x:

1. direct routing remains limited to explicit school defaults or local user
   rules;
2. literal unsafe addresses and unsafe URL forms remain blocked before PAC;
3. the application does not claim resolved-address protection for Chromium
   `DIRECT`;
4. this limitation does not justify TUN, global DNS interception, disabling web
   security, or proxying all public traffic through the campus tunnel;
5. changes to built-in direct domains require review and route tests.

For 2.0, `ControlledDirectExit` is the intended solution: resolve through a
bounded resolver, validate every returned address, connect through an owned
dialer, bind the decision to policy revision/generation, and revalidate on
redirect or new connection. It must preserve browser Cookie/SSO continuity and
must not silently fall back to campus routing.

## Alternatives

| Alternative | Decision |
| --- | --- |
| Keep Chromium `DIRECT` forever | Accepted only as the explicitly documented 1.x limitation; insufficient for a stronger 2.0 resolved-address claim |
| Send partner/public sites through Campus L3 | Rejected as a default: it breaks sites that reject the campus path and violates explicit Direct policy |
| Intercept global/system DNS | Rejected: expands privilege and system-mutation scope without owning Chromium's final socket |
| Proxy all public traffic through one generic local forwarder | Deferred unless it can preserve browser Session, TLS, redirects, downloads and streaming without becoming a second browser stack |
| TUN or route injection | Rejected for this problem; disproportionate privilege and rollback cost, and does not by itself define safe Direct resolution |
| Electron/Chromium supported connection hook | Preferred if a future supported API can bind resolution and dialing while retaining one persistent Session |

## Reopen criteria

Promote the deferred work when one of these is true:

- an authorized test reproduces a meaningful rebinding/local-service risk;
- Chromium/Electron offers a supported connection hook that preserves one
  persistent browser Session;
- a 2.0 controlled-exit implementation has cross-platform tests for public,
  loopback, link-local, private, IPv4-mapped IPv6, multi-answer and rebind cases.

## Consequences

The 1.x risk is explicit and bounded but not eliminated. Users should add only
domains they trust to direct rules. Campus routing, local listeners, system DNS,
routes and proxies remain unchanged. Release notes must not describe 1.x direct
routing as resolved-address isolated.

## Security

- Current 1.x checks unsafe literal addresses and URL forms before route selection, but deliberately makes
  no post-resolution guarantee for an ordinary hostname.
- Direct rules remain explicit school defaults or local user decisions; a page cannot silently create a
  new persistent rule.
- Browser sandbox, context isolation, permission denial and local-service navigation guards remain active
  on both routes.
- A future ControlledDirectExit must validate every IPv4/IPv6 answer, redirects and new connections;
  mixed safe/unsafe answers, rebinding, IPv4-mapped IPv6 and policy-generation changes fail closed.
- Resolution or dial failure must not silently downgrade to Campus, system proxy or a different Exit.

## Rollback

Current 1.x adds no new component, privilege or persistent state, so rollback is documentation/policy
reversion only. A future ControlledDirectExit must be independently feature-gated. If disabled or rolled
back, it must close its resolver/dialer, invalidate its generation and return a typed Exit-unavailable
result; it may restore the explicitly documented 1.x Chromium `DIRECT` behavior only through a reviewed
version decision, never silently during an active request.

## Evidence

- `desktop/lib/campus-browser.js` and routing policy tests prove URL/literal prechecks, explicit route
  ownership and fail-closed Campus request gating.
- JS/PAC differential tests prove current domain decision consistency, not resolved-address isolation.
- Campus Engine SOCKS/HTTP destination policy covers the tunnel path only and does not prove Chromium
  `DIRECT` safety.
- `docs/engineering/1x-release-gate.md` retains the accepted limitation and the still-missing real
  Direct/SAML canary evidence.
- No current test owns Chromium's ordinary direct DNS resolution and socket, which is the reason the 2.0
  capability remains `I0/E1` rather than implemented.
