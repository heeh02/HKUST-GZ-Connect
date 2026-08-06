# Browser Routing Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Campus Browser users persist exact-host or subdomain route choices and preserve the selected path through popups and SSO redirects without modifying system networking.

**Architecture:** Add a bounded owner-only JSON rule store and a pure resolver that produces an effective route plus its source. Campus Browser owns tab-level route state, asks the resolver for new tabs, popup tabs, typed navigation, and redirect continuations, and replaces only the affected `WebContentsView` when its isolated session must change. The Electron main process owns persistence and tunnel readiness; the browser toolbar remains a sandboxed local renderer that sends only validated route commands.

**Tech Stack:** Node.js CommonJS, Electron `BrowserWindow` / `WebContentsView` / `session`, native Node test runner, existing Rust SOCKS engine.

## Global Constraints

- Store rules only in the Electron user-data directory as `routing-rules.json`; never include them in an app bundle, logs, diagnostics, account sync, telemetry, import/export, or Git.
- Rule records contain only normalized host, `includeSubdomains`, `route`, and `updatedAt`; never persist URLs, URL query strings, fragments, cookies, credentials, or form data.
- Supported routes are exactly `campus` and `direct`. Campus is the fallback; failure to establish the campus engine must not silently use Direct.
- A manual selector change immediately creates/replaces an exact-host user rule and reloads the active page through the chosen isolated session.
- Exact user rule > user include-subdomains rule > reviewed built-in partner rule > inherited popup/redirect route > campus default.
- A new toolbar navigation has no inheritance. A popup inherits the opener route. A server redirect/SSO continuation inherits its source tab route when no higher-priority rule matches.
- Do not modify system DNS, system proxy, default route, ordinary browsers, or the existing SOCKS listener contract.
- Keep `README.md`'s existing uncommitted changes untouched.

---

## File structure

| File | Responsibility |
| --- | --- |
| `desktop/lib/routing-rule-store.js` | Host normalization, bounded v1 JSON parsing, atomic owner-only persistence, and mutation helpers. |
| `desktop/lib/route-resolver.js` | Pure precedence resolver that returns route, source, and matched rule without reading files or configuring Electron. |
| `desktop/lib/campus-route.js` | Exposes built-in reviewed partner defaults to the resolver while retaining session/proxy helpers. |
| `desktop/lib/campus-browser.js` | Keeps per-tab route context, configures missing route sessions, creates inherited popup tabs, intercepts safe main-frame route changes, and drives the toolbar. |
| `desktop/main.js` | Defines `routing-rules.json`, creates the store adapter, and exposes an `ensureCampusReady` callback to Campus Browser. |
| `desktop/renderer/campus-browser.{html,js,css}` | Displays route source and immediate saved feedback; opens and operates the local Network Rules manager through hash commands. |
| `desktop/test/routing-rule-store.test.js` | Unit coverage for normalization, malformed JSON recovery, bounded persistence, and mutations. |
| `desktop/test/route-resolver.test.js` | Unit coverage for precedence, suffix scope, built-ins, and inheritance. |
| `desktop/test/campus-browser.test.js` | Regression coverage for popup inheritance, missing-session setup, route replacement, redirect behavior, and tunnel readiness failure. |
| `desktop/test/campus-browser-toolbar.test.js` | Contract coverage for the feedback and manager controls in the local toolbar. |

## Shared interfaces

```js
// desktop/lib/routing-rule-store.js
const MAX_ROUTING_RULES = 128;

// Exact ASCII hostname only; throws Error('路由规则域名无效') on invalid input.
function normalizeRuleHost(value) {}

// Returns a normalized, de-duplicated array, newest record winning.
function normalizeRoutingRules(value) {}

// Returns [] for unreadable or malformed JSON. It does not throw for a broken file.
function loadRoutingRules(filePath) {}
function saveRoutingRules(filePath, rules) {}
function upsertRoutingRule(currentRules, payload, now = Date.now()) {}
function deleteRoutingRule(currentRules, host, includeSubdomains) {}
```

```js
// desktop/lib/route-resolver.js
// source is one of user-exact, user-subdomain, builtin, inherited, default.
function resolveRouteForUrl(rawUrl, {
  userRules = [],
  inheritedRoute = null,
} = {}) {}
```

