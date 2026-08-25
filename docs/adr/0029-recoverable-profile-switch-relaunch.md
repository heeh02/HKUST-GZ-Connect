# ADR-0029: Activate a Profile switch through controlled relaunch

- Status: Accepted for 2.0 P6j
- Scope: Main switch cleanup, persistent activation, startup recovery and relaunch
- Visible school selector: deferred until P6k

## Decision

Profile-scoped services remain immutable for one Desktop process. A switch does
not mutate credential stores, Browser Sessions, PAC files, certificate stores or
Engine configuration in place. The existing P4 journal first gates and retires
the old context, atomically activates the destination Profile/Account/Workspace,
clears the committed journal, and then schedules one controlled application
relaunch. The successor resolves the new Profile before constructing any
path-bound service.

The live cleanup order is fixed:

1. synchronously invalidate the active-context lease;
2. suspend the Campus Browser request boundary;
3. cancel MFA, onboarding, network recovery and queued mutations;
4. wait for the real Campus Browser window to emit `closed`;
5. stop the exact captured Engine generation;
6. remove the local proxy credential projection;
7. clear server-derived resources, telemetry and connection presentation;
8. validate the destination and activate persistent authority;
9. schedule a relaunch and close the old log before exit.

If the process stops with a prepared, ready or committed journal, the next Main
process performs recovery before persistence, logs, tray, Browser, network
monitoring or auto-connect start. It confirms that no prior owned Engine remains,
finishes the same journal, and relaunches once into the newly selected authority.

## Relaunch identity

Each successor carries `--profile-switch-relaunch=<switchId>`. Reusing the same
switchId is treated as a non-converging loop and fails closed. A later deliberate
switch removes an older marker and installs its new switchId, so repeated user
switches remain supported without an unbounded restart chain. The switchId and
persistent keys never cross the Renderer IPC response.

## Engine and Browser proof

POSIX orphan cleanup uses an exact escaped executable pattern, requests
termination, then requires `pgrep` to prove absence. Windows requires the
owner-only PID/executable record, verifies both values in PowerShell, force-stops
that exact process, proves it absent, and only then removes the owner record.

The Browser manager no longer drops ownership when `close()` is merely requested.
The switch barrier waits for the actual `closed` event with a bounded deadline;
timeout or missing proof leaves the journal prepared and destination inactive.

## Evidence

- real Electron recovers a prepared reviewed-to-custom journal before services;
- real Electron custom-to-reviewed switch closes an open isolated Browser first;
- real Electron reviewed-to-custom switch advances the epoch again;
- all three transitions clear the journal and relaunch into the selected Profile;
- unit tests cover ready/committed recovery, stale contexts, 100 alternating
  switches, Browser timeout, Engine absence proof and relaunch loop prevention.
