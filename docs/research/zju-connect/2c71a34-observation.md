# zju-connect source observation — 2c71a34

- Repository: <https://github.com/Mythologyli/zju-connect>
- Fixed commit: `2c71a34c17ea7ecf04c5fe862c4c315344128653`
- License: AGPL-3.0
- Observation type: public-source architecture review
- HKUST(GZ) real-environment evidence: none
- Dependency decision: no source/build/link/runtime dependency

This record distinguishes source presence, default CLI behavior and HKUST evidence. It does not treat an
upstream implementation as proof that the same capability exists on the school profile.

## Capability classification

| Area | Source observation | Default/activation observation | HKUST decision |
| --- | --- | --- | --- |
| EasyConnect auth | password, CAPTCHA, SMS, TOTP and certificate paths | password default; other paths profile/flag dependent | candidate states only; no real provider without school evidence |
| aTrust auth | password, CAS/OAuth2, SMS and bounded continuation families | protocol must be selected; not HKUST default | research-only |
| L3 transport | EasyConnect and aTrust implementations | EasyConnect default | current Rust Modern L3 remains independent oracle |
| Per-app TCP tunnel | aTrust resource-driven path | optional | not WebVPN; no HKUST evidence |
| WebVPN | no Sangfor WebVPN backend observed | N/A | cannot use upstream as a WebVPN design oracle |
| DNS | remote DNS, cache/single-flight, UDP/TCP, secondary and FakeIP | remote DNS enabled; public secondary may be automatic | borrow transport separation only; retain campus fail-closed policy |
| SOCKS/HTTP | local frontends | wildcard and unauthenticated by default | reject; retain loopback + strict auth |
| Underlay | explicit and opt-in auto interface binding | auto detect disabled | borrow ownership/generation ideas after a no-op seam |
| Multi-line | EasyConnect parsing and latency selection | enabled unless disabled | require HKUST discovery/token-portability evidence |
| TUN/FakeIP | experimental TUN, route and DNS-hijack paths | disabled unless requested | keep deferred/optional; never 2.0 default |
| Port forwarding | TCP/UDP forwarding | explicit configuration | only after a real user need and separate threat model |

## Design ideas worth independently implementing

1. A centralized dial/underlay owner for gateway sockets.
2. DNS wire/cache/single-flight and transport separation.
3. Opaque, bounded continuation-style authentication state.
4. Endpoint set, stickiness, failure history and hysteresis concepts.
5. Typed separation between L3, per-application tunnel and local ingress.

## Behaviors explicitly rejected

- `InsecureSkipVerify` or continue-after-anti-MITM-failure behavior;
- public/secondary fallback for split-horizon campus names;
- wildcard unauthenticated local proxy listeners;
- ZJU-specific routes/domains;
- secrets in argv, TOML, stdout, logs or ordinary persisted client data;
- TUN/FakeIP/DNS hijack and system route mutation as defaults;
- PCAP/TLS-key-log product paths;
- direct source translation or copying upstream fixtures.

## Test and CI evidence limits

Static inventory at this commit contains 33 Go test files, 224 `Test*` functions and six benchmarks. The
current audit environment did not have Go installed, so none were executed. Upstream CI builds multiple
architectures but does not gate `go test`, vet, lint or vulnerability scanning; a green upstream build is not
protocol/security regression proof.

## Delta from the previous fixed review

Compared with `4c4b41fee599646efc1463ecf080590724b24f28`, current `main` is one commit ahead. The delta is
documentation/argument alignment in README/config/entrypoint files; no protocol architecture change was
observed in that delta. Future observations must still re-fix the exact upstream commit.