```js
// CampusBrowser constructor additions
new CampusBrowser({
  // Existing dependencies...
  routingRules: {
    list: () => Array,
    upsert: (payload) => ({ rule, rules }),
    remove: ({ host, includeSubdomains }) => Array,
  },
  ensureCampusReady: async () => Boolean,
});
```

```js
// Tab fields added by CampusBrowser
{
  route: 'campus' | 'direct',
  routeSource: 'user-exact' | 'user-subdomain' | 'builtin' | 'inherited' | 'default',
  openerRoute: 'campus' | 'direct' | null,
  replacementUrl: '',
}
```

### Task 1: Add the local routing-rule store

**Files:**
- Create: `desktop/lib/routing-rule-store.js`
- Test: `desktop/test/routing-rule-store.test.js`

**Consumes:** `desktop/lib/private-file.js` (`ensureOwnerOnly`).

**Produces:** `normalizeRuleHost`, `normalizeRoutingRules`, `loadRoutingRules`, `saveRoutingRules`, `upsertRoutingRule`, and `deleteRoutingRule` with the signatures above.

- [ ] **Step 1: Write the failing rule-store tests**

```js
test('normalizes only exact host records and retains no URL material', () => {
  assert.equal(normalizeRuleHost(' Login.MicrosoftOnline.com. '), 'login.microsoftonline.com');
  assert.throws(() => normalizeRuleHost('https://login.microsoftonline.com/a?token=x'), /域名无效/);
  assert.deepEqual(normalizeRoutingRules([
    { host: 'a.example', route: 'campus', includeSubdomains: false, updatedAt: 1 },
    { host: 'A.EXAMPLE.', route: 'direct', includeSubdomains: false, updatedAt: 2 },
  ]), [{ host: 'a.example', route: 'direct', includeSubdomains: false, updatedAt: 2 }]);
});

test('persists a bounded v1 owner-only rule document and recovers from malformed JSON', () => {
  const file = path.join(temp, 'routing-rules.json');
  saveRoutingRules(file, [{ host: 'login.microsoftonline.com', route: 'direct', includeSubdomains: false, updatedAt: 10 }]);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(loadRoutingRules(file), [{ host: 'login.microsoftonline.com', route: 'direct', includeSubdomains: false, updatedAt: 10 }]);
  fs.writeFileSync(file, '{broken');
  assert.deepEqual(loadRoutingRules(file), []);
});

test('upsert and deletion use host plus scope as the stable identity', () => {
  const first = upsertRoutingRule([], { host: 'login.microsoftonline.com', route: 'direct' }, 10);
  const next = upsertRoutingRule(first.rules, {
    host: 'login.microsoftonline.com', route: 'campus', includeSubdomains: true,
  }, 20);
  assert.equal(next.rules.length, 2);
  assert.equal(deleteRoutingRule(next.rules, 'login.microsoftonline.com', false).length, 1);
});
```

- [ ] **Step 2: Run the new tests to verify failure**

Run: `node --test desktop/test/routing-rule-store.test.js`

Expected: FAIL because `../lib/routing-rule-store` does not exist.

- [ ] **Step 3: Implement normalized, bounded, atomic persistence**

```js
const RULE_FILE_VERSION = 1;
const MAX_ROUTING_RULES = 128;

function saveRoutingRules(filePath, rules) {
  const normalized = normalizeRoutingRules(rules);
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  try {
    fs.writeFileSync(temporary, JSON.stringify({ version: RULE_FILE_VERSION, rules: normalized }, null, 2), {
      encoding: 'utf8', flag: 'wx', mode: 0o600,
    });
    fs.renameSync(temporary, filePath);
    ensureOwnerOnly(filePath);
  } finally {
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {}
  }
  return normalized;
}
```

Use `domainToASCII` from `node:url`, reject host values containing a scheme,
slash, colon, `@`, wildcard, control character, or whitespace, and reject
records that are not `campus` or `direct`. De-duplicate by the pair
`host + includeSubdomains`, retaining the newest `updatedAt` record. Never
return a raw input object.

- [ ] **Step 4: Run the focused tests**

Run: `node --test desktop/test/routing-rule-store.test.js`

Expected: PASS with all store cases green.

- [ ] **Step 5: Commit the store**

```bash
git add desktop/lib/routing-rule-store.js desktop/test/routing-rule-store.test.js
git commit -m "feat: persist local browser routing rules"
```

