# 发布流程 / Release Process

本文档记录 HKUST(GZ) Connect 当前的实际发布流程。发布构建完全由
GitHub Actions 云端完成；本地脚本只用于开发自测。

[中文](#中文) · [English](#english)

---

# 中文

## 前置要求

- Rust：由 `independent/rust-toolchain.toml` 固定（当前 1.97.1），rustup 自动安装。
- Node.js 24（CI 使用版本）和 `cd desktop && npm ci`。
- 本机 macOS 打包需要 macOS 和 Xcode 命令行工具（`codesign`）。
- 发布需要仓库的推送和 tag 权限。

## 本地构建与安装

```bash
bash desktop/scripts/build-engine.sh   # 编译 Rust 引擎，放进 desktop/engine/
bash desktop/scripts/rebuild-mac.sh    # macOS：打包、校验并安装到 /Applications
```

`build-engine.sh` 在 `independent/` 下以`--no-default-features`构建`ec-engine`和
`ec-proxy-command`，
把二进制复制为 `desktop/engine/ec-engine-<平台>-<架构>`，并复制
`config/hkustgz.json`。打包时 electron-builder 通过 `extraResources`
把 `desktop/engine/` 放进应用包。

`rebuild-mac.sh` 依次完成：构建引擎 → `electron-builder --mac dir --arm64`
（`CSC_IDENTITY_AUTO_DISCOVERY=false`，ad-hoc 签名）→
`node build/verify-package.js` 校验包内容 → `codesign --verify` →
原子替换 `/Applications/hkustgzconnect.app`（全机只保留一份）。
用户数据和已保存密码不受影响。本机构建是 ad-hoc 签名，首次打开需右键 →
“打开”，Keychain 授权一次即可。

## 测试

```bash
cd desktop
npm test                          # node --test 单元测试
npm run test:renderer-layout      # Electron 界面布局 e2e 测试
npm run audit:ci                  # npm audit；仅网络故障时用 OSV 精确锁文件兜底
node --check main.js preload.js campus-preload.js lib/browser/session/campus-browser.js \
  renderer/campus-browser.js renderer/app.js

cd ../independent
cargo fmt --all -- --check
cargo clippy --locked --all-targets --no-default-features -- -D warnings
cargo test --locked --no-default-features
cargo clippy --locked --all-targets --no-default-features \
  --features engine-lifecycle-fixture -- -D warnings
cargo test --locked --no-default-features \
  --features engine-lifecycle-fixture --test engine_success_lifecycle
```

最后一项串行运行100轮真实`ec-engine`的non-routing post-Transport生命周期soak；它不连接
Gateway、DNS或校园目标，也不能替代真实环境canary。

production命令与`.github/workflows/build.yml`一致；test feature检查与普通
`.github/workflows/ci.yml`一致。

`audit:ci`优先使用npm官方审计结果。只有npm未返回结构化报告（例如审计接口超时）时，
才会把`package-lock.json`中的全部精确npm包版本提交给OSV批量查询；OSV兜底对任何已知
漏洞都失败，而不是只拦截high/critical。两个服务都不可用时同样失败关闭。

## 版本号

- 版本号只出现在 `desktop/package.json` 和 `desktop/package-lock.json` 中，
  两处必须同步修改。
- CI 的 “Verify release version” 步骤强制要求 tag `vX.Y.Z` 与
  `desktop/package.json` 的 `version` 完全一致，不一致则构建失败。

## 分支与标签流程

1. 在功能分支（或 worktree）上开发，合并到 `main`。
2. 提交版本号修改，提交信息沿用约定：
   `release: prepare hkustgzconnect X.Y.Z`。
3. 打附注标签并推送：

   ```bash
   git tag -a vX.Y.Z -m "hkustgzconnect X.Y.Z"
   git push origin main
   git push origin vX.Y.Z
   ```

## CI 构建产物

推送 `v*` 标签触发 `.github/workflows/build.yml`（也可在 Actions 页面用
workflow_dispatch 手动触发）：

- **macOS 作业**：分别编译arm64和x64原生程序。每次只向`desktop/engine/`暂存
  当前架构的Engine/helper，再分别运行`electron-builder --mac dmg --arm64`和
  `electron-builder --mac dmg --x64`（每个架构最多重试3次）；最后用
  `build/verify-package.js`校验两个app包的内容和引擎架构。
- **Windows 作业**：编译引擎后运行 `npm run dist:win`，生成 x64 NSIS
  安装程序，并用 `build/verify-package.js` 校验。
- **Linux 作业**：编译x64原生程序、生成AppImage、校验解包资源并通过Xvfb启动smoke。
- 只发布`desktop/release/*.dmg`、`desktop/release/*.exe`和
  `desktop/release/*.AppImage`。标签构建会通过softprops/action-gh-release
  自动附加到同名GitHub Release。

非默认`engine-lifecycle-fixture` feature只用于测试。发布构建显式使用
`--no-default-features`；若误把feature构建的Engine暂存进应用，包验证器会通过固定
`HKUSTGZ_TEST_ONLY_ENGINE_LIFECYCLE_V1` marker拒绝它。

## 签名与公证

- **macOS**：仓库 secrets 配置了 `MAC_CSC_LINK` / `MAC_CSC_KEY_PASSWORD` /
  `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` 时，CI 使用
  Developer ID 签名并公证；缺少这些 secrets 时显式回退为
  `CSC_IDENTITY_AUTO_DISCOVERY=false` 的 ad-hoc 签名，用户需按 README
  “安装”一节右键 → “打开”。
- **Windows**：配置了 `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` 时签名；
  否则安装程序未签名，可能触发 SmartScreen。
- 本地 `rebuild-mac.sh` 始终是 ad-hoc 签名。

## 发布说明

CI 创建 Release 后，用 `gh release view vX.Y.Z` 查看、
`gh release edit vX.Y.Z` 编辑发布说明。说明中应如实写明本次构建的
签名方式（Developer ID 公证或 ad-hoc）。

---

# English

## Prerequisites

- Rust: pinned by `independent/rust-toolchain.toml` (currently 1.97.1);
  rustup installs it automatically.
- Node.js 24 (the CI version) and `cd desktop && npm ci`.
- Local macOS packaging requires macOS with Xcode command line tools
  (`codesign`).
- Releasing requires push and tag permissions on the repository.

## Local build and install

```bash
bash desktop/scripts/build-engine.sh   # build the Rust engine into desktop/engine/
bash desktop/scripts/rebuild-mac.sh    # macOS: package, verify, install to /Applications
```

`build-engine.sh` builds `ec-engine` and `ec-proxy-command` with
`--no-default-features` in `independent/`, copies the binaries to `desktop/engine/`,
and copies `config/hkustgz.json`. electron-builder bundles `desktop/engine/`
via `extraResources`.

`rebuild-mac.sh` builds the engine, packages with
`electron-builder --mac dir --arm64` (`CSC_IDENTITY_AUTO_DISCOVERY=false`,
ad-hoc signing), verifies the package with `node build/verify-package.js`,
runs `codesign --verify`, and atomically swaps
`/Applications/hkustgzconnect.app` so exactly one copy exists on disk. User
data and saved passwords are untouched. The local build is ad-hoc signed:
open it once via right-click → **Open** and approve the Keychain prompt.

## Tests

```bash
cd desktop
npm test                          # node --test unit tests
npm run test:renderer-layout      # Electron renderer layout e2e test
npm run audit:ci                  # npm audit; exact-lock OSV fallback only on network failure
node --check main.js preload.js campus-preload.js lib/browser/session/campus-browser.js \
  renderer/campus-browser.js renderer/app.js

cd ../independent
cargo fmt --all -- --check
cargo clippy --locked --all-targets --no-default-features -- -D warnings
cargo test --locked --no-default-features
cargo clippy --locked --all-targets --no-default-features \
  --features engine-lifecycle-fixture -- -D warnings
cargo test --locked --no-default-features \
  --features engine-lifecycle-fixture --test engine_success_lifecycle
```

The final command serially runs 100 rounds of the real `ec-engine` with the
non-routing post-Transport lifecycle fixture. It contacts no Gateway, DNS, or
campus target and cannot replace a real-environment canary.

The production commands match `.github/workflows/build.yml`; the test-feature
checks match the ordinary `.github/workflows/ci.yml` gate.

`audit:ci` prefers npm's structured advisory report. Only when npm returns no
report (for example, an audit-endpoint timeout) does it query OSV with every
exact npm package version in `package-lock.json`; that fallback fails on any
known vulnerability, not only high/critical findings. If both services are
unavailable, the gate fails closed.

## Version numbers

- The version lives only in `desktop/package.json` and
  `desktop/package-lock.json`; bump both together.
- CI's "Verify release version" step requires the tag `vX.Y.Z` to equal
  `desktop/package.json`'s `version`; a mismatch fails the build.

## Branch and tag flow

1. Develop on a feature branch (or worktree), merge into `main`.
2. Commit the version bump using the convention
   `release: prepare hkustgzconnect X.Y.Z`.
3. Create an annotated tag and push:

   ```bash
   git tag -a vX.Y.Z -m "hkustgzconnect X.Y.Z"
   git push origin main
   git push origin vX.Y.Z
   ```

## CI artifacts

Pushing a `v*` tag triggers `.github/workflows/build.yml` (it can also be
started manually via workflow_dispatch):

- **macOS job**: builds both native architectures, stages only the matching
  Engine/helper for each package, and runs `electron-builder --mac dmg --arm64`
  and `electron-builder --mac dmg --x64` separately (up to three attempts per
  architecture). It then verifies both app bundles and engine architectures
  with `build/verify-package.js`.
- **Windows job**: builds the engine, runs `npm run dist:win` to produce the
  x64 NSIS installer, and verifies it with `build/verify-package.js`.
- **Linux job**: builds x64 native binaries, produces an AppImage, verifies its
  unpacked resources, and runs an Xvfb launch smoke.
- Only `desktop/release/*.dmg`, `desktop/release/*.exe`, and
  `desktop/release/*.AppImage` are published.
  Tag builds attach them to the matching GitHub Release via
  softprops/action-gh-release.

The non-default `engine-lifecycle-fixture` feature is test-only. Release builds
explicitly disable default/features, and the package verifier rejects its fixed
`HKUSTGZ_TEST_ONLY_ENGINE_LIFECYCLE_V1` marker if a feature-enabled Engine is
ever staged accidentally.

## Signing and notarization

- **macOS**: when the repository secrets `MAC_CSC_LINK` /
  `MAC_CSC_KEY_PASSWORD` / `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` /
  `APPLE_TEAM_ID` are present, CI signs with a Developer ID and notarizes;
  otherwise it explicitly falls back to `CSC_IDENTITY_AUTO_DISCOVERY=false`
  ad-hoc signing, and users install via right-click → **Open** as described
  in the README "Installation" section.
- **Windows**: signed when `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` are set;
  otherwise the installer is unsigned and SmartScreen may appear.
- Local `rebuild-mac.sh` builds are always ad-hoc signed.

## Release notes

After CI creates the Release, inspect it with `gh release view vX.Y.Z` and
edit the notes with `gh release edit vX.Y.Z`. The notes should state the
actual signing mode of the build (Developer ID notarized or ad-hoc).
