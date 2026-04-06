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
codesign --force --deep --sign - "$APP_PATH" 2>/dev/null || true

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

1. Drag "Interview Assistant.app" to the "Applications" folder.

2. Open the app:
   • Double-click it from Applications.
   • If you see "app can't be opened", right-click → Open, then click Open.
   • If that still fails, double-click "Install.command" in this window
     (right-click → Open if macOS blocks it too).

3. On first launch the app will set up its Python environment (~1 min).

Need help? The terminal command that always works:
  xattr -cr "/Applications/Interview Assistant.app" && open "/Applications/Interview Assistant.app"

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
