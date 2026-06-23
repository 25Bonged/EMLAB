from __future__ import annotations

import hashlib
import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from .config import Settings


SCHEMA = """
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS tests (
  id TEXT PRIMARY KEY,
  identity_key TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK(status IN ('pending_pair','processing','quarantined','accepted','replaced')),
  project TEXT, cycle TEXT, config TEXT, transmission TEXT, lab TEXT,
  vehicle_model TEXT, vn_no TEXT, vin_sample_id TEXT, test_date TEXT,
  catalyst_state TEXT, odo REAL, imported_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  parser_version TEXT NOT NULL, data_json TEXT NOT NULL, low_confidence_json TEXT NOT NULL,
  combined_hash TEXT
);
CREATE INDEX IF NOT EXISTS idx_tests_status ON tests(status);
CREATE INDEX IF NOT EXISTS idx_tests_date ON tests(test_date);
CREATE INDEX IF NOT EXISTS idx_tests_filters ON tests(project, cycle, config, transmission, lab);

CREATE TABLE IF NOT EXISTS pollutant_results (
  test_id TEXT NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  pollutant TEXT NOT NULL, value REAL, unit TEXT NOT NULL,
  PRIMARY KEY(test_id, pollutant)
);
CREATE TABLE IF NOT EXISTS phases (
  test_id TEXT NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  phase_index INTEGER NOT NULL, name TEXT NOT NULL, distance_km REAL, data_json TEXT NOT NULL,
  PRIMARY KEY(test_id, phase_index)
);
CREATE TABLE IF NOT EXISTS trace_points (
  test_id TEXT NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  channel TEXT NOT NULL, point_index INTEGER NOT NULL, time_s REAL NOT NULL, data_json TEXT NOT NULL,
  PRIMARY KEY(test_id, channel, point_index)
);
CREATE TABLE IF NOT EXISTS source_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  test_id TEXT REFERENCES tests(id) ON DELETE SET NULL,
  stem TEXT NOT NULL, kind TEXT NOT NULL, path TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL, size_bytes INTEGER NOT NULL, modified_ns INTEGER NOT NULL,
  first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ingestion_jobs (
  stem TEXT PRIMARY KEY, status TEXT NOT NULL, pdf_path TEXT, xlsm_path TEXT,
  pdf_hash TEXT, xlsm_hash TEXT, message TEXT, first_seen_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, test_id TEXT REFERENCES tests(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS replacement_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, test_id TEXT NOT NULL,
  previous_hash TEXT, replacement_hash TEXT, replaced_at TEXT NOT NULL,
  parser_outcome TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS manual_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT, test_id TEXT NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  patch_json TEXT NOT NULL, changed_at TEXT NOT NULL, changed_by TEXT NOT NULL
);
"""

POLLUTANT_UNITS = {
    "CO": "mg/km", "THC": "mg/km", "NOx": "mg/km", "CO2": "mg/km",
    "CH4": "mg/km", "NMHC": "mg/km", "PM": "mg/km", "PN": "#/km",
}


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


