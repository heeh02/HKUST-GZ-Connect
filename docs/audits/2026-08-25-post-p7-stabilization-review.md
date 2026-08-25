# Post-P7 current-main stabilization review

## Evidence boundary

This review rechecked the external architecture report against `main` at
`35996adb4d52d8dba5e6a4e2f92582260ac4228e`, the merge of PR #50. The external report was treated as an
investigation lead, not as code fact. No Gateway, credential, Browser session or vendor binary was accessed.

Observed repository baseline:

```text
Desktop JavaScript files: 367
Desktop dependency edges: 742
CommonJS cycles: 0
desktop/main.js: 1632 lines, 35 direct local dependencies
desktop/renderer/app.js: 525 lines
desktop/lib root-level JavaScript files: 136
desktop/lib subdirectories: integrations only
```

The merged P7 branch passed Desktop, real Electron, Rust, secret, Windows private-file and macOS/Windows/Linux
package-verifier checks. This is strong repository/package evidence, not a real-school or imported-tool canary.

## Finding disposition

| Finding | Current verdict | Evidence and action |
| --- | --- | --- |
| F-01 JS syntax check may execute zero files | Confirmed | Both CI and tag build used `rg` in process substitution. A missing `rg` could leave the step green. Replaced by a repository-owned exact-tree, non-zero, self-tested Node gate. |
| F-02 product/plan drift | Confirmed | Documents still described pre-P6 sequencing and pre-P7 capability. Current status now accepts experimental Custom Gateway after implemented safety gates while retaining a second reviewed Profile as the formal support gate. |
| F-03 flat Desktop physical architecture | Confirmed | 136 production modules remain directly under `desktop/lib`; P7 correctly created `lib/integrations`, but the other domains remain flat. Behavior-preserving grouping is required before P8. |
| F-04 façade hides transitive complexity | Confirmed and remediated | `app-data-dir.js` exported unrelated systems through one misleading name. It is replaced by the single-export `lib/app/desktop-runtime-composition.js`; Architecture Gate v2 measures transitive dependencies, fan-in/out and composition exports. |
| F-05 duplicate ADR number | Confirmed | Gateway connector and P3 path seam both used ADR-0016. The P3 seam is renumbered ADR-0030 and an ADR index distinguishes durable decisions from implementation records. |
| F-06 PR #49 too large | Historical, accepted | History is not rewritten. Future work uses small behavior-coherent commits and independently green PRs while retaining only one active 2.0 development branch. |
| F-07 package still says 1.2.3 | Confirmed, currently safe | `v1.2.3` is the published stable line; current `main` is unreleased 2.0 development. The manifest version changes only when the first 2.0 release candidate is deliberately built. |
| F-08 multi-Profile is not formal multi-school support | Confirmed | Only HKUST(GZ) is reviewed. Custom Profiles are local/unverified and cannot establish protocol compatibility. |

## Corrections to the external report

- P7 is implemented in PR #50, not merely planned.
- P7 owns generic Clash/Mihomo/PAC/manual exports, a managed Clash Verge Rev extension and managed OpenSSH
  Include/profile files with Profile-bound helper credentials.
- P7 already has unit fault coverage for target drift, tampering, links, permission boundaries, staged writes,
  readback validation, multi-file commit, rollback and removal that preserves unrelated user content.
- The production provider is still password + Modern L3. P7 changes no Gateway protocol capability.

## Stabilization decision

Do not roll back P3-P7 and do not combine their state machines merely to reduce file count. Preserve the
conceptual boundaries, repair false gates, make documentation authoritative, then move modules by domain with
compatibility exports and dependency rules. P8 begins only after those behavior-neutral changes pass the full
Desktop/Rust/Electron/package suite.
