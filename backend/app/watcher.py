from __future__ import annotations

import hashlib
import threading
import time
from pathlib import Path

from .config import Settings
from .db import Database
from .parser import parse_pair


def stem_of(path: Path) -> str:
    name = path.name
    for suffix in ("_REPORT.pdf", "_TRACES.xlsm"):
        if name.upper().endswith(suffix.upper()):
            return name[: -len(suffix)]
    return path.stem


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


class FolderWatcher:
    def __init__(self, settings: Settings, db: Database):
        self.settings = settings
        self.db = db
        self.stop_event = threading.Event()
        self.thread: threading.Thread | None = None

    def start(self) -> None:
        if self.thread and self.thread.is_alive():
            return
        self.thread = threading.Thread(target=self._loop, name="fev-folder-watcher", daemon=True)
        self.thread.start()

    def stop(self) -> None:
        self.stop_event.set()
        if self.thread:
            self.thread.join(timeout=5)

    def _loop(self) -> None:
        while not self.stop_event.is_set():
            try:
                self.scan_once()
            except Exception as exc:
                print(f"watcher scan failed: {exc}", flush=True)
            self.stop_event.wait(self.settings.scan_interval_seconds)

    def scan_once(self) -> None:
        root = self.settings.watch_folder
        root.mkdir(parents=True, exist_ok=True)
        groups: dict[str, dict[str, Path]] = {}
        for path in root.rglob("*"):
            if not path.is_file():
                continue
            upper = path.name.upper()
            kind = "pdf" if upper.endswith("_REPORT.PDF") else "xlsm" if upper.endswith("_TRACES.XLSM") else None
            if not kind:
                continue
            groups.setdefault(stem_of(path), {})[kind] = path.resolve()

        for stem, pair in groups.items():
            pdf = pair.get("pdf")
            xlsm = pair.get("xlsm")
            pdf_hash = sha256(pdf) if pdf else None
            xlsm_hash = sha256(xlsm) if xlsm else None
            if pdf:
                self.db.register_source(stem, "pdf", pdf, pdf_hash or "")
            if xlsm:
                self.db.register_source(stem, "xlsm", xlsm, xlsm_hash or "")
            if not pdf or not xlsm:
                self.db.update_job(
                    stem, "pending_pair", pdf_path=str(pdf) if pdf else None, xlsm_path=str(xlsm) if xlsm else None,
                    pdf_hash=pdf_hash, xlsm_hash=xlsm_hash,
                    message=f"Waiting for {'REPORT.pdf' if not pdf else 'TRACES.xlsm'}",
                )
                continue
            combined_hash = hashlib.sha256(f"{pdf_hash}:{xlsm_hash}".encode()).hexdigest()
            current = next((job for job in self.db.list_jobs() if job["stem"] == stem), None)
            if current and current.get("status") == "accepted" and current.get("pdf_hash") == pdf_hash and current.get("xlsm_hash") == xlsm_hash:
                existing_test = self.db.get_test(current.get("test_id")) if current.get("test_id") else None
                if existing_test and existing_test.get("units", {}).get("trace"):
                    continue
            self.db.update_job(
                stem, "processing", pdf_path=str(pdf), xlsm_path=str(xlsm),
                pdf_hash=pdf_hash, xlsm_hash=xlsm_hash, message="Parsing FEV report and traces",
            )
            try:
                test = parse_pair(pdf, xlsm)
                existing = self.db.find_identity(test, stem)
                low = list(test.get("lowConfidence", []))
                if existing:
                    field_map = {
                        "project": "project", "cycle": "cycle", "config": "config",
                        "transmission": "transmission", "vnNo": "vnNo",
                    }
                    for flag, field in field_map.items():
                        if flag in low and existing.get(field) not in {None, "", "Unknown"}:
                            test[field] = existing[field]
                            low.remove(flag)
                    for field in ("catalystState", "stt", "startSoc"):
                        if not test.get(field) and existing.get(field) is not None:
                            test[field] = existing[field]
                    test["lowConfidence"] = low
                status = "quarantined" if low else "accepted"
                test_id, replaced = self.db.save_test(
                    test, stem, combined_hash, status,
                    f"parsed with {len(low)} low-confidence field(s)",
                )
                self.db.register_source(stem, "pdf", pdf, pdf_hash or "", test_id)
                self.db.register_source(stem, "xlsm", xlsm, xlsm_hash or "", test_id)
                self.db.update_job(
                    stem, status, pdf_path=str(pdf), xlsm_path=str(xlsm), pdf_hash=pdf_hash,
                    xlsm_hash=xlsm_hash, test_id=test_id,
                    message="Corrected source replaced active record" if replaced else ("Ready for review" if low else "Accepted"),
                )
            except Exception as exc:
                self.db.update_job(
                    stem, "quarantined", pdf_path=str(pdf), xlsm_path=str(xlsm),
                    pdf_hash=pdf_hash, xlsm_hash=xlsm_hash, message=str(exc)[:1000],
                )
