# Resource Manager Layout Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair the local shortcut manager so it respects the macOS title-bar safe area and remains balanced and usable at every supported control-window size.

**Architecture:** Keep the native modal and all shortcut persistence/commands unchanged. Reshape the modal into a fixed safe-area panel with three flex regions: static header, scrollable body, and static action bar. Give each shortcut row a summary region and a separately wrapping action region so compact windows never force controls outside the panel.

**Tech Stack:** Electron renderer HTML/CSS/JavaScript, Node.js native test runner, existing packaged macOS arm64 app.

## Global Constraints

- Preserve the existing resource create, edit, reorder, delete, validation, and local-only persistence behavior.
- Reserve at least 48px from the renderer top edge so a modal cannot overlap macOS `hiddenInset` traffic lights.
- Support the defined 420×560 minimum and 500×640 default control-window sizes without clipping close, fields, error, or actions.
- Do not modify the EasyConnect engine, SOCKS listener, browser routing rules, account credentials, user-data format, or system network settings.
- Do not stage or change the user-owned uncommitted `README.md`.

---

## File structure

| File | Responsibility |
| --- | --- |
| `desktop/renderer/index.html` | Places resource-list and editor content inside the dialog's independently scrollable body. |
| `desktop/renderer/app.js` | Emits a summary and action wrapper for each shortcut row without changing its action handlers. |
| `desktop/renderer/styles.css` | Defines safe-area dialog geometry, fixed header/action regions, scroll behavior, and compact wrapping. |
| `desktop/test/resource-manager-layout-preload.js` | Supplies a complete local-only Electron API stub for the renderer layout test. |
| `desktop/test/resource-manager-layout.electron.js` | Opens the real renderer in Electron and asserts measured dialog geometry at both supported compact sizes. |

## Shared layout contract

```html
<form id="resourceForm" class="resource-form">
  <div class="dialog-head">…</div>
  <div class="resource-dialog-body">
    <div id="resourceEditorList" class="resource-editor-list"></div>
    <div class="resource-editor-fields">…</div>
    <p id="resourceFormError" class="dialog-error"></p>
  </div>
  <div class="dialog-actions">…</div>
</form>
```

```js
// Each resource row emitted by renderResourceEditorList().
<div class="resource-editor-row" data-resource-id="…">
  <div class="resource-editor-summary">
    <span class="resource-editor-name">…</span>
    <span class="resource-editor-route">…</span>
  </div>
  <div class="resource-editor-actions">…existing labeled buttons…</div>
</div>
```

```css
/* Key geometry. The exact color values remain part of the existing theme. */
.resource-dialog {
  position: fixed;
  inset: 48px 12px 12px;
  width: auto;
  max-width: 540px;
  margin: 0 auto;
  max-height: none;
  overflow: hidden;
}
.resource-form { height: 100%; min-height: 0; }
.resource-dialog-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
.dialog-actions { flex: 0 0 auto; }
```

### Task 1: Reproduce the compact-window regression in a real Electron renderer

**Files:**
- Create: `desktop/test/resource-manager-layout-preload.js`
- Create: `desktop/test/resource-manager-layout.electron.js`

**Consumes:** The real `desktop/renderer/index.html`, `app.js`, and `styles.css` loaded in an isolated Electron `BrowserWindow`.

**Produces:** An automated visual-layout regression test that measures the actual dialog rather than grepping CSS source.

- [ ] **Step 1: Create the deterministic Electron API preload**

