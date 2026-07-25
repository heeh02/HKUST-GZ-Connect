# Upgrade and continuity playbook

No independent implementation of a proprietary protocol can honestly
guarantee compatibility with every future release. This project instead
targets a measurable continuity objective: detect changes before rollout,
fail closed, isolate the affected contract, validate a replacement against the
official client, and retain an official recovery path.

## Risk controls

| Event | Automatic signal | Release decision | Recovery action |
|---|---|---|---|
| `zju-connect` repository or releases disappear | none required at runtime | independent code unaffected | restore only historical GPL evidence from institutional archive; never fetch it during build/run |
| Public EasyConnect package/module changes | daily metadata, module, installer, and hash diff | block compatibility release | archive signed official artifact, classify changed capability, update isolated adapter and fixtures |
| Authentication XML/state changes | parser/fixture failure or approved canary failure | block login release | add explicit auth state; never guess or fall through |
| Modern token/control layout changes | 48/64-byte contract or status mismatch | block tunnel release | compare official module and authorized black-box trace; version the codec |
| Special TLS fingerprint changes | version/cipher/compression mismatch | block tunnel release | add a separately reviewed transport backend; do not widen the existing backend |
| Gateway certificate rotates | HTTPS/leaf binding or configured pin mismatch | block connection | verify through gateway administration, then approve the new pin/baseline |
| TLS 1.1/RC4 is removed by the gateway | modern empty-channel canary fails at handshake | desired security upgrade; block old backend | implement the newly advertised secure suite as a new backend and retire the obsolete one |
| Entire protocol family is replaced | capability markers and canary both fail | mark profile unsupported | keep official EasyConnect/aTrust available while the new family is analyzed and validated |
| Cargo registry, toolchain, or GitHub is unavailable | reproducible-build restore test | block release if restore fails | build from institution-controlled `cargo vendor` and pinned toolchain archive |

## Compatibility rings

1. **Daily public ring** — no credentials; compares gateway/package/module
   metadata and official artifact hashes.
2. **Offline implementation ring** — pinned Rust toolchain, locked crates,
   fixtures, crypto vectors, parser/state tests, and lint.
3. **Restricted empty-channel ring** — institution-owned runner and approved
   test account; authenticates, obtains an address, opens empty send/receive
   channels, sends no IP packet, logs out, and retains sanitized evidence.
4. **Staff packet canary** — only after security approval; exercises DNS,
   TCP/SOCKS, reconnect, timeout, and sustained traffic against dedicated test
   services.
5. **Production promotion** — signed build, small staff cohort, monitored
   failure rates, and documented rollback.

GitHub-hosted CI should run rings 1–2 only. Credentials belong on a
school-controlled restricted runner, not in a public-repository workflow or
third-party secret store.

## Review service levels

- Public metadata drift: triage within one working day.
- Certificate-only rotation: validate through the management plane before the
  next client rollout.
- Compatible official patch: complete empty-channel parity before promotion.
- Protocol or cryptographic family change: declare the profile temporarily
  unsupported; do not bypass verification to meet a deadline.

Availability during an unsupported interval comes from the signed official
client and an out-of-band administration path, not from silently accepting an
unknown protocol.

## Independence checklist

- No `zju-connect` binary, module, source download, Git dependency, or runtime
  invocation in the independent crate.
- GPL reference provenance and obligations remain documented even though the
  implementation is native Rust.
- Official vendor artifacts stay ignored and restricted; committed baselines
  contain hashes and structural facts only.
- Credentials, TWFID, token, assigned address, cookies, packet contents, and
  traffic captures never enter Git or compatibility artifacts.
- At least two maintainers can restore the toolchain/vendor archive, execute
  all compatibility rings, rotate a certificate pin, and roll back.
