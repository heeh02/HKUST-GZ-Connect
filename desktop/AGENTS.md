# Desktop instructions

- Inherit the root `AGENTS.md` and the Desktop boundaries in `ARCHITECTURE.md` and `SECURITY.md`.
- `main.js` is a composition root. New persistence, browser, routing, IPC, recovery or credential
  behavior belongs in an owned `lib/<domain>/` module.
- Keep Main-only secrets in Main/Rust owners. Renderer receives sanitized display DTOs only.
- IPC handlers use trusted-sender registration, exact channel names, bounded schemas and injected
  stores/effects. Never add a generic invoke/send bridge.
- Browser, Profile, Account and Workspace state remains scoped to the active opaque context keys.
- Migrations are journaled, no-follow, owner-only, crash-safe and backward compatible.
- Connection and browser operations remain generation/intent bound; stale async work is a no-op.
- New files live under an existing domain unless an architecture change explicitly creates a domain.
- Tests mirror the production domain under `test/unit/<domain>/`; do not add new root test debt.

## Minimum validation

Run from `desktop/`:

```text
npm test
npm run check:architecture
npm run check:secrets
npm run check:install-scripts
npm run check:syntax
```

Also run the relevant Electron E2E for browser, MFA, migration, profile switching, routing, layout or
Engine lifecycle changes. Packaging/security boundary changes require the exact package verifier on
all supported platforms through CI.
