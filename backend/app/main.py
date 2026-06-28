from __future__ import annotations

import base64
import json
import secrets
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any
import hashlib

from fastapi import Body, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from .config import load_settings
from .db import Database
from .export import export_xlsx
from .watcher import FolderWatcher


settings = load_settings()
db = Database(settings)
watcher = FolderWatcher(settings, db)


def is_local(request: Request) -> bool:
    host = request.client.host if request.client else ""
    return host in {"127.0.0.1", "::1", "localhost"}


def require_local(request: Request) -> None:
    if not is_local(request):
        raise HTTPException(status_code=403, detail="Edits are allowed only from the host engineering PC")


@asynccontextmanager
async def lifespan(_: FastAPI):
    # The library is sourced exclusively from real reports ingested by the
    # folder watcher — no seed/demo data is ever loaded. The initial scan runs
    # inside the watcher thread (which scans immediately on its first iteration)
    # so a large backlog of files does not block the server from accepting
    # connections at startup.
    watcher.start()
    yield
    watcher.stop()


app = FastAPI(title="EMLAB Daily FEV Emissions Library", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def basic_auth(request: Request, call_next):
    """Optional HTTP Basic auth gate.

    Disabled by default (trusted internal network). Set EMLAB_AUTH_USER and
    EMLAB_AUTH_PASSWORD (or the matching config.json keys) to require a login
    for every request — the browser handles the credential prompt natively, so
    no frontend changes are needed. Local-only edit checks (require_local) still
    apply on top of this for write operations.
    """
    if settings.auth_enabled:
        header = request.headers.get("authorization", "")
        ok = False
        if header.startswith("Basic "):
            try:
                user, _, password = base64.b64decode(header[6:]).decode("utf-8").partition(":")
                ok = secrets.compare_digest(user, settings.auth_user) and secrets.compare_digest(
                    password, settings.auth_password
                )
            except (ValueError, UnicodeDecodeError):
                ok = False
        if not ok:
            return Response(
                status_code=401,
                headers={"WWW-Authenticate": 'Basic realm="EMLAB"'},
                content="Authentication required",
            )
    return await call_next(request)


@app.get("/api/health")
def health(request: Request):
    return {
        "ok": True,
        "can_edit": is_local(request),
        "watch_folder": str(settings.watch_folder),
        "database": str(settings.database_path),
    }


@app.get("/api/tests")
def tests(include_nonaccepted: bool = True, summary: bool = True):
    rows = db.list_tests(include_nonaccepted=include_nonaccepted)
    if summary:
        return [{**test, "trace": None, "phases": []} for test in rows]
    return rows


@app.get("/api/tests/{test_id}")
def test_detail(test_id: str):
    test = db.get_test(test_id)
    if not test:
        raise HTTPException(404, "Test not found")
    return test


@app.patch("/api/tests/{test_id}")
def patch_test(request: Request, test_id: str, patch: dict[str, Any] = Body(...)):
    require_local(request)
    test = db.patch_test(test_id, patch)
    if not test:
        raise HTTPException(404, "Test not found")
    return test


@app.post("/api/tests/import-parsed")
def import_parsed(request: Request, payload: dict[str, Any] = Body(...)):
    require_local(request)
    tests = payload.get("tests", [])
    imported: list[str] = []
    for test in tests:
        stem = test.get("id", "manual-import")
        digest = hashlib.sha256(json.dumps(test, sort_keys=True).encode()).hexdigest()
        status = "quarantined" if test.get("lowConfidence") else "accepted"
        test_id, _ = db.save_test(test, stem, digest, status, "manual browser import")
        imported.append(test_id)
    return {"count": len(imported), "ids": imported}


@app.post("/api/tests/{test_id}/approve")
def approve_test(request: Request, test_id: str):
    require_local(request)
    if not db.set_status(test_id, "accepted"):
        raise HTTPException(404, "Test not found")
    return {"ok": True}


@app.post("/api/tests/{test_id}/quarantine")
def quarantine_test(request: Request, test_id: str):
    require_local(request)
    if not db.set_status(test_id, "quarantined"):
        raise HTTPException(404, "Test not found")
    return {"ok": True}


@app.delete("/api/tests/{test_id}")
def delete_test(request: Request, test_id: str):
    require_local(request)
    if not db.delete_test(test_id):
        raise HTTPException(404, "Test not found")
    return {"ok": True}


@app.get("/api/tests/{test_id}/audit")
def test_audit(test_id: str):
    return db.audit(test_id)


@app.get("/api/tests/{test_id}/evidence/{kind}")
def evidence(test_id: str, kind: str):
    if kind not in {"pdf", "xlsm"}:
        raise HTTPException(400, "Evidence kind must be pdf or xlsm")
    path = db.source_path(test_id, kind)
    if not path or not path.exists():
        raise HTTPException(404, "Evidence file not found")
    return FileResponse(path, filename=path.name)


@app.get("/api/ingestion")
def ingestion():
    return db.list_jobs()


@app.post("/api/ingestion/rescan")
def rescan(request: Request):
    require_local(request)
    watcher.scan_once()
    return {"ok": True, "jobs": db.list_jobs()}


@app.get("/api/export.xlsx")
def export(include_nonaccepted: bool = False):
    content = export_xlsx(db.list_tests(include_nonaccepted=include_nonaccepted))
    return Response(
        content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=emission_compilation.xlsx"},
    )


if settings.dashboard_dist.exists():
    app.mount("/", StaticFiles(directory=settings.dashboard_dist, html=True), name="dashboard")
