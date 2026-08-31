#!/usr/bin/env bash
# Installs claude-usage.30s.js into a SwiftBar plugin folder and points
# SwiftBar at it. Safe to re-run.
set -euo pipefail

PLUGIN_DIR="${1:-$HOME/.swiftbar-plugins}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required but wasn't found. Install it with: brew install node" >&2
  exit 1
fi

if ! command -v swiftbar >/dev/null 2>&1 && [ ! -d "/Applications/SwiftBar.app" ]; then
  echo "SwiftBar doesn't appear to be installed. Install it with: brew install --cask swiftbar" >&2
  exit 1
fi

mkdir -p "$PLUGIN_DIR"
cp "$SCRIPT_DIR/claude-usage.30s.js" "$PLUGIN_DIR/"
chmod +x "$PLUGIN_DIR/claude-usage.30s.js"
defaults write com.ameba.SwiftBar PluginDirectory "$PLUGIN_DIR"

echo "Installed to $PLUGIN_DIR"
echo "Launching SwiftBar..."
open -a SwiftBar
echo "Done. Look for the usage icon in your menu bar (may take up to 30s on first launch)."
