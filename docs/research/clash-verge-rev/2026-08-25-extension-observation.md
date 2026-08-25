# Clash Verge Rev managed-extension observation — 2026-08-25

## Evidence boundary

- Documentation repository commit: `ebfb1b181b83753a3252d90eac478f45e456fa1b`.
- Application source commit: `272c09568cc0ab206f926a012cba581cf915db9f` on `dev`.
- This is a static compatibility observation, not permission to discover or edit arbitrary local files and not
  proof that every installed Clash Verge Rev version has the same layout.

## Verified behavior used by P7

1. Official extension documentation separates YAML extension configuration from JavaScript extension scripts.
2. YAML values are merged/overwritten by field; arrays such as `proxies` and `rules` are not a safe append-only
   ownership boundary. Campus Connect therefore does not install a YAML extension that could replace subscription
   arrays.
3. Current source models profile items with `type`, `uid`, `file` and an `option.script` reference. Script items
   use an `s<uid>.js` file; the protected global item is `Script.js`.
4. Current source resolves the application data root by platform and keeps `profiles.yaml` plus a `profiles/`
   directory beneath it. Portable mode uses a different root, so Campus Connect must not guess a path from the
   operating system alone.
5. The current global `Script.js` entry point is `main(config, profileName)` and returns the effective config.
   Campus Connect can safely wrap a pre-existing function only inside one exact marked block, while retaining
   the previous return value and unrelated arrays.
6. Clash Verge Rev itself validates and reapplies scripts when saved through its UI/API. Campus Connect has no
   reviewed stable external API for that operation, so P7 requires the user to select the exact registered
   `Script.js`, performs its own syntax/readback validation, and never claims the client activated the change.

## Source pointers

- Extension docs: <https://www.clashverge.dev/guide/extend.html>
- Profile schema and protected files:
  <https://github.com/clash-verge-rev/clash-verge-rev/blob/272c09568cc0ab206f926a012cba581cf915db9f/src-tauri/src/config/profiles.rs>
- Profile item/script schema:
  <https://github.com/clash-verge-rev/clash-verge-rev/blob/272c09568cc0ab206f926a012cba581cf915db9f/src-tauri/src/config/prfitem.rs>
- Platform/portable data directories:
  <https://github.com/clash-verge-rev/clash-verge-rev/blob/272c09568cc0ab206f926a012cba581cf915db9f/src-tauri/src/utils/dirs.rs>
- Script execution boundary:
  <https://github.com/clash-verge-rev/clash-verge-rev/blob/272c09568cc0ab206f926a012cba581cf915db9f/src-tauri/src/enhance/script.rs>
