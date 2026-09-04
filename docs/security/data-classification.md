# Repository data classification

- Status: Current policy
- Owner: Security maintainers
- Last verified: 2026-09-04
- Applies to: Git, issues, pull requests, CI, releases, research and agent sessions

| Class | Examples | Allowed locations |
| --- | --- | --- |
| Public source | Code, public docs, synthetic fixtures, reviewed profile metadata | Git and public collaboration |
| Sanitized evidence | Bounded protocol shapes, redacted errors, checksums and compatibility receipts | Git only after Security review |
| Restricted evidence | Official installers, licensed binaries, raw static analysis, authorized network observations | Approved local/institution storage; never public Git |
| Secret | Passwords, OTPs, cookies, tokens, private keys, credential envelopes, authorization headers | Runtime secure storage/memory only |
| Personal data | Student/staff identity, private schedules, account-specific portal data | User-owned runtime storage only |
| Generated | `node_modules`, Cargo target, staged engines, applications, DMGs, EXEs, AppImages | Ignored local output or bounded CI artifacts |

## Rules

- Secret and personal data never enter prompts, issues, PRs, source fixtures, screenshots, logs or
  CI artifacts.
- Sanitization must remove values, not merely blur them visually.
- Synthetic fixtures use reserved/non-real identities and cannot be accepted as live compatibility
  evidence.
- Restricted evidence has an owner, authorization basis, retention period and deletion process.
- Package/release artifacts are published only by the release workflow; local builds are not added
  to Git.
- A suspected leak stops the task. Do not rewrite public history without a maintainer-led incident
  plan; revoke/rotate first and preserve private forensic evidence.
