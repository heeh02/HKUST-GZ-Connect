# Interactive-auth lifecycle and explicit activation

- Status: Proposed behavior review candidate; not merged, installed or released
- Owner: Desktop / authentication UI maintainers, issue #79
- Verified: 2026-09-08
- Base: PR #117, `3e44771eec3cd77cb7f0f339ec6305974e999183`
- Tested runtime: `aa2e09c29649f29285b0ed3bb6ea1ce3c32356e3`

## Actual behavior change

The native public entrypoint provides `create`, its compatibility alias `createAuthChallengeFeature`,
the explicit convenience function `start`, and `MAX_RESPONSE_BYTES`. The instance has synchronous
`start`, terminal `dispose`, `render` and `clearResponse`. Creation only obtains required DOM nodes;
start acquires bindings and the subscription. Repeated start is idempotent; disposal prevents restart.
An owner disposed before start does not clear another owner's existing DOM.

`app.js` explicitly mounts `auth-challenge` through the existing feature host. The host's static
catalog uses the native public entrypoint. The old HTML script, `window.authChallenge` export and
legacy exception are removed; the eight-line facade is deleted, recoverable from PR #117/Git history.
No substitute HTML bootstrap or hidden timer starts the feature. Other legacy startup owners are
unchanged, so this is not completion of the whole M1 migration.

The view controller (208 lines) owns DOM bindings, visible metadata, response input, action state
and boundary timers. The lifecycle owner (49 lines) owns the initial snapshot and unsubscribe handle.
No architecture budget is raised; app.js remains 562 lines and one legacy global owner is retired.

## Isolation and cleanup

- Every new/cleared challenge advances the view revision. Old command success, failure and finally
  continuations cannot paint an error or unlock the new challenge. Retirement fences all revisions.
- Initial state is accepted only if no newer display event arrived, including an event delivered
  synchronously during subscription. A retired snapshot is ignored.
- Response input is cleared before invoking Preload, when a challenge clears/expires, on unload
  and on disposal. Empty, oversized, expired, cooling-down and unsupported synthetic actions do
  not reach Main. The existing 4,096-byte bound remains; long UTF-16 input is rejected before encoding.
- Disposal removes owned DOM/locale/unload listeners, cancels the timer (including handle zero),
  unsubscribes once and closes/clears owned UI. Cleanup errors do not skip subsequent cleanup.
  A missing unsubscribe contract fails startup and fences a callback retained by that invalid API.
- Partial startup, reentrant binding/subscription/timer retirement and canceled timer callbacks
  cannot recreate a live owner. A late method/result from a retired owner cannot clear a new owner.
- Locale changes repaint dynamic description/error text without replacing the challenge revision,
  erasing typed input or unlocking pending submission. This covers an existing challenge at startup
  before the application applies its effective language.

Disposal does **not** send a remote cancellation command: a command already issued to Main may
still finish, and Main/Engine retain transaction and account authority. These Renderer fences do
not add protocol identifiers, bypass MFA or prove real-school SMS/popup support. No IPC schema,
credential storage, Browser Session, Profile, account, routing or Engine source is changed.

## Acceptance evidence

The first five regression tests failed on the parent implementation (new-challenge error pollution,
late errors after clearing, missing disposal, disabled actions reaching Main, non-idempotent start).
A separate locale-repaint test also failed before the repair. All now pass.

- Mac Node 24.19: auth/owner tests 26 passed; package/Renderer boundary tests 40 passed.
- 5070 Linux Node 24.20: full `node --test` — 1,383 passed, 6 platform skips, zero failures.
- Native 5070 Windows Node 24.20: auth, lifecycle, registry and package unit tests — 54 passed.
- `node e2e/renderer-module-asar.js` passed on Mac, Windows and Linux/Xvfb. Both startup languages
  restore a pre-existing synthetic challenge with the correct text; one submission clears input.
  Host pagehide then closes both auth/favorite dialogs, clears calendar/auth DOM, leaves zero auth
  listeners and ignores a subsequent fake challenge. Parent-confirmed child exit/profile retirement
  passed. HTTP(S) is blocked; fixture metadata and responses are synthetic.
- Mac `control-shell-layout.electron.js` passed. Architecture, staged-secret, install-script and
  governance gates passed. Exact-tree syntax passed 512 files at tree
  `15be367ae6bf7d6961ef1a4e05a718982e730220`.

Windows retains the existing GPU exit-code 34/state-invalid warnings. No full Windows Desktop
suite, real-school MFA, hardware-GPU acceptance or full installer verification is claimed. Package
verification now requires the native index/controller/lifecycle instead of the removed facade;
all three are exercised inside native ASAR fixtures, but full release-package gates remain required.
No Actions build, merge, tag, release, installed-App replacement, transfer or protection change ran.

## Rollback

Revert this behavior unit as a whole: restore the facade/HTML declaration, old controller API,
registry ownership and old package-required path together. PR #117's structural extraction can
remain. No persisted data migration or Engine rollback is needed. User sessions remain untouched.
