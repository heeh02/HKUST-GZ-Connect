# EasyConnect macOS 7.6.7 sanitized static observation

- Sample: `EC-MAC-INSTALLED-7.6.7-20260823`
- Evidence identity: `installed-mutated`
- Analysis type: authorized, read-only static extraction
- Credentials/session/runtime socket contents read: no
- Vendor source or binary content committed: no
- HKUST profile activation proven by this sample: none; an earlier, separate controlled observation covered the
  historical password path, but this installed-mutated sample cannot prove the currently enabled HKUST profile
  or any other school's configuration

## 1. Two independent evidence axes

Static implementation visibility and school-profile activation are different questions. A capability may be
directly visible in readable client code while remaining completely unproven on a particular Gateway profile.
They must not be collapsed into one confidence score.

Static visibility:

- `V4`: directly readable Electron/Web implementation or signed plist value;
- `V3`: signed package manifest, dependency, entitlement or symbol topology;
- `V2`: file/import/name marker only;
- `V1`: indirect adjacency clue requiring corroboration;
- `V0`: protected native internals or behavior unavailable to static inspection.

Profile activation:

- `A4`: current fixed school profile observed end to end with exact sample/run identity;
- `A3`: controlled historical school observation, not proof of current state;
- `A2`: sanitized profile/configuration response without end-to-end behavior;
- `A1`: indirect school-specific clue that has not been reproduced in a controlled run;
- `A0`: no profile evidence.

Unless a section says otherwise, implementation statements below are `V2`–`V4` static observations and their
HKUST activation level is `A0`. The separate historical password observation is `A3`; it is not evidence from
this macOS sample and does not establish the current HKUST configuration.

A `V3` signed-manifest/topology observation does not upgrade this `installed-mutated` sample into a pristine,
strictly verifiable or reproducible package baseline.

The sample contained approximately 1,314 ASAR files, 371 Web files and 20 bundled x86_64 dynamic
libraries. Complete inventories and extracted content remain restricted evidence; only this neutral summary is
retained.

## 2. Product architecture

```text
Electron shell and local Web portal
  ├── window/tray/menu/crash/settings services
  ├── broad preload + generic IPC bridge
  └── Web authentication/resource/settings SDK
             ↓
      loopback ECAgent control plane
             ↓
  ECAgentProxy / ECAgent / EasyMonitor / svpnservice
             ↓
  DNS / L3VPN / TCP / VIRTUALLINE modules
  legacy network components, privileged scripts and optional RemoteApp stack
```

The official client's feature breadth comes largely from a privileged local control plane and platform
components. This is not the architecture target for HKUST(GZ) Connect 2.0.

## 3. Electron shell and IPC

Evidence locations include ASAR Main, preload, window/controller and IPC service modules.
Evidence: `V4` implementation visibility; `A0` school-profile activation.

Observed design:

- one Electron composition root starts crash, IPC, tray, VPN, window and data services;
- local/remote pages call a generic preload API, which sends typed-name but broadly shaped IPC messages to
  Main services and ECAgent;
- one process owns multiple login, resource, status, settings, passive-logout, rejection and RemoteApp windows;
- tray menus expose resources, messages, link state and application actions.

Useful neutral ideas:

- single-instance ownership;
- explicit request/response correlation;
- separate window/tray/VPN/data services;
- service-state and passive-event UI.

Rejected security behavior:

- global certificate-error bypass and disabled web-security switch;
- `sandbox=false`, `contextIsolation=false`, broad preload/remote access and plugin enablement;
- generic IPC without exact sender/origin/schema ownership;
- remote URL windows plus arbitrary script injection;
- raw IPC/config/agent data logging.

The current HKUST Campus Browser sandbox, context isolation, exact sender checks and permission denial remain
the required baseline.

## 4. Authentication implementation

Evidence: `V4` client-module visibility; `A0` activation for the listed secondary methods. The historical
password observation remains separate `A3` evidence.

The Web SDK contains separate modules for:

- password/RSA/CSRF/anti-replay and CAPTCHA;
- SMS code acquisition, cooldown and submission;
- token/radius/security-question style continuation;
- TOTP and rebind;
- certificate list/import/authentication;
- USB key and HID discovery/registration;
- login domain/SSO;
- WeChat, DingTalk and enterprise-WeChat QR/OAuth flows.

The initialization path also checks relogin, proxy state, update/version, anti-MITM helper, HID and security
state before advancing through multi-step authentication and service startup.

2.0 migration decision:

- retain Engine-owned `AuthProvider`/`AuthTransactionOwner` and bounded challenge metadata;
- add one provider only after the method is observed on a fixed school profile;
- keep TwfID/Cookie/CSRF/continuation in Rust;
- keep response/resend/cancel/deadline and zeroization;
- never infer a provider from a static module name alone.

Do not migrate endpoint/field assumptions, Renderer-owned secrets, argv token/session material or raw response
logging.

## 5. Credential and settings implementation

Evidence: `V4` client implementation visibility; `A0` school-profile activation.

The official shell has global and per-VPN temporary/persistent stores, login history, remember-password,
auto-relogin and multiple VPN-address records. The static implementation uses reversible local protection and
logs configuration keys/values in several paths.

2.0 may borrow only:

- global versus profile-specific settings;
- temporary versus persistent state;
- explicit login history/profile selection;
- transactional migration.

