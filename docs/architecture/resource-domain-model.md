# Web resource model

Status: accepted and implemented on the active P8 branch; merge remains independently reviewed.

## 1. Product boundary

The first 2.0 user-facing resource model is deliberately Web-only. Campus Connect establishes a safe campus
network and opens ordinary Web pages in Campus Browser. Mature external tools continue to own SSH, remote
development, databases and HPC workflows.

The first Beta does not define or implement:

- SSH, TCP, UDP, HPC, Jupyter, database, file, Remote Desktop or WebVPN resource types;
- `ResourceDescriptor`, `resourceHandle`, `LaunchHandle`, `ResourceLaunchBroker` or `ForwardLease`;
- an SSH client, terminal, scheduler/HPC manager or application-specific forwarding workbench.

External Clash/Mihomo YAML and VS Code Remote-SSH snippet generation belongs to the independent
[`External Tool Integration Center`](../adr/0005-external-tool-integration-center.md), not this model.

## 2. Current evidence

The current product already has:

- fifteen reviewed built-in Web shortcuts, including nine current HKUST(GZ) academic tools linked by the
  official Academic Registry Services Systems & Tools page;
- locally managed custom Web shortcuts;
- Campus/Direct route choice and remembered domain rules;
- a sandboxed, multi-tab Campus Browser;
- a local exact-origin credential vault and certificate-pin management.

The Rust catalogue parser is offline structural evidence only. Production does not retrieve or authorize a
server resource catalogue. An EasyConnect/aTrust field name must not create a new resource type or launch action.

## 3. WebResource

P8 uses one small, versioned value model:

```text
WebResource
  schemaVersion
  id
  localizedName
  localizedDescription
  url
  route                 campus | direct
  category
  keywords[]
  iconKey?
  reviewed
```

`LocalizedText` is an exact bounded object:

```text
LocalizedText
  zh
  en
```

No arbitrary locale keys, HTML or remote translation payloads are accepted. Until reviewed English labels are
available, migration may use the current local label as the fallback for both locales; the UI must not invent a
translation.

### Field rules

- `id` is stable and unique inside one Profile. Local IDs cannot replace a reviewed built-in ID.
- `localizedName` and `localizedDescription` are bounded, control-character-free text rendered by text APIs.
- `url` is a canonical HTTP(S) URL without embedded credentials. Reviewed built-ins require HTTPS.
- `route` is explicit. Campus failure never silently becomes Direct.
- `category` is a closed presentation value such as `common`, `academic`, `campus-service` or `custom`.
- `keywords` are bounded local search terms. They never affect trust, authorization or routing.
- `iconKey` resolves only to a packaged allowlisted asset; remote icon URLs are not accepted.
- `reviewed` describes packaged review provenance. It is not server authorization and does not bypass URL,
  destination, certificate or route checks.

The value contains no Cookie, token, CSRF, TwfID, VPN credential, proxy credential, hidden form body, command,
executable path or provider authorization material.

## 4. Source and storage

The first Beta has only two production sources:

| Source | `reviewed` | Ownership |
| --- | --- | --- |
| packaged Profile resource file | `true` | read-only, SHA-256 bound to the reviewed Profile manifest |
| local custom website | `false` | editable on this computer inside the active Profile/Account workspace |

The packaged source is the single file referenced by `browser.builtinResourcesRef`. Profile JSON does not embed
a duplicate resource array.

Built-in and custom documents remain independently bounded to 32 entries. The 1.x compatibility shelf is a
built-in-first projection of at most 32 visible entries. Projection conflict/overflow receipts never rewrite the
stored custom source. P8 may introduce category/search views over the lossless sources, but changing these limits
requires an explicit UI/storage decision rather than an incidental merge change.

Future authenticated server Web resources require an evidence-backed `ResourceProvider`, explicit authorization
semantics, revision/expiry and a separate promotion gate. They may be normalized into `WebResource` only after
that gate; they do not expand the first-Beta type system.

## 5. Open flow without launch handles

The control Renderer selects a stable resource ID. It does not mint or receive an authorization handle.

```text
user selects WebResource
  -> trusted IPC validates the sender and bounded resource ID
  -> Main resolves the ID in the active Profile/Account resource store
  -> Main revalidates current resource revision, canonical URL and route
  -> Direct: open without starting or waiting for Campus Engine
  -> Campus: ensure the current Engine generation and Browser request gate are ready
  -> open one Campus Browser tab
  -> record a sanitized success/failure outcome
```

