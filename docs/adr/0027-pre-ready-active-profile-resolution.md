# ADR-0027: Resolve the active Profile before path-bound services

- Status: Accepted for 2.0 P6h
- Scope: clean restart into reviewed or provisioned custom Profile authority
- Interactive onboarding and live switch IPC: deferred

## Decision

When owner-only GlobalSettings exists, Main resolves its opaque
`activeProfileKey` before constructing the active SchoolProfile controller,
credential adapter, logs, routing stores, certificate trust or Campus Browser.

Resolution order is exact:

1. read and validate owner-only GlobalSettings without credential access;
2. match `activeProfileKey` against reviewed anchors and the custom index;
3. reject ambiguous or unknown ownership;
4. reopen the candidate Profile/Account/Workspace and compiled Engine config;
5. create a candidate-backed controller;
6. run the existing pre-ready Profile Workspace authority/path selection.

The only fallback is the first P6 startup after a historical P3 migration, when
both candidate stores are empty and older builds could only have created HKUST.
P6g anchors that reviewed authority before ordinary services. Once any
candidate authority exists, an unknown key can never fall back to HKUST.

## Browser and routing isolation

The Campus Browser receives the exact Workspace-derived persistent partition.
HKUST retains its adopted legacy partition; each custom Workspace uses its
opaque-key-derived partition. A custom Profile has no reviewed homepage, so its
internal home is the local non-network `about:blank` page. It carries a DIRECT
route and does not start the Engine. Every real HTTP(S) page retains the existing
connection barrier in P6h: removing it before an asynchronous request-boundary
barrier exists would break an original DIRECT-to-campus SSO redirect.

Custom empty campus domains remain empty through settings projection and PAC
generation; they never inherit HKUST domains. Empty custom health targets
disable website health probes instead of inventing HKUST targets. True on-demand
connection for a DIRECT first page remains a P8 requirement and must preserve
the original request rather than replaying it as a GET.

## Native probe packaging

The credential-free `ec-gateway-probe` is built and staged with the Engine and
OpenSSH helper for macOS arm64/x86_64, Windows x86_64 and Linux x86_64. The
package verifier requires the exact architecture-specific binary set, and
macOS local/release signing seals all three executables. Test-only fixtures and
private material remain excluded.

## Evidence

- clean custom Profile pre-ready authority and path selection;
- unknown-key fail-closed behavior;
- first-run reviewed fallback;
- real Electron custom Main startup with no credential or Engine;
- isolated custom Browser partition and local blank home;
- real Electron HKUST Main integration preserving its SSO connection barrier;
- package naming, exact-resource and multi-platform workflow gates.
