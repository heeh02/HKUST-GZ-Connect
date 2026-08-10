#!/usr/bin/env bash
# Build and stage the independent Rust engine for local desktop development.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd -P)"
ROOT="$(cd "$HERE/.." && pwd -P)"
case "$(uname -s)" in
  Darwin) PLATFORM=darwin ;;
  Linux) PLATFORM=linux ;;
  *) echo "unsupported local build platform" >&2; exit 1 ;;
esac
case "$(uname -m)" in
  arm64|aarch64) ARCH=arm64 ;;
  x86_64|amd64) ARCH=amd64 ;;
  *) echo "unsupported local build architecture" >&2; exit 1 ;;
esac

run_cargo() {
  if command -v cargo >/dev/null 2>&1; then
    cargo "$@"
  elif command -v rustup >/dev/null 2>&1; then
    TOOLCHAIN_BIN="$(dirname "$(rustup which rustc --toolchain 1.97.1)")"
    PATH="$TOOLCHAIN_BIN:$PATH" rustup run 1.97.1 cargo "$@"
  else
    echo "cargo/rustup is required" >&2
    exit 1
  fi
}

cd "$ROOT/independent"
run_cargo build --locked --release --bin ec-engine --bin ec-proxy-command
mkdir -p "$HERE/engine"
cp target/release/ec-engine "$HERE/engine/ec-engine-$PLATFORM-$ARCH"
cp target/release/ec-proxy-command "$HERE/engine/ec-proxy-command-$PLATFORM-$ARCH"
cp config/hkustgz.json "$HERE/engine/hkustgz.json"
chmod 755 "$HERE/engine/ec-engine-$PLATFORM-$ARCH"
chmod 755 "$HERE/engine/ec-proxy-command-$PLATFORM-$ARCH"
echo "staged independent binaries: engine/ec-engine-$PLATFORM-$ARCH, engine/ec-proxy-command-$PLATFORM-$ARCH"
