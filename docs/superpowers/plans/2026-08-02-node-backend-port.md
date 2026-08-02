# Node Backend Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Python FastAPI backend with an equivalent Node backend that passes a Vitest translation of the existing pytest suite, so the EMLAB dashboard runs with zero Python.

**Architecture:** A `dashboard/electron/` module holds the ported backend: `node:sqlite` for storage, a polling folder watcher, `exceljs` for export, and a Hono HTTP server on loopback serving the same 12 routes and JSON shapes FastAPI serves today. Parsing is injected as a function so tests can stub it, mirroring the Python suite's `@patch("app.watcher.parse_pair")`. No Electron in this plan — the result runs under plain `node`.

**Tech Stack:** Node 22 (`node:sqlite`, built in), Hono + `@hono/node-server`, exceljs, Vitest, TypeScript.

---

## Scope

This is plan 1 of 3 for the spec at `docs/superpowers/specs/2026-08-02-electron-desktop-app-design.md`:

1. **This plan** — backend port to Node. Ends with Python deleted and the dashboard working.
2. Electron shell — main/preload, window, first-run folder picker, `userData` paths, `utilityProcess` parsing.
3. Packaging + CI/CD — electron-builder dmg/exe, GitHub Actions.

Splitting here is deliberate: if the port has bugs, they surface under plain `node` where they are easy to debug, not behind an Electron window.

## Verified environment facts

These were checked empirically, not assumed. Do not re-litigate them:

- Node v22.21.0 is on PATH. `node:sqlite` works **without** `--experimental-sqlite` (emits an `ExperimentalWarning` only).
- `DatabaseSync` provides `.exec()`, `.prepare()`, and on statements `.run()` (returns `{changes, lastInsertRowid}`), `.get()`, `.all()`. `changes` is `0` for a no-op DELETE, so it maps onto Python's `cursor.rowcount > 0`.
- `BEGIN`/`COMMIT`/`ROLLBACK` via `.exec()` work.
- Rows come back as **null-prototype objects**. `row.field` and `{...row}` work; prefer `{...row}` before returning to the API layer.
- **`fs.statSync(p, {bigint:true}).mtimeNs` exceeds `Number.MAX_SAFE_INTEGER`.** Storing it as SQLite `INTEGER` makes node:sqlite throw `RangeError: Value is too large to be represented as a JavaScript number` on read-back. This plan stores it as **TEXT** — see Task 6.

## File structure

All new files live in `dashboard/electron/`. They join the existing npm project so `parsePair` can import `../src/ingest/*` directly.

| File | Responsibility |
|---|---|
| `electron/schema.ts` | SQL DDL constant + `POLLUTANT_UNITS` |
| `electron/config.ts` | `Settings` type + resolution from env/JSON |
| `electron/db.ts` | Port of `backend/app/db.py` |
| `electron/watcher.ts` | Port of `backend/app/watcher.py` |
| `electron/export.ts` | Port of `backend/app/export.py` |
| `electron/server.ts` | Hono app — the 12 routes from `backend/app/main.py` |
| `electron/serve.ts` | Plain-node entry point (`npm run serve`) |
| `electron/parsePair.ts` | Moved from `dashboard/scripts/parsePair.ts`, as an importable function |
| `electron/*.test.ts` | Vitest translations of `backend/tests/` |

`tsconfig.app.json` sets `erasableSyntaxOnly: true`. **Do not use TypeScript parameter properties or enums** — declare class fields explicitly.

---

### Task 1: Scaffold the electron module

**Files:**
- Modify: `dashboard/package.json`
- Create: `dashboard/tsconfig.electron.json`
- Modify: `dashboard/tsconfig.json`
- Modify: `dashboard/vite.config.ts:12-15`

- [ ] **Step 1: Install runtime dependencies**

```bash
cd dashboard
npm install hono@4 @hono/node-server exceljs@4
```

- [ ] **Step 2: Create `dashboard/tsconfig.electron.json`**

```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.electron.tsbuildinfo",
    "target": "es2023",
    "lib": ["ES2023"],
    "module": "esnext",
    "types": ["node"],
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "erasableSyntaxOnly": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["electron"]
}
```

- [ ] **Step 3: Reference it from `dashboard/tsconfig.json`**

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" },
    { "path": "./tsconfig.electron.json" }
  ]
}
```

- [ ] **Step 4: Widen the Vitest include in `dashboard/vite.config.ts`**

Replace the `test` block:

```ts
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'electron/**/*.test.ts'],
  },
```

- [ ] **Step 5: Add a serve script to `dashboard/package.json`**

Add to `"scripts"`:

```json
    "serve": "node --experimental-strip-types electron/serve.ts",