It must retain OS secure storage, owner-only files, no secret argv, no reversible fixed-salt password storage,
no raw settings/credential logging and no cross-profile credential reuse.

## 6. Resources, SSO and service model

Evidence: `V4` client implementation visibility; `A0` HKUST profile activation for the resource classes and
service flows listed below.

The official resource SDK normalizes server configuration/resource documents into groups and multiple resource
classes, including Web, IP, application, DNS, FTP, file share, mail, RemoteApp/terminal and SSO-related
entries. It manages default/balanced resources, service start/query state, Web/EasyLink rewriting, external
browser opening and SSO form/cookie flows.

Useful neutral ideas:

- authenticated session-owned resource retrieval;
- opaque resource handles and grouped/default ordering;
- typed resource capability and required Exit;
- service readiness and per-resource failure state;
- passive catalogue refresh and balance/revision updates.

Rejected behavior:

- putting session identifiers in URLs;
- hidden-form credential/phone/certificate injection without exact origin and authorization;
- ActiveX/remote automation assumptions;
- interpreting opaque authorization fields without parity evidence;
- treating Web resource rewriting as ordinary HTTP proxying.

The current Campus Browser already provides multi-tab navigation, one fixed persistent Session, explicit
Campus/Direct routes, a local credential vault and certificate trust controls. It is not yet profile-scoped.
Making those stores and the Browser partition profile-scoped is a 2.0 target that better matches this project's
stated isolation and ordinary-user workflow goals; this static observation does not establish a comparative
usability result.

## 7. Notices, expiry and update

Evidence: `V4` UI/state-path visibility; `A0` HKUST profile activation.

Static UI/state paths exist for:

- passive logout/session switch;
- rejected login and concurrent-session state;
- password change/expiry;
- required client update, version mismatch and reinstall;
- service startup/download/no-power failures;
- messages, connection information and RemoteApp notices.

2.0 should expose stable secret-free events such as:

```text
session_notice
session_replaced
password_change_required
upgrade_required
resource_catalogue_changed
service_state_changed
```

Gateway-driven updates must not download/execute privileged code directly. Application updates require an
independently signed manifest, staged rollout and rollback.

## 8. Native services and platform integration

Evidence: `V3` for signed package/service topology, `V2` for module/component markers and `V0` for protected
native behavior; `A0` HKUST profile activation unless separately observed.

The bundle includes:

- a user LaunchAgent for `ECAgentProxy`;
- a root LaunchDaemon for `EasyMonitor`;
- root-owned setuid/setgid `ECAgent`, `EasyMonitor` and `svpnservice` binaries;
- certificate management/authentication in `ECAgentProxy`;
- DNS, L3VPN, TCP and VIRTUALLINE module declarations;
- legacy TUN/proxy-hook components and start/stop/reset/install scripts;
- RemoteApp/RSession components with clipboard, audio, input and graphics dependencies.

The sealed package topology also contains legacy TLS/crypto material and a private-key-formatted asset. Its
contents were not copied or retained. This reinforces the decision not to reuse the local Agent TLS design.

2.0 rejects root/setuid daemons, static local TLS keys, query-string control tokens, old driver stacks and
default RemoteApp clipboard/audio/input exposure. Optional RemoteApp support, if ever required, is a separate
backend and security review.

## 9. DNS, route, proxy and tunnel integration

Evidence: `V2`–`V4` depending on whether the item is a readable configuration/UI path or only a packaged
component marker; `A0` HKUST profile activation.

Static configuration/UI paths recognize:

- preferred/alternate DNS and special resource policies;
- L3/TCP service state;
- system proxy detection/testing and proxy credentials;
- multi-line selection and load balancing;
- cache/Web optimization;
- start/stop L3/TCP, reset-DNS and legacy TUN/proxy-hook installation components.

Only the following ideas are candidates for independent implementation:

- profile-owned split-DNS policy;
- typed L3/TCP service state;
- proxy-loop/conflict diagnostics;
- endpoint candidates, stickiness, health and explicit rollback.

Global DNS/route/system proxy mutation, kext/TUN hooks, root scripts and global first-L3 ownership remain out
of the default architecture.

## 10. Logging, crash and privacy

Evidence: `V4` for readable Electron/Web logging paths and `V2`–`V3` for packaged crash/native markers; `A0`
for school-specific use.

Static paths show broad logging of startup arguments, URLs, settings/configuration and Agent responses, plus
optional heap/crash collection. These are not acceptable diagnostics boundaries for 2.0.

Retain the current project model:

- typed/redacted events;
- bounded three-day logs;
- no full URL/query, password, OTP, Cookie, token, TwfID or raw response;
- explicit temporary diagnostic mode;
- crash recovery without secret-bearing heap upload.

## 11. Cross-project conclusion

EasyConnect contributes the broadest static feature catalogue in the reviewed evidence. It becomes a behavior
oracle only for a capability exercised in a separately authorized, fixed and sanitized parity run; this
installed-mutated static sample is not such an oracle. Its security and system-integration architecture is not
a template. The highest-value evidence-triggered migrations are:

1. real multi-stage authentication provider;
2. authenticated resource catalogue and service state;
3. passive notice/password-expiry/update reason;
4. typed endpoint/multi-line state;
5. independently signed update policy.

WebVPN, RemoteApp, aTrust, TUN and privileged platform components remain separately gated. Static presence
does not prove that HKUST or another school enables them.
