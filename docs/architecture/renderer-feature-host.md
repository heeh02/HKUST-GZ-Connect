# Renderer feature host: lifecycle-owned native modules

- Status: Proposed behavior/lifecycle contribution, not merged or installed
- Owner: Desktop Renderer maintainers, issue #79
- Base: PR #110 at `7b76f2b429030e5da2d0ce7bd88cae96eb43a9e6`
- Verified: 2026-09-08, source `e91628c3bf33324d72a71dc159d5dabab4467fb6`

## Boundary

`features/feature-host/index.mjs` is the explicit static catalog and factory entrypoint.
Its internal registry accepts synchronous constructors/start/dispose contracts, mounts a known
ID once, preserves injected options and reverses mounted-owner disposal. Startup failure retires
the partial owner and earlier owners. Cleanup failures are collected rather than hiding failure
or skipping subsequent owners. Definitions cannot be swapped after registry creation.

The initial checkpoint below registered only `campus-data`. The separate proposed
[favorite lifecycle contribution](official-favorites-lifecycle.md) also registers official-favorites
at its existing startup position. The separate [auth lifecycle unit](renderer-auth-challenge-lifecycle.md)
also explicitly mounts interactive-auth. These three native owners use the host; legacy features remain on
their existing paths until their lifecycle contracts are reviewed. Direct native factory/start
pairs in app.js reduce from two to zero across these two review units.
It is a real running entrypoint, but not completion of the full Renderer registry/migration goal.

The machine inventory adds one owned `feature-host` root whose allowed dependencies name the
existing campus-data, official-favorites and auth-challenge public entrypoints. It does not expand the legacy global allowlist,
permit private cross-feature imports or add an HTML bootstrap exception. This inventory change
requires independent review along with the implementation.

## Campus-data owner contract

The instance adds synchronous, terminal `dispose()`. `start()` returns true only for its first
successful invocation. Repeated start or disposal is inert. Partial startup failure cleans owned
bindings; disposal closes its own detail dialog, disconnects its observer, removes its listeners,
cancels its timer and clears owned DOM/data. Other modules' listeners and dialogs are not removed.

Generation checks make queued events, observer callbacks, timer callbacks and pending read results
inert after retirement, including retirement from an injected catalog callback. Published data
cannot be cached or returned afterwards. Authorization-epoch changes made by a valid denial still
render that denial rather than accidentally preserving old data. The earlier compact pending-week,
cache-revocation and full-revalidation fixes remain intact.

The instance is not restartable after disposal; a new document/host constructs a new owner. This
does not add BFCache resume or runtime plugin discovery. In-flight Main/Preload work already issued
is not claimed to be canceled: its Renderer publication is fenced. No IPC, persistence schema,
credential, routing, Engine or system-network behavior is added.

## Acceptance and limits

- Registry tests cover definitions, exact options/order, duplicate IDs, reverse disposal,
  invalid/async lifecycle contracts, startup/cleanup failure, pagehide and reentrancy.
- Owner tests cover idempotence, partial-start cleanup, queued callbacks, cache/timer retirement,
  external-listener preservation and reentrant catalog publication.
- Windows native SSH: 33 focused registry/lifecycle/module/cache tests passed.
- Linux 5070: complete Desktop suite 1,344 passed / 6 platform skips.
- Native ASAR Renderer tests passed on Mac, Windows and Linux/xvfb, including host-driven pagehide
  clearing campus-data DOM while leaving the unregistered favorite dialog alone; parent confirmed
  child close and fixture deletion. This is asset/bootstrap evidence, not full installer acceptance.
- Mac control-shell layout and schedule width/zoom/detail/expiry recovery gates passed; stylesheet
  comparisons retained the delivered compact calendar behavior.
- Architecture/install-script gates passed; syntax tree
  `7c72870bb7f6cfaba4511102aef1f3b68abd8db5` passed 489 source checks. No budget or dependency increase.

The controller is 469 lines (existing 500-line limit); the internal registry is 77 lines. Full
Windows unit, real-school, signed installer, long soak and hardware GPU acceptance were not run.
No installed App was replaced and no release/transfer/protection change is included. Revert this
isolated contribution to restore direct campus-data creation without reverting the prior calendar
fixes; no user-data migration is involved. Localization and other feature lifecycles remain open.
