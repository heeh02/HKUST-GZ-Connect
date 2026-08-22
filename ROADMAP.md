# HKUST(GZ) Connect 1.2.3 baseline and roadmap

This roadmap is an implementation and evidence ledger, not a promise that an
unobserved proprietary gateway revision will work forever. A trait, parser,
capability marker, mock, or sanitized fixture is useful preparation, but it is
**not** a finished user feature.

## Status and evidence rules

- **Done**: the capability is wired into the production path, has bounded
  regression coverage, and has the real-device or school-gateway evidence that
  the capability requires.
- **Partial**: an interface, classifier, offline parser, observer, or one side of
  the production flow exists. Partial items must not be advertised as supported.
- **Pending**: no reviewed production implementation exists.
- **Real-environment dependency**: the item cannot move to Done using synthetic
  fixtures alone. It needs a school-controlled enabled profile, authorized test
  identity/device, and comparison with the supported official client.

The compatibility matrix in `independent/spec/COMPATIBILITY_MATRIX.md` remains
the detailed evidence record. If this roadmap and that matrix disagree, use the
more conservative status until the discrepancy is reviewed.

## Release 1.2.3 baseline

| Area | Status | Production result | Evidence still needed |
| --- | --- | --- | --- |
| Independent password + modern L3 engine | **Done** for the current HKUST(GZ) profile | Rust owns authentication, tunnel setup, userspace TCP/UDP and loopback proxying; the authenticated session is separated from L3 configuration, token, DNS and data-plane ownership | Repeat the restricted canary after a gateway or official-client upgrade |
| Isolated Campus Browser | **Done** for the current Web path | Multi-tab browser, direct/campus routing, local credential vault and fail-closed tunnel policy; a two-process Electron gate proves exact/subdomain rules and PAC survive an app restart | Cross-platform campus-site canary for each release |
| SOCKS/PAC/Clash/SSH frontends | **Done** for documented TCP use | New installs default to strict local authentication; older compatibility choices require an explicit migration decision; no global network mutation | Windows current-user-only helper sidecar requires the remote Windows CI result for this release |
| Authentication correctness | **Done** for the current password-only profile | Explicit rejection, indeterminate network outcome and protocol-invalid responses have distinct stable codes; stale cancel cannot destroy a valid transaction; Engine-owned deadlines and budgets fail closed | Real Gateway MFA remains unsupported until authorized sanitized evidence exists |
| Lifecycle and recovery | **Partial** | Event API v1 emits a generation-bound structured `stopped` reason; authentication consumes shutdown/pipe EOF through a cancellable coordinator and renderer loss cancels a pending challenge | Sleep/resume, network switching and server-initiated termination need real-device canaries |
| Desktop performance | **Partial** | Offline 20-tab switching/lifecycle soak and a hidden-idle telemetry contract exist | Stable product baselines on supported macOS/Windows hardware and a real campus page set |
| Split-horizon campus DNS | **Done** for the current HKUST(GZ) profile | Authenticated `rclist.csp`/`conf.csp` DNS is acquired automatically; matching truncated UDP responses retry the same campus resolver over userspace TCP; public/system fallback is disabled | Repeat the HPC hostname and truncated-answer canary after a gateway or school DNS change |

### 1.2.3 authentication and DNS hardening

The active gateway publishes split-horizon DNS in the authenticated
`rclist.csp` resource policy even when the optional `conf.csp` fields are
empty. The 1.2.x line reads both protocol locations on every connection.
Downloaded policy is authoritative; the bounded reviewed deployment profile
is selected only when both locations are empty or unavailable. Queries travel
through `VirtualNetstack`, responses validate transaction ID and the exact
question, and only bounded A answers are cached. Version 1.2.3 adds
length-prefixed TCP to the same resolver only after a valid `TC=1` response.
Public/system fallback is disabled and no operating-system DNS setting or route
is changed.

Authentication now treats only a verified structured password-required state
as credential rejection. Timeout/reset/partial outcomes are indeterminate and
stop blind automatic retries; malformed structured responses are protocol
invalid. Remote cleanup status is secondary and never overwrites the primary
failure. Generic interactive transactions remain synthetic-only but are
bounded by Engine-owned monotonic deadlines, steps, submissions, resends and
continuation-request ceilings.

### 1.2.1 lifecycle and restart evidence

The lifecycle APIs have deliberately separate directions. Event API v1 is the
engine-to-supervisor bounded event stream. Control API v2 is an opt-in,
bidirectional protocol over the already inherited private stdin/stdout pipes;
it does not open a loopback control listener. Closing that stdin channel closes
control only and does not implicitly stop the tunnel. The current implemented
control capabilities are graceful engine shutdown, request cancellation, and
control-channel close. During authentication, losing the private pipe cancels
that generation; after connection, pipe EOF closes control only and leaves the
tunnel under process/signal supervision. Names for resource, WebVPN, or MFA capabilities return
typed unsupported errors and are not implementations.
The framing and EOF contract is documented in
[`independent/spec/ENGINE_CONTROL_API_V2.md`](independent/spec/ENGINE_CONTROL_API_V2.md).

Run the true two-process app-restart routing contract from `desktop/`:

```bash
npm run test:routing-restart
```

