# GitHub and release instructions

- Inherit the root `AGENTS.md` and read `RELEASING.md` before workflow or release changes.
- Keep workflow permissions at the smallest job-level scope. Build/test jobs are read-only; only the
  dedicated release job may receive `contents: write`.
- Pin every external Action to a verified full commit SHA. Do not replace a SHA with a mutable tag.
- Do not use `pull_request_target` to execute contributor-controlled code.
- Required status contexts are stable public contracts. Renaming or conditionally omitting one
  requires a coordinated branch-rule migration and readback.
- Changes to workflows, CODEOWNERS, agent instructions, branch/tag rules, package verification,
  signing or release scripts require Security/Release review.
- A `vX.Y.Z` release tag must match the package version, resolve to a `main` commit and be immutable.
- Do not expose Actions secrets to fork pull requests, logs, artifacts or untrusted scripts.
- GitHub setting changes are incomplete until the REST/API state is read back and recorded.
- Repository transfer requires a migration receipt covering remotes, redirects, permissions,
  protections, secrets, environments, Actions, releases and update URLs.

## Required validation

- Validate YAML and inspect the effective event/permission boundary.
- Run exact-tree secret and package-verifier tests for workflow or release changes.
- Confirm required status-check names against the live branch/ruleset configuration.
- For releases, verify the exact tag commit, workflow conclusion, artifact names/digests and actual
  signing/notarization state before editing release notes.
