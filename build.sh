#!/bin/bash
# Build MacWallpaperPro.app (release)
#   SIGN_IDENTITY  signing certificate (default: the first "Developer ID Application" found, else "-" = ad-hoc, this Mac only)
#   VERSION / BUILD_NUMBER  version numbers written to Info.plist
set -euo pipefail
# Always sign with the same certificate so the Accessibility permission survives rebuilds
# (ad-hoc "-" gets a new identity every build, so macOS asks for the permission again).
DEFAULT_IDENTITY="$(security find-identity -v -p codesigning 2>/dev/null | grep -o '"Developer ID Application: [^"]*"' | head -1 | tr -d '"')"
SIGN_IDENTITY="${SIGN_IDENTITY:-${DEFAULT_IDENTITY:--}}"
VERSION="${VERSION:-0.1.0}"
BUILD_NUMBER="${BUILD_NUMBER:-1}"
cd "$(dirname "$0")"
swift build -c release
APP=build/MacWallpaperPro.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp .build/release/MacWallpaperPro "$APP/Contents/MacOS/MacWallpaperPro"
cp -R Wallpapers "$APP/Contents/Resources/Wallpapers"
cp -R Localization "$APP/Contents/Resources/Localization"
cp Resources/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>MacWallpaperPro</string>
  <key>CFBundleDisplayName</key><string>MacWallpaperPro</string>
  <key>CFBundleIdentifier</key><string>com.macwallpaperpro.app</string>
  <key>CFBundleExecutable</key><string>MacWallpaperPro</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
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
  echo "⚠️  No Developer ID certificate found: signing ad-hoc (macOS will ask for permissions again after every build)"
  codesign --force --sign - "$APP"
else
  # Hardened Runtime + secure timestamp: required by Apple for notarization
  codesign --force --options runtime --timestamp --sign "$SIGN_IDENTITY" "$APP"
fi
echo "✅ Built $APP"
