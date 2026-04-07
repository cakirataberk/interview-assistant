#!/bin/bash
# Post-build script: creates a polished DMG with Install.command included
set -e

APP_NAME="Interview Assistant"
VERSION="1.0.0"
DIST="./dist"
APP_PATH="$DIST/mac-arm64/$APP_NAME.app"
DMG_OUT="$DIST/$APP_NAME-$VERSION-arm64.dmg"
TMP_DMG="/tmp/ia_tmp.dmg"
WORK_DIR="/tmp/ia_dmg_work"

echo "→ Stripping quarantine from .app..."
xattr -cr "$APP_PATH"

echo "→ Preparing DMG working folder..."
rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR"

# Copy app into work dir
cp -R "$APP_PATH" "$WORK_DIR/"

# Create Applications symlink
ln -s /Applications "$WORK_DIR/Applications"

# Copy and chmod Install.command
cp "build/Install.command" "$WORK_DIR/Install.command"
chmod +x "$WORK_DIR/Install.command"
xattr -d com.apple.quarantine "$WORK_DIR/Install.command" 2>/dev/null || true

# Create README.txt
cat > "$WORK_DIR/README.txt" << 'EOF'
How to install Interview Assistant
====================================

OPTION A — Easy install (recommended):
  1. Double-click "Install.command" in this window.
     → If macOS says it can't be opened: right-click it → Open → Open
  2. The app will be copied to Applications and launch automatically.

OPTION B — Manual install:
  1. Drag "Interview Assistant.app" to the "Applications" folder.
  2. Right-click the app in Applications → Open → Open
     (This is required the very first time for apps not from the App Store.)

On first launch the app will set up its Python environment (~1 min).

────────────────────────────────────────
STILL BLOCKED? Run this in Terminal:
  xattr -cr "/Applications/Interview Assistant.app"
  open "/Applications/Interview Assistant.app"
────────────────────────────────────────
EOF

echo "→ Creating DMG..."
rm -f "$DMG_OUT" "$TMP_DMG"

hdiutil create \
  -volname "$APP_NAME $VERSION" \
  -srcfolder "$WORK_DIR" \
  -ov \
  -format UDZO \
  -imagekey zlib-level=9 \
  "$DMG_OUT"

echo "✓ Done: $DMG_OUT"
rm -rf "$WORK_DIR"
