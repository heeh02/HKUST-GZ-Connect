# Independent engine maintenance policy

No implementation can guarantee compatibility with every future proprietary
gateway revision. The maintainable goal is narrower and testable: detect a
change before release, identify the affected contract, update one isolated
adapter, prove parity in an approved lab, and keep a supported fallback while
that work is in progress.

## Control loop

1. **Observe** — the native `ec-watch` command compares public gateway metadata, module policy,
   package versions, and the streamed SHA-256 of the official Windows
   installer with a reviewed baseline.
2. **Quarantine** — a detected difference blocks compatibility CI. It never
   updates the baseline automatically.
3. **Acquire evidence** — authorized staff archive the new official package in
   restricted storage, verify its publisher signature and SHA-256, and record
   its provenance. Official binaries are never committed here.
   `ec-binary-watch` can then compare package/binary hashes and named
   protocol capability markers without reproducing vendor code.
   `ec-adapter-check` must also find exactly one valid x86/x86_64 sync/ack
   template pair, classify any runtime patch region, and match a newly reviewed
   hash baseline.
4. **Classify** — determine whether discovery, authentication, session,
   configuration, resource policy, tunnel framing, DNS, or local exposure
   changed.
5. **Specify** — analysts produce a behavior-only specification and synthetic
   fixtures. Decompiled source, raw tokens, credentials, and packet captures
   stay in restricted storage.
6. **Implement** — the independent engine changes only the affected adapter or
   state transition. The desktop UI talks to a versioned local engine API and
   does not contain gateway protocol logic.
7. **Validate** — official and independent clients run the same approved
   compatibility matrix. Negative, reconnect, timeout, and downgrade cases are
   mandatory.
8. **Canary and release** — deploy to staff canaries, observe failure metrics,
   then promote a signed build. Roll back the client independently of the
   gateway.

## Required architecture boundaries

```text
desktop / CLI
    -> versioned local engine API
        -> auth state machine
        -> gateway-version capability adapters
        -> session/config/resource parsers
        -> tunnel transport
        -> shared proxy policy
            -> one SOCKS5 TCP/UDP listener
            -> DNS-neutral PAC in the desktop layer
        -> TUN is a separate optional frontend
```

- Core types and state transitions are vendor-neutral.
- The userspace stack is the pinned `geiserx_ts_netstack_smoltcp` `0.43.0`
  compatibility fork. Its blocked-command generation guard is required for
  safe UDP socket closure; downgrading to the stale-handle-prone `0.4.0` line
  is prohibited.
- Version differences live in capability adapters selected from observed
  behavior, never scattered conditionals in the UI.
- The current official-preface adapter supports reviewed x86 and x86_64 ELF,
  Mach-O, and PE layouts. Runtime-patched fields are explicit adapter metadata;
  they are not guessed from architecture alone. ARM-only code, obfuscation, or
  an unrecognized call convention intentionally blocks release until a
  separately reviewed backend exists.
- Legacy raw L3 and modern TLS send/receive tunnels are different protocol
  families. A syntactically valid legacy reply or official-module marker must
  never be treated as evidence that the production gateway accepts that
  family.
- The active modern transport is isolated in `special_tls11.rs`. It accepts
  only the reviewed TLS 1.1/RSA/RC4-SHA selection, verifies the server
  certificate against WebPKI, the leaf from the same verified HTTPS session,
  or an explicit administrator-approved SHA-256 pin, and validates Finished
  and record MACs. It is not a reusable TLS library.
- Address control, send, and receive connections are pinned to the same
  resolved gateway peer for a session. DNS or certificate rotation creates a
  new session and must never splice live channels across backends.
- Unknown authentication methods or frames fail closed with a structured
  `gateway_incompatible` event.
- Parsers have strict size/depth limits and synthetic fuzz/regression inputs.
- Secrets are passed as secret inputs, never command-line arguments or logs.
- Gateway trust and official-package publisher trust are separate decisions.

## Release gates

A release is blocked unless all applicable gates pass:

- offline parser and state-machine tests;
- sanitized fixture tests for every supported gateway family;
- official-client versus independent-engine black-box parity;
- official package publisher verification plus binary/text/adapter hash review;
- SOCKS TCP, SOCKS UDP, PAC routing, reconnect, idle lifetime, timeout, and
  logout tests;
- required secondary authentication tests;
- supported OS/architecture packaging and signing;
- security review of new binary formats, crypto, drivers, or attestation;
- explicit acceptance or gateway remediation of the obsolete TLS 1.1/RC4
  transport risk before production packet forwarding;
- staff canary with a documented rollback.

The reviewed baseline may be updated only after the associated change is
classified and the required gates pass. A baseline update is an approval
record, not a repair.

## Fallback and availability

The school should retain a vendor-supported EasyConnect/aTrust distribution
channel and a documented emergency procedure. The independent client can
reduce vendor and upstream-project dependency, but it must not become the only
way administrators can reach recovery systems.

For critical administration, keep at least one management path that does not
depend on the same VPN implementation (for example, an approved bastion or
out-of-band access path). Exact choices require the school's network and
security owners.

## Build supply-chain continuity

- `rust-toolchain.toml` pins the reviewed compiler and `Cargo.lock` pins every
  Rust dependency and checksum. The crate has no Git dependencies and never
  fetches `zju-connect`.
- For each approved release, archive `cargo vendor --locked` output and the
  pinned Rust toolchain in institution-controlled artifact storage. The
  archive need not be committed to this repository, but its SHA-256,
  provenance, and restore test must be recorded.
- Keep macOS, Windows, and Linux build runners reproducible from that internal
  mirror. Test restoration at least every six months; an untested archive is
  not a continuity plan.
- Dependency and compiler upgrades are explicit maintenance changes. They
  must pass formatting, lint, offline fixtures, public live comparison,
  official-package comparison, credentialed parser validation, and the normal
  release gates.

## Ownership

- Network owner: approves gateway changes and maintenance windows.
- Security owner: approves analysis scope, evidence handling, and release risk.
- Protocol maintainer: owns specifications, fixtures, and adapters.
- Client maintainer: owns API integration, packaging, and rollback.
- Operations owner: owns canaries, monitoring, and incident response.

At least two named maintainers should be able to run the full release process.
Review authorization, vendor terms, test accounts, and fallback readiness at
least every six months and after any gateway major upgrade.
