# Shortcut entry, certificate pinning, and cloud release design

## Goal

Make a pasted campus URL easy to save and reopen, permit a user to explicitly
trust one self-signed HTTPS certificate without weakening browser-wide TLS
verification, and produce future releases in GitHub Actions with only DMG and
EXE assets.

The currently observed gateway-side data-plane disconnect is intentionally out
of scope for this change. The desktop must continue to show a failed tunnel
accurately after its existing bounded reconnect policy is exhausted; this work
does not claim that reconnecting alone resolves that protocol failure.

## Shortcut flow

The dashboard keeps the existing URL field and open action. It gains an
`添加到常用并打开` action.

1. The action sends the pasted URL, without a caller-selected route, to the
   existing owner-only shortcut store.
2. The store normalizes the URL and chooses its reviewed default route. This
   preserves direct defaults for Outlook and Canvas instead of accidentally
   forcing them into the tunnel.
3. The renderer suggests an editable name from the normalized hostname. In the
   manager it fills a blank name when the URL field loses focus, so a user who
   enters only a URL can save it. A manually entered name is never replaced.
4. A successful save updates both the shortcut grid and the manager list in
   the same renderer turn, displays an explicit success message, and opens the
   saved shortcut using its persisted route.
5. Invalid or duplicate URLs remain rejected by the main-process store and
   display its message beside the action. No renderer writes settings files.

The existing maximum, URL normalization, route validation, atomic write, and
owner-only permissions remain the authority. The enhancement neither exports
shortcuts nor synchronizes them to an account.

## Per-site certificate trust

The campus browser normally retains Chromium's certificate verification. A
certificate error is eligible for an exception only when all of these are true:

- it belongs to a main-frame `https:` navigation owned by the Campus Browser;
- its exact origin (`scheme`, host, and port) is a locally opened campus-browser
  origin; and
- the user chooses `信任此证书` in a native confirmation dialog.

The dialog identifies the exact origin, verification error, certificate subject,
issuer, validity interval, and SHA-256 fingerprint. `取消` retains Chromium's
normal rejection. The app never trusts every certificate, every self-signed
certificate, a hostname suffix, or a certificate based on name alone.

On approval, a new owner-only `campus-certificate-trust.json` stores a bounded
record of the exact HTTPS origin and the SHA-256 hash of the leaf certificate's
DER bytes. The hash is derived locally from Electron's PEM certificate data;
the certificate itself, password, and browser cookies are not stored in this
file. Future certificate errors are accepted only when both exact origin and
fingerprint match. A changed certificate is rejected and shown to the user for
a new explicit decision.

The trust decision is enforced by the main process through the Campus Browser's
managed `WebContents`; a sandboxed page cannot invoke it. Subresources and
popups do not inherit a main-frame decision for another origin.

## Cloud build and release assets

`desktop/package.json` and `.github/workflows/build.yml` will request only
macOS DMG and Windows NSIS EXE targets. The workflow will no longer create,
upload, attach, or checksum ZIP, TXT, or blockmap release assets. A macOS DMG
failure fails the release job rather than substituting a ZIP.

GitHub Actions builds both Apple Silicon and Intel DMGs. It uses Developer ID
signing and notarization only when the repository's signing secrets are
configured; otherwise the cloud runner produces an ad-hoc-signed DMG. Release
notes must state the actual signing mode and must not claim that a personal
Apple Development identity signed a cloud-built artifact.

## Tests and release gates

- Extend the Electron renderer test from layout-only coverage to a real
  `新增 → 保存 → 立即列出` shortcut workflow, including a host-and-port URL.
- Add focused unit tests for automatic hostname labels, shortcut route defaults,
  certificate PEM fingerprint normalization, bounded owner-only trust storage,
  exact-origin matching, changed-certificate rejection, and dialog cancellation.
- Preserve all existing desktop and Rust tests. The excluded data-plane
  heartbeat work has no source change in this release.
- Before tagging the next version, run desktop tests, renderer workflow test,
  audit, Rust fmt/clippy/tests/build, package verification, and a local
  inspection of the cloud-release asset list. The only acceptable final assets
  are two `.dmg` files and one `.exe` file.

## Non-goals

- No global TLS bypass, system trust-store modification, VPN/DNS/routing change,
  account sync, shortcut export, ZIP release, TXT checksum release, or local
  Apple-signing requirement.
