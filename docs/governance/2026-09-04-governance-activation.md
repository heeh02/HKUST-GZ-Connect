# Repository governance activation receipt

- Status: Current activation receipt
- Owner: project maintainer
- Last verified: 2026-09-04
- Applies to: `heeh02/HKUST-GZ-Connect` before Organization transfer
- Superseded by: the required post-transfer Organization receipt when migration completes

## Source baseline

- Current source: `main@15738338ff2a280300b66e98a1823659f24630a4`
- Governance baseline: merged through PR #59
- Runtime behavior changed by the governance baseline: none

## Repository settings applied and read back

```text
allow_squash_merge=true
allow_merge_commit=false
allow_rebase_merge=false
delete_branch_on_merge=true
has_discussions=true
has_wiki=true (preserved because existing content could not be disproved)
```

Security and Actions:

```text
private_vulnerability_reporting=true
dependabot_alerts=true
dependabot_security_updates=true
secret_scanning=true
secret_scanning_push_protection=true
secret_scanning_non_provider_patterns=false (plan/feature unavailable)
secret_scanning_validity_checks=false (plan/feature unavailable)
actions_default_token=read
actions_allowed_actions=all
actions_sha_pinning_required=true
```

The repository workflows already use full commit SHAs. `allowed_actions=all` remains temporarily so
the pinned non-GitHub release action continues to work; immutable-SHA enforcement prevents mutable
tag references.

## Branch and tag protection

Classic `main` protection remains active with strict, up-to-date required checks:

```text
secret-scan
package-verifier
desktop
desktop-electron
windows-private-file
engine
offline-tests
```

It also requires one approval, stale-review dismissal, conversation resolution and linear history,
and disables force pushes/deletion for ordinary contributors. Administrator enforcement remains
off because `heeh02` is the only direct collaborator.

Ruleset `release-tag-immutability` (`id=22269087`) is active for `refs/tags/v*` and prevents:

```text
deletion
non-fast-forward update
update
```

Tag creation restriction is intentionally deferred until an Organization Release team exists;
otherwise an active no-bypass creation rule would prevent the sole maintainer from creating the next
valid release tag.

## Repository collaboration surface

- Discussions enabled.
- Private vulnerability reporting enabled.
- Area, risk, type, status and `ai-assisted` labels created.
- `release` Environment created without required reviewers; the tag release job is being bound to it
  by the merged governance baseline.
- Repository Milestones separate open-source governance, the 2.0.1 repair release and M1–M5
  architecture modularization. Goal/transfer/release/module work is tracked by linked Issues.
- Wiki left enabled pending a content inventory.

## Machine-readable readback

The versioned contract is [`repository-governance-contract.json`](repository-governance-contract.json).
The following read-only command queries only explicit GitHub settings endpoints, emits no secret values and
returns nonzero on required drift:

```text
node .github/scripts/audit-live-github-governance.js \
  --live heeh02/HKUST-GZ-Connect \
  --phase pre-transfer \
  --expected-owner heeh02
```

The 2026-09-04 readback passed every pre-transfer requirement. It explicitly reported three deferred controls:
the broad Actions allowlist (mitigated by mandatory full-SHA pinning), unavailable non-provider secret patterns
and unavailable secret validity checks. They are not represented as enabled.

## Pending Organization migration

The authenticated `heeh02` account currently reports no Organization memberships. Migration cannot
continue until the maintainer supplies or creates the destination Organization login. Issue #84 owns
the blocked transfer and its post-transfer receipt.

After transfer, read back and verify:

1. repository owner, redirects, clone/push remotes and default branch;
2. releases, immutable tags, Actions history, secrets and environments;
3. team permissions and CODEOWNERS substitutions;
4. main and tag Rulesets, Release-team creation bypass and administrator enforcement;
5. private vulnerability reporting, Dependabot, Discussions and security settings;
6. update URLs embedded in source/package behavior;
7. a clean required CI run on the new repository identity.