Every click performs a fresh owner-side lookup. The Renderer cannot supply a replacement URL, route, command,
host or port for an existing resource. Profile/Account switches invalidate the active store and queued opens by
context epoch; a stale request fails and the user clicks again. No persistent or one-use `LaunchHandle` table is
needed for this Web-only flow.

For the existing local-resource editor, the user may submit their own bounded URL/name/description/route draft.
That mutation path cannot edit a packaged built-in and remains separate from the open action.

## 6. Routing behavior

All Web opens use the shared route policy:

```text
exact user domain rule
  > user parent-domain rule
  > local WebResource route
  > reviewed Profile domain rule
  > authenticated server suggestion (future, evidence-gated)
  > Campus default
```

Direct is forbidden for loopback, unspecified, link-local, multicast and private/local targets under the existing
safety policy. The first Beta retains the documented Chromium Direct boundary; a future controlled Direct Exit
may strengthen resolved-address ownership without changing `WebResource`.

Microsoft 365, Canvas and other reviewed partner domains can remain Direct while redirects back to a campus
domain return to Campus through the same Browser Session and route policy.

## 7. Ordinary-user features

P8 adds lightweight presentation over `WebResource`:

- categories;
- local search over name, description and keywords;
- favorites;
- recent successful opens;
- user-defined websites;
- clear Campus/Direct labels;
- one-click open.

Recommended reviewed categories are:

- **Common:** one-stop services, Outlook, Canvas and library;
- **Academic:** SIS/course registration, class schedule/quota, exams, grades and room booking;
- **Campus services:** school home, orientation, identity/account and IT-service entry points.

Every concrete URL must be confirmed from an official school page before entering a reviewed Profile. A product
name alone is not sufficient evidence for a URL.

Favorites and recent entries store only Profile/Account scope, resource ID and bounded timestamps. They do not
copy URLs or create routing authority. Search stays local and sends no query to the school or project maintainer.

## 8. Multi-school isolation

Each Profile/Account workspace owns its own:

- custom websites;
- favorites and recent entries;
- Campus Browser partition;
- website passwords and certificate pins;
- domain route rules.

Profile A records are never visible or openable in Profile B. A Profile switch closes or invalidates old queued
opens before the new Profile becomes active. The initial multi-school release still runs only one active Engine.

## 9. Migration

P8 migration reads both current sources directly:

1. the manifest-bound built-in resource file;
2. every normalized custom resource retained in settings.

It must not use the 32-visible compatibility projection as migration input. Existing IDs remain stable where
valid. Migration adds localized/category/search metadata without changing URLs, routes, Browser partitions,
cookies or website credentials.

If a legacy custom URL duplicates a built-in, the built-in remains visible and the custom record remains
available for explicit user deletion. Invalid or overflow normalization must produce a bounded local receipt;
future saves must not silently erase unreported user records.

## 10. Acceptance gates

P8 is complete only when:

- no SSH/HPC/TCP/Jupyter/database/File/Remote Desktop/WebVPN launcher or `LaunchHandle` exists in production;
- all packaged resources pass the single shared schema at package and runtime validation;
- Direct Web resources open without starting Campus; Campus resources never silently fall back Direct;
- category/search/favorite/recent/custom/open behavior is Profile/Account isolated;
- a stale Profile/Account request opens zero pages;
- invalid, duplicate and canonical-length-overflow resources fail or produce an explicit compatibility receipt;
- Renderer/IPC/logs contain zero VPN/proxy credentials, Cookies, tokens or hidden authorization material;
- current Browser routing, password-vault, certificate and multi-tab E2E suites remain green;
- macOS, Windows and Linux package verifiers contain the reviewed resource source and reject the legacy duplicate
  resource asset.

## 11. Deferred capabilities

The following remain separate evidence-gated decisions after the first Beta:

- authenticated EasyConnect resource catalogue and notices;
- WebVPN, aTrust and per-application TCP backends;
- generic port forwarding, TUN and Headless service mode;
- RemoteApp or mobile clients.

None of them is activated by adding a field or enum value to `WebResource`.

## References

- [HKUST(GZ) Academic Registry Services — Systems & Tools](https://ars.hkust-gz.edu.cn/systems-tools/) is the
  reviewed discovery source for SIS, class schedule/quota, examination, grade reporting, room booking, class
  enrollment and Canvas entries. Each final target is still checked individually before entering a packaged
  Profile; the name of a system alone is not a URL contract.
