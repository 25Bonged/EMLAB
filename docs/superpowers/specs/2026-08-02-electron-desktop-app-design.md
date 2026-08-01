# EMLAB Desktop App — Electron Port Design

**Date:** 2026-08-02
**Status:** Approved for planning

## Goal

Ship EMLAB as a double-clickable desktop app for a handful of colleagues on mixed
macOS and Windows laptops, none of whom have Python, Node, or a terminal.

## Why Electron, not Tauri

The decision turns on one fact: **the parsing logic is already TypeScript.**
`backend/app/parser.py` exists only to shell out to Node and run
`dashboard/scripts/parsePair.ts`, which imports `src/ingest/pdfReport.ts`,
`xlsmTrace.ts`, and `normalize.ts` (pdfjs-dist + SheetJS).

Today the app needs three runtimes: Python, Node, and a browser.

Tauri's single advantage is a ~10 MB native binary, and that is only collectable
if the backend is Rust. Nobody is reimplementing pdfjs and SheetJS parsing in
Rust, so a Tauri build would bundle a Node sidecar anyway — landing near
Electron's size with more moving parts. Tauri also uses WKWebView on macOS and
WebView2 on Windows, so a Recharts-heavy dashboard can render differently per
platform, which is a support cost when handing the app to non-technical users.

Electron's main process *is* Node. Porting the Python layer into it collapses
three runtimes into one, and ships a single Chromium so both platforms render
identically.

## Architecture

```
Electron main process (Node)
├── Hono HTTP server, bound 127.0.0.1:<ephemeral port>
│   └── the same 12 routes and JSON shapes FastAPI serves today
├── node:sqlite            ← port of backend/app/db.py       (310 lines)
├── chokidar watcher       ← port of backend/app/watcher.py  (164 lines)
├── exceljs export         ← port of backend/app/export.py    (61 lines)
└── utilityProcess running parsePair  ← backend/app/parser.py DELETED (54 lines)
Renderer (BrowserWindow) → loads dashboard/dist, otherwise unchanged
```

### Why keep an HTTP server instead of moving to IPC

`dashboard/src/lib/api.ts` exposes `exportUrl()` and `evidenceUrl()`, which return
URLs consumed as `<a href>` and by the PDF viewer. Pure IPC would force those into
blob URLs or a custom protocol handler and touch call sites across all nine views.

Keeping a loopback HTTP server means `API_BASE` — already configurable via
`import.meta.env.VITE_API_BASE` — is the **only** frontend change. The store,
the views, the Recharts code, and both URL builders are untouched.

The port is ephemeral (bind port 0, read back the assigned port) and injected
into the renderer via preload. No fixed port, so no collision with a colleague's
other software.

## Data model: local DB per laptop

Each install watches that user's own OneDrive folder and builds its own SQLite
database. Approvals and edits do not propagate between colleagues. Multi-user
reconciliation is explicitly out of scope.

### What this deletes

Since every request now originates from `127.0.0.1`, an entire layer of
`main.py` becomes dead weight and must NOT be ported:

- `is_local()` / `require_local()` — every user edits their own copy
- the HTTP Basic auth middleware (~30 lines)
- `host: 0.0.0.0` → bind `127.0.0.1` only; the app never listens on the network
- CORS middleware — retained only for `vite dev` on :5173, dropped in production

Roughly 60 of `main.py`'s 199 lines disappear.

### What this adds

1. **First-run folder picker.** `config.json` hardcodes
   `"../OneDrive_3_6-20-2026 (1)"`, which is meaningless on another laptop. On
   first launch, show a native folder dialog and persist the choice to
   `app.getPath('userData')/config.json`. Must be re-openable from the UI.
2. **Database relocation.** `./data/emissions.db` sits inside the app bundle —
   read-only on macOS once installed, and destroyed by every update. Move to
   `app.getPath('userData')`.

## Porting hazards

These were found by reading the Python and do not appear in the test suite. Each
must be handled explicitly.

### 1. Transactions (performance-critical)

Python's `with self.connect()` wraps every `Database` method in a single implicit
transaction, committing once at the end. `node:sqlite` autocommits per statement.

