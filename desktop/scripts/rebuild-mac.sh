#!/usr/bin/env bash
# Rebuild the engine and the macOS app, then replace the installed copy.
#
# Leaves exactly one hkustgzconnect.app on the machine: the packaged output is
# moved into /Applications and the build directory is removed, so repeated
# rebuilds never accumulate copies.
#
#   bash desktop/scripts/rebuild-mac.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd -P)"
INSTALLED="/Applications/hkustgzconnect.app"
BUILT="$HERE/release/mac-arm64/hkustgzconnect.app"

case "$(uname -s)" in Darwin) ;; *) echo "✗ macOS only" >&2; exit 1 ;; esac

echo "→ building and staging the engine…"
bash "$HERE/scripts/build-engine.sh"

echo "→ packaging the app…"
cd "$HERE"
# `dir` produces only the .app: no dmg or zip copies to clean up afterwards.
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac dir --arm64

echo "→ verifying the package…"
node "$HERE/build/verify-package.js" "$BUILT/Contents/Resources" darwin arm64
codesign --verify --deep --strict "$BUILT"

echo "→ quitting the running app…"
osascript -e 'tell application "hkustgzconnect" to quit' 2>/dev/null || true
for _ in $(seq 1 20); do
  pgrep -f "hkustgzconnect.app/Contents/MacOS" >/dev/null 2>&1 || break
  sleep 1
done
if pgrep -f "hkustgzconnect.app/Contents/MacOS" >/dev/null 2>&1; then
  echo "✗ the app is still running — quit it and re-run" >&2
  exit 1
fi

echo "→ installing…"
# Stage beside the target and swap, so a failed copy cannot leave the machine
# without an application at all.
STAGE="/Applications/.hkustgzconnect.new.$$"
OLD="/Applications/.hkustgzconnect.old.$$"
rm -rf "$STAGE"
ditto "$BUILT" "$STAGE"
[ -d "$INSTALLED" ] && mv "$INSTALLED" "$OLD"
mv "$STAGE" "$INSTALLED"
rm -rf "$OLD"

echo "→ removing the build output…"
rm -rf "$HERE/release"

copies="$(find /Applications "$HOME/Applications" "$HOME/Desktop" "$HOME/Downloads" \
  -maxdepth 4 -name 'hkustgzconnect.app' -type d 2>/dev/null | wc -l | tr -d ' ')"
if [ "$copies" != "1" ]; then
  echo "⚠ expected exactly one hkustgzconnect.app, found $copies:" >&2
  find /Applications "$HOME/Applications" "$HOME/Desktop" "$HOME/Downloads" \
    -maxdepth 4 -name 'hkustgzconnect.app' -type d 2>/dev/null >&2
fi

echo "✓ installed $INSTALLED (1 copy on disk)"
echo "  User data and saved passwords were untouched:"
echo "    ~/Library/Application Support/hkustgzconnect"
echo "  The build is ad-hoc signed, so macOS asks for keychain access once —"
echo "  click 「始终允许」and the VPN password is reused without re-entry."