```js
const state = {
  loggedIn: true,
  settings: { port: 1080, autoReconnect: true, maxAttempts: 3, closeAction: 'ask' },
  campusResources: Array.from({ length: 18 }, (_, index) => ({
    id: `fixture-${index}`, name: `测试网站 ${index + 1}`,
    url: `https://fixture-${index}.example.edu/`, description: '用于布局回归测试',
    route: index % 2 ? 'direct' : 'campus', builtin: false,
  })),
  connected: false, connecting: false, clientIp: null, lastError: null, version: 'test', pacUrl: '',
};
contextBridge.exposeInMainWorld('api', {
  getState: async () => state, getLogs: async () => '', onStatus: () => {}, onTelemetry: () => {},
  save: async () => ({ ok: true }), connect: async () => ({ ok: true }), disconnect: async () => ({ ok: true }),
  reconnect: async () => ({ ok: true }), logout: async () => ({ ok: true }), openLog: async () => ({ ok: true }),
  sshConfig: async () => '', copy: async () => ({ ok: true }), openCampusBrowser: async () => ({ ok: true }),
  saveResource: async () => ({ ok: true, resources: state.campusResources }),
  deleteResource: async () => ({ ok: true, resources: state.campusResources }),
  reorderResources: async () => ({ ok: true, resources: state.campusResources }), resize: async () => ({ ok: true }),
});
```

- [ ] **Step 2: Create the measured layout test**

```js
async function measureAt(width, height) {
  win.setContentSize(width, height);
  await new Promise((resolve) => setTimeout(resolve, 50));
  await win.webContents.executeJavaScript("document.getElementById('manageResources').click()");
  return win.webContents.executeJavaScript(`new Promise((resolve) => requestAnimationFrame(() => {
    const rect = (selector) => { const r = document.querySelector(selector).getBoundingClientRect(); return { top: r.top, right: r.right, bottom: r.bottom, left: r.left, width: r.width, height: r.height }; };
    const body = document.querySelector('.resource-dialog-body');
    resolve({ dialog: rect('.resource-dialog'), close: rect('#closeResourceDialog'), actions: rect('.dialog-actions'), body: { ...rect('.resource-dialog-body'), clientHeight: body.clientHeight, scrollHeight: body.scrollHeight }, row: rect('.resource-editor-row'), rowActions: rect('.resource-editor-actions') });
  }))`);
}

for (const [width, height] of [[500, 640], [420, 560]]) {
  const view = await measureAt(width, height);
  assert.ok(view.dialog.top >= 48, `${width}×${height}: dialog overlaps titlebar`);
  assert.ok(view.close.top >= view.dialog.top && view.close.right <= view.dialog.right, `${width}×${height}: close control is clipped`);
  assert.ok(view.actions.bottom <= view.dialog.bottom, `${width}×${height}: action bar is outside the panel`);
  assert.ok(view.body.clientHeight > 0 && view.body.scrollHeight >= view.body.clientHeight, `${width}×${height}: body does not establish a scroll region`);
  assert.ok(view.row.right <= view.dialog.right && view.rowActions.right <= view.dialog.right, `${width}×${height}: row actions overflow the dialog`);
}
```

- [ ] **Step 3: Run the measured test and confirm it fails at the existing compact layout**

Run: `desktop/node_modules/.bin/electron desktop/test/resource-manager-layout.electron.js`

Expected: FAIL because the current modal may enter the title-bar area and has neither a scrollable body nor compact action wrappers.

### Task 2: Implement the safe modal and compact resource rows

**Files:**
- Modify: `desktop/renderer/index.html`
- Modify: `desktop/renderer/app.js`
- Modify: `desktop/renderer/styles.css`
- Test: `desktop/test/resource-manager-layout.electron.js`

**Consumes:** Task 1's layout contract and the existing `saveResource`, `deleteResource`, and `reorderResources` renderer handlers.

**Produces:** A title-safe native modal whose middle region scrolls independently and whose resource-row controls never overflow at compact width.

- [ ] **Step 1: Move only scrollable manager content into the body wrapper**

```html
<div class="resource-dialog-body">
  <div id="resourceEditorList" class="resource-editor-list"></div>
  <div class="resource-editor-fields">
    <!-- Preserve the existing hidden id, labels, fields, ids, and maxlength values. -->
  </div>
  <p id="resourceFormError" class="dialog-error"></p>
</div>
```

Keep `.dialog-head` above the wrapper and `.dialog-actions` after it. Do not
move the form or change any element ids used by `app.js`.

- [ ] **Step 2: Emit row summary and action wrappers while retaining all existing commands**

```js
const actions = custom
  ? '<button class="mini" type="button" data-resource-action="edit">编辑</button>'
    + '<button class="mini" type="button" data-resource-action="up">↑</button>'
    + '<button class="mini" type="button" data-resource-action="down">↓</button>'
    + '<button class="mini" type="button" data-resource-action="delete">删除</button>'
  : '<span class="resource-editor-route">内置</span>';

