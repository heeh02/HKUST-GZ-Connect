# Security policy

HKUST(GZ) Connect handles campus credentials, persistent browser sessions and a local proxy. Please
report suspected vulnerabilities privately and do not include real credentials, OTPs, cookies,
tokens, private keys, browser profiles, packet captures or personal data in a public issue.

## Supported versions

Security fixes are provided for the latest stable release and the current `main` branch. Older
releases may be used to reproduce an upgrade issue, but are not promised separate fixes.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting entry on the repository Security page. If private
reporting is temporarily unavailable, contact the repository owner through GitHub without posting
technical exploit details, then wait for a private channel before sharing sensitive evidence.

Include only sanitized information initially:

- affected version, platform and architecture;
- vulnerability class and impact;
- minimal reproduction using synthetic values;
- whether credentials, browser data, local proxy access or release artifacts are involved;
- suggested mitigation, if known.

Do not test against other users, bypass school controls, perform load testing, or access data you do
not own. Real-school verification requires explicit institutional authorization.

## Response process

Maintainers will acknowledge a usable report, classify affected boundaries, arrange a private fix,
run the applicable security/upgrade/package gates and coordinate disclosure. A report is not closed
solely because a synthetic test passes; shipped artifacts and affected versions must be reconciled.

## Public security model

The Desktop threat model and non-negotiable runtime invariants are documented in
`desktop/SECURITY.md`. Protocol capability and MFA claims remain evidence-gated by
`ARCHITECTURE.md` and the accepted specifications.
