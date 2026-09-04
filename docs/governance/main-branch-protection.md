# Main branch protection contract

- Status: Active; last read back from GitHub on 2026-09-04
- Applies to: `main`
- Owner: project maintainer

## Required pull-request checks

Every pull request and merge-group SHA must create and pass these stable contexts:

```text
secret-scan
package-verifier
desktop
desktop-electron
windows-private-file
engine
offline-tests
```

`package-verifier` is an aggregate. It succeeds only after macOS, Windows and Linux unpacked applications are
built from the same SHA and each platform verifier passes. Matrix child names are deliberately not branch-rule
contracts.

`secret-scan` reads the exact Git tree identified by `GITHUB_SHA`. It is not satisfied by scanning an untracked
worktree or only the changed files.

Required checks use strict/up-to-date mode. A newer base commit therefore requires a fresh merge SHA and fresh
checks before an ordinary merge.

## Pull-request review policy

- changes reach `main` through a pull request;
- at least one approving review is required;
- approvals are dismissed when new commits are pushed;
- all review conversations must be resolved;
- linear history is required;
- force pushes and branch deletion are disabled for ordinary contributors.

## Administrator break-glass

Classic branch protection uses `enforce_admins=false` so the current single administrator is not permanently
locked out when no independent GitHub reviewer is available or the CI provider itself is unavailable. This means
the no-force-push/delete rule is not an absolute technical control against an administrator.

Administrator bypass is an emergency path, not the normal workflow:

1. ordinary merges wait for the required checks and an independent review whenever one is available;
2. bypass is limited to reviewer unavailability or CI/infrastructure recovery;
3. the pull request or a linked issue records the reason, exact SHA, checks that did run and follow-up action;
4. bypass never waives secret handling, credential evidence or release/package truth;
5. force push or deletion of `main` is not an accepted maintenance operation even though an administrator can
   technically bypass classic protection.

If a second reliable administrator/reviewer becomes available, the project should evaluate `enforce_admins=true`
or a separate no-bypass ruleset for deletion/non-fast-forward updates.

## Activation and verification receipt

The governance change is not complete when this file or a green workflow is merged. The maintainer must apply
the protection through GitHub and then read it back:

```text
GET /repos/heeh02/HKUST-GZ-Connect/branches/main/protection
```

The receipt must prove:

- `strict=true` and exactly the seven contexts above;
- approving reviews `>=1` and stale approvals dismissed;
- conversation resolution and linear history enabled;
- force push and deletion disabled;
- the chosen administrator-enforcement state matches the break-glass policy.

P1 production code must not be pushed for review until this read-back succeeds. Recheck the receipt before any
future claim that `main` is protected; green CI alone is not protection.

### 2026-08-24 activation receipt

The protection was applied after governance PR #8 and read back while `main` pointed to
`871cdd9e5e27529b7580b40f710436e78da1bcb5`:

```text
strict=true
contexts=secret-scan,package-verifier,desktop,desktop-electron,windows-private-file,engine,offline-tests
required_approving_review_count=1
dismiss_stale_reviews=true
required_conversation_resolution=true
required_linear_history=true
allow_force_pushes=false
allow_deletions=false
enforce_admins=false
```

This receipt records the P1 admission decision; it is not a timeless claim. Release or governance work that
depends on protection must query the GitHub API again.

### 2026-09-04 governance readback

The same seven required contexts and all values above were read back unchanged while `main` pointed to
`15738338ff2a280300b66e98a1823659f24630a4`. The machine-readable pre-transfer audit in
[`repository-governance-contract.json`](repository-governance-contract.json) also passed. Administrator,
code-owner and last-push enforcement remain intentionally deferred until an Organization and second trusted
reviewer exist; Issue #84 owns that transition.
