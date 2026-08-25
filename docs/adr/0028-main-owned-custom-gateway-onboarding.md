# ADR-0028: Keep custom Gateway onboarding in Main

- Status: Accepted for 2.0 P6i
- Scope: credential-free probe, confirmation and durable Candidate provisioning
- School selector and active Profile switch: deferred to P6j

## Decision

The control Renderer may request four narrow operations: list sanitized Profile
views, probe a custom Gateway origin, confirm the short-lived result, and cancel
the flow. Main owns every protocol and persistence component.

The native `ec-gateway-probe` receives one normalized HTTPS root origin and no
credential, cookie, token, account name or Profile key. Its child environment
does not inherit proxy variables, certificate overrides or application secrets.
Stdout and discarded stderr are bounded, the process has a fixed deadline, and
malformed, concurrent, failed and cancelled outcomes use stable value-free error
codes.

Main binds a successful probe to the exact current process-lifetime active
context before issuing a two-minute confirmation handle. Context drift,
expiration, cancellation or duplicate consumption makes that handle unusable.
The Renderer receives the normalized origin, candidate family, reported version,
expiry and unverified flag, but never the generated Profile/Account/Workspace
keys or the unredacted Profile document.

Confirmation is consumed synchronously into the existing recoverable custom
Profile provisioning journal. Only after all Profile, Engine config, Account and
Workspace files are materialized and the custom index is committed does Main
return the new public `profileId` and refreshed sanitized Profile views.

## Boundaries

P6i intentionally does not expose a visible selector or activate the Candidate.
Doing so before P4 switch recovery and controlled relaunch are composed in Main
would leave path-bound credentials, Browser Session, routes and Engine ownership
on the previous school. P6j must switch those authorities transactionally before
the onboarding UI becomes user-facing.

## Evidence

- exact child argv and scrubbed environment contract;
- timeout, cancellation, concurrent, oversized and malformed output tests;
- active-context drift invalidates a completed probe;
- real provisioning produces a restart-readable custom Candidate;
- trusted IPC and Preload expose no raw invoke, persistent key or Gateway state;
- real Electron reviewed/custom Main startup can list only sanitized active views;
- live credential-free HKUST probe returns the recognized compiled family.
