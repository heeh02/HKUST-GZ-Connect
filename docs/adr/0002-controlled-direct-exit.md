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
