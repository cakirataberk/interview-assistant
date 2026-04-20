#!/bin/bash
# Post-build script: re-signs the .app ad-hoc and creates the final DMG.
set -e

APP_NAME="Interview Assistant"
VERSION="$(node -p "require('../package.json').version" 2>/dev/null || node -p "require('./package.json').version")"
DIST="./dist"
APP_PATH="$DIST/mac-arm64/$APP_NAME.app"
DMG_OUT="$DIST/$APP_NAME-$VERSION-arm64.dmg"
WORK_DIR="/tmp/ia_dmg_work"

echo "→ Ad-hoc signing .app (enables 'Open Anyway' on recipient machines)..."
codesign --force --deep --sign - "$APP_PATH"

echo "→ Preparing DMG working folder..."
rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR"

cp -R "$APP_PATH" "$WORK_DIR/"
ln -s /Applications "$WORK_DIR/Applications"

echo "→ Creating DMG..."
rm -f "$DMG_OUT"

hdiutil create \
  -volname "$APP_NAME $VERSION" \
  -srcfolder "$WORK_DIR" \
  -ov \
  -format UDZO \
  -imagekey zlib-level=9 \
  "$DMG_OUT"

echo "✓ Done: $DMG_OUT"
rm -rf "$WORK_DIR"
