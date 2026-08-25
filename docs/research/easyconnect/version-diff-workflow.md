# EasyConnect version-diff workflow

Status: authorized clean-room maintenance workflow. It records sanitized evidence; it does not authorize
redistribution of vendor packages or activation of an unverified production capability.

## Inputs

- an approved official-client package kept outside Git;
- the previous sanitized package report under `independent/baselines/`;
- a credential-free Gateway collection config when public metadata comparison is authorized;
- a completed authorization record before any credentialed or dynamic observation.

Never place a password, OTP, Cookie, TwfID, CSRF value, token, raw authentication response or extracted vendor
binary in the repository.

## Package receipt

```bash
cd independent
cargo run --locked --bin ec-binary-watch -- \
  /approved-local-path/EasyConnect-new.deb \
  --output /private-local-output/easyconnect-new-binary.json

cargo run --locked --bin ec-binary-watch -- diff \
  baselines/easyconnect-linux-7.6.7.3-binary.json \
  /private-local-output/easyconnect-new-binary.json \
  --output /private-local-output/easyconnect-binary-diff.json
```

The diff contains only package metadata, hashes, binary sizes and reviewed capability-marker booleans. A binary
appearing/disappearing, architecture change or capability-marker change sets `review_required: true`. This is a
maintenance signal, not proof that HKUST(GZ) or another school enables the capability.

## Gateway receipt

```bash
cd independent
cargo run --locked --bin ec-watch -- collect \
  --config /private-local-input/credential-free-collection.json \
  --output /private-local-output/gateway-new.json \
  --compare baselines/hkustgz-production.json \
  --diff-output /private-local-output/gateway-diff.json
```

`ec-watch` classifies authentication switches, Gateway version, module manifest, installer identity and package
metadata changes. A critical diff blocks automatic baseline replacement and requires source review, sanitized
fixture updates and the applicable school canary before production Provider changes.

## Acceptance sequence

```text
fixed package/Gateway identity
  -> sanitized inspect receipt
  -> deterministic old/new diff
  -> review critical fields and provider boundaries
  -> update synthetic fixtures and tests
  -> authorized school canary when needed
  -> update baseline provenance
  -> only then enable a production capability
```

The diff output may be committed only after confirming it contains sanitized metadata and hashes. Vendor
packages, extracted files and raw captures remain ignored local evidence.

## Self-check evidence

On 2026-08-26, both tools were run against their own existing baselines. The package receipt reported
`changed=false`, `review_required=false`, `critical=0`, `warning=0`; the Gateway receipt reported
`changed=false` with zero changes. This proves deterministic receipt generation, not current vendor parity.