### Task 2: Add a pure route resolver with explicit precedence

**Files:**
- Create: `desktop/lib/route-resolver.js`
- Modify: `desktop/lib/campus-route.js`
- Test: `desktop/test/route-resolver.test.js`

**Consumes:** routing-rule records from Task 1 and `ROUTE_CAMPUS` / `ROUTE_DIRECT` from `campus-route.js`.

**Produces:** `resolveRouteForUrl(rawUrl, options)` returning `{ route, source, matchedRule: { host, includeSubdomains } | null }`.

- [ ] **Step 1: Write failing precedence tests**

```js
test('resolves exact user, suffix user, built-in, inherited, then default routes', () => {
  const userRules = [
    { host: 'microsoftonline.com', includeSubdomains: true, route: 'campus', updatedAt: 1 },
    { host: 'login.microsoftonline.com', includeSubdomains: false, route: 'direct', updatedAt: 2 },
  ];
  assert.deepEqual(resolveRouteForUrl('https://login.microsoftonline.com/saml', { userRules }), {
    route: 'direct', source: 'user-exact',
    matchedRule: { host: 'login.microsoftonline.com', includeSubdomains: false },
  });
  assert.equal(resolveRouteForUrl('https://device.microsoftonline.com/', { userRules }).source, 'user-subdomain');
  assert.equal(resolveRouteForUrl('https://outlook.office.com/', { inheritedRoute: 'campus' }).source, 'builtin');
  assert.deepEqual(resolveRouteForUrl('https://login.microsoftonline.com/', { inheritedRoute: 'direct' }), {
    route: 'direct', source: 'inherited', matchedRule: null,
  });
  assert.equal(resolveRouteForUrl('https://portal.example/', {}).route, 'campus');
});

test('a suffix rule matches the root host and descendants but not a sibling lookalike', () => {
  const rule = [{ host: 'example.edu', includeSubdomains: true, route: 'direct', updatedAt: 1 }];
  assert.equal(resolveRouteForUrl('https://example.edu/', { userRules: rule }).route, 'direct');
  assert.equal(resolveRouteForUrl('https://id.example.edu/', { userRules: rule }).route, 'direct');
  assert.equal(resolveRouteForUrl('https://notexample.edu/', { userRules: rule }).route, 'campus');
});
```

- [ ] **Step 2: Run the resolver tests to verify failure**

Run: `node --test desktop/test/route-resolver.test.js`

Expected: FAIL because `../lib/route-resolver` does not exist.

- [ ] **Step 3: Implement resolver and expose built-in matching**

```js
function resolveRouteForUrl(rawUrl, { userRules = [], inheritedRoute = null } = {}) {
  const host = hostnameForUrl(rawUrl);
  const exact = userRules.find((rule) => rule.host === host && !rule.includeSubdomains);
  if (exact) return resolved(exact.route, 'user-exact', exact);
  const suffix = userRules.find((rule) => rule.includeSubdomains && hostMatches(host, rule.host));
  if (suffix) return resolved(suffix.route, 'user-subdomain', suffix);
  const builtin = builtinRouteForHost(host);
  if (builtin) return resolved(builtin, 'builtin', null);
  if (inheritedRoute === ROUTE_DIRECT || inheritedRoute === ROUTE_CAMPUS) {
    return resolved(inheritedRoute, 'inherited', null);
  }
  return resolved(ROUTE_CAMPUS, 'default', null);
}
```

Retain `routeForUrl` as a compatibility wrapper returning only `.route`, so
existing shortcut and open-policy callers continue working. Add
`builtinRouteForHost(host)` to `campus-route.js`; it returns `direct` only for
the reviewed partner host list and `null` otherwise.

- [ ] **Step 4: Run focused resolver and existing route tests**

Run: `node --test desktop/test/route-resolver.test.js desktop/test/campus-resources.test.js desktop/test/campus-open-policy.test.js`

Expected: PASS; existing Outlook and Canvas defaults remain Direct.

- [ ] **Step 5: Commit the resolver**

```bash
git add desktop/lib/route-resolver.js desktop/lib/campus-route.js desktop/test/route-resolver.test.js
git commit -m "feat: resolve browser routes from local rules"
```

### Task 3: Wire rule persistence and campus readiness through the main process

