#!/usr/bin/env bash
# Generate the macOS icon from the checked-in transparent rounded artwork.
# Do not use Quick Look to render the raw crest SVG: it adds an opaque white
# canvas and makes older macOS versions display a square Dock icon.
set -euo pipefail
cd "$(dirname "$0")/.."
[[ "$(uname -s)" == "Darwin" ]] || { echo "macOS is required"; exit 1; }
command -v sips >/dev/null || { echo "missing sips"; exit 1; }
command -v iconutil >/dev/null || { echo "missing iconutil"; exit 1; }

work_root="$(mktemp -d "${TMPDIR:-/tmp}/campus-connect-icon.XXXXXX")"
iconset="$work_root/icon.iconset"
source_png="assets/hkust-gz-favicon.png"
trap 'find "$work_root" -depth -delete' EXIT
mkdir -p "$iconset"

for size in 16 32 64 128 256 512 1024; do
  sips -z "$size" "$size" "$source_png" --out "$iconset/icon_${size}x${size}.png" >/dev/null
done
cp "$iconset/icon_256x256.png" build/icon.png
for size in 16 32 128 256 512; do
  cp "$iconset/icon_$((size*2))x$((size*2)).png" "$iconset/icon_${size}x${size}@2x.png"
done
iconutil -c icns "$iconset" -o build/icon.icns
echo "✓ build/icon.icns"
# .ico (needs imagemagick); skip gracefully
if command -v magick >/dev/null || command -v convert >/dev/null; then
  bin=$(command -v magick || command -v convert)
  "$bin" build/icon.iconset/icon_16x16.png build/icon.iconset/icon_32x32.png \
         build/icon.iconset/icon_64x64.png build/icon.iconset/icon_128x128.png \
         build/icon.iconset/icon_256x256.png build/icon.ico && echo "✓ build/icon.ico"
else
  echo "• Windows icon unchanged (ImageMagick unavailable)"
fi
echo "done"
