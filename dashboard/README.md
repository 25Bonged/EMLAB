# EMLAB — Daily FEV Emissions Library

A persistent engineering cockpit for vehicle emission compilation and release review.
A Python/FastAPI service watches the synced OneDrive folder, pairs daily FEV reports and
traces, stores validated evidence in SQLite, and updates the dashboard automatically.

Organized as **Program → Cycle → Tests** (STLA / Honda / RNTBCI → WLTP / MIDC / NEDC),
with an executive release cockpit, target exposure/P95 risk, configuration readiness,
automated engineering observations, a master table, compliance dashboard (vs BS6.2 norm
**and** STLA target), test comparison, trend/ageing charts, and per-test catalyst
(pre/post-cat) analysis.

## How it works

Each test is a pair of files:

| File | Provides | Parser |
|------|----------|--------|
| `*_REPORT.pdf` | Authoritative results (CO/THC/NOx/CO2/CH4/NMHC/PM/PN mg/km), per-phase, metadata, dyno A/B/C | `src/ingest/pdfReport.ts` (pdfjs, position-aware) |
| `*_TRACES.xlsm` | Second-by-second speed + dilute + raw pre/post-cat traces | `src/ingest/xlsmTrace.ts` (SheetJS) |
| `*.xlsx` | Compilation rows across configuration/cycle/lab sheets, including catalyst, STT/SOC, RLD, ODO and limits | `src/ingest/compilationWorkbook.ts` (dynamic header mapping) |

Files are paired by filename stem and parsed by the existing position-aware PDF and XLSM
parsers. FastAPI owns hashing, identity, SQLite persistence, quarantine, replacement
audit, evidence links and Excel export. Identical hashes are ignored; corrected sources
replace the active result and leave an audit entry.

Fields the parser can't read with confidence (cycle/config when the report doesn't encode
them) are **flagged ⚑** and editable per-test via *Edit tags*.

## Run locally

```bash
./scripts/setup_emlab.sh
./scripts/start_emlab.sh
```

Open `http://localhost:8000`. The production server also binds to the office LAN by
default. Change the watch folder, port, database, or bind address in
`backend/config.json`.

For frontend development, run FastAPI on port 8000 and `npm run dev` in `dashboard/`.
Vite proxies `/api` to the backend.

## Daily operation

- Copy or sync new `*_REPORT.pdf` and `*_TRACES.xlsm` files beneath the configured
  OneDrive folder.
- A missing half appears immediately in **Intake** as `pending_pair`.
- Complete pairs are parsed automatically. Low-confidence or invalid data is quarantined.
- Formal cockpit/compliance KPIs include accepted tests only.
- Corrections with the same test identity replace the active record by hash.
- Editing and approval are allowed only from the host PC; LAN users are read-only.
- Original PDF/XLSM evidence remains in OneDrive and opens from Test Detail.
- Mass-specific results are normalized internally to `mg/km`; users can switch every
  result, target, norm, table and trend between `mg/km` and `g/km`. PN remains `#/km`.
- Trace channels retain their source units from XLSM (`ppm`, `%`, `1/cm³`, `g`, `N`,
  `kW`) and are never incorrectly converted into distance-specific emissions.
- Excel exports include side-by-side `mg/km` and `g/km` columns plus the source unit.

Install automatic macOS startup once with:

```bash
./scripts/install_emlab_startup.sh
```

## Verification

```bash
cd dashboard && npm test && npm run build
cd ..
PYTHONPATH=backend python3 -m unittest discover -s backend/tests -v
```

## Stack

FastAPI · SQLite/WAL · React + Vite + TypeScript · Recharts · pdfjs-dist · SheetJS · Zustand.