**Files:**
- Modify: `desktop/main.js`
- Test: `desktop/test/campus-browser.test.js`

**Consumes:** Task 1 store functions and the existing `connect()` / `waitForConnected()` lifecycle helpers.

**Produces:** a `routingRules` adapter and `ensureCampusReady` callback passed to every `CampusBrowser` instance.

- [ ] **Step 1: Add failing constructor-contract tests**

Extend the fake CampusBrowser dependencies to assert that a Direct-to-Campus
route switch calls an injected readiness callback before rebuilding the view.

```js
const browser = new CampusBrowser({
  // existing fake dependencies,
  routingRules: { list: () => [], upsert: () => ({ rule, rules: [rule] }), remove: () => [] },
  ensureCampusReady: async () => false,
});
await browser.open('https://outlook.office.com/owa/', 1080, ROUTE_DIRECT);
assert.equal(await browser.setTabRoute(browser.activeTabId, ROUTE_CAMPUS), false);
assert.equal(browser.activeTab().route, ROUTE_DIRECT);
```

- [ ] **Step 2: Run the focused browser test to verify failure**

Run: `node --test desktop/test/campus-browser.test.js`

Expected: FAIL because `CampusBrowser` does not yet use `ensureCampusReady`.

- [ ] **Step 3: Add the main-process adapter**

```js
const ROUTING_RULES = path.join(DATA, 'routing-rules.json');
ensureOwnerOnly(ROUTING_RULES);

const routingRules = {
  list: () => loadRoutingRules(ROUTING_RULES),
  upsert: (payload) => {
    const result = upsertRoutingRule(loadRoutingRules(ROUTING_RULES), payload);
    return { rule: result.rule, rules: saveRoutingRules(ROUTING_RULES, result.rules) };
  },
  remove: ({ host, includeSubdomains }) => saveRoutingRules(
    ROUTING_RULES,
    deleteRoutingRule(loadRoutingRules(ROUTING_RULES), host, includeSubdomains),
  ),
};

async function ensureCampusReady() {
  if (state.connected) return true;
  await connect();
  return waitForConnected();
}
```

Pass both values only through `getCampusBrowser()`. Do not expose the file path
or generic filesystem IPC to either renderer.

- [ ] **Step 4: Update CampusBrowser constructor defaults and run focused tests**

Make `routingRules` default to a safe in-memory empty adapter for tests and
make a missing `ensureCampusReady` return `true` only when the caller is
already using a configured campus session. Do not use Direct as a fallback.

Run: `node --test desktop/test/campus-browser.test.js`

Expected: PASS, including the failed-readiness regression.

- [ ] **Step 5: Commit the main-process boundary**

```bash
git add desktop/main.js desktop/lib/campus-browser.js desktop/test/campus-browser.test.js
git commit -m "feat: connect browser routing rules to tunnel lifecycle"
```

### Task 4: Implement tab route context, popup inheritance, and safe session replacement

**Files:**
- Modify: `desktop/lib/campus-browser.js`
- Test: `desktop/test/campus-browser.test.js`

**Consumes:** `resolveRouteForUrl`, `routingRules`, `ensureCampusReady`, and existing route-specific Electron sessions.

**Produces:** `resolveTabRoute`, `ensureRouteSession`, `replaceTabView`, `navigateWithRoute`, and popup tabs that carry their opener route.

- [ ] **Step 1: Write failing route-context tests**

```js
test('a Direct Outlook popup inherits Direct for Microsoft login and configures its session', async () => {
  await browser.open('https://outlook.office.com/owa/', 1080, ROUTE_DIRECT);
  const opener = browser.activeTab();
  opener.view.webContents.popupHandler({ url: 'https://login.microsoftonline.com/tenant/saml' });
  await flushImmediate();
  const popup = browser.activeTab();
  assert.equal(popup.route, ROUTE_DIRECT);
  assert.equal(popup.routeSource, 'inherited');
  assert.equal(popup.view.options.webPreferences.session, directSession);
});

test('switching the active selector persists an exact host rule before replacement reload', async () => {
  await browser.open('https://portal.example.edu/', 1080, ROUTE_CAMPUS);
  assert.equal(await browser.setTabRoute(browser.activeTabId, ROUTE_DIRECT, { remember: true }), true);
  assert.deepEqual(savedPayload, {
    host: 'portal.example.edu', includeSubdomains: false, route: ROUTE_DIRECT,
  });
  assert.equal(browser.activeTab().routeSource, 'user-exact');
});
```

