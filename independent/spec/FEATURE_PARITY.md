# EasyConnect feature parity and forward-compatibility plan

This inventory is a behavior-level record for maintainers. It was produced
from the authorized, read-only inspection of:

- EasyConnect for macOS 7.6.7;
- EasyConnect for Linux 7.6.7.3;
- the current gateway's public metadata and redacted compatibility probes.

No vendor source, binary, credential, token, cookie, internal address, or raw
capture belongs in this repository. A feature visible in an official package
is only a capability signal; it does not prove that the HKUST(GZ) gateway has
enabled that feature.

## Product and protocol inventory

| Area | Capability present in official client | HKUST(GZ) Connect status | Maintenance decision |
| --- | --- | --- | --- |
| Primary authentication | Username/password and remembered login | Supported | Keep as the current production path |
| Interactive authentication | Image challenge, SMS passcode, token passcode and security question | Auth states recognized; interactive exchange not implemented | Add through the versioned auth-challenge control API; never encode it in the desktop UI |
| Certificate authentication | Imported certificate, certificate password and USB key | Capability recognized only | Separate credential-provider adapter; require an approved test profile |
| Federated authentication | SSO, QR code and WeChat flows | Capability recognized only | Browser-based auth provider using an isolated session |
| Endpoint authorization | Hardware-ID registration and approval states | Not implemented | Device-identity provider; do not invent or spoof attestations |
| Password lifecycle | Initial/expired password change and password policy display | Not implemented | Structured `password_change_required` challenge |
| Anonymous/Web-only login | Anonymous and security-check-degraded Web access | Not implemented | Separate profile capability, disabled by default |
| Session configuration | L3/TCP configuration and VPN DNS discovery | Supported for the active L3 profile | Preserve strict parser and version adapters |
| Resource catalogue | Groups, Web resources, public/private folders and application resources | Resource-list parser exists; catalogue is not exposed to the desktop | Add a sanitized resource provider and UI; never log raw resource data |
| Campus browsing | Resource page and external browser launch | Isolated in-app campus browser | Default novice path; no external browser or Clash required |
| Application access | TCP and UDP application traffic | TCP supported; UDP frontend exists, live service coverage incomplete | Keep UDP canary as a release gate |
| Remote application | Remote-app launch and notices | Not implemented | Independent launcher adapter only if the school enables it |
| Connection lifecycle | Auto login, reconnect, cancellation, timeout and passive kick | Auto-connect/reconnect supported; passive reasons are not structured | Move engine output to versioned structured events |
| User information | Login history, server messages and announcements | Not implemented | Read-only optional providers |
| Client lifecycle | Version mismatch, module update and client update | Public package watcher exists; no end-user updater | Signed update manifest with staged rollout and rollback |
| Diagnostics | Environment checks, service status and logs | Safe local logs and basic telemetry | Add one-click redacted diagnostic bundle |
| Network integration | L3 system tunnel, DNS service control, proxy checks and browser integration | Explicit SOCKS/PAC plus isolated browser | Do not copy global DNS mutation; add system integration only as a reversible, opt-in frontend |
| Multi-server profiles | Server history and server switching | Gateway is fixed by reviewed configuration | Institution-managed profiles may be added without changing protocol modules |
| Accessibility/i18n | Chinese/English UI and ordinary-user resource pages | README bilingual; app currently Chinese | Move strings to locale files before adding more challenge screens |

## What is deliberately different from EasyConnect

The official package contains privileged DNS, L3, monitoring, environment
check and browser-control components. HKUST(GZ) Connect must not copy that
deployment model merely to claim parity.

The default frontend is application-isolated:

1. the Rust engine obtains an address and runs the userspace network stack;
2. the desktop starts a loopback proxy;
3. the multi-tab Campus Browser uses a dedicated Electron session whose
   traffic goes through that proxy;
4. the operating-system DNS, global proxy, default route and other browsers
   remain unchanged;
5. if the engine stops, Campus Browser fails closed instead of silently going
   direct.

Campus website credentials are a separate local-only facility. A main-frame
HTTPS form submission may offer to save a credential, but storage requires
explicit user confirmation. The vault is exact-origin scoped, encrypted with
the operating-system credential provider, owner-only on disk, excluded from
logs and diagnostics, and unavailable when Linux would fall back to
`basic_text`.

An optional system-wide mode is acceptable only if it snapshots the exact
pre-connection state, writes changes transactionally, restores them on normal
exit and crash, and verifies restoration on the next launch. It must never be
the default for students who only need Web resources.

## Stable extension contracts

Future gateway features should plug into these contracts:

```text
Desktop
  -> versioned engine control protocol
       -> AuthProvider
          password | captcha | sms | token | certificate | browser_sso | device
       -> SessionProvider
       -> ResourceProvider
          web | tcp | udp | ssh | remote_app
       -> TransportAdapter
          legacy | modern | future-version
       -> Frontend
          campus_browser | socks | pac | optional_managed_system
```

The control protocol must represent, without UI-specific fields:

- `state_changed`;
- `auth_required` with a challenge ID, method and safe display metadata;
- `auth_response` and `cancel`;
- `resource_catalogue_changed`;
- `session_notice`, `password_change_required`, `upgrade_required`;
- `listener_ready`, `network_unhealthy` and `fatal_error`.

Unknown methods fail closed and remain visible as `unsupported_capability`.
They must never be treated as a bad password.

## Upgrade review checklist

For every official-client or gateway upgrade:

1. verify publisher signature and archive the package in restricted storage;
2. run public metadata and binary-capability watchers;
3. compare this inventory and the compatibility matrix;
4. exercise discovery, every enabled auth step, configuration, resource list,
   tunnel establishment, DNS, TCP, UDP, reconnect, passive logout and logout;
5. create sanitized fixtures for each changed contract;
6. update only the affected provider/adapter;
7. canary on staff devices before the student release.

No design can promise compatibility with every future proprietary protocol
without maintenance. This separation makes that maintenance bounded and
detectable instead of forcing a desktop rewrite.
