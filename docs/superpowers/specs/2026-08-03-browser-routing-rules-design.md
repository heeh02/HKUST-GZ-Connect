# Browser routing rules design

## Purpose

The Campus Browser must let a user choose **Campus tunnel** or **Direct** for
the current website, remember that choice locally, and apply it consistently to
new tabs, main-frame redirects, and popup/SSO flows. The design fixes the
current failure mode where an Outlook or Canvas flow reaches a different login
host and falls back to the campus SOCKS session.

This feature changes only the in-app Campus Browser. It never modifies system
DNS, the default route, global proxy settings, or ordinary browsers.

## User experience

1. The route selector in the browser toolbar always shows the active tab's
   effective route: **Campus tunnel** or **Direct**.
2. Changing the selector immediately switches the current tab to the selected
   route, reloads its current URL, and creates or replaces an exact-host user
   rule without a confirmation dialog.
3. A short non-sensitive status message confirms the saved rule, for example:
   `Remembered: login.microsoftonline.com → Direct`.
4. A separate **Network rules** manager lets users edit or delete remembered
   rules. It is separate from Common Websites, which remains a bookmark
   manager.
5. A remembered rule initially applies only to the exact current hostname.
   In the manager, a user may enable **Include subdomains** to apply it to the
   hostname and every descendant hostname.
6. Popup and SSO windows are represented as tabs. They inherit the route of
   their opener unless a more-specific remembered or built-in rule matches the
   popup host.

## Rule data and local storage

Rules are stored in the Electron user-data directory as
`routing-rules.json`, never in the repository, app bundle, logs, diagnostics,
or a cloud account.

The versioned file has this shape:

```json
{
  "version": 1,
  "rules": [
    {
      "host": "login.microsoftonline.com",
      "includeSubdomains": false,
      "route": "direct",
      "updatedAt": 1760000000000
    }
  ]
}
```

`host` is a normalized ASCII hostname: lowercase, without a trailing dot, no
scheme, path, port, query, fragment, credentials, wildcard, or whitespace.
Internationalized names are stored in ASCII/Punycode form. The rule store
contains a bounded number of entries and uses an atomic temporary-file rename
with owner-only permissions. Invalid, duplicated, or malformed entries are
discarded on load; a malformed file falls back to an empty user rule set rather
than changing system networking or making the browser direct by default.

The store records only hostnames, route choice, scope, and modification time.
It never records URLs, SAML query strings, browser cookies, account names, or
passwords.

## Route-resolution contract

Every main-frame navigation, popup, and explicit toolbar route change resolves
the route through one shared function. The resolution order is fixed:

1. Exact-host user rule.
2. User rule whose `includeSubdomains` flag matches the hostname.
3. Reviewed built-in partner rule.
4. Inherited route context: the opener tab for a popup, or the source tab for
   a server-driven main-frame redirect / SSO continuation.
5. Campus tunnel as the safe default.

Built-in partner rules retain the current direct defaults for Outlook and
Canvas. User rules always override built-in rules. Inherited context is a
continuity fallback only: it keeps an Outlook tab's Microsoft login redirect or
popup Direct, but it does not silently create a permanent rule for the
redirected host. A toolbar entry or deliberately opened new tab has no inherited
context, so it resolves only through user rules, built-ins, and the default.

Each tab records both its effective route and optional opener route. If the
resolved route differs from the tab's existing Electron session, the browser
creates a replacement `WebContentsView` in the resolved isolated session,
restores the same URL, and disposes the old view. A navigation-generation token
prevents the replacement load from triggering an infinite route-switch loop.

## Navigation handling

- **Toolbar navigation:** resolve the typed hostname before loading it.
- **Main-frame redirect or cross-origin SSO continuation:** resolve the target
  before it commits, using the source tab's route as inheritance fallback. If
  its route differs, cancel the pending load, switch the tab's isolated
  session, and load the same target once.
- **Popup or `window.open`:** create a tab using the popup URL and the opener
  route as the inheritance fallback. The tab receives a configured session even
  when that route has not been used previously.
- **Subframes:** keep the route of their containing tab. They cannot change an
  entire tab's network route.
- **Non-HTTP(S) targets:** remain blocked by the existing navigation policy.

Changing from Campus tunnel to Direct does not alter the global SOCKS listener
or system settings. Changing from Direct to Campus tunnel asks the main process
to establish the local engine first when saved credentials permit it; if the
tunnel cannot become ready, the tab stays unchanged and receives a clear error
instead of a silent direct fallback.

## Rule manager

The manager lists hostname, route, scope, source, and last update time. It
supports:

- deleting a user rule;
- changing its route;
- toggling exact-host versus include-subdomains scope;
- adding a normalized hostname rule deliberately.

Built-in rules are visible as recommendations but cannot be edited or deleted.
A user rule for the same hostname takes precedence and is displayed as an
override. There is no account synchronization, import/export, telemetry, or
automatic broad-domain rule creation.

## Module boundaries

- `desktop/lib/routing-rule-store.js`: normalization, bounded versioned JSON
  loading, atomic owner-only persistence, and rule mutations.
- `desktop/lib/route-resolver.js`: pure precedence resolution from user rules,
  built-ins, and optional opener route.
- `desktop/lib/campus-route.js`: reviewed built-in partner defaults and
  session/proxy configuration only; it does not read files.
- `desktop/lib/campus-browser.js`: tab lifecycle, navigation interception,
  session replacement, popup inheritance, and toolbar state.
- `desktop/main.js` and `desktop/preload.js`: narrow IPC endpoints for reading
  and mutating user rules.
- `desktop/renderer/campus-browser.*`: selector feedback and access to the
  Network rules manager.

No renderer receives filesystem paths or direct access to the rule JSON file.

## Error handling

- Corrupt JSON produces an empty user rule set and a non-secret recoverable
  warning; it never turns every page into Direct mode.
- A failed save leaves the existing tab route active for that load and reports
  that the choice was not remembered.
- A failed route-session replacement keeps the old view and route alive where
  possible.
- Direct pages never require the VPN engine. Campus pages require the engine
  and fail closed if the local SOCKS tunnel is unavailable.

## Acceptance tests

1. Switching `login.microsoftonline.com` to Direct creates an exact-host rule
   and restores it after application restart.
2. The rule applies to that host but not to a sibling host.
3. Enabling Include subdomains applies the rule to descendants and preserves
   exact-host precedence over a broader rule.
4. User rules override built-in partner defaults; built-ins override parent
   inheritance; inheritance overrides the campus default.
5. An Outlook Direct tab opening a Microsoft login popup keeps that popup
   Direct without creating a new persistent Microsoft rule.
6. A campus popup targeting a reviewed direct partner receives a configured
   Direct session instead of silently failing because the session was absent.
7. Main-frame redirects change session only when route resolution requires it,
   and cannot loop indefinitely.
8. Invalid hosts, overlong input, malformed JSON, duplicated entries, and
   failed writes do not create a route rule or cause a silent Direct fallback.
9. Rule data persists only in the local owner-only JSON file and contains no
   query strings, account identifiers, cookies, or passwords.
10. Existing campus-browser, direct-partner, credentials, and package tests
    continue to pass.

## Non-goals

- Global proxy, system DNS, default-route, or firewall changes.
- Route rules for ordinary external browsers or other applications.
- Cloud sync, account sync, telemetry, import/export, or sharing of rules.
- Automatic inference that a parent site's redirected host should become a
  permanent user rule.
