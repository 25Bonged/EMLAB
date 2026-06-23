from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any


WORKSPACE_ROOT = Path(__file__).resolve().parents[2]
DASHBOARD_ROOT = WORKSPACE_ROOT / "dashboard"
PARSER = DASHBOARD_ROOT / "scripts" / "parsePair.ts"
VITE_NODE = DASHBOARD_ROOT / "node_modules" / ".bin" / "vite-node"


def node_executable() -> Path:
    """Resolve a real Node.js binary for the FEV parser subprocess.

    Resolution order favours an explicit override and a system install on PATH;
    the codex-runtime cache is only a last resort so ingestion does not silently
    break if that cache is cleared or the app moves to another host.
    """
    configured = os.environ.get("EMLAB_NODE")
    which = shutil.which("node")
    candidates = [
        Path(configured) if configured else None,
        Path("/usr/local/bin/node"),
        Path("/opt/homebrew/bin/node"),
        Path(which) if which else None,
        Path.home() / ".cache" / "codex-runtimes" / "codex-primary-runtime" / "dependencies" / "node" / "bin" / "node",
    ]
    for candidate in candidates:
        if candidate and candidate.exists():
            return candidate
    raise RuntimeError("Node.js executable not found; set EMLAB_NODE to its absolute path")


def parse_pair(pdf_path: Path, xlsm_path: Path) -> dict[str, Any]:
    if not VITE_NODE.exists():
        raise RuntimeError(
            f"FEV parser runtime missing: {VITE_NODE} not found. "
            "Run `npm ci` in the dashboard/ directory to materialize node_modules."
        )
    result = subprocess.run(
        [str(node_executable()), str(VITE_NODE.resolve()), str(PARSER), str(pdf_path), str(xlsm_path)],
        cwd=DASHBOARD_ROOT,
        capture_output=True,
        text=True,
        timeout=180,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "FEV parser failed")
    return json.loads(result.stdout)
