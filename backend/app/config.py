from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = BACKEND_ROOT.parent


@dataclass(frozen=True)
class Settings:
    watch_folder: Path
    database_path: Path
    host: str
    port: int
    scan_interval_seconds: float
    dashboard_dist: Path
    auth_user: str = ""
    auth_password: str = ""

    @property
    def auth_enabled(self) -> bool:
        return bool(self.auth_user and self.auth_password)


def _resolve(base: Path, value: str) -> Path:
    path = Path(value).expanduser()
    return path if path.is_absolute() else (base / path).resolve()


def load_settings() -> Settings:
    config_path = Path(os.environ.get("EMLAB_CONFIG", BACKEND_ROOT / "config.json"))
    raw: dict = {}
    if config_path.exists():
        raw = json.loads(config_path.read_text(encoding="utf-8"))
    base = config_path.parent
    return Settings(
        watch_folder=_resolve(base, os.environ.get("EMLAB_WATCH_FOLDER", raw.get("watch_folder", str(WORKSPACE_ROOT / "OneDrive_3_6-20-2026 (1)")))),
        database_path=_resolve(base, os.environ.get("EMLAB_DATABASE_PATH", raw.get("database_path", "./data/emissions.db"))),
        host=os.environ.get("EMLAB_HOST", raw.get("host", "0.0.0.0")),
        port=int(os.environ.get("EMLAB_PORT", raw.get("port", 8000))),
        scan_interval_seconds=float(os.environ.get("EMLAB_SCAN_INTERVAL", raw.get("scan_interval_seconds", 3))),
        dashboard_dist=_resolve(base, raw.get("dashboard_dist", "../dashboard/dist")),
        auth_user=os.environ.get("EMLAB_AUTH_USER", raw.get("auth_user", "")),
        auth_password=os.environ.get("EMLAB_AUTH_PASSWORD", raw.get("auth_password", "")),
    )
