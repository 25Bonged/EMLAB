#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

npm --prefix dashboard ci
npm --prefix dashboard run build

echo "Setup complete. Start with: ./scripts/start_emlab.sh"