- [ ] **Step 2: Run the focused tests to verify failure**

Run: `node --test desktop/test/campus-browser.test.js`

Expected: FAIL because popup creation currently calls `createTab(url)` without
opener context and route changes do not persist a rule.

- [ ] **Step 3: Implement the route-aware tab methods**

```js
resolveTabRoute(rawUrl, { inheritedRoute = null } = {}) {
  return resolveRouteForUrl(rawUrl, {
    userRules: this.routingRules.list(),
    inheritedRoute,
  });
}

async ensureRouteSession(route, port) {
  if (route === ROUTE_CAMPUS && !await this.ensureCampusReady()) {
    throw new Error('校园隧道未连接，无法切换到校园隧道');
  }
  return this.configure(port, route);
}
```

Refactor view construction into one `createView(routeSession)` method so new
tabs and replacements always retain `nodeIntegration: false`,
`contextIsolation: true`, `sandbox: true`, `webSecurity: true`, and
`safeDialogs: true`.

`replaceTabView(tab, url, resolved)` must remove and close the old view only
after the target route session is ready; then set `tab.route`,
`tab.routeSource`, `tab.openerRoute`, and `tab.replacementUrl` before loading
the same normalized URL. Clear `replacementUrl` once that precise URL starts
loading, so replacement navigation cannot recurse.

`setWindowOpenHandler` must capture `tab.route` and call
`createTab(url, undefined, { inheritedRoute: tab.route })`. `createTab` must
resolve the route itself, call `ensureRouteSession`, and report an error if the
session cannot be configured; it must never return `null` silently for a
missing Direct session.

`setTabRoute(id, route, { remember = true } = {})` must normalize the active
URL hostname, persist an exact-host record before replacement when `remember`
is true, resolve the URL again, then replace the tab. If persistence fails,
leave the old view and route intact.

- [ ] **Step 4: Run focused browser tests**

Run: `node --test desktop/test/campus-browser.test.js desktop/test/campus-open-policy.test.js`

Expected: PASS; Direct popup inheritance works, explicit user route overrides
remain possible, and campus readiness failure leaves a Direct tab unchanged.

- [ ] **Step 5: Commit the tab lifecycle changes**

```bash
git add desktop/lib/campus-browser.js desktop/test/campus-browser.test.js
git commit -m "feat: preserve browser route through popup flows"
```

### Task 5: Apply rules to safe main-frame redirect continuations

**Files:**
- Modify: `desktop/lib/campus-browser.js`
- Test: `desktop/test/campus-browser.test.js`

**Consumes:** Task 4 tab fields and route-aware replacement methods.

**Produces:** a single `handleMainFrameRedirect(tab, event, url, requestMethod)` path that preserves SSO continuity without a route-switch loop.

- [ ] **Step 1: Write failing redirect tests**

```js
test('a Direct tab keeps its inherited path through a GET SSO redirect', async () => {
  await browser.open('https://outlook.office.com/owa/', 1080, ROUTE_DIRECT);
  const tab = browser.activeTab();
  const event = { prevented: false, preventDefault() { this.prevented = true; } };
  await browser.handleMainFrameRedirect(tab, event, 'https://login.microsoftonline.com/saml', 'GET');
  assert.equal(tab.route, ROUTE_DIRECT);
  assert.equal(tab.routeSource, 'inherited');
});

test('an explicit user route wins over redirect inheritance exactly once', async () => {
  rules.push({ host: 'login.microsoftonline.com', includeSubdomains: false, route: ROUTE_CAMPUS, updatedAt: 1 });
  const event = { prevented: false, preventDefault() { this.prevented = true; } };
  await browser.handleMainFrameRedirect(tab, event, 'https://login.microsoftonline.com/saml', 'GET');
  assert.equal(event.prevented, true);
  assert.equal(tab.route, ROUTE_CAMPUS);
  assert.equal(tab.routeSource, 'user-exact');
  assert.equal(replacementLoads.filter((url) => url.includes('login.microsoftonline.com')).length, 1);
});
```

- [ ] **Step 2: Run redirect tests to verify failure**

Run: `node --test desktop/test/campus-browser.test.js`