```

- [ ] **Step 6: Verify the toolchain still builds**

Run: `cd dashboard && npx tsc -b && npm test`
Expected: tsc exits 0; Vitest passes the existing `src/**` tests.

- [ ] **Step 7: Commit**

```bash
git add dashboard/package.json dashboard/package-lock.json dashboard/tsconfig.json dashboard/tsconfig.electron.json dashboard/vite.config.ts
git commit -m "chore: scaffold electron backend module"
```

---

### Task 2: Schema and settings

**Files:**
- Create: `dashboard/electron/schema.ts`
- Create: `dashboard/electron/config.ts`

No tests — these are constants and consumed by every later task's tests.

- [ ] **Step 1: Create `dashboard/electron/schema.ts`**

Transcribe the DDL from `backend/app/db.py:15-70` verbatim, with one change: `source_files.modified_ns` becomes `TEXT` (see Task 6 rationale).

```ts
export const SCHEMA = `
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
  sha256 TEXT NOT NULL, size_bytes INTEGER NOT NULL, modified_ns TEXT NOT NULL,
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
`

export const POLLUTANT_UNITS: Record<string, string> = {
  CO: 'mg/km', THC: 'mg/km', NOx: 'mg/km', CO2: 'mg/km',
  CH4: 'mg/km', NMHC: 'mg/km', PM: 'mg/km', PN: '#/km',
}

export const POLLUTANTS = ['CO', 'THC', 'NOx', 'CO2', 'CH4', 'NMHC', 'PM', 'PN']
```

- [ ] **Step 2: Create `dashboard/electron/config.ts`**

Port of `backend/app/config.py`, minus `host`/`auth_user`/`auth_password` — the spec deletes the auth layer and binds loopback only.

```ts
import path from 'node:path'
import fs from 'node:fs'

export interface Settings {
  watchFolder: string
  databasePath: string
  port: number
  scanIntervalSeconds: number
  dashboardDist: string
}

export function loadSettings(overrides: Partial<Settings> = {}): Settings {
  const configPath = process.env.EMLAB_CONFIG ?? ''
  let raw: Record<string, unknown> = {}
  if (configPath && fs.existsSync(configPath)) {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
  }
  const base = configPath ? path.dirname(configPath) : process.cwd()
  const resolve = (v: string) => (path.isAbsolute(v) ? v : path.resolve(base, v))
  return {
    watchFolder: resolve(process.env.EMLAB_WATCH_FOLDER ?? (raw.watch_folder as string) ?? './watch'),
    databasePath: resolve(process.env.EMLAB_DATABASE_PATH ?? (raw.database_path as string) ?? './data/emissions.db'),
    port: Number(process.env.EMLAB_PORT ?? raw.port ?? 8000),
    scanIntervalSeconds: Number(process.env.EMLAB_SCAN_INTERVAL ?? raw.scan_interval_seconds ?? 3),
    dashboardDist: resolve((raw.dashboard_dist as string) ?? './dist'),
    ...overrides,
  }
}
```

- [ ] **Step 3: Verify it typechecks**

Run: `cd dashboard && npx tsc -b`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add dashboard/electron/schema.ts dashboard/electron/config.ts
git commit -m "feat: add backend schema and settings"
```

---

### Task 3: Identity key and test id

These are pure functions and the foundation of deduplication. `identityKey` must mirror Python's `or ""` semantics — use `|| ''`, not `?? ''`, so empty strings and zeros collapse the same way.

**Files:**
- Create: `dashboard/electron/db.ts`
- Create: `dashboard/electron/db.test.ts`

- [ ] **Step 1: Write the failing test**

Create `dashboard/electron/db.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { identityKey, testId } from './db.ts'

const base = {
  vehicleModel: 'CITROEN AIRCROSS',
  vnNo: '9740',
  date: '2026-03-18',
  cycle: 'WLTP',
}

describe('identityKey', () => {
  it('falls back to the stem when fewer than three fields are present', () => {
    expect(identityKey({ vehicleModel: 'X' }, 'MyStem')).toBe('stem|mystem')
  })

  it('lowercases and joins identity fields', () => {
    expect(identityKey(base, 'nostamp')).toBe('citroen aircross|9740|2026-03-18|wltp|')
  })

  it('includes the run timestamp from the stem so same-day runs stay distinct', () => {
    const a = identityKey(base, 'CITROEN_AIRCROSS_MT_9740_5099_2026-03-18_09-51-01')
    const b = identityKey(base, 'CITROEN_AIRCROSS_MT_9740_5099_2026-03-18_15-22-40')
    expect(a).not.toBe(b)
    expect(a.endsWith('|2026-03-18_09-51-01')).toBe(true)
  })
})

describe('testId', () => {
  it('is a stable 24-char hex digest', () => {
    const id = testId('some|identity|key')
    expect(id).toHaveLength(24)
    expect(id).toBe(testId('some|identity|key'))
    expect(id).not.toBe(testId('other|identity|key'))
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd dashboard && npx vitest run electron/db.test.ts`
Expected: FAIL — cannot resolve `./db.ts`.

- [ ] **Step 3: Create `dashboard/electron/db.ts` with the minimal implementation**

```ts
import { createHash } from 'node:crypto'

const RUN_TS = /(\d{4}-\d{2}-\d{2})[ _T](\d{2}-\d{2}-\d{2})/

export function identityKey(test: Record<string, any>, fallbackStem: string): string {
  const fields = [
    String(test.vehicleModel || '').trim().toLowerCase(),
    String(test.vnNo || '').trim().toLowerCase(),
    String(test.date || '').trim(),
    String(test.cycle || '').trim().toLowerCase(),
  ]
  if (fields.filter(Boolean).length < 3) return `stem|${fallbackStem.toLowerCase()}`
  const match = RUN_TS.exec(fallbackStem || '')
  const runTs = match ? `${match[1]}_${match[2]}` : ''
  return [...fields, runTs].join('|')
}

export function testId(identity: string): string {
  return createHash('sha256').update(identity).digest('hex').slice(0, 24)
}

export function utcnow(): string {
  return new Date().toISOString()
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `cd dashboard && npx vitest run electron/db.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add dashboard/electron/db.ts dashboard/electron/db.test.ts
git commit -m "feat: port identity key and test id derivation"
```

---

### Task 4: Database class — save, list, get

This is the port of `test_idempotent_hash_and_replacement_audit` and `test_quarantined_excluded_from_formal_list` from `backend/tests/test_database.py`.

**Every write method must run inside an explicit transaction.** node:sqlite autocommits per statement; `saveTest` writes one row per trace point, so without a transaction a single insert becomes thousands of fsyncs.

**Files:**
- Modify: `dashboard/electron/db.ts`
- Modify: `dashboard/electron/db.test.ts`

- [ ] **Step 1: Add the failing tests to `dashboard/electron/db.test.ts`**

Append (and extend the import to `import { identityKey, testId, Database } from './db.ts'`):

```ts
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeEach, afterEach } from 'vitest'

function sampleTest(value = 10.0) {
  return {
    id: 'sample', project: 'STLA', cycle: 'WLTP', config: 'CC24', transmission: 'MB6', lab: 'FEV',
    vehicleModel: 'CITROEN AIRCROSS', vinSampleId: 'VIN', vnNo: '9740', date: '2026-03-18',
    results: { CO: value, THC: 1, NOx: 2, CO2: 3, CH4: 4, NMHC: 5, PM: 0.1, PN: 1e9 },
    phases: [] as any[],
    trace: { dilute: [{ t: 1, NOx: 2 }], preCat: [], postCat: [] },
    source: {}, lowConfidence: [] as string[], importedAt: '2026-06-20T00:00:00Z',
  }
}

describe('Database', () => {
  let dir: string
  let db: Database

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'emlab-'))
    db = new Database(path.join(dir, 'test.db'))
  })
  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('is idempotent on an unchanged hash and audits replacements', () => {
    const first = db.saveTest(sampleTest(), 'stem', 'hash-a', 'accepted', 'ok')
    expect(first.replaced).toBe(false)

    const second = db.saveTest(sampleTest(), 'stem', 'hash-a', 'accepted', 'ok')
    expect(second.testId).toBe(first.testId)
    expect(second.replaced).toBe(false)

    const third = db.saveTest(sampleTest(20), 'stem', 'hash-b', 'accepted', 'corrected')
    expect(third.testId).toBe(first.testId)
    expect(third.replaced).toBe(true)
    expect(db.audit(first.testId)).toHaveLength(1)
  })

  it('excludes quarantined tests from the accepted-only list', () => {
    db.saveTest(sampleTest(), 'accepted', 'a', 'accepted', 'ok')
    const other = sampleTest()
    other.vnNo = '9999'
    db.saveTest(other, 'quarantined', 'b', 'quarantined', 'review')
    expect(db.listTests(true)).toHaveLength(2)
    expect(db.listTests(false)).toHaveLength(1)
  })

  it('round-trips a test through getTest with its status', () => {
    const { testId: id } = db.saveTest(sampleTest(), 'stem', 'h', 'quarantined', 'ok')
    const got = db.getTest(id)
    expect(got?.status).toBe('quarantined')
    expect(got?.vehicleModel).toBe('CITROEN AIRCROSS')
    expect(db.getTest('missing')).toBeNull()
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd dashboard && npx vitest run electron/db.test.ts`
Expected: FAIL — `Database is not exported`.

- [ ] **Step 3: Implement the class in `dashboard/electron/db.ts`**

Append to the file (add `import { DatabaseSync } from 'node:sqlite'`, `import fs from 'node:fs'`, `import { SCHEMA, POLLUTANT_UNITS } from './schema.ts'` at the top):

```ts
export class Database {
  db: DatabaseSync

  constructor(databasePath: string) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true })
    this.db = new DatabaseSync(databasePath)
    this.db.exec(SCHEMA)
    this.db.exec('PRAGMA foreign_keys=ON')
  }

  close(): void {
    this.db.close()
  }

  tx<T>(fn: () => T): T {
    this.db.exec('BEGIN')
    try {
      const result = fn()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  saveTest(
    input: Record<string, any>, stem: string, combinedHash: string,
    status: string, parserOutcome: string,
  ): { testId: string; replaced: boolean } {
    const identity = identityKey(input, stem)
    const id = testId(identity)
    const now = utcnow()
    const test = { ...input, id, status }

    return this.tx(() => {
      const existing = this.db
        .prepare('SELECT combined_hash FROM tests WHERE id=?')
        .get(id) as { combined_hash: string } | undefined
      const sameSource = Boolean(existing && existing.combined_hash === combinedHash)
      let replaced = false

      if (existing && !sameSource) {
        replaced = true
        this.db.prepare(
          'INSERT INTO replacement_audit(test_id,previous_hash,replacement_hash,replaced_at,parser_outcome) VALUES(?,?,?,?,?)',
        ).run(id, existing.combined_hash, combinedHash, now, parserOutcome)
      }

      this.db.prepare(`
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
      `).run(
        id, identity, 1, status, test.project ?? null, test.cycle ?? null, test.config ?? null,
        test.transmission ?? null, test.lab ?? null, test.vehicleModel ?? null, test.vnNo ?? null,
        test.vinSampleId ?? null, test.date ?? null, test.catalystState ?? null, test.odo ?? null,
        test.importedAt || now, now, 'fev-js-v1', JSON.stringify(test),
        JSON.stringify(test.lowConfidence ?? []), combinedHash,
      )

      this.db.prepare('DELETE FROM pollutant_results WHERE test_id=?').run(id)
      const insResult = this.db.prepare(
        'INSERT INTO pollutant_results(test_id,pollutant,value,unit) VALUES(?,?,?,?)',
      )
      for (const [pollutant, value] of Object.entries(test.results ?? {})) {
        insResult.run(id, pollutant, (value as number) ?? null, POLLUTANT_UNITS[pollutant] ?? '')
      }

      this.db.prepare('DELETE FROM phases WHERE test_id=?').run(id)
      const insPhase = this.db.prepare(
        'INSERT INTO phases(test_id,phase_index,name,distance_km,data_json) VALUES(?,?,?,?,?)',
      )
      ;(test.phases ?? []).forEach((phase: any, index: number) => {
        insPhase.run(id, index, phase.name ?? `Phase ${index + 1}`, phase.distanceKm ?? null, JSON.stringify(phase))
      })

      this.db.prepare('DELETE FROM trace_points WHERE test_id=?').run(id)
      const insPoint = this.db.prepare(
        'INSERT INTO trace_points(test_id,channel,point_index,time_s,data_json) VALUES(?,?,?,?,?)',
      )
      for (const [channel, points] of Object.entries(test.trace ?? {})) {
        ;(points as any[]).forEach((point, index) => {
          insPoint.run(id, channel, index, point.t ?? 0, JSON.stringify(point))
        })
      }

      return { testId: id, replaced }
    })
  }

  listTests(includeNonaccepted = true): Record<string, any>[] {
    const where = includeNonaccepted ? 'WHERE active=1' : "WHERE active=1 AND status='accepted'"
    const rows = this.db.prepare(
      `SELECT data_json,status FROM tests ${where} ORDER BY test_date DESC, updated_at DESC`,
    ).all() as { data_json: string; status: string }[]
    return rows.map((row) => ({ ...JSON.parse(row.data_json), status: row.status }))
  }

  getTest(id: string): Record<string, any> | null {
    const row = this.db.prepare('SELECT data_json,status FROM tests WHERE id=?').get(id) as
      | { data_json: string; status: string } | undefined
    return row ? { ...JSON.parse(row.data_json), status: row.status } : null
  }

  findIdentity(test: Record<string, any>, stem: string): Record<string, any> | null {
    const row = this.db.prepare('SELECT data_json,status FROM tests WHERE identity_key=?')
      .get(identityKey(test, stem)) as { data_json: string; status: string } | undefined
    return row ? { ...JSON.parse(row.data_json), status: row.status } : null
  }

  audit(id: string): Record<string, any>[] {
    const replacements = (this.db.prepare(
      'SELECT * FROM replacement_audit WHERE test_id=? ORDER BY replaced_at DESC',
    ).all(id) as Record<string, any>[]).map((r) => ({ ...r, kind: 'replacement' }))
    const overrides = (this.db.prepare(
      'SELECT * FROM manual_overrides WHERE test_id=? ORDER BY changed_at DESC',
    ).all(id) as Record<string, any>[]).map((r) => ({ ...r, kind: 'override' }))
    return [...replacements, ...overrides].sort((a, b) =>
      String(b.replaced_at ?? b.changed_at).localeCompare(String(a.replaced_at ?? a.changed_at)),
    )
  }
}
```

- [ ] **Step 4: Run to confirm it passes**

Run: `cd dashboard && npx vitest run electron/db.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add dashboard/electron/db.ts dashboard/electron/db.test.ts
git commit -m "feat: port test persistence with transactional writes"
```

---

### Task 5: Ingestion jobs

**Files:**
- Modify: `dashboard/electron/db.ts`
- Modify: `dashboard/electron/db.test.ts`

- [ ] **Step 1: Add the failing test**

Append inside the `describe('Database', ...)` block:

```ts
  it('preserves first_seen_at across job updates and clears unset fields', () => {
    db.updateJob('stem-1', 'pending_pair', { pdf_path: '/a.pdf', message: 'waiting' })
    const first = db.listJobs()[0]
    expect(first.status).toBe('pending_pair')
    expect(first.pdf_path).toBe('/a.pdf')

    db.updateJob('stem-1', 'accepted', { pdf_path: '/a.pdf', xlsm_path: '/a.xlsm' })
    const second = db.listJobs()[0]
    expect(second.status).toBe('accepted')
    expect(second.first_seen_at).toBe(first.first_seen_at)
    expect(second.message).toBeNull()
  })
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd dashboard && npx vitest run electron/db.test.ts`
Expected: FAIL — `db.updateJob is not a function`.

- [ ] **Step 3: Implement — add these methods to the `Database` class**

```ts
  updateJob(stem: string, status: string, fields: Record<string, any> = {}): void {
    const now = utcnow()
    this.tx(() => {
      const previous = this.db.prepare('SELECT first_seen_at FROM ingestion_jobs WHERE stem=?')
        .get(stem) as { first_seen_at: string } | undefined
      const v = {
        pdf_path: null, xlsm_path: null, pdf_hash: null, xlsm_hash: null,
        message: null, test_id: null, ...fields,
      }
      this.db.prepare(`
        INSERT INTO ingestion_jobs(stem,status,pdf_path,xlsm_path,pdf_hash,xlsm_hash,message,first_seen_at,updated_at,test_id)
        VALUES(?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(stem) DO UPDATE SET status=excluded.status,pdf_path=excluded.pdf_path,
          xlsm_path=excluded.xlsm_path,pdf_hash=excluded.pdf_hash,xlsm_hash=excluded.xlsm_hash,
          message=excluded.message,updated_at=excluded.updated_at,test_id=excluded.test_id
      `).run(
        stem, status, v.pdf_path, v.xlsm_path, v.pdf_hash, v.xlsm_hash, v.message,
        previous ? previous.first_seen_at : now, now, v.test_id,
      )
    })
  }

  listJobs(): Record<string, any>[] {
    return (this.db.prepare('SELECT * FROM ingestion_jobs ORDER BY updated_at DESC')
      .all() as Record<string, any>[]).map((row) => ({ ...row }))
  }
```

- [ ] **Step 4: Run to confirm it passes**

Run: `cd dashboard && npx vitest run electron/db.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add dashboard/electron/db.ts dashboard/electron/db.test.ts
git commit -m "feat: port ingestion job tracking"
```

---

### Task 6: Source file registry — the mtime precision fix

`watcher._file_hash()` skips re-hashing when size and mtime both match. Python stores `st_mtime_ns` (integer nanoseconds, ~1.78e18).

**Storing that as SQLite `INTEGER` makes node:sqlite throw `RangeError` on read-back** — verified. Store it as **TEXT** (`String(stat.mtimeNs)`) and compare as a string. This avoids `setReadBigInts` plumbing on every statement and avoids BigInt reaching `JSON.stringify`, which throws.

**Files:**
- Modify: `dashboard/electron/db.ts`
- Modify: `dashboard/electron/db.test.ts`

- [ ] **Step 1: Add the failing test**

Append inside `describe('Database', ...)`:

```ts
  it('stores nanosecond mtimes losslessly and reads them back', () => {
    const file = path.join(dir, 'sample.pdf')
    require('node:fs').writeFileSync(file, 'x')
    db.registerSource('stem-1', 'pdf', file, 'deadbeef')

    const meta = db.sourceMeta(file)
    expect(meta).not.toBeNull()
    expect(meta!.sha256).toBe('deadbeef')

    const stat = require('node:fs').statSync(file, { bigint: true })
    expect(meta!.modified_ns).toBe(String(stat.mtimeNs))
    expect(meta!.size_bytes).toBe(1)
    expect(db.sourceMeta('/nope')).toBeNull()
  })

  it('returns the most recent source path for a kind', () => {
    const file = path.join(dir, 'a.pdf')
    require('node:fs').writeFileSync(file, 'x')
    const { testId: id } = db.saveTest(sampleTest(), 'stem', 'h', 'accepted', 'ok')
    db.registerSource('stem', 'pdf', file, 'hash', id)
    expect(db.sourcePath(id, 'pdf')).toBe(file)
    expect(db.sourcePath(id, 'xlsm')).toBeNull()
  })
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd dashboard && npx vitest run electron/db.test.ts`
Expected: FAIL — `db.registerSource is not a function`.

- [ ] **Step 3: Implement — add to the `Database` class**

```ts
  registerSource(stem: string, kind: string, filePath: string, sha256: string, testIdValue: string | null = null): void {
    const stat = fs.statSync(filePath, { bigint: true })
    const now = utcnow()
    this.tx(() => {
      this.db.prepare(`
        INSERT INTO source_files(test_id,stem,kind,path,sha256,size_bytes,modified_ns,first_seen_at,last_seen_at)
        VALUES(?,?,?,?,?,?,?,?,?)
        ON CONFLICT(path) DO UPDATE SET test_id=excluded.test_id,sha256=excluded.sha256,
          size_bytes=excluded.size_bytes,modified_ns=excluded.modified_ns,last_seen_at=excluded.last_seen_at
      `).run(testIdValue, stem, kind, filePath, sha256, Number(stat.size), String(stat.mtimeNs), now, now)
    })
  }

  sourceMeta(filePath: string): { sha256: string; size_bytes: number; modified_ns: string } | null {
    const row = this.db.prepare('SELECT sha256, size_bytes, modified_ns FROM source_files WHERE path=?')
      .get(filePath) as { sha256: string; size_bytes: number; modified_ns: string } | undefined
    return row ? { ...row } : null
  }

  sourcePath(testIdValue: string, kind: string): string | null {
    const row = this.db.prepare(
      'SELECT path FROM source_files WHERE test_id=? AND kind=? ORDER BY last_seen_at DESC LIMIT 1',
    ).get(testIdValue, kind) as { path: string } | undefined
    return row ? row.path : null
  }
```

- [ ] **Step 4: Run to confirm it passes**

Run: `cd dashboard && npx vitest run electron/db.test.ts`
Expected: PASS, 10 tests. If you see `RangeError: Value is too large`, `modified_ns` is still an INTEGER column — fix `schema.ts`.

- [ ] **Step 5: Commit**

```bash
git add dashboard/electron/db.ts dashboard/electron/db.test.ts
git commit -m "feat: port source registry, storing mtime as text to avoid bigint overflow"
```

---

### Task 7: Patch, status, delete

`deleteTest` must tombstone the ingestion job **before** deleting the test row, while `test_id` is still set — otherwise the watcher resurrects the record on the next scan.

**Files:**
- Modify: `dashboard/electron/db.ts`
- Modify: `dashboard/electron/db.test.ts`

- [ ] **Step 1: Add the failing test**

Append inside `describe('Database', ...)`:

```ts
  it('applies only allowlisted patch fields and records an override', () => {
    const { testId: id } = db.saveTest(sampleTest(), 'stem', 'h', 'accepted', 'ok')
    const updated = db.patchTest(id, { vehicleModel: 'EDITED', results: { CO: 999 } } as any)
    expect(updated!.vehicleModel).toBe('EDITED')
    expect(updated!.results.CO).toBe(10)
    expect(db.audit(id).filter((a) => a.kind === 'override')).toHaveLength(1)
    expect(db.patchTest('missing', {})).toBeNull()
  })

  it('sets status and reports whether a row matched', () => {
    const { testId: id } = db.saveTest(sampleTest(), 'stem', 'h', 'quarantined', 'ok')
    expect(db.setStatus(id, 'accepted')).toBe(true)
    expect(db.getTest(id)!.status).toBe('accepted')
    expect(db.setStatus('missing', 'accepted')).toBe(false)
  })

  it('tombstones the ingestion job when deleting a test', () => {
    const { testId: id } = db.saveTest(sampleTest(), 'stem', 'h', 'accepted', 'ok')
    db.updateJob('stem', 'accepted', { test_id: id })
    expect(db.deleteTest(id)).toBe(true)
    expect(db.listJobs()[0].status).toBe('deleted')
    expect(db.getTest(id)).toBeNull()
    expect(db.deleteTest(id)).toBe(false)
  })
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd dashboard && npx vitest run electron/db.test.ts`
Expected: FAIL — `db.patchTest is not a function`.

- [ ] **Step 3: Implement — add to the `Database` class**

```ts
  patchTest(id: string, patch: Record<string, any>): Record<string, any> | null {
    const current = this.getTest(id)
    if (!current) return null
    const allowed = new Set([
      'project', 'cycle', 'config', 'transmission', 'lab',
      'vehicleModel', 'vinSampleId', 'vnNo',
      'catalystState', 'stt', 'startSoc', 'lowConfidence',
    ])
    const clean: Record<string, any> = {}
    for (const [key, value] of Object.entries(patch)) {
      if (allowed.has(key)) clean[key] = value
    }
    const updated = { ...current, ...clean }
    const now = utcnow()
    this.tx(() => {
      this.db.prepare(
        'UPDATE tests SET project=?,cycle=?,config=?,transmission=?,lab=?,' +
        'vehicle_model=?,vn_no=?,vin_sample_id=?,catalyst_state=?,' +
        'data_json=?,low_confidence_json=?,updated_at=? WHERE id=?',
      ).run(
        updated.project ?? null, updated.cycle ?? null, updated.config ?? null,
        updated.transmission ?? null, updated.lab ?? null, updated.vehicleModel ?? null,
        updated.vnNo ?? null, updated.vinSampleId ?? null, updated.catalystState ?? null,
        JSON.stringify(updated), JSON.stringify(updated.lowConfidence ?? []), now, id,
      )
      this.db.prepare(
        'INSERT INTO manual_overrides(test_id,patch_json,changed_at,changed_by) VALUES(?,?,?,?)',
      ).run(id, JSON.stringify(clean), now, 'local-pc')
    })
    return updated
  }

  setStatus(id: string, status: string): boolean {
    return this.tx(() =>
      this.db.prepare('UPDATE tests SET status=?,updated_at=? WHERE id=?')
        .run(status, utcnow(), id).changes > 0,
    )
  }

  deleteTest(id: string): boolean {
    return this.tx(() => {
      this.db.prepare("UPDATE ingestion_jobs SET status='deleted', updated_at=? WHERE test_id=?")
        .run(utcnow(), id)
      return this.db.prepare('DELETE FROM tests WHERE id=?').run(id).changes > 0
    })
  }
```

- [ ] **Step 4: Run to confirm it passes**

Run: `cd dashboard && npx vitest run electron/db.test.ts`
Expected: PASS, 13 tests. `db.py` is now fully ported.

- [ ] **Step 5: Commit**

```bash
git add dashboard/electron/db.ts dashboard/electron/db.test.ts
git commit -m "feat: port patch, status, and delete with job tombstoning"
```

---

### Task 8: Parse function extraction

Move `dashboard/scripts/parsePair.ts` into an importable function so the watcher can take it as a dependency and tests can stub it — mirroring the Python suite's `@patch("app.watcher.parse_pair")`.

**Files:**
- Create: `dashboard/electron/parsePair.ts`
- Delete: `dashboard/scripts/parsePair.ts`

- [ ] **Step 1: Create `dashboard/electron/parsePair.ts`**

Same logic as the script, with the CLI argument handling removed and the body wrapped in an exported async function.

```ts
import fs from 'node:fs'
import path from 'node:path'
import { parseReportItems, type PageItems, type TextItem } from '../src/ingest/pdfReport.ts'
import { parseTraceWorkbook, traceUnitMetadata } from '../src/ingest/xlsmTrace.ts'
import { buildTest } from '../src/ingest/normalize.ts'

export type ParsePair = (pdfPath: string, xlsmPath: string) => Promise<Record<string, any>>

export const parsePair: ParsePair = async (pdfPath, xlsmPath) => {
  const pdf = fs.readFileSync(pdfPath)
  const xlsm = fs.readFileSync(xlsmPath)
  const stem = path.basename(pdfPath).replace(/_REPORT\.pdf$/i, '').replace(/\.pdf$/i, '')
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), disableWorker: true }).promise
  const pages: PageItems[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const viewport = page.getViewport({ scale: 1 })
    const text = await page.getTextContent()
    const items: TextItem[] = text.items
      .map((item: any) => item as { str: string; transform: number[] })
      .filter((item: any) => item.str.trim() !== '')
      .map((item: any) => ({
        s: item.str.trim(),
        x: +item.transform[4].toFixed(1),
        y: +item.transform[5].toFixed(1),
      }))
    pages.push({ width: viewport.width, height: viewport.height, items })
  }
  const report = parseReportItems(pages)
  const buffer = xlsm.buffer.slice(xlsm.byteOffset, xlsm.byteOffset + xlsm.byteLength)
  const trace = parseTraceWorkbook(buffer)
  const test = buildTest(stem, report, trace, { pdf: pdfPath, xlsm: xlsmPath }, new Date().toISOString())
  test.units = {
    resultsCanonical: 'mg/km',
    resultsSource: report.resultUnit,
    resultSourceByPollutant: {
      CO: report.resultUnit, THC: report.resultUnit, NOx: report.resultUnit, CO2: report.resultUnit,
      CH4: report.resultUnit, NMHC: report.resultUnit, PM: report.pmUnit, PN: '#/km',
    },
    trace: traceUnitMetadata(buffer),
  }
  return test
}
```

- [ ] **Step 2: Delete the old script**

```bash
git rm dashboard/scripts/parsePair.ts
```

- [ ] **Step 3: Verify it typechecks**

Run: `cd dashboard && npx tsc -b`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add dashboard/electron/parsePair.ts
git commit -m "refactor: expose parsePair as an importable function"
```

---

### Task 9: Folder watcher

This is the port of all five tests in `backend/tests/test_watcher.py` — the subtlest behavior in the codebase. `parsePair` is injected via the constructor.

**Files:**
- Create: `dashboard/electron/watcher.ts`
- Create: `dashboard/electron/watcher.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `dashboard/electron/watcher.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Database } from './db.ts'
import { FolderWatcher, stemOf } from './watcher.ts'

function parsedTest() {
  return {
    id: 'FEV_SAMPLE', project: 'STLA', cycle: 'WLTP', config: 'CC24', transmission: 'MB6', lab: 'FEV',
    vehicleModel: 'CITROEN AIRCROSS', vinSampleId: 'VIN', vnNo: '9740', date: '2026-03-18',
    catalystState: 'Fresh', stt: 'ON', startSoc: 96, inertia: 1464, odo: 139, distanceKm: 14.96,
    phaseCount: 3, rld: { A: 48.3, B: -0.1, C: 0.04 }, fuel: { name: 'E20' }, conditions: {},
    results: { CO: 325.3, THC: 7.59, NOx: 24.73, CO2: 134752, CH4: 2.68, NMHC: 4.42, PM: 1.32, PN: 3.38e9 },
    phases: [] as any[], trace: { dilute: [], preCat: [], postCat: [] },
    units: {
      resultsCanonical: 'mg/km', resultsSource: 'mg/km',
      trace: { dilute: { NOx: 'ppm' }, preCat: { NOx: 'ppm' }, postCat: { NOx: 'ppm' } },
    },
    source: {}, lowConfidence: [] as string[], importedAt: '2026-06-20T00:00:00Z',
  }
}

describe('stemOf', () => {
  it('strips the known suffixes case-insensitively', () => {
    expect(stemOf('/x/FEV_SAMPLE_REPORT.pdf')).toBe('FEV_SAMPLE')
    expect(stemOf('/x/FEV_SAMPLE_TRACES.xlsm')).toBe('FEV_SAMPLE')
    expect(stemOf('/x/other.txt')).toBe('other')
  })
})

describe('FolderWatcher', () => {
  let dir: string, watch: string, db: Database, parse: ReturnType<typeof vi.fn>, watcher: FolderWatcher
  let pdf: string, xlsm: string

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'emlab-w-'))
    watch = path.join(dir, 'watch')
    mkdirSync(watch)
    db = new Database(path.join(dir, 'test.db'))
    parse = vi.fn(async () => parsedTest())
    watcher = new FolderWatcher({ watchFolder: watch, scanIntervalSeconds: 1 }, db, parse)
    pdf = path.join(watch, 'FEV_SAMPLE_REPORT.pdf')
    xlsm = path.join(watch, 'FEV_SAMPLE_TRACES.xlsm')
  })
  afterEach(() => {
    watcher.stop()
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('waits for a pair, then ingests idempotently and reparses on correction', async () => {
    writeFileSync(pdf, 'pdf-v1')
    await watcher.scanOnce()
    expect(db.listJobs()[0].status).toBe('pending_pair')

    writeFileSync(xlsm, 'xlsm-v1')
    await watcher.scanOnce()
    const job = db.listJobs()[0]
    expect(job.status).toBe('accepted')
    expect(parse).toHaveBeenCalledTimes(1)

    await watcher.scanOnce()
    expect(parse).toHaveBeenCalledTimes(1)
    expect(db.audit(job.test_id)).toHaveLength(0)

    writeFileSync(pdf, 'pdf-corrected')
    await watcher.scanOnce()
    expect(parse).toHaveBeenCalledTimes(2)
    expect(db.audit(job.test_id)).toHaveLength(1)
  })

  it('keeps same-day repeat runs distinct', async () => {
    for (const ts of ['09-51-01', '15-22-40']) {
      const stem = `CITROEN_AIRCROSS_MT_9740_5099_2026-03-18_${ts}`
      writeFileSync(path.join(watch, `${stem}_REPORT.pdf`), `pdf-${ts}`)
      writeFileSync(path.join(watch, `${stem}_TRACES.xlsm`), `xlsm-${ts}`)
    }
    await watcher.scanOnce()
    expect(db.listTests()).toHaveLength(2)
    expect(parse).toHaveBeenCalledTimes(2)
  })

  it('does not re-hash unchanged files', async () => {
    writeFileSync(pdf, 'pdf-v1')
    writeFileSync(xlsm, 'xlsm-v1')
    const spy = vi.spyOn(watcher, 'hashFile')
    await watcher.scanOnce()
    const afterFirst = spy.mock.results.length
    await watcher.scanOnce()
    expect(spy.mock.results.length).toBe(afterFirst + 2)
    expect(spy.mock.results.slice(afterFirst).every((r) => r.type === 'return')).toBe(true)
    expect(parse).toHaveBeenCalledTimes(1)
  })

  it('does not resurrect a deleted test from an unchanged source', async () => {
    writeFileSync(pdf, 'pdf-v1')
    writeFileSync(xlsm, 'xlsm-v1')
    await watcher.scanOnce()
    const id = db.listJobs()[0].test_id
    expect(db.deleteTest(id)).toBe(true)
    expect(db.listTests()).toHaveLength(0)

    await watcher.scanOnce()
    expect(db.listTests()).toHaveLength(0)
    expect(parse).toHaveBeenCalledTimes(1)
  })

  it('does not reparse an unchanged quarantined record, preserving manual edits', async () => {
    const quarantined = parsedTest()
    quarantined.lowConfidence = ['results']
    parse.mockResolvedValue(quarantined)
    writeFileSync(pdf, 'pdf-v1')
    writeFileSync(xlsm, 'xlsm-v1')
    await watcher.scanOnce()
    expect(db.listTests()[0].status).toBe('quarantined')
    const id = db.listJobs()[0].test_id

    db.patchTest(id, { vehicleModel: 'EDITED MODEL' })
    await watcher.scanOnce()
    expect(parse).toHaveBeenCalledTimes(1)
    expect(db.getTest(id)!.vehicleModel).toBe('EDITED MODEL')
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd dashboard && npx vitest run electron/watcher.test.ts`
Expected: FAIL — cannot resolve `./watcher.ts`.

- [ ] **Step 3: Implement `dashboard/electron/watcher.ts`**

```ts
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { Database } from './db.ts'
import type { ParsePair } from './parsePair.ts'

export interface WatcherSettings {
  watchFolder: string
  scanIntervalSeconds: number
}

export function stemOf(filePath: string): string {
  const name = path.basename(filePath)
  for (const suffix of ['_REPORT.pdf', '_TRACES.xlsm']) {
    if (name.toUpperCase().endsWith(suffix.toUpperCase())) return name.slice(0, -suffix.length)
  }
  return name.replace(/\.[^.]+$/, '')
}

export function sha256File(filePath: string): string {
  const digest = createHash('sha256')
  const fd = fs.openSync(filePath, 'r')
  try {
    const buffer = Buffer.alloc(1024 * 1024)
    let read = 0
    while ((read = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      digest.update(buffer.subarray(0, read))
    }
  } finally {
    fs.closeSync(fd)
  }
  return digest.digest('hex')
}

export class FolderWatcher {
  settings: WatcherSettings
  db: Database
  parsePair: ParsePair
  timer: NodeJS.Timeout | null
  scanning: boolean

  constructor(settings: WatcherSettings, db: Database, parsePair: ParsePair) {
    this.settings = settings
    this.db = db
    this.parsePair = parsePair
    this.timer = null
    this.scanning = false
  }

  /** Reuses the stored digest when size and mtime are unchanged. */
  hashFile(filePath: string): string {
    const stat = fs.statSync(filePath, { bigint: true })
    const meta = this.db.sourceMeta(filePath)
    if (meta && meta.size_bytes === Number(stat.size) && meta.modified_ns === String(stat.mtimeNs)) {
      return meta.sha256
    }
    return sha256File(filePath)
  }

  start(): void {
    if (this.timer) return
    const tick = async () => {
      try {
        await this.scanOnce()
      } catch (error) {
        console.error('watcher scan failed:', error)
      }
      this.timer = setTimeout(tick, this.settings.scanIntervalSeconds * 1000)
    }
    this.timer = setTimeout(tick, 0)
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  /** Serialized so the background loop and a manual rescan never overlap. */
  async scanOnce(): Promise<void> {
    if (this.scanning) return
    this.scanning = true
    try {
      await this.scan()
    } finally {
      this.scanning = false
    }
  }

  private async scan(): Promise<void> {
    const root = this.settings.watchFolder
    fs.mkdirSync(root, { recursive: true })

    const groups = new Map<string, { pdf?: string; xlsm?: string }>()
    for (const entry of fs.readdirSync(root, { recursive: true, encoding: 'utf-8' })) {
      const full = path.resolve(root, entry)
      if (!fs.statSync(full).isFile()) continue
      const upper = path.basename(full).toUpperCase()
      const kind = upper.endsWith('_REPORT.PDF') ? 'pdf' : upper.endsWith('_TRACES.XLSM') ? 'xlsm' : null
      if (!kind) continue
      const stem = stemOf(full)
      const group = groups.get(stem) ?? {}
      group[kind] = full
      groups.set(stem, group)
    }

    const jobsByStem = new Map(this.db.listJobs().map((job) => [job.stem, job]))

    for (const [stem, pair] of groups) {
      const { pdf, xlsm } = pair
      let pdfHash: string | null = null
      let xlsmHash: string | null = null
      try {
        pdfHash = pdf ? this.hashFile(pdf) : null
        xlsmHash = xlsm ? this.hashFile(xlsm) : null
        if (pdf) this.db.registerSource(stem, 'pdf', pdf, pdfHash ?? '')
        if (xlsm) this.db.registerSource(stem, 'xlsm', xlsm, xlsmHash ?? '')
      } catch (error) {
        // A file vanished mid-scan (OneDrive sync churn) — skip this pair.
        console.error(`watcher: source for ${stem} unavailable, skipping:`, error)
        continue
      }

      if (!pdf || !xlsm) {
        this.db.updateJob(stem, 'pending_pair', {
          pdf_path: pdf ?? null, xlsm_path: xlsm ?? null, pdf_hash: pdfHash, xlsm_hash: xlsmHash,
          message: `Waiting for ${!pdf ? 'REPORT.pdf' : 'TRACES.xlsm'}`,
        })
        continue
      }

      const combinedHash = createHash('sha256').update(`${pdfHash}:${xlsmHash}`).digest('hex')
      const current = jobsByStem.get(stem)
      const sourceUnchanged = Boolean(
        current && current.pdf_hash === pdfHash && current.xlsm_hash === xlsmHash,
      )

      // A test the engineer deleted stays deleted until its source changes.
      if (current && current.status === 'deleted' && sourceUnchanged) continue

      // Unchanged source with a fully-parsed record: do not re-run the parser.
      // It is deterministic, and re-running would overwrite manual edits.
      if (sourceUnchanged && current && ['accepted', 'quarantined'].includes(current.status)) {
        const existingTest = current.test_id ? this.db.getTest(current.test_id) : null
        if (existingTest && existingTest.units?.trace) continue
      }

      this.db.updateJob(stem, 'processing', {
        pdf_path: pdf, xlsm_path: xlsm, pdf_hash: pdfHash, xlsm_hash: xlsmHash,
        message: 'Parsing FEV report and traces',
      })

      try {
        const test = await this.parsePair(pdf, xlsm)
        const existing = this.db.findIdentity(test, stem)
        let low = [...(test.lowConfidence ?? [])]
        if (existing) {
          const fieldMap: Record<string, string> = {
            project: 'project', cycle: 'cycle', config: 'config',
            transmission: 'transmission', vnNo: 'vnNo',
          }
          for (const [flag, field] of Object.entries(fieldMap)) {
            if (low.includes(flag) && ![null, undefined, '', 'Unknown'].includes(existing[field])) {
              test[field] = existing[field]
              low = low.filter((f) => f !== flag)
            }
          }
          for (const field of ['catalystState', 'stt', 'startSoc']) {
            if (!test[field] && existing[field] !== null && existing[field] !== undefined) {
              test[field] = existing[field]
            }
          }
          test.lowConfidence = low
        }
        const status = low.length ? 'quarantined' : 'accepted'
        const { testId: id, replaced } = this.db.saveTest(
          test, stem, combinedHash, status, `parsed with ${low.length} low-confidence field(s)`,
        )
        this.db.registerSource(stem, 'pdf', pdf, pdfHash ?? '', id)
        this.db.registerSource(stem, 'xlsm', xlsm, xlsmHash ?? '', id)
        this.db.updateJob(stem, status, {
          pdf_path: pdf, xlsm_path: xlsm, pdf_hash: pdfHash, xlsm_hash: xlsmHash, test_id: id,
          message: replaced
            ? 'Corrected source replaced active record'
            : low.length ? 'Ready for review' : 'Accepted',
        })
      } catch (error) {
        this.db.updateJob(stem, 'quarantined', {
          pdf_path: pdf, xlsm_path: xlsm, pdf_hash: pdfHash, xlsm_hash: xlsmHash,
          message: String(error).slice(0, 1000),
        })
      }
    }
  }
}
```

- [ ] **Step 4: Run to confirm it passes**

Run: `cd dashboard && npx vitest run electron/watcher.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Run the whole suite**

