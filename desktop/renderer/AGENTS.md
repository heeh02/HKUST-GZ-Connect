# Renderer instructions

- Inherit the root and Desktop `AGENTS.md` files.
- Renderer is presentation and interaction only. It never reads files, starts processes, opens raw
  sockets, stores credentials or interprets Engine protocol text.
- Do not add a new feature symbol to `window`/`globalThis`. Existing globals are migration debt, not
  precedent.
- Each feature owns its model, controller, view, styles and one explicit public entrypoint.
- A feature may use shared UI/contracts or injected callbacks; it may not reach into sibling feature
  internals.
- Scope CSS beneath a feature root class. Shared tokens/components live in shared UI files; do not
  add broad selectors to solve one feature's layout.
- Keep DOM IDs stable unless all contracts and upgrade/UI tests are updated in the same PR.
- Preserve Chinese/English parity, keyboard operation, visible focus, reduced motion, zoom and text
  overflow behavior.
- GUI evidence covers narrow, standard and wide layouts and both official/personal workspace states
  when affected.

## Minimum validation

- Relevant Node renderer/component tests.
- `npm run test:renderer-layout` and/or `npm run test:workspace-layout` for layout changes.
- `npm run check:architecture`, `npm run check:syntax` and `npm run check:secrets`.
- Browser/MFA E2E when a change affects popup, navigation, login, credentials or browser chrome.