Expected: FAIL because there is no redirect route handler.

- [ ] **Step 3: Implement conservative redirect handling**

Attach Electron's main-frame redirect event to each page view and call
`handleMainFrameRedirect`. Resolve the target using `inheritedRoute: tab.route`.

- If the resolver returns the current route, update `routeSource` and allow the
  redirect to continue unchanged.
- If a higher-priority rule requires another route and the redirect method is
  `GET`, prevent the original redirect and call `replaceTabView` once with the
  target URL and resolved route.
- If a higher-priority rule requires another route but the method is not `GET`,
  preserve the in-flight tab route, emit the message `为保留登录提交，本次跳转继续使用当前网络路径`, and do not persist any new rule. This prevents discarding SAML/OAuth form data.
- Ignore redirects to non-HTTP(S) targets and preserve the existing blocked
  navigation behavior.

Use `tab.replacementUrl === normalizedUrl` as the loop guard. Reset it after
the matching navigation starts or fails; do not suppress unrelated later
navigations to the same host.

- [ ] **Step 4: Run the redirect suite**

Run: `node --test desktop/test/campus-browser.test.js`

Expected: PASS, including one replacement load, inherited Direct SSO, and
non-GET preservation.

- [ ] **Step 5: Commit redirect behavior**

```bash
git add desktop/lib/campus-browser.js desktop/test/campus-browser.test.js
git commit -m "feat: preserve route across browser sso redirects"
```

### Task 6: Add toolbar feedback and the local Network Rules manager

**Files:**
- Modify: `desktop/renderer/campus-browser.html`
- Modify: `desktop/renderer/campus-browser.js`
- Modify: `desktop/renderer/campus-browser.css`
- Modify: `desktop/lib/campus-browser.js`
- Test: `desktop/test/campus-browser-toolbar.test.js`

**Consumes:** Task 1 rule records and Task 4 command handling.

**Produces:** user-visible route source, immediate remember feedback, and a local manager for add/edit/delete/scope changes.

- [ ] **Step 1: Write failing toolbar contract tests**

```js
test('browser toolbar exposes remembered route feedback and a network-rules manager', () => {
  assert.match(html, /id="routeSource"/);
  assert.match(html, /id="manageRules"/);
  assert.match(html, /id="ruleDialog"/);
  assert.match(js, /command\('set-route'/);
  assert.match(js, /command\('save-rule'/);
  assert.match(js, /command\('delete-rule'/);
});
```

- [ ] **Step 2: Run the toolbar test to verify failure**

Run: `node --test desktop/test/campus-browser-toolbar.test.js`

Expected: FAIL because the route source, manager button, and dialog do not
exist yet.

- [ ] **Step 3: Build the local toolbar controls**

Add a compact `routeSource` label next to the selector, a `manageRules` button,
and a native `<dialog id="ruleDialog">`. The dialog lists every resolved user
rule with hostname, route selector, exact/subdomain checkbox, update time, and
delete button. It includes an add form with a hostname, route, and scope. It
does not display full URLs or any credential field.

In `campus-browser.js`, encode `{ host, route, includeSubdomains }` as JSON in
the existing hash-command value. On `set-route`, optimistically display
`正在记住…`; toolbar state from the main process then changes it to
`已记住此主机` or a non-secret error. Render rule text with `textContent`, not
`innerHTML`.

In the main `CampusBrowser.handleToolbarCommand`, add:

```js
else if (command === 'set-route' && active) {
  this.setTabRoute(active.id, value, { remember: true }).catch((error) => this.reportError(error));
} else if (command === 'list-rules') {
  this.updateToolbar();
} else if (command === 'save-rule') {
  this.saveUserRule(JSON.parse(value));
} else if (command === 'delete-rule') {
  this.deleteUserRule(JSON.parse(value));
}
```

Parse every command payload inside a `try/catch`, normalize through the store,
and call `updateToolbar()` after a successful mutation. Do not trust renderer
route source, hostname, or timestamps.

- [ ] **Step 4: Run toolbar and browser tests**

Run: `node --test desktop/test/campus-browser-toolbar.test.js desktop/test/campus-browser.test.js`

Expected: PASS. Existing keyboard shortcuts and tab controls remain present.

- [ ] **Step 5: Commit the UI**

