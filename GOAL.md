# Open-source collaboration convergence goal

- Status: Active
- Authority: project maintainer
- Baseline: `main@15738338ff2a280300b66e98a1823659f24630a4`
- Started: 2026-09-04
- Scope: repository governance, documentation truth, agent instructions, module boundaries,
  contributor workflow, GitHub protections and organization migration

## Objective

Make HKUST(GZ) Connect safe and understandable for sustained open-source development by
multiple people and multiple coding agents, without weakening the credential, MFA, routing,
upgrade or release boundaries already shipped in 2.0.0.

The result must make ownership, authority, scope, validation and release provenance explicit.
`AGENTS.md` guides agents, repository documents guide people, and CI/GitHub settings enforce the
high-risk rules. No instruction file is treated as a substitute for review or technical controls.

## Non-negotiable boundaries

- Real passwords, OTPs, cookies, tokens, private keys and unsanitized school evidence never enter
  Git, issues, pull requests, agent prompts, logs or CI artifacts.
- Real-school investigation remains read-only and user-authenticated unless a maintainer approves
  a bounded canary with sanitized evidence.
- Unknown authentication, routing and protocol behavior fails closed.
- Renderer, Preload, Desktop Main and Rust Engine retain the dependency and secret boundaries in
  `ARCHITECTURE.md`.
- Public release tags are immutable and releases remain bound to one exact commit and verified
  cross-platform artifacts.
- User data and installed application state are outside repository-governance migrations.

## Current findings

1. PR #59 established the contributor, agent, documentation and machine-governance baseline on
   `main`; runtime modularization must now consume those boundaries rather than create alternatives.
2. `desktop/main.js`, `desktop/lib/browser/session/campus-browser.js`, the Renderer bootstrap/CSS,
   and `independent/src/bin/ec-engine.rs` are concurrency hot spots.
3. Renderer feature files still depend on global `window.*` names and HTML script order that the
   CommonJS architecture graph cannot see.
4. The immutable `v2.0.0` tag exists, but no stable GitHub Release is published for it and
   `/releases/latest` still resolves to `v1.2.3`; Issue #76 owns the 2.0.1 repair release.
5. Repository Rulesets, CODEOWNERS, templates, Dependabot, release Environment and immutable Action
   policies are active, but one administrator and no independent reviewer prevent full enforcement.
6. The `heeh02` account currently has no GitHub Organization membership. Repository transfer is
   blocked until the maintainer chooses or creates the destination organization.

## Completion outcomes

### G0 — Restore repository truth

- `docs/README.md` defines the documentation map and authority order.
- Current status, roadmap, product definition, ADR index and 2.0.0 release notes agree with the
  published stable release.
- Tool-specific historical material such as `docs/superpowers/` is removed from the maintained
  tree; Git history remains the recovery record.
- Historical plans and audits are clearly non-authoritative.

### G1 — Establish contributor and agent contracts

- Root and scoped `AGENTS.md` files cover repository, GitHub, Desktop, Renderer, Rust and docs.
- `CONTRIBUTING.md`, root `SECURITY.md`, `CODE_OF_CONDUCT.md`, PR/Issue templates and CODEOWNERS
  exist and agree with the architecture.
- AI-assisted work records scope, evidence and accountable reviewer without storing raw prompts or
  secrets.
- One issue, one owner, one branch and one isolated worktree is the default concurrency model.

### G2 — Enforce file and module ownership

- A machine-readable module map identifies owned paths, public entrypoints, allowed dependencies,
  risk class and required validation.
- Repository checks reject missing governance files, forbidden generated/private paths and new
  tool-specific canonical-document directories.
- Tests mirror production domains; new root-level test debt is forbidden.
- Architecture budgets ratchet downward as hot spots are extracted; budgets are never raised to
  make unrelated feature work pass.

### G3 — Reduce concurrency hot spots

- Renderer stops adding global feature symbols and moves behind one explicit bootstrap/public API
  per feature.
- Campus Browser separates window, tab, navigation, routing, credential/MFA, download and workspace
  ownership.
