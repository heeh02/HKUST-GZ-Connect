# Candidate combination preflight

- Status: Historical read-only integration evidence; not merge acceptance
- Owner: project maintainers
- Last verified: 2026-09-12
- Applies to: published main `39850415c901aeaa77ecb86cd3ce49a2e75290a8` and the exact candidates below

## Inputs and result

The open queue still contains 14 drafts. Existing Renderer dependencies are represented by the
chain tip; no draft was merged, closed or declared complete in this preflight.

| Lane | Exact tip |
| --- | --- |
| Renderer / Integration Center (#120) | `239419dbdec843eb496efcfaef471222370aa934` |
| Browser download lifecycle (#113) | `7ff7eca97061c02e2225a3f2575a8d24b655d897` |
| Popup MFA test ownership (#111) | `178b94493bf5a39028649e63fd447d6f73d2e72d` |
| Governance (#89) | `85016009a9ba110308a9a41b8dcd51fad36a3b7c` |

Run `git merge-tree --write-tree` sequentially in that order. Intermediate unreferenced local
commit objects carry the two parents solely to preserve merge-base semantics for the next step;
no branch, tag, checkout or remote ref is moved by creating these inspection objects.

1. Renderer + Browser tree: `d756a5ae749d777129f1d924159638e8dbe3cd5e`.
2. Add popup fixture: `5aa076ff66764ed4b3c7868fe5684023e976809f`.
3. Add governance: **`8a59beb8a115258d8921dbce94d0296dcbac2a00`**.

All three merge-tree operations returned success without textual conflicts. The combined owned
Electron fixture helper matches #111 exactly (SHA-256
`8a67fb2afcd199caca647fedb3b829fd55d29981964cdce2fb5a7a4053c145da`).
The combined difference from published main spans 139 files; this is not a small release patch.
The existing exact-tree JavaScript syntax gate passed 531 sources on the final tree, and its
exact-tree secret scan passed. These checks inspect the combined blobs, not a different checkout.

## Remaining acceptance

No whole-combination unit suite, native GUI, native package or live-campus test was run by these
merge-tree checks. Earlier per-lane evidence must not be added together to claim combined success.
Next use the exact final tree in an isolated existing integration checkout, verify production
boundaries and run full tests plus both download/MFA fixtures. Source checks cannot substitute for
Windows/Linux/native package evidence or independent review of Main/IPC/security changes.

## Whole-combination Mac follow-up — 2026-09-12

The existing `goal-combination-check` worktree was switched detached to inspection commit
`dfc75d463cda4c1dc9c03f1bd8b6a9ad3c8ff1fc`, and its tree was verified as the exact final tree above.
Its pre-existing untracked historical receipt and existing dependency directory were preserved.
No implementation branch was created or moved.

Mac Node 24 full `node --test`: **1,471 passed, 14 platform skips, zero failures (1,485 total)**.
Architecture, install-script and repository-governance checks passed. Existing Electron 43.2.0
ran the Node-owned native DownloadItem, popup-MFA and Renderer-ASAR fixtures successfully; all
three confirmed child closure and temporary-data removal. Tests use synthetic/loopback data only.
These are whole-combination results, not sums of per-lane test counts.
The native control-shell layout fixture also passed on the same tree.

Full Windows/Linux combination tests, distribution packages, live-school behavior and independent
review remain outstanding. The earlier three-platform #120 results exclude the Browser/governance
combination and cannot substitute for them. No dependency installation or installed-app update ran.

The package manifest still says 2.0.2. That is inherited source metadata, not authorization to
replace the already-published immutable 2.0.2 tag or assets. Any future release needs its own version,
exact-source acceptance and authorization. Organization transfer is independent of this whole-stack
acceptance and still requires the pending permission/transfer decision.

No new implementation branch, dependency cache, build artifact, Actions run, PR merge or release
was created. Local inspection objects are reproducible from the recorded input commits.

## Whole-combination Linux follow-up — 2026-09-12

The existing designated 5070 WSL inspection checkout advanced detached to
`dfc75d463cda4c1dc9c03f1bd8b6a9ad3c8ff1fc`; readback verified tree
`8a59beb8a115258d8921dbce94d0296dcbac2a00`, identical to the Mac combination.
Node v24.20.0 with umask 022 passed **1,471 tests, 14 platform skips, zero failures (1,485 total)**.
Native architecture checks and all three Node-owned fixtures passed under `xvfb-run -a`:
DownloadItem completion/cancellation/retirement, popup MFA assertions/cleanup, and Renderer ASAR
startup/retirement. Each runner confirmed child closure and fixture removal; no no-sandbox override
was used. All fixture data is synthetic or loopback-only.

Existing Linux dependencies were reused; process-local NODE_PATH referenced the previously
lockfile-verified Acorn tooling through WSL. No dependency download or package build was performed.
The pre-existing dependency symlink remains the only untracked checkout path; temporary transfer
bundles on both hosts were removed and the full-suite log remains on 5070 for audit.

This closes Linux full-combination source/fixture acceptance, not Windows combination, distribution
packages, real-school behavior or independent review. Those remain outstanding. No installed app,
credentials, user files, repository protection, release or Organization transfer was changed.