```bash
git add desktop/renderer/campus-browser.html desktop/renderer/campus-browser.js \
  desktop/renderer/campus-browser.css desktop/lib/campus-browser.js \
  desktop/test/campus-browser-toolbar.test.js
git commit -m "feat: manage remembered browser routing rules"
```

### Task 7: Complete regression, package, documentation, and manual verification

**Files:**
- Modify: `README.md` only if its user-facing browser routing description needs
  the new manager and precedence behavior; preserve the user’s existing edits.
- Modify: `desktop/build/verify-package.js` only if a new local renderer asset
  requires a package-presence assertion.
- Test: all existing desktop and engine tests.

**Consumes:** all preceding tasks.

**Produces:** a package that contains the new rule modules, has no renderer
filesystem exposure, and passes automated plus manual SSO-route checks.

- [ ] **Step 1: Add package assertions if files are new runtime assets**

If `routing-rule-store.js` or `route-resolver.js` is not already included by
the existing `lib/**/*` package glob, add these exact entries to
`requiredEntries` in `desktop/build/verify-package.js`:

```js
'/lib/routing-rule-store.js',
'/lib/route-resolver.js',
```

Add a Node test or invoke the verifier against a temporary package fixture only
if the current verifier test setup supports it; otherwise the release package
verification command below is the required evidence.

- [ ] **Step 2: Run all automated checks before packaging**

Run:

```bash
cd desktop && npm test && npm audit --audit-level=high
node --check main.js
node --check preload.js
node --check campus-preload.js
node --check lib/routing-rule-store.js
node --check lib/route-resolver.js
node --check lib/campus-browser.js
node --check renderer/campus-browser.js
cd ../independent
cargo fmt --all -- --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked
```

Expected: every command exits 0.

- [ ] **Step 3: Perform a fresh macOS arm64 package build and verify its contents**

Run:

```bash
cd desktop
bash scripts/build-engine.sh
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac dir --arm64
node build/verify-package.js release/mac-arm64/hkustgzconnect.app/Contents/Resources darwin arm64
codesign --verify --deep --strict release/mac-arm64/hkustgzconnect.app
```

Expected: the package build succeeds, the verifier reports the engine and
renderer checks, and `codesign` exits 0.

- [ ] **Step 4: Run the manual Campus Browser regression script**

1. Start the freshly packaged app and connect through the existing local test
   setup.
2. Open Outlook through its Direct shortcut; verify the route indicator says
   Direct.
3. Follow or trigger the Microsoft login flow; verify the popup/new tab route
   says Direct and no SOCKS connection failure page appears.
4. In a campus tab, switch the selector to Direct; verify the page reloads and
   a rule manager entry exists for the exact hostname.
5. Quit and reopen the app; open the same hostname in a new tab and verify its
   remembered route is restored.
6. In the manager, enable Include subdomains for a test hostname; verify a
   descendant resolves to the chosen route and a sibling does not.
7. Switch a Direct tab to Campus while the engine is stopped; verify the app
   either connects first or leaves the tab unchanged with a clear error, never
   silently Direct.
8. Disconnect, quit, and confirm no engine process remains.

- [ ] **Step 5: Update concise user documentation and commit release-ready source**

Document that route rules are local-only, exact-host by default, can include
subdomains on request, and preserve SSO/popup continuity without changing
system networking. Do not describe domain queries, account values, or test
credentials.

```bash
git add README.md desktop/build/verify-package.js
git commit -m "docs: explain local browser routing rules"
```

Commit only files actually modified in this task. If `README.md` still contains
unrelated user-owned changes, stage only the exact reviewed hunks or leave it
uncommitted and report that boundary.

## Plan self-review

- **Spec coverage:** Tasks 1–2 implement versioned local storage, host
  normalization, privacy limits, and precedence. Tasks 3–5 implement tunnel
  readiness, selector persistence, popup inheritance, redirect continuity,
  safe replacement, and failure behavior. Task 6 implements the manager and
  user feedback. Task 7 covers packaging, documentation, automated checks, and
  manual SSO regression.
- **No-placeholder check:** The plan contains no TODO/TBD items; every task
  supplies exact files, interfaces, commands, and test assertions.
- **Type consistency:** All tasks use the same two route strings, the same
  `includeSubdomains` field, the same resolver source strings, and the same
  `routingRules` adapter interface.
