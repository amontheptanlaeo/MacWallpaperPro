#!/bin/bash
# Make a release build for distribution: build -> sign with Developer ID -> notarize -> staple -> zip
#
#   ./release.sh 1.0.0                 # build number = commit count (or a timestamp)
#   ./release.sh 1.0.0 12              # set the build number yourself
#   ./release.sh 1.0.0 --no-notarize   # sign only, don't send to Apple (local testing)
#
# Output: dist/MacWallpaperPro.zip (+ .sha256). Upload it to a GitHub Release under exactly that
# asset name: the website's /download and the README link to
# https://github.com/<owner>/<repo>/releases/latest/download/MacWallpaperPro.zip
#
# Signing settings come from the environment, so forks can use their own Apple account.
# The defaults are the upstream maintainer's (identifiers, not secrets):
#   TEAM_ID        Apple Developer Team ID
#   SIGN_IDENTITY  codesign identity (default: "Developer ID Application: Amonthep tanlaeo ($TEAM_ID)")
#   ASC_KEY_ID     App Store Connect API key id (for notarytool)
#   ASC_ISSUER     App Store Connect issuer id
#   ASC_KEY_PATH   path to the AuthKey_<id>.p8 file (default: ~/.appstoreconnect/private_keys/)
set -euo pipefail
cd "$(dirname "$0")"

TEAM_ID="${TEAM_ID:-VTY2MA9M32}"
SIGN_IDENTITY="${SIGN_IDENTITY:-Developer ID Application: Amonthep tanlaeo ($TEAM_ID)}"
# App Store Connect API key (the .p8 file stays on this machine only; never commit it)
ASC_KEY_ID="${ASC_KEY_ID:-H5KU2R5Z6A}"
ASC_ISSUER="${ASC_ISSUER:-0333d04c-285e-4c69-9b17-3bff0fb4dde3}"
ASC_KEY_PATH="${ASC_KEY_PATH:-$HOME/.appstoreconnect/private_keys/AuthKey_$ASC_KEY_ID.p8}"

VERSION="${1:-}"
[ -n "$VERSION" ] || { echo "Usage: ./release.sh <version> [build-number] [--no-notarize]"; exit 1; }
shift
BUILD_NUMBER="$(git rev-list --count HEAD 2>/dev/null || date +%Y%m%d%H%M)"
NOTARIZE=1
for arg in "$@"; do
  case "$arg" in
    --no-notarize) NOTARIZE=0 ;;
    *) BUILD_NUMBER="$arg" ;;
  esac
done

APP="build/MacWallpaperPro.app"
DIST="dist"
# Fixed asset name: releases/latest/download/MacWallpaperPro.zip must keep working.
ZIP="$DIST/MacWallpaperPro.zip"

step() { printf '\n\033[1;35m▸ %s\033[0m\n' "$1"; }

step "Checking tools"
security find-identity -v -p codesigning | grep -q "$SIGN_IDENTITY" \
  || { echo "❌ Signing certificate not found: $SIGN_IDENTITY (set SIGN_IDENTITY / TEAM_ID)"; exit 1; }
if [ "$NOTARIZE" = 1 ]; then
  [ -f "$ASC_KEY_PATH" ] || { echo "❌ API key not found: $ASC_KEY_PATH (set ASC_KEY_ID / ASC_ISSUER / ASC_KEY_PATH)"; exit 1; }
fi
echo "Version $VERSION (build $BUILD_NUMBER)"

step "Building and signing with Developer ID"
SIGN_IDENTITY="$SIGN_IDENTITY" VERSION="$VERSION" BUILD_NUMBER="$BUILD_NUMBER" ./build.sh
codesign --verify --deep --strict --verbose=2 "$APP"

mkdir -p "$DIST"
rm -f "$ZIP"

if [ "$NOTARIZE" = 1 ]; then
  step "Sending to Apple for notarization (about 1-10 minutes)"
  SUBMIT_ZIP="$DIST/.notarize-upload.zip"
  ditto -c -k --keepParent "$APP" "$SUBMIT_ZIP"
  OUT=$(xcrun notarytool submit "$SUBMIT_ZIP" \
    --key "$ASC_KEY_PATH" --key-id "$ASC_KEY_ID" --issuer "$ASC_ISSUER" \
    --wait --output-format json)
  rm -f "$SUBMIT_ZIP"
  STATUS=$(echo "$OUT" | /usr/bin/python3 -c 'import sys,json;print(json.load(sys.stdin).get("status",""))')
  SUB_ID=$(echo "$OUT" | /usr/bin/python3 -c 'import sys,json;print(json.load(sys.stdin).get("id",""))')
  if [ "$STATUS" != "Accepted" ]; then
    echo "❌ Notarization failed (status: $STATUS). Details:"
    xcrun notarytool log "$SUB_ID" --key "$ASC_KEY_PATH" --key-id "$ASC_KEY_ID" --issuer "$ASC_ISSUER"
    exit 1
  fi
  echo "✅ Accepted by Apple (submission $SUB_ID)"

  step "Stapling the notarization ticket"
  xcrun stapler staple "$APP"
  xcrun stapler validate "$APP"
fi

step "Creating the distribution zip"
ditto -c -k --keepParent "$APP" "$ZIP"
shasum -a 256 "$ZIP" | tee "$ZIP.sha256"

step "Checking it the way a user's Mac will (Gatekeeper)"
if [ "$NOTARIZE" = 1 ]; then
  spctl -a -vv -t exec "$APP"
else
  echo "Skipping the Gatekeeper check (not notarized): other Macs will still show a warning"
fi

echo
echo "🎉 Done: $ZIP"
echo "   Publish it on GitHub Releases (the asset name must stay MacWallpaperPro.zip):"
echo "   gh release create v$VERSION $ZIP $ZIP.sha256 --title \"v$VERSION\" --generate-notes"
echo "   Optional fallback for /download: npx wrangler r2 object put macwallpaperpro-files/releases/MacWallpaperPro.zip --file $ZIP --remote"
