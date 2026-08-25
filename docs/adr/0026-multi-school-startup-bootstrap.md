# ADR-0026: Multi-school startup recovery and reviewed anchor bootstrap

- Status: Accepted for 2.0 P6g
- Scope: production startup while HKUST remains the only active pre-ready Profile
- Custom Profile activation and selector IPC: deferred

## Decision

After `DesktopPersistenceRuntime` finishes P3 migration and before log, tray,
Browser or network services start, production Main now executes one
`MultiSchoolStartupRuntime` boundary.

In `profile-workspace` mode it performs this exact order:

1. recover or complete any owner-only custom Profile provisioning journal;
2. synchronously obtain the current packaged reviewed Profile source document;
3. verify that document matches the active persistence authority;
4. reopen the exact reviewed Profile/Account/Workspace by GlobalSettings keys;
5. persist or verify the immutable reviewed Profile anchor;
6. build the restart-safe candidate directory and verify enumeration.

Any unreadable journal, partial destination, index conflict, wrong Profile,
authority mismatch, link, permission or Engine-config drift aborts startup before
ordinary services can read credentials or open network state.

Legacy first-run mode remains behavior-compatible and constructs no multi-school
stores. A successful P3 migration still performs its bounded one-time relaunch;
the successor then executes this bootstrap. Real Electron main integration,
synthetic Engine lifecycle and two-process persistence migration remain green.

## Current limitation

Pre-ready Profile selection still begins from the packaged HKUST controller.
Therefore this slice deliberately refuses a custom active authority at startup
and does not expose Profile switching IPC. The next slice must resolve the
active Profile from GlobalSettings/profile directory before creating path-bound
services, then rotate the controller, persistence adapter, Browser session and
active-context lease after a committed switch.

The composition is now exposed through the accurately named
`lib/app/desktop-runtime-composition.js` composition boundary, so
`main.js` stays at its architecture ratchet of 35 direct dependencies and 1644
lines.
