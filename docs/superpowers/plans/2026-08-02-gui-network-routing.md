# GUI Layout and Per-Site Network Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the HKUST(GZ) Connect desktop UI less crowded and resizable, add local user-managed website shortcuts with collapse/expand behavior, and let each browser tab choose campus-tunnel or direct networking so partner services remain usable.

**Architecture:** Keep the main window as a compact responsive control panel with a user-configurable size range. Store custom shortcuts locally inside the existing owner-only settings file and merge them with reviewed built-ins at IPC boundaries. Give the campus browser separate persistent Electron sessions for `campus` and `direct` routes; each tab owns one route, so changing a tab never changes another tab or system networking.

**Tech Stack:** Electron 43, vanilla HTML/CSS/JavaScript renderer, Node.js IPC, existing local settings store and encrypted credential vault, Node test runner.

## Global Constraints

- No account synchronization, import/export, or remote persistence for custom links.
- Do not modify system DNS, default routes, system proxy settings, or global browser settings.
- Direct mode is explicit per tab/link and uses the operating system network only for that tab.
- Campus mode continues to use the loopback SOCKS5 tunnel and `<-loopback>` proxy bypass rule.
- Existing built-in links remain reviewed HTTPS resources; user links are bounded and validated with the same URL safety rules.
- Preserve local credential storage and origin scoping for both browser sessions.
- Keep unrelated `sshr.sh` untracked and untouched.

### Task 1: Define local shortcut and route data contracts

**Files:**
- Create: `desktop/lib/campus-route.js`
- Modify: `desktop/lib/campus-resources.js`
- Modify: `desktop/lib/settings-store.js`
- Modify: `desktop/lib/settings-update.js`
- Test: `desktop/test/campus-resources.test.js`
- Test: `desktop/test/settings-store.test.js`

**Interfaces:**
- `campus-route.js` exports `ROUTE_CAMPUS`, `ROUTE_DIRECT`, `DIRECT_PARTNER_HOSTS`, `routeForUrl(url)`, `proxyConfigForRoute(route, port)`, and `partitionForRoute(route)`.
- `campus-resources.js` exports `normalizeResource(value, options)`, `normalizeCustomResources(input)`, `mergeCampusResources(builtIns, custom)`, and `resourceRoute(resource)` while preserving existing loader exports.
- Normalized resource shape is `{ id, name, description, url, route, builtin }`.
- Settings gain `customResources`, normalized to at most 32 entries; invalid entries are discarded without affecting unrelated settings.

- [ ] **Step 1: Write failing route and resource tests** covering partner-host direct defaults, campus-host campus defaults, explicit route preservation, direct/campus proxy configs, stable partition names, custom resource validation, duplicate IDs/URLs, and settings round-trip.
- [ ] **Step 2: Run focused tests and verify they fail** with missing exports or missing `customResources` behavior.
- [ ] **Step 3: Implement the smallest route and persistence modules** with strict HTTPS URL normalization, exact host/suffix matching, bounded labels, and owner-only settings persistence through existing store code.
- [ ] **Step 4: Run focused tests and verify they pass** with `node --test test/campus-resources.test.js test/settings-store.test.js`.
- [ ] **Step 5: Commit** `feat: add local shortcut and browser route contracts`.

### Task 2: Support independent campus/direct browser sessions

**Files:**
- Modify: `desktop/lib/campus-browser.js`
- Modify: `desktop/campus-preload.js`
- Modify: `desktop/main.js`
- Test: `desktop/test/campus-browser.test.js`

**Interfaces:**
- `CampusBrowser.open(rawUrl, port, route)` opens a tab with the requested route.
- `CampusBrowser.createTab(rawUrl, route)` stores `tab.route` and selects the matching persistent session.
- Browser toolbar state includes `route` and `routeLabel` for the active tab and each tab summary.
- `CampusBrowser.setTabRoute(tabId, route)` reloads the selected tab in the requested session while preserving its URL.
- IPC `open-campus-browser` accepts `{ url, route }`; legacy string input remains accepted and uses `routeForUrl`.