The parent creates one temporary userData directory. One Electron process
writes exact-domain and subdomain rules and exits; a second process reopens the
same directory and checks persisted rule resolution, the generated PAC, and
single-Session browser ownership. The parent enforces hard deadlines and
removes the temporary directory. This is offline persistence evidence, not a
campus-site availability test.

### 1.2.1 performance work

The 1.2.1 performance gate has two deliberately different layers:

1. **Offline disaster guards** fail builds on hangs, leaked views/timers, hidden
   application enumeration, or very large latency regressions. They use only
   synthetic loopback/blocked-port inputs and do not contact the gateway.
2. **Product targets** describe the desired experience, such as 20-tab switch
   p95 and hidden main-process CPU. They are reported but are not release gates
   until repeated measurements exist for supported school devices.

Run the deterministic hidden-idle baseline from `desktop/`:

```bash
npm run test:idle-performance
```

Run the existing real-Electron, synthetic-network 20-tab/lifecycle gate:

```bash
npm run test:browser-performance
```

Each command emits one bounded line prefixed with
`HKUSTGZ_DESKTOP_PERF_JSON ` using schema
`hkustgzconnect.desktop-performance.v1`. Store the line together with commit,
OS, architecture, Electron version, power mode and whether the machine was on
battery. These reports do not measure gateway latency, tunnel throughput, DNS
latency or real campus-page rendering.

## Future 2.0.0 EasyConnect compatibility contingency plan

This section is deliberately inactive in the 1.x maintenance line. It records
what the code can and cannot do today so the school has a reviewed starting
point if an optional EasyConnect feature is enabled later. It is not a 2.0.0
release commitment, and none of the Partial entries below is advertised as a
working user feature.

The trigger for implementation is evidence that the school has enabled a
specific capability on a controlled test profile. Work should then cover only
that capability, compare it with the supported official client, and pass the
promotion checklist below before its status changes to Done.

| Order | Capability | Status | What exists now | Required next evidence/work |
| ---: | --- | --- | --- | --- |
| 0 | `AuthProvider`, `ResourceProvider`, `TransportBackend` boundaries | **Done** | Stable Rust traits, typed `Supported`/`Unsupported`/`Unavailable`, production password and L3 adapters, fail-closed contract tests | Keep vendor wire formats in narrow adapters |
| 1 | Server campus resource catalogue, groups and authorization | **Partial** | Bounded offline parser, opaque handles and redacted presentation v1; authorization values are only `declared_unverified` | Implement authenticated retrieval, expiry/refresh, authorization semantics and safe desktop presentation; canary all of them on the school profile |
| 2 | Announcements, passive kick, password expiry and forced-upgrade reason | **Partial** | Generic bounded engine lifecycle/error events exist | Add gateway-specific reason parsing plus `session_notice`, `password_change_required` and `upgrade_required`; test server-initiated cases live |
| 3 | WebVPN-only access when L3 is absent | **Partial** | The configuration parser recognizes a WebVPN endpoint and a typed backend slot exists | Implement authenticated WebVPN transport/resource rewriting; validate a profile with L3 disabled. Current production correctly fails instead of going direct |
| 4 | Multiple-line discovery and healthy selection | **Partial** | Multiple VPN endpoints can be parsed offline | Define authenticated discovery, bounded parallel health policy, sticky selection and safe failover; validate against multiple school-controlled lines |
| 5 | CAPTCHA | **Partial** | Auth state classification and provider challenge boundary exist | Implement challenge fetch/expiry/response/cancel and bilingual accessible UI against an enabled test account |
| 6 | SMS, TOTP and dynamic-token authentication | **Partial** | SMS/token states are classified; mock providers prove only that the interface is extensible | Implement each provider independently, including resend/rate-limit/expiry; validate each enabled method. The modern L3 transport token is not a user OTP feature |
| 7 | Isolated SSO, QR code and WeChat-style flow | **Partial** | States are recognized; the ordinary Campus Browser is isolated | Build a separate authentication session, callback/state binding and cancellation contract; validate each enabled identity-provider flow. Browser isolation alone is not SSO support |
| 8 | Certificate, USB Key and HID authentication | **Partial** | Capability recognition and explicit unsupported errors only | Begin only after the school supplies an approved profile, device/key lifecycle and vendor-supported comparison environment; use platform credential APIs, not process-scanning shims |

## Deliberate non-goals

The following official-client behaviors are not parity targets:

- changing global DNS, the default route or the operating-system proxy by
  default;
- a root/administrator-resident service merely to keep the GUI connected;
- process-driven USB monitoring, security-desktop impersonation or compliance
  bypasses;
- globally ignoring certificate errors or disabling browser web security;
- proprietary RemoteApp drivers without a separate school-approved product and
  security assessment.

System integration, if the school later needs it, must be a signed, reversible,
opt-in platform component with scoped routes/DNS and an auditable rollback. It
must not weaken the isolated browser and explicit-proxy defaults.

## 2.0.0 promotion checklist for every activated capability

1. Obtain authorized official-client behavior from a school-controlled enabled
   profile; never use production student credentials as a fixture.
2. Record a sanitized, bounded contract fixture and the expected failure mode.
3. Implement one provider/adapter without changing unrelated frontends.
4. Keep unsupported, unknown and expired states as typed fail-closed tests.
5. Compare official and independent clients on the same test profile.
6. Canary on staff devices, document rollback, then and only then change the
   roadmap and compatibility matrix to Done.