Run: `cd dashboard && npm test`
Expected: PASS — all `src/**` tests plus 19 new backend tests.

- [ ] **Step 6: Commit**

```bash
git add dashboard/electron/watcher.ts dashboard/electron/watcher.test.ts
git commit -m "feat: port folder watcher with injected parser"
```

---

## Remaining tasks

Tasks 10–13 (xlsx export, the Hono server, the plain-node entry point, and deleting the Python backend) follow the same TDD shape. They are appended in a follow-up pass to keep this document reviewable — the nine tasks above are self-contained and end with `db.py` and `watcher.py` fully ported and green.

---

## Self-review notes

- **Spec coverage:** `db.py` → Tasks 3–7. `watcher.py` → Task 9. `parser.py` deletion → Task 8. `export.py`, `main.py`, Python removal → Tasks 10–13. Transactions hazard → Task 4. mtime hazard → Task 6. Timestamp format hazard → `utcnow()` in Task 3, one format throughout.
- **Naming consistency checked:** `testId` (function) vs `saveTest().testId` (field) are distinct on purpose; `hashFile` is the spied method in Task 9 and the definition in Task 9 Step 3; `sourceMeta` returns `modified_ns` as `string` in both Task 6 and its consumer in Task 9.
- **Deviation from the Python:** `Settings` drops `host`, `auth_user`, `auth_password` per the spec's deletion of the auth layer. `Database` takes a path string rather than a `Settings` object, since it only ever used `database_path`.