- [ ] **Step 1: Add failing tests** asserting two persistent partitions, campus proxy configuration, direct mode `{ mode: 'direct' }`, route retained per tab, and route changes not affecting other tabs.
- [ ] **Step 2: Run the focused browser tests and verify failure.**
- [ ] **Step 3: Refactor `CampusBrowser` from one session to a route-keyed session map**; keep credential vault origin behavior unchanged, close only the affected session connections when the port changes, and reject unsupported routes.
- [ ] **Step 4: Add route-aware navigation commands** (`set-route`) and prevent direct tabs from silently becoming campus tabs on reload/new navigation.
- [ ] **Step 5: Run browser tests and verify pass.**
- [ ] **Step 6: Commit** `feat: isolate campus and direct browser sessions`.

### Task 3: Expose local shortcut management through IPC

**Files:**
- Modify: `desktop/main.js`
- Modify: `desktop/preload.js`
- Modify: `desktop/lib/settings-update.js`
- Test: `desktop/test/settings-update.test.js`

**Interfaces:**
- `get-state` returns merged reviewed and local resources, with `builtin` and `route` fields.
- IPC `save-resource` accepts `{ id?, name, description?, url, route }` and returns `{ ok, resource, resources }`.
- IPC `delete-resource` accepts an ID and refuses deletion of built-ins.
- IPC `reorder-resources` accepts an ordered list of local IDs and returns normalized resources.
- IPC `open-campus-browser` auto-selects `routeForUrl` when route is omitted; known partner sites can open without connecting the engine, while campus routes still wait for a connected engine.

- [ ] **Step 1: Add failing IPC-contract/unit tests** for add/edit/delete/reorder, built-in protection, invalid URLs, direct-site open without tunnel, campus-site connection wait, and legacy string input.
- [ ] **Step 2: Run focused tests and verify failure.**
- [ ] **Step 3: Implement bounded local-resource mutations** using the existing atomic owner-only settings writer; return user-readable validation errors and never include passwords or credential payloads in resource responses.
- [ ] **Step 4: Update `connectAndOpenCampusBrowser`** to branch on route before calling `connect()` and pass route to `CampusBrowser.open`.
- [ ] **Step 5: Run focused tests and verify pass.**
- [ ] **Step 6: Commit** `feat: manage local shortcuts and route-aware opening`.

### Task 4: Make the control window responsive and less crowded

**Files:**
- Modify: `desktop/main.js`
- Modify: `desktop/renderer/index.html`
- Modify: `desktop/renderer/styles.css`
- Modify: `desktop/renderer/app.js`
- Test: `desktop/test/window-layout.test.js` (create)

**Interfaces:**
- Main window default size becomes `500×640`, minimum `420×560`, maximum `760×900`, and `resizable: true`; it remains non-maximizable and keeps platform title-bar behavior.
- Renderer uses CSS custom properties and responsive breakpoints instead of fixed `max-width: 372px` vertical stacking.
- `window.api.resize(height)` remains available but is used only for content-driven login/dashboard transitions within the new bounds.

- [ ] **Step 1: Add layout contract tests** for window options, responsive breakpoint class names, bounded resize requests, and no fixed non-resizable setting.
- [ ] **Step 2: Run layout tests and verify failure.**
- [ ] **Step 3: Implement window sizing and responsive CSS**: use a two-column dashboard at widths above 620px, one-column compact layout below it, reduce card padding/vertical gaps, and keep all pages scrollable without clipping.
- [ ] **Step 4: Simplify the connect page hierarchy** by making statistics and gateway details collapsible secondary sections while keeping connection state and the primary website action visible.
- [ ] **Step 5: Run layout tests and renderer syntax checks.**
- [ ] **Step 6: Commit** `feat: make control window responsive`.

### Task 5: Add shortcut manager and collapsible website shelf