return '<div class="resource-editor-row" data-resource-id="' + esc(resource.id) + '">'
  + '<div class="resource-editor-summary"><span class="resource-editor-name">' + esc(resource.name) + '</span>'
  + '<span class="resource-editor-route">' + esc(routeLabel(resource)) + '</span></div>'
  + '<div class="resource-editor-actions">' + actions + '</div></div>';
```

Retain the existing delegated `data-resource-action` handler. Built-in rows
remain non-editable; their former disabled Edit control is replaced by their
existing `内置` label because it never invoked an action.

- [ ] **Step 3: Implement the panel regions and responsive action grouping**

```css
.resource-dialog {
  position: fixed; inset: 48px 12px 12px; width: auto; max-width: 540px;
  max-height: none; margin: 0 auto; border: 0; border-radius: 18px;
  padding: 0; overflow: hidden;
}
.resource-form { display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0; }
.dialog-head { flex: 0 0 auto; padding: 16px 18px 12px; border-bottom: 1px solid var(--line); }
.resource-dialog-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 12px 18px; }
.dialog-actions { flex: 0 0 auto; padding: 12px 18px 16px; border-top: 1px solid var(--line); background: var(--card); }
.resource-editor-row { grid-template-columns: minmax(0, 1fr) auto; }
.resource-editor-summary, .resource-editor-actions { display: flex; align-items: center; min-width: 0; gap: 6px; }
.resource-editor-actions { flex-wrap: wrap; justify-content: flex-end; }
@media (max-width: 619px) {
  .resource-editor-row { grid-template-columns: 1fr; }
  .resource-editor-actions { justify-content: flex-start; }
}
```

Retain the existing colors, button styles, field dimensions, and wide/compact
field rules. Set the resource list's max height with
`clamp(128px, 30vh, 190px)` and give it its own `overflow-y: auto` so a long
list does not monopolize the body.

- [ ] **Step 4: Run the focused contract test and the related shortcut tests**

Run: `desktop/node_modules/.bin/electron desktop/test/resource-manager-layout.electron.js && node --test desktop/test/resource-view.test.js desktop/test/campus-resource-store.test.js desktop/test/settings-store.test.js`

Expected: PASS. The focused test verifies layout structure; shortcut/store tests prove no resource behavior changed.

- [ ] **Step 5: Commit the repair**

```bash
git add desktop/renderer/index.html desktop/renderer/app.js desktop/renderer/styles.css desktop/test/resource-manager-layout-preload.js desktop/test/resource-manager-layout.electron.js
git commit -m "fix: keep resource manager usable in compact windows"
```

### Task 3: Verify the app rather than only its source

**Files:**
- Modify: no source files expected
- Verify: `desktop/release/mac-arm64/hkustgzconnect.app`

**Consumes:** Task 2's committed renderer repair and the existing macOS arm64 package configuration.

**Produces:** Evidence that the packaged app includes the repaired renderer and works at default and minimum control-window dimensions.

- [ ] **Step 1: Run the full desktop suite and syntax checks**

Run:

```bash
cd desktop
npm test
node --check main.js
node --check renderer/app.js
node --check build/verify-package.js
./node_modules/.bin/electron test/resource-manager-layout.electron.js
```

Expected: every test passes and all three syntax checks produce no output.

- [ ] **Step 2: Build the arm64 macOS package and verify package contents**

Run:

```bash
cd desktop
rm -rf release/mac-arm64
npx electron-builder --mac zip --arm64 --publish never
node build/verify-package.js release/mac-arm64/hkustgzconnect.app
```

Expected: builder succeeds, the verifier finds the engine/config and all renderer files, and the application bundle is recreated at the stated path.

- [ ] **Step 3: Inspect the packaged dialog at both supported compact sizes**

Launch the rebuilt app with a temporary isolated Electron user-data directory.
Open `管理`, inspect its default 500×640 presentation, resize to 420×560, and
inspect again after expanding the local shortcut list. Confirm that the panel
starts below traffic lights; its close button, editor fields, validation area,
and New/Cancel/Save actions remain visible; and only the manager content/list
scrolls.

- [ ] **Step 4: Record the verification result in the handoff**

Report the tested package path and exact test/build results. Do not create a
release, push, or modify unrelated uncommitted files unless separately asked.
