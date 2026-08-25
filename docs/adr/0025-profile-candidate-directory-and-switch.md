# ADR-0025: Restart-safe Profile candidate directory and P4 switch

- Status: Accepted for 2.0 P6f
- Scope: reviewed/custom candidate discovery and persistent authority switching
- Main/Renderer activation: deferred to the next P6 slice

## Decision

Before leaving a reviewed Profile, Main persists one owner-only immutable
anchor containing only its reviewed `profileId`, opaque `profileKey`, opaque
primary `accountKey` and Account creation time. The anchor is accepted only
after the packaged Profile and its local Profile/Account/Workspace authority
are revalidated. It contains no Gateway, username, credential, Cookie, route or
Browser data.

The `ProfileCandidateDirectory` combines:

- packaged reviewed Profiles that have an exact local anchor;
- provisioned `custom-local` Profiles from the owner-only custom index.

For every candidate it reopens authority by opaque keys, verifies the Profile,
Account, Workspace and Engine config, and constructs an internal persistent
context. Renderer enumeration receives only `SchoolProfileView`; no persistent
key or config path crosses that boundary.

## Switch composition

`ProfileSwitchRuntime` consumes the exact current persistent context and one
directory candidate. It calculates a monotonic epoch, obtains the two-target
activation receipts, binds the current Engine generation when present, and
submits the request to the existing P4 `ActiveContextSwitchSystem`.

The coordinator sequence remains:

```text
gate old Browser/context
→ validate source
→ cancel MFA/connectivity/mutations
→ close old Browser workspace
→ stop exact Engine generation
→ revoke proxy access and server state
→ revalidate destination
→ commit destination Workspace epoch + GlobalSettings pair
→ clear journal
→ activate new runtime
```

Source and destination callbacks reopen the candidate directory rather than
trusting a prior Renderer selection. Runtime activation receives the exact
post-commit directory record. Switching back to HKUST uses its reviewed anchor
and preserves the adopted legacy Campus Browser partition; custom workspaces
retain their derived isolated partitions.

## Evidence

The real-filesystem integration alternates reviewed HKUST and a custom Profile
twenty times using actual GlobalSettings, destination Workspace files, P4
journal, activation store, cleanup barrier and candidate directory. Every round
advances the epoch, updates the exact active Profile/Account pair and leaves no
journal residue.

This slice does not yet compose the switch runtime into production Main or
expose selection IPC. That integration must invalidate the Main-owned Gateway
confirmation and every old `ActiveContextLease` token before its first await.