**Files:**
- Modify: `desktop/renderer/index.html`
- Modify: `desktop/renderer/styles.css`
- Modify: `desktop/renderer/app.js`
- Test: `desktop/test/campus-resources.test.js`

**Interfaces:**
- Website shelf shows a compact pinned row by default and a `展开全部`/`收起` control for the remaining links.
- Each shortcut displays its route badge (`校园隧道` or `直连`) and opens with its saved route.
- A local manager dialog supports add, edit, delete, route selection, and move up/down ordering.
- Built-ins are editable only in local display state if needed, but cannot be deleted or overwritten in persistent storage.

- [ ] **Step 1: Add renderer/resource behavior tests** for collapsed count, route labels, local-only mutation calls, built-in delete protection, and preserving user input while the dialog is open.
- [ ] **Step 2: Run focused tests and verify failure.**
- [ ] **Step 3: Implement the shelf and manager dialog** with keyboard focus handling, escape-to-close, validation messages, and no inline script handlers.
- [ ] **Step 4: Add route-aware click handling** and refresh state after mutations without resetting the active page or scroll position.
- [ ] **Step 5: Run all desktop tests and manually verify add/edit/delete/reorder/expand/collapse.**
- [ ] **Step 6: Commit** `feat: add local shortcut manager and collapsible shelf`.

### Task 6: Add browser route controls and partner-site defaults

**Files:**
- Modify: `desktop/renderer/campus-browser.html`
- Modify: `desktop/renderer/campus-browser.css`
- Modify: `desktop/renderer/campus-browser.js`
- Modify: `desktop/lib/campus-browser.js`
- Test: `desktop/test/campus-browser.test.js`

**Interfaces:**
- Toolbar shows the active tab route as a compact selector/badge; changing it sends `set-route` and reloads only that tab.
- The browser displays `校园隧道` for campus tabs and `直连` for direct tabs, with direct mode clearly labeled.
- Partner defaults include `outlook.office.com` and `hkust-gz.instructure.com`; matching is exact host or subdomain suffix only.

- [ ] **Step 1: Add failing toolbar tests** for route state rendering, route command emission, and direct/campus labels.
- [ ] **Step 2: Run focused tests and verify failure.**
- [ ] **Step 3: Implement route badge/select UI** without adding a second tab strip or covering native window controls.
- [ ] **Step 4: Run desktop tests and manually verify one campus tab and one direct partner tab can remain open together.**
- [ ] **Step 5: Commit** `feat: expose per-tab network route control`.

### Task 7: Full verification, documentation, and packaging check

**Files:**
- Modify: `README.md` (document local shortcuts and route modes in Chinese and English)
- Modify: `desktop/test/*` only if verification exposes a missing regression case

- [ ] **Step 1: Run complete desktop checks**: `npm test`, `node --check main.js`, `node --check renderer/app.js`, `node --check renderer/campus-browser.js`, and `node --check lib/campus-browser.js`.
- [ ] **Step 2: Run Rust verification** with `cargo fmt --all -- --check`, `cargo clippy --locked --all-targets -- -D warnings`, and `cargo test --locked` when the Rust toolchain is available.
- [ ] **Step 3: Manually verify** resize bounds, compact/expanded shelf, local shortcut CRUD, Outlook/Canvas direct mode, campus home tunnel mode, saved passwords, and no system proxy/DNS changes.
- [ ] **Step 4: Review `git diff --check`, inspect package contents, and build the macOS directory target without committing generated `.app` artifacts.
- [ ] **Step 5: Commit** `docs: document local shortcuts and route modes`.

## Self-review

- Scope is one coordinated desktop feature set; each independent subsystem has its own tests and commit boundary.
- No synchronization/import/export is included.
- Direct mode is per-tab and cannot alter the system network.
- Partner-site defaults and user overrides are represented in the same normalized resource contract.
- The plan does not require Python or new runtime dependencies.
