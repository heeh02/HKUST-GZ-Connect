# EasyConnect interoperability research boundary

This directory contains neutral, sanitized research records only. It does not contain, and must never
contain, official installers, application bundles, ASAR contents, native modules, captures, decompiler output
or authentication material.

## Evidence identities

Every input is classified as one of:

- `pristine-package`: fixed installer from an approved channel, signature and hash verified;
- `installed-mutated`: an installed/used application; useful only for clues, never a reproducible baseline;
- `gateway-observation`: one authorized fixed profile/run;
- `sanitized-baseline`: hash/length/count/state summary derived under the clean-room process;
- `public-source-reference`: third-party public source used only for engineering ideas.

## Workflow

```text
authorization
  → acquisition and signature/hash manifest
  → restricted read-only extraction
  → static/dynamic observation
  → restricted raw evidence
  → neutral fact review
  → synthetic/redacted fixture
  → exact secret/binary scan
  → implementation handoff
  → parity/canary/destruction receipt
```

The analysis team may inspect approved official artifacts. The implementation team receives only reviewed
neutral specifications and synthetic fixtures. The validation team compares official and independent clients
on the same authorized profile.

Complete ASAR/file inventories, module graphs and symbol/reference listings remain restricted raw evidence.
Git may retain only bounded counts, neutral categories and reviewed schema classes derived from them.

## Allowed Git content

- public package URL or approved opaque internal evidence record ID; never an internal path or URL;
- acquisition date, size, SHA-256, publisher/signature and architecture;
- bounded file/dependency/capability counts;
- schema field names after sensitivity review;
- neutral state diagrams, ordering and bounds;
- synthetic fixtures containing no vendor bytes or production values;
- evidence classification, redaction proof and destruction receipt.

## Prohibited Git content

- DMG/PKG/APP/ASAR/DEB/RPM/EXE/MSI/CAB/DLL/dylib or extracted files;
- raw PCAP/HAR/log/process trace or crash dump;
- decompiled/disassembled source and vendor fixed byte sequences;
- password, OTP, Cookie, token, CSRF, TwfID, sslctx, RSA/private-key/certificate secrets;
- assigned/private/internal addresses and hostnames;
- account, phone, email, user or device identifiers;
- raw authentication/configuration/resource responses.

`.gitignore` is not a security boundary. Every candidate commit must also pass exact index/tree secret scans,
binary/magic/size checks and an explicit provenance review.

## Dynamic-analysis gate

No broader dynamic work begins until
[`../../../independent/cleanroom/AUTHORIZATION_TEMPLATE.md`](../../../independent/cleanroom/AUTHORIZATION_TEMPLATE.md)
is completed and approved. Testing stops on real-user data, production instability, rate limits,
attestation/private keys or activity outside the authorized matrix.

## Current limitation

The installed macOS application is an `installed-mutated` sample because runtime-created socket entries are
present inside the bundle. It is useful for topology clues but must not be treated as a pristine official
file baseline. Its authorized static topology observation is recorded in
[`macos-7.6.7-static-observation.md`](macos-7.6.7-static-observation.md). Acquire a signed, hash-fixed
installer before version-differential or official-parity work.
