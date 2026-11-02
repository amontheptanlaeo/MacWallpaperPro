#!/bin/bash
# Build MacWallpaperPro.app (release)
#   SIGN_IDENTITY  ใบรับรองสำหรับเซ็น (ค่าเริ่มต้น "-" = ad-hoc ใช้ในเครื่องเท่านั้น)
#   VERSION / BUILD_NUMBER  เลขเวอร์ชันใน Info.plist
set -euo pipefail
SIGN_IDENTITY="${SIGN_IDENTITY:--}"
VERSION="${VERSION:-0.1.0}"
BUILD_NUMBER="${BUILD_NUMBER:-1}"
cd "$(dirname "$0")"
swift build -c release
APP=build/MacWallpaperPro.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp .build/release/MacWallpaperPro "$APP/Contents/MacOS/MacWallpaperPro"
cp -R Wallpapers "$APP/Contents/Resources/Wallpapers"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>MacWallpaperPro</string>
  <key>CFBundleDisplayName</key><string>MacWallpaperPro</string>
  <key>CFBundleIdentifier</key><string>com.macwallpaperpro.app</string>
  <key>CFBundleExecutable</key><string>MacWallpaperPro</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$BUILD_NUMBER</string>
  <key>LSMinimumSystemVersion</key><string>15.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHumanReadableCopyright</key><string>© 2026 Amonthep tanlaeo · GPL-3.0</string>
  <key>CFBundleURLTypes</key><array><dict>
    <key>CFBundleURLName</key><string>com.macwallpaperpro.app</string>
    <key>CFBundleURLSchemes</key><array><string>macwallpaperpro</string></array>
  </dict></array>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsArbitraryLoads</key><true/></dict>
</dict></plist>
PLIST
if [ "$SIGN_IDENTITY" = "-" ]; then
  codesign --force --sign - "$APP"
else
  # Hardened Runtime + secure timestamp: Apple บังคับสำหรับการ notarize
  codesign --force --options runtime --timestamp --sign "$SIGN_IDENTITY" "$APP"
fi
echo "✅ Built $APP"
