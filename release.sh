#!/bin/bash
# ออกเวอร์ชันสำหรับแจก: build → เซ็นด้วย Developer ID → notarize → staple → zip
#
#   ./release.sh 1.0.0            # build number = จำนวน commit หรือ timestamp
#   ./release.sh 1.0.0 12         # กำหนด build number เอง
#   ./release.sh 1.0.0 --no-notarize   # เซ็นอย่างเดียว ไม่ส่ง Apple (ทดสอบในเครื่อง)
#
# ผลลัพธ์: dist/MacWallpaperPro-<version>.zip (อัปขึ้นเว็บเป็น releases/MacWallpaperPro.zip ได้เลย)
set -euo pipefail
cd "$(dirname "$0")"

TEAM_ID="VTY2MA9M32"
SIGN_IDENTITY="Developer ID Application: Amonthep tanlaeo ($TEAM_ID)"
# App Store Connect API key (ไฟล์ .p8 อยู่ในเครื่องเท่านั้น ห้าม commit)
ASC_KEY_ID="H5KU2R5Z6A"
ASC_ISSUER="0333d04c-285e-4c69-9b17-3bff0fb4dde3"
ASC_KEY_PATH="$HOME/.appstoreconnect/private_keys/AuthKey_$ASC_KEY_ID.p8"

VERSION="${1:-}"
[ -n "$VERSION" ] || { echo "ใช้: ./release.sh <version> [build-number] [--no-notarize]"; exit 1; }
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
ZIP="$DIST/MacWallpaperPro-$VERSION.zip"

step() { printf '\n\033[1;35m▸ %s\033[0m\n' "$1"; }

step "ตรวจเครื่องมือ"
security find-identity -v -p codesigning | grep -q "$SIGN_IDENTITY" \
  || { echo "❌ ไม่พบใบรับรอง: $SIGN_IDENTITY"; exit 1; }
if [ "$NOTARIZE" = 1 ]; then
  [ -f "$ASC_KEY_PATH" ] || { echo "❌ ไม่พบ API key: $ASC_KEY_PATH"; exit 1; }
fi
echo "เวอร์ชัน $VERSION (build $BUILD_NUMBER)"

step "Build และเซ็นด้วย Developer ID"
SIGN_IDENTITY="$SIGN_IDENTITY" VERSION="$VERSION" BUILD_NUMBER="$BUILD_NUMBER" ./build.sh
codesign --verify --deep --strict --verbose=2 "$APP"

mkdir -p "$DIST"
rm -f "$ZIP"

if [ "$NOTARIZE" = 1 ]; then
  step "ส่งให้ Apple ตรวจ (notarize) — รอประมาณ 1–10 นาที"
  SUBMIT_ZIP="$DIST/.notarize-upload.zip"
  ditto -c -k --keepParent "$APP" "$SUBMIT_ZIP"
  OUT=$(xcrun notarytool submit "$SUBMIT_ZIP" \
    --key "$ASC_KEY_PATH" --key-id "$ASC_KEY_ID" --issuer "$ASC_ISSUER" \
    --wait --output-format json)
  rm -f "$SUBMIT_ZIP"
  STATUS=$(echo "$OUT" | /usr/bin/python3 -c 'import sys,json;print(json.load(sys.stdin).get("status",""))')
  SUB_ID=$(echo "$OUT" | /usr/bin/python3 -c 'import sys,json;print(json.load(sys.stdin).get("id",""))')
  if [ "$STATUS" != "Accepted" ]; then
    echo "❌ Notarize ไม่ผ่าน (status: $STATUS) — รายละเอียด:"
    xcrun notarytool log "$SUB_ID" --key "$ASC_KEY_PATH" --key-id "$ASC_KEY_ID" --issuer "$ASC_ISSUER"
    exit 1
  fi
  echo "✅ Apple อนุมัติแล้ว (submission $SUB_ID)"

  step "แปะตั๋วเข้าแอป (staple)"
  xcrun stapler staple "$APP"
  xcrun stapler validate "$APP"
fi

step "สร้างไฟล์สำหรับแจก"
ditto -c -k --keepParent "$APP" "$ZIP"
shasum -a 256 "$ZIP" | tee "$ZIP.sha256"

step "ตรวจแบบเดียวกับเครื่องผู้ใช้ (Gatekeeper)"
if [ "$NOTARIZE" = 1 ]; then
  spctl -a -vv -t exec "$APP"
else
  echo "ข้ามการตรวจ Gatekeeper (ไม่ได้ notarize) — เครื่องอื่นจะยังเจอคำเตือน"
fi

echo
echo "🎉 เสร็จแล้ว: $ZIP"
echo "   อัปขึ้นเว็บ: npx wrangler r2 object put <bucket>/releases/MacWallpaperPro.zip --file $ZIP"
