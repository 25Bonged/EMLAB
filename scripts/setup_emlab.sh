#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

python3 -m venv --system-site-packages backend/.venv
backend/.venv/bin/python3 -m pip install -r backend/requirements.txt
(cd dashboard && npm install && npm run build)

echo "Setup complete. Start with: ./scripts/start_emlab.sh"