- Desktop Main becomes a composition root rather than a lifecycle implementation hub.
- Rust Engine moves process orchestration out of `src/bin/ec-engine.rs`, narrows public visibility
  and keeps compatibility laboratories outside production paths.
- Every refactor wave preserves observable behavior and lands as a separately reviewable PR.

### G4 — Harden GitHub and migrate ownership

- The repository is transferred to the maintainer-selected GitHub Organization.
- Organization teams separate maintainers, Engine, Desktop/UI, Security and Release ownership.
- Main and `v*` tags are protected by Rulesets; release tags cannot be updated or deleted.
- Ordinary changes use squash merge and merged branches are deleted automatically.
- CODEOWNERS review and last-push approval are enabled after a second trusted reviewer exists.
- GitHub Actions require immutable full-SHA references and least privilege.
- Dependabot alerts/security updates and grouped npm, Cargo and Actions updates are enabled.
- A migration receipt verifies redirects/remotes, permissions, branch/tag rules, secrets,
  environments, Actions, releases and the installed update URL after transfer.

## Delivery sequence

1. Documentation truth and obsolete-document removal.
2. Agent/contributor/security/ownership contracts.
3. Machine-enforced repository and module rules.
4. GitHub settings and Organization migration.
5. Renderer, Browser, Desktop Main and Rust modularization waves.
6. Final cross-platform, upgrade, security and release-governance audit.

## Pull-request boundaries

- Governance and documentation changes do not contain runtime behavior changes.
- Each modularization PR owns one domain and one independently reviewable outcome.
- GUI, protocol, persistence migration, CI and release changes are not combined in one PR.
- A PR records exact base/final SHA, owned paths, tests run, tests omitted, risks and rollback.
- Stacked PRs require an explicit dependency chain; otherwise every PR targets `main`.

## Goal completion gate

The goal is complete only when:

1. all G0–G4 outcomes are implemented or explicitly accepted as deferred with an owner and trigger;
2. the new GitHub owner, default branch, release tags, protections and latest Release are read back;
3. required CI passes on the exact final `main` commit;
4. module-boundary and repository-governance checks pass locally and in CI;
5. documentation has one current source of truth and no active statement points to a merged branch;
6. no secrets, generated packages, raw captures or vendor binaries entered the Git tree;
7. unresolved risks and organization-level settings are recorded in a final governance receipt.

## Progress receipt — 2026-09-04

- G0 merged through PR #59: current release truth is aligned; obsolete tool-specific documents and
  completed product proposals are removed; original 2.0 vision documents are classified under
  `docs/archive/`.
- G1 merged through PR #59: six-level agent instructions, contribution/security/conduct policies,
  CODEOWNERS, templates and AI provenance are present.
- G2 baseline merged through PR #59: module inventory, repository-governance/link/Action-pin checks
  and CI wiring are present; target module dependency/public-entrypoint enforcement belongs to M1–M4.
- G3 planned but intentionally not mixed into this governance PR. Runtime modularization begins only
  after the governance baseline merges.
- G4 partially activated on the current personal repository: squash-only, branch auto-delete,
  Discussions, private vulnerability reporting, Dependabot security updates, full-SHA Action
  enforcement, labels, release Environment and tag immutability are active and read back.
- Organization transfer, team CODEOWNERS, release-tag creation restriction, protected release
  reviewers and administrator enforcement remain blocked on the destination Organization login and
  a second trusted reviewer.
- Windows/Profile upgrade repair merged through PR #75. Issue #76 records that the missing stable
  2.0 channel must be repaired with a verified 2.0.1 rather than republishing the known-buggy 2.0.0
  Windows artifact.
- PR #78 provides the repository-ID-based 2.0.1 transition patch so update discovery remains bound
  to the same public, enabled repository across owner transfer without trusting arbitrary redirects.

## Current external blocker

The repository cannot be transferred safely until the destination Organization login is supplied.
The maintainer must either create an Organization or name an existing one and confirm that
`heeh02` is an owner there. No Organization name, team slug, billing plan or public identity will be
invented by an agent.
