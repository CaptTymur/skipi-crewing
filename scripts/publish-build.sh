#!/usr/bin/env bash
# Publish the most recent Skipi Crewing build to the local skipi-server's
# updater directory. Run AFTER `cargo tauri build`.
#
# Usage:  bash scripts/publish-build.sh
#
# Picks up version from src-tauri/tauri.conf.json, copies .deb / .AppImage
# (and their .sig files) into skipi-server/releases/crewing/, regenerates
# latest.json so that running Skipi Crewing instances see the new version
# on next startup.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RELEASES="$ROOT/../skipi-server/releases/crewing"
mkdir -p "$RELEASES"

VERSION=$(grep -E '"version"' "$ROOT/src-tauri/tauri.conf.json" | head -1 | sed -E 's/.*"version"\s*:\s*"([^"]+)".*/\1/')
if [ -z "$VERSION" ]; then
  echo "could not detect version from tauri.conf.json" >&2
  exit 1
fi

BUNDLE="$ROOT/src-tauri/target/release/bundle"
DEB="$BUNDLE/deb/Skipi Crewing_${VERSION}_amd64.deb"
APPIMAGE="$BUNDLE/appimage/Skipi Crewing_${VERSION}_amd64.AppImage"
APPIMAGE_SIG="${APPIMAGE}.sig"

if [ ! -f "$APPIMAGE" ] || [ ! -f "$APPIMAGE_SIG" ]; then
  echo "missing AppImage or .sig for $VERSION" >&2
  echo "expected: $APPIMAGE" >&2
  echo "build first with: TAURI_SIGNING_PRIVATE_KEY_PATH=~/.tauri/skipi-crewing.key TAURI_SIGNING_PRIVATE_KEY_PASSWORD= cargo tauri build" >&2
  exit 1
fi

# Strip spaces from output filenames (URL-friendly).
DEB_OUT="Skipi-Crewing_${VERSION}_amd64.deb"
APPIMAGE_OUT="Skipi-Crewing_${VERSION}_amd64.AppImage"
SIG_OUT="${APPIMAGE_OUT}.sig"

cp "$APPIMAGE" "$RELEASES/$APPIMAGE_OUT"
cp "$APPIMAGE_SIG" "$RELEASES/$SIG_OUT"
[ -f "$DEB" ] && cp "$DEB" "$RELEASES/$DEB_OUT" || true

PUB_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
SIGNATURE=$(cat "$RELEASES/$SIG_OUT")
BASE_URL="${SKIPI_UPDATE_BASE:-http://127.0.0.1:8000/crewing/releases}"

cat > "$RELEASES/latest.json" <<JSON
{
  "version": "$VERSION",
  "pub_date": "$PUB_DATE",
  "notes": "Skipi Crewing $VERSION",
  "platforms": {
    "linux-x86_64": {
      "signature": "$SIGNATURE",
      "url": "$BASE_URL/$APPIMAGE_OUT"
    }
  }
}
JSON

echo "published $VERSION → $RELEASES"
echo "  deb       : $BASE_URL/$DEB_OUT"
echo "  appimage  : $BASE_URL/$APPIMAGE_OUT"
echo "  manifest  : $BASE_URL/latest.json (served as /crewing/latest.json)"
