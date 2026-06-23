#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/com.emlab.daily-fev-library.plist"
mkdir -p "$HOME/Library/LaunchAgents" "$ROOT/backend/logs"

sed \
  -e "s|__ROOT__|$ROOT|g" \
  "$ROOT/scripts/com.emlab.daily-fev-library.plist.template" > "$PLIST"

launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl enable "gui/$(id -u)/com.emlab.daily-fev-library"
echo "EMLAB startup service installed: $PLIST"