class Database:
    def __init__(self, settings: Settings):
        self.path = settings.database_path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as conn:
            conn.executescript(SCHEMA)

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.path, timeout=30)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    @staticmethod
    def identity_key(test: dict[str, Any], fallback_stem: str) -> str:
        fields = [
            str(test.get("vehicleModel") or "").strip().lower(),
            str(test.get("vnNo") or "").strip().lower(),
            str(test.get("date") or "").strip(),
            str(test.get("cycle") or "").strip().lower(),
        ]
        raw = "|".join(fields)
        if sum(bool(x) for x in fields) < 3:
            raw = f"stem|{fallback_stem.lower()}"
        return raw

    @staticmethod
    def test_id(identity_key: str) -> str:
        return hashlib.sha256(identity_key.encode()).hexdigest()[:24]

    def save_test(self, test: dict[str, Any], stem: str, combined_hash: str, status: str, parser_outcome: str) -> tuple[str, bool]:
        identity = self.identity_key(test, stem)
        test_id = self.test_id(identity)
        now = utcnow()
        test = {**test, "id": test_id, "status": status}
        replaced = False
        with self.connect() as conn:
            existing = conn.execute("SELECT combined_hash FROM tests WHERE id=?", (test_id,)).fetchone()
            same_source = bool(existing and existing["combined_hash"] == combined_hash)
            if existing and not same_source:
                replaced = True
                conn.execute(
                    "INSERT INTO replacement_audit(test_id,previous_hash,replacement_hash,replaced_at,parser_outcome) VALUES(?,?,?,?,?)",
                    (test_id, existing["combined_hash"], combined_hash, now, parser_outcome),
                )
            conn.execute(
                """
                INSERT INTO tests(id,identity_key,active,status,project,cycle,config,transmission,lab,vehicle_model,
                  vn_no,vin_sample_id,test_date,catalyst_state,odo,imported_at,updated_at,parser_version,
                  data_json,low_confidence_json,combined_hash)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(id) DO UPDATE SET
                  status=excluded.status, project=excluded.project, cycle=excluded.cycle, config=excluded.config,
                  transmission=excluded.transmission, lab=excluded.lab, vehicle_model=excluded.vehicle_model,
                  vn_no=excluded.vn_no, vin_sample_id=excluded.vin_sample_id, test_date=excluded.test_date,
                  catalyst_state=excluded.catalyst_state, odo=excluded.odo, updated_at=excluded.updated_at,
                  parser_version=excluded.parser_version, data_json=excluded.data_json,
                  low_confidence_json=excluded.low_confidence_json, combined_hash=excluded.combined_hash, active=1
                """,
                (
                    test_id, identity, 1, status, test.get("project"), test.get("cycle"), test.get("config"),
                    test.get("transmission"), test.get("lab"), test.get("vehicleModel"), test.get("vnNo"),
                    test.get("vinSampleId"), test.get("date"), test.get("catalystState"), test.get("odo"),
                    test.get("importedAt") or now, now, "fev-js-v1", json.dumps(test),
                    json.dumps(test.get("lowConfidence", [])), combined_hash,
                ),
            )
            conn.execute("DELETE FROM pollutant_results WHERE test_id=?", (test_id,))
            for pollutant, value in test.get("results", {}).items():
                conn.execute(
                    "INSERT INTO pollutant_results(test_id,pollutant,value,unit) VALUES(?,?,?,?)",
                    (test_id, pollutant, value, POLLUTANT_UNITS.get(pollutant, "")),
                )
            conn.execute("DELETE FROM phases WHERE test_id=?", (test_id,))
            for index, phase in enumerate(test.get("phases", [])):
                conn.execute(
                    "INSERT INTO phases(test_id,phase_index,name,distance_km,data_json) VALUES(?,?,?,?,?)",
                    (test_id, index, phase.get("name", f"Phase {index + 1}"), phase.get("distanceKm"), json.dumps(phase)),
                )
            conn.execute("DELETE FROM trace_points WHERE test_id=?", (test_id,))
            for channel, points in (test.get("trace") or {}).items():
                conn.executemany(
                    "INSERT INTO trace_points(test_id,channel,point_index,time_s,data_json) VALUES(?,?,?,?,?)",
                    [(test_id, channel, index, point.get("t", 0), json.dumps(point)) for index, point in enumerate(points)],
                )
        return test_id, replaced

    def list_tests(self, include_nonaccepted: bool = True) -> list[dict[str, Any]]:
        where = "WHERE active=1" if include_nonaccepted else "WHERE active=1 AND status='accepted'"
        with self.connect() as conn:
            rows = conn.execute(f"SELECT data_json,status FROM tests {where} ORDER BY test_date DESC, updated_at DESC").fetchall()
        return [{**json.loads(row["data_json"]), "status": row["status"]} for row in rows]

    def get_test(self, test_id: str) -> dict[str, Any] | None:
        with self.connect() as conn:
            row = conn.execute("SELECT data_json,status FROM tests WHERE id=?", (test_id,)).fetchone()
        return {**json.loads(row["data_json"]), "status": row["status"]} if row else None

    def find_identity(self, test: dict[str, Any], stem: str) -> dict[str, Any] | None:
        identity = self.identity_key(test, stem)
        with self.connect() as conn:
            row = conn.execute("SELECT data_json,status FROM tests WHERE identity_key=?", (identity,)).fetchone()
        return {**json.loads(row["data_json"]), "status": row["status"]} if row else None

    def update_job(self, stem: str, status: str, **fields: Any) -> None:
        now = utcnow()
        with self.connect() as conn:
            previous = conn.execute("SELECT first_seen_at FROM ingestion_jobs WHERE stem=?", (stem,)).fetchone()
            values = {
                "pdf_path": None, "xlsm_path": None, "pdf_hash": None, "xlsm_hash": None,
                "message": None, "test_id": None, **fields,
            }
            conn.execute(
                """
                INSERT INTO ingestion_jobs(stem,status,pdf_path,xlsm_path,pdf_hash,xlsm_hash,message,first_seen_at,updated_at,test_id)
                VALUES(?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(stem) DO UPDATE SET status=excluded.status,pdf_path=excluded.pdf_path,
                  xlsm_path=excluded.xlsm_path,pdf_hash=excluded.pdf_hash,xlsm_hash=excluded.xlsm_hash,
                  message=excluded.message,updated_at=excluded.updated_at,test_id=excluded.test_id
                """,
                (stem, status, values["pdf_path"], values["xlsm_path"], values["pdf_hash"], values["xlsm_hash"],
                 values["message"], previous["first_seen_at"] if previous else now, now, values["test_id"]),
            )

    def list_jobs(self) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute("SELECT * FROM ingestion_jobs ORDER BY updated_at DESC").fetchall()
        return [dict(row) for row in rows]

    def register_source(self, stem: str, kind: str, path: Path, sha256: str, test_id: str | None = None) -> None:
        stat = path.stat()
        now = utcnow()
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO source_files(test_id,stem,kind,path,sha256,size_bytes,modified_ns,first_seen_at,last_seen_at)
                VALUES(?,?,?,?,?,?,?,?,?)
                ON CONFLICT(path) DO UPDATE SET test_id=excluded.test_id,sha256=excluded.sha256,
                  size_bytes=excluded.size_bytes,modified_ns=excluded.modified_ns,last_seen_at=excluded.last_seen_at
                """,
                (test_id, stem, kind, str(path), sha256, stat.st_size, stat.st_mtime_ns, now, now),
            )

    def source_path(self, test_id: str, kind: str) -> Path | None:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT path FROM source_files WHERE test_id=? AND kind=? ORDER BY last_seen_at DESC LIMIT 1",
                (test_id, kind),
            ).fetchone()
        return Path(row["path"]) if row else None

    def patch_test(self, test_id: str, patch: dict[str, Any]) -> dict[str, Any] | None:
        current = self.get_test(test_id)
        if not current:
            return None
        allowed = {
            "project", "cycle", "config", "transmission", "lab",
            "vehicleModel", "vinSampleId", "vnNo",
            "catalystState", "stt", "startSoc", "lowConfidence",
        }
        clean = {key: value for key, value in patch.items() if key in allowed}
        updated = {**current, **clean}
        now = utcnow()
        with self.connect() as conn:
            conn.execute(
                "UPDATE tests SET project=?,cycle=?,config=?,transmission=?,lab=?,"
                "vehicle_model=?,vn_no=?,vin_sample_id=?,catalyst_state=?,"
                "data_json=?,low_confidence_json=?,updated_at=? WHERE id=?",
                (
                    updated.get("project"), updated.get("cycle"), updated.get("config"), updated.get("transmission"),
                    updated.get("lab"), updated.get("vehicleModel"), updated.get("vnNo"), updated.get("vinSampleId"),
                    updated.get("catalystState"), json.dumps(updated),
                    json.dumps(updated.get("lowConfidence", [])), now, test_id,
                ),
            )
            conn.execute(
                "INSERT INTO manual_overrides(test_id,patch_json,changed_at,changed_by) VALUES(?,?,?,?)",
                (test_id, json.dumps(clean), now, "local-pc"),
            )
        return updated

    def set_status(self, test_id: str, status: str) -> bool:
        with self.connect() as conn:
            cursor = conn.execute("UPDATE tests SET status=?,updated_at=? WHERE id=?", (status, utcnow(), test_id))
        return cursor.rowcount > 0

    def delete_test(self, test_id: str) -> bool:
        with self.connect() as conn:
            cursor = conn.execute("DELETE FROM tests WHERE id=?", (test_id,))
        return cursor.rowcount > 0

    def audit(self, test_id: str) -> list[dict[str, Any]]:
        with self.connect() as conn:
            replacements = [dict(r) | {"kind": "replacement"} for r in conn.execute(
                "SELECT * FROM replacement_audit WHERE test_id=? ORDER BY replaced_at DESC", (test_id,)
            )]
            overrides = [dict(r) | {"kind": "override"} for r in conn.execute(
                "SELECT * FROM manual_overrides WHERE test_id=? ORDER BY changed_at DESC", (test_id,)
            )]
        return sorted(replacements + overrides, key=lambda row: row.get("replaced_at") or row.get("changed_at"), reverse=True)

