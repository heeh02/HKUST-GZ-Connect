# ADR-0024: Verified inactive custom Profile runtime candidate

- Status: Accepted for 2.0 P6e
- Scope: persisted custom Profile loading and Engine launch binding
- Production selection, credential entry and active switch: deferred

## Decision

Every provisioned custom Profile stores a compiled-family Engine config as an
eleventh receipt-bound owner-only target. User/Profile data selects only the
confirmed HTTPS root origin. The following remain compiled code:

- EasyConnect password/Modern-L3 protocol family;
- discovery, password configuration, login, logout, session configuration and
  resource-list paths;
- standard user agent, timeout and MTU;
- disabled environment/system DNS fallback;
- empty reviewed DNS fallback;
- disabled private-Gateway exception.

Custom JSON cannot provide endpoint paths, CA files, scripts, package URLs,
private DNS or transport plugins.

`CustomSchoolProfileRegistry` loads only entries in the owner-only additive
index. It reopens the raw SchoolProfile, ProfileState, ProfileSettings,
CampusAccount, WorkspaceScope, WorkspaceSettings, local resources and Engine
config through link-free owner-only paths. It verifies every Profile revision,
Gateway origin, ProtocolFamily, Account/Workspace relationship and credential
presence before returning an internal candidate.

The Engine config is reconstructed from compiled code and compared exactly with
the persisted JSON. Its SHA-256, origin, Profile ID/revision and family form the
same private `engine_config_binding` frame already rechecked by Rust before
credential input.

## Presentation boundary

Renderer-facing enumeration contains only `SchoolProfileView` fields and the
visible `custom-local`/unverified candidate status. Opaque profile/account/
workspace keys, Engine config path, endpoint set and credential state remain in
Main. The registry's internal callback is synchronous and its nested source
document is immutable.

## Activation boundary

Loading a candidate does not write GlobalSettings, create an
`ActiveContextLease`, open a Browser partition or start an Engine. The next P6
slice must compose this candidate with the existing P4 cleanup and two-target
activation journal. Only after activation may a credential transaction bind a
username/password envelope to this Profile, Account revision, origin and
ProtocolFamily.