`save_test()` writes one row per trace point across three channels. Without an
explicit `BEGIN`/`COMMIT`, a single test insert becomes thousands of individual
fsyncs. Given commit `ce87f58` ("Harden folder watcher and DB for bulk (200+ file)
ingestion"), this path is already known to be under load. **Every ported method
that writes must wrap its statements in an explicit transaction.**

### 2. Parsing must not run in the main process

`parse_pair` is currently a subprocess, which gives crash and latency isolation.
The watcher runs in its own Python thread, so parsing never blocks the API.

In Node, a synchronous parse loop in the main process would freeze the window —
unacceptable during a 200+ file bulk ingest, and a corrupt PDF could take the app
down. **Parsing runs in an Electron `utilityProcess`**, preserving today's
isolation. `utilityProcess` over `worker_thread` specifically because it is a
separate OS process: a pdfjs crash or runaway allocation is contained, matching
the current subprocess behavior, and it keeps the existing 180-second timeout
meaningful.

### 3. `mtime` precision

`watcher._file_hash()` skips re-hashing when `st_size` and `st_mtime_ns` both
match the stored value. `st_mtime_ns` is integer nanoseconds. Node's default
`stat().mtimeMs` is a float in milliseconds and will not compare equal.

**Use `fs.statSync(path, { bigint: true }).mtimeNs`.** Getting this wrong makes
the cache silently always-miss — every file re-hashed on every 3-second scan.
The `test_unchanged_files_are_not_rehashed` test guards this.

### 4. Timestamp and JSON formatting differences

- `datetime.now(timezone.utc).isoformat()` yields `...+00:00`; JS `toISOString()`
  yields `...Z`. Values are stored as TEXT and used in `ORDER BY`. Pick one
  format and apply it consistently; mixing them within one database misorders
  rows whose timestamps tie on the prefix.
- Python's `json.dumps` defaults to `", "` / `": "` separators; `JSON.stringify`
  emits none. Irrelevant for `data_json` (only ever re-parsed), but it changes
  the digest in `main.py`'s `import-parsed` route, which hashes
  `json.dumps(test, sort_keys=True)`. Fresh per-laptop databases make this
  harmless in practice; noted so it is not mistaken for a bug.

## Testing

`backend/tests/` already encodes seven behaviors that would fail silently in a
port. **Translate these to Vitest first, then port against them.**

| Behavior | Source test |
|---|---|
| Idempotent save; re-save with new hash writes a replacement audit row | `test_idempotent_hash_and_replacement_audit` |
| Quarantined tests excluded from the accepted-only list | `test_quarantined_excluded_from_formal_list` |
| `pending_pair` → paired → idempotent → corrected-source reparse | `test_pending_pair_completion_idempotency_and_correction` |
| Two runs of one vehicle/cycle on one day stay distinct (filename time via `_RUN_TS`) | `test_same_day_repeat_runs_stay_distinct` |
| Unchanged files are not re-hashed | `test_unchanged_files_are_not_rehashed` |
| A deleted test is not resurrected by an unchanged source | `test_deleted_test_is_not_resurrected` |
| Unchanged quarantined records are not re-parsed; manual edits survive | `test_unchanged_quarantined_not_reparsed_and_edits_survive` |

Existing dashboard tests (`pdfReport.test.ts`, `xlsmTrace.test.ts`,
`compilationWorkbook.test.ts`, `engineering.test.ts`, `stats.test.ts`) continue to
run unchanged — the ingest modules they cover are not modified by this work.

Add one end-to-end check: launch the built app against a fixture folder, assert a
pair is ingested and the API returns it.

## Packaging

`electron-builder` targeting:

- macOS: `.dmg`, arm64 + x64
- Windows: NSIS `.exe`, x64

### SQLite driver

Use `node:sqlite`, built into the Node that Electron ships (requires Node ≥ 22.5;
confirm the Electron version at implementation time). This means **zero native
modules** — nothing to rebuild per platform or architecture.

It is still flagged experimental. The alternative, `better-sqlite3`, is
battle-tested but is a native module requiring prebuilds for mac-arm64, mac-x64,
and win-x64. The API surface used here is small (`exec`, `prepare`, `run`, `get`,
`all`), so switching later is a contained change.

### Code signing — open item, does not block implementation

Unsigned, macOS shows "cannot be opened because the developer cannot be verified"
and requires right-click → Open; Windows shows a SmartScreen warning. To
non-technical colleagues this reads as a broken app.

Resolving it needs an Apple Developer account (~$99/yr, enables notarization) and
a Windows OV certificate (~$200–400/yr). **This is a purchasing decision, not an
engineering one, and is deliberately left unresolved here.** The build must
succeed unsigned and pick up signing automatically when the secrets exist.

## CI/CD

No CI exists today (no `.github/`). The remote is
`git@github.com:25Bonged/EMLAB.git`.

CI is not optional polish here: **the Windows installer cannot be built on a
Mac.** `electron-builder` can produce NSIS via wine, but it is unreliable and
cannot sign. A GitHub Actions matrix is the build machine for half the users.

**In scope:**

1. **Tests on every push** — Ubuntu runner: Vitest, `tsc -b`, eslint. Currently
   nothing runs the test suite automatically; this is what makes the port safe.
2. **Release builds on version tag** — `macos-latest` produces the dmgs,
   `windows-latest` the exe; artifacts attach to a GitHub Release.

Workflows must build successfully **without** signing secrets and enable signing
automatically once `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `CSC_LINK`,
`CSC_KEY_PASSWORD`, and `WIN_CSC_LINK` are present — so CI is never blocked on
the certificate purchase.

**Out of scope (documented follow-up):** `electron-updater` auto-update. It is
dead weight until signing is settled, because **unsigned auto-update silently
fails on macOS.**

Note: on a private repo, macOS runners bill at a 10× minute multiplier (Windows
2×). A ~10-minute Mac build costs ~100 billed minutes against the 2,000/month
free tier — fine for roughly 15–20 releases a month.

## Out of scope

- Multi-user sync, shared databases, or conflict reconciliation
- Auto-update
- Rewriting any `src/ingest/*` parsing logic
- Changes to the nine views, the Zustand store, or the Recharts code
- Retaining a Python runtime, in any form, after the port

## Deliverables

1. Vitest translations of the seven backend tests
2. `node:sqlite` port of `db.py`, transactional
3. `chokidar` port of `watcher.py`, parsing in a `utilityProcess`
4. `exceljs` port of `export.py`
5. Hono server carrying the 12 routes, minus the deleted auth layer
6. Electron main + preload; first-run folder picker; `userData` paths
7. One-line `api.ts` change to consume the injected port
8. `electron-builder` config for dmg + exe
9. `.github/workflows/` for test CI and tagged release builds
