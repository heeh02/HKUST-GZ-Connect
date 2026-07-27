#!/usr/bin/env bash
# One-command macOS install — downloads the latest hkustgzconnect (zip), verifies it
# against the release checksum, strips the Gatekeeper quarantine flag, and installs
# to /Applications so it launches without the "damaged"/"cannot verify" prompt.
# (We aren't Apple-notarized.)
#
#   curl -fsSL https://raw.githubusercontent.com/heeh02/hkustgzconnect/main/desktop/scripts/install-mac.sh | bash
#
# The quarantine flag is what normally stops an unsigned download from running, so
# this script MUST NOT remove it from a file it has not verified. SHA256SUMS-macos.txt
# is published with every release; a missing or mismatched checksum aborts the
# install rather than falling back to trusting the download.
set -euo pipefail
REPO="heeh02/hkustgzconnect"
case "$(uname -m)" in arm64) A=arm64 ;; *) A=x64 ;; esac

echo "→ finding latest mac-$A build…"
RELEASE=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest")
URL=$(printf '%s' "$RELEASE" | grep -oE "https://[^\"]*mac-$A\.zip" | head -1)
SUMS_URL=$(printf '%s' "$RELEASE" | grep -oE "https://[^\"]*SHA256SUMS-macos\.txt" | head -1)
[ -n "$URL" ] || { echo "✗ no mac-$A.zip in latest release"; exit 1; }
[ -n "$SUMS_URL" ] || { echo "✗ release has no SHA256SUMS-macos.txt — refusing to install unverified"; exit 1; }

# keep partial downloads in a stable cache so flaky networks can resume (-C -)
CACHE="$HOME/.cache/hkustgzconnect"; mkdir -p "$CACHE"
ZIP="$CACHE/$(basename "$URL")"
echo "↓ $URL"
curl -fL# --retry 8 --retry-delay 2 --retry-all-errors -C - -o "$ZIP" "$URL"

echo "→ verifying checksum…"
EXPECTED=$(curl -fsSL "$SUMS_URL" \
  | awk -v want="$(basename "$ZIP")" '{name=$2; sub(/^\*/,"",name); if (name==want) {print tolower($1); exit}}')
ACTUAL=$(shasum -a 256 "$ZIP" | awk '{print tolower($1)}')
if [ -z "$EXPECTED" ]; then
  echo "✗ $(basename "$ZIP") is not listed in SHA256SUMS-macos.txt — refusing to install"
  exit 1
fi
if [ "$EXPECTED" != "$ACTUAL" ]; then
  # A resumed download of a different build lands in the same cache path, so the
  # stale file has to go or every retry repeats this failure.
  rm -f "$ZIP"
  echo "✗ checksum mismatch — discarded the download, please re-run"
  echo "  expected $EXPECTED"
  echo "  actual   $ACTUAL"
  exit 1
fi
echo "✓ sha256 $ACTUAL"

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
ditto -x -k "$ZIP" "$TMP/x"
APP=$(find "$TMP/x" -maxdepth 2 -name '*.app' | head -1)
[ -n "$APP" ] || { echo "✗ no .app inside zip"; exit 1; }

# Stage the new bundle beside the target and swap, so a failed copy cannot leave
# the machine with no application at all.
STAGE="/Applications/.hkustgzconnect.install.$$"
rm -rf "$STAGE"
cp -R "$APP" "$STAGE"
xattr -dr com.apple.quarantine "$STAGE" 2>/dev/null || true
rm -rf "/Applications/hkustgzconnect.app"
mv "$STAGE" "/Applications/hkustgzconnect.app"
echo "✓ 已安装到 /Applications/hkustgzconnect.app — 直接从启动台/应用程序打开即可。"
