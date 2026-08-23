# EasyConnect sanitized sample manifest

This manifest records identities only. No proprietary artifact is stored in the repository.

## EC-MAC-INSTALLED-7.6.7-20260823

| Field | Value |
| --- | --- |
| Evidence identity | `installed-mutated` |
| Source class | Locally installed macOS application bundle; restricted locator held outside Git |
| Bundle identifier | `com.sangfor.Easyconnect` |
| Display version/build | `7.6.7` / `6` |
| Main architecture | x86_64 |
| Bundle size | approximately 263 MiB |
| Publisher | Sangfor Technologies Company Limited |
| Apple Team ID | `YYE5WQ4M88` |
| Signature timestamp | 2024-03-15 |
| Main executable SHA-256 | `973d2ada4d2c298afd5ba1b3bf183b8e8a71e99cda29d7e6920a7fe1cb5a721a` |
| `app.asar` SHA-256 | `e95b49a7f52be4ca5c5d5202057c6915a144dfd6273927da9aca1afbd204571f` |
| Topology clue | Electron shell, native agents/monitor/service, LaunchAgent/Daemon, native libraries and legacy network components |
| Reproducible baseline | No |

The installed bundle contains runtime-created socket entries, so strict bundle verification no longer proves
the pristine installer contents. No socket content, user setting, log, credential or session was read. Do not
use this sample for official parity or version-baseline evidence; obtain a pristine installer first. The
authorized feature/topology summary is
[`macos-7.6.7-static-observation.md`](macos-7.6.7-static-observation.md).

## EC-LINUX-PUBLIC-7.6.7.3

| Field | Value |
| --- | --- |
| Evidence identity | historical `pristine-package` baseline |
| Public package label | 7.6.7.3 |
| Debian control version | 7.6.7.7 |
| Architecture | x86_64 |
| SHA-256 | `ae623c6dc0354ff87afefbb770de5013bfd943051c9a653b93db708253b2f0d3` |
| Repository material | sanitized binary/adapter JSON only |

See [`../../../independent/cleanroom/EVIDENCE_LOG.md`](../../../independent/cleanroom/EVIDENCE_LOG.md)
and the matching files under `independent/baselines/` for provenance and limits.

## EC-WINDOWS-L3-7.6.7.200

| Field | Value |
| --- | --- |
| Evidence identity | historical sanitized gateway-module baseline |
| Module version | 7.6.7.200 |
| Architecture | PE32 x86 |
| Module SHA-256 | `3a93b43b7f404fb68edcff2aa952a46ee27bcc380af9cc8068bf2ccec38ed379` |
| Repository material | adapter hash/length/patch metadata only |

The original CAB/module remains restricted and is not committed.

## Gateway observation

The last recorded public HKUST(GZ) gateway metadata reported `M7.6.8R2`. Client/package versions and gateway
versions are independent identities; no compatibility claim is inferred from version-number similarity.

## Required next sample

A pristine, signed and hash-fixed current macOS installer is the first required acquisition. Current Windows
and Linux packages should then be fixed so version/platform differentials compare reproducible inputs.
