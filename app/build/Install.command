#!/bin/bash
APP="/Applications/Interview Assistant.app"

echo "Installing Interview Assistant..."
if [ -d "$APP" ]; then
    echo "Removing old version..."
    rm -rf "$APP"
fi

# Copy app
cp -R "$(dirname "$0")/Interview Assistant.app" /Applications/

# Remove quarantine so the app opens without any security warning
xattr -cr "$APP"

echo ""
echo "Done! Opening Interview Assistant..."
open "$APP"
