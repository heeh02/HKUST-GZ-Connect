# Documentation instructions

- Inherit the root `AGENTS.md` and follow `docs/README.md` for authority and placement.
- Documentation is evidence, not permission. A plan, ADR, type or fixture cannot promote an
  unsupported capability.
- Every maintained document declares status, owner, last verification and applicability.
- Current state never depends on an uncommitted/local worktree. Use exact tags or `main` commits.
- ADRs are for durable, difficult-to-reverse decisions; procedural implementation records belong in
  development/operations history.
- Historical audits and plans are retained only when they provide continuing evidence and are
  marked non-authoritative. Tool-specific folders are not canonical project categories.
- Do not duplicate version history in README; use release notes and the current status index.
- Security claims distinguish source review, offline fixtures, package evidence and authorized
  live-school validation.
- Keep links relative within the repository and update inbound links when files move.
- Delete obsolete documentation only with explicit scope; Git history is the recovery mechanism.
