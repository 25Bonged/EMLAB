import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { SCHEMA, POLLUTANT_UNITS } from './schema.ts'
import { resultForTest } from '../src/lib/j2951ForTest.ts'

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

export class Database {
  db: DatabaseSync

  constructor(databasePath: string) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true })
    this.db = new DatabaseSync(databasePath)
    this.db.exec(SCHEMA)
    this.db.exec('PRAGMA foreign_keys=ON')
    // CREATE TABLE IF NOT EXISTS never alters an existing tests table, so a DB
    // created before programs existed lacks program_id. Add it in place.
    const cols = this.db.prepare('PRAGMA table_info(tests)').all() as { name: string }[]
    if (!cols.some((c) => c.name === 'program_id')) {
      this.db.exec('ALTER TABLE tests ADD COLUMN program_id TEXT')
    }
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
    const test = { ...input, id, status } as Record<string, any>

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
        INSERT INTO tests(id,identity_key,active,status,project,program_id,cycle,config,transmission,lab,vehicle_model,
          vn_no,vin_sample_id,test_date,catalyst_state,odo,imported_at,updated_at,parser_version,
          data_json,low_confidence_json,combined_hash)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
          status=excluded.status, project=excluded.project, program_id=excluded.program_id, cycle=excluded.cycle, config=excluded.config,
          transmission=excluded.transmission, lab=excluded.lab, vehicle_model=excluded.vehicle_model,
          vn_no=excluded.vn_no, vin_sample_id=excluded.vin_sample_id, test_date=excluded.test_date,
          catalyst_state=excluded.catalyst_state, odo=excluded.odo, updated_at=excluded.updated_at,
          parser_version=excluded.parser_version, data_json=excluded.data_json,
          low_confidence_json=excluded.low_confidence_json, combined_hash=excluded.combined_hash, active=1
      `).run(
        id, identity, 1, status, test.project ?? null, test.program_id ?? null, test.cycle ?? null, test.config ?? null,
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

  /**
   * Same rows as listTests, with `trace` and `phases` removed *inside SQLite*
   * so their JSON is never parsed in JS. The full data_json is ~580 KB per
   * test, almost all of it trace; the list route only ever wanted the summary.
   * Callers that need traces (backfill, getTest) must use listTests/getTest.
   */
  listTestSummaries(includeNonaccepted = true): Record<string, any>[] {
    const where = includeNonaccepted ? 'WHERE active=1' : "WHERE active=1 AND status='accepted'"
    const rows = this.db.prepare(
      `SELECT json_remove(data_json,'$.trace','$.phases') AS data_json, status FROM tests ${where}
       ORDER BY test_date DESC, updated_at DESC`,
    ).all() as { data_json: string; status: string }[]
    return rows.map((row) => ({ ...JSON.parse(row.data_json), trace: null, phases: [], status: row.status }))
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

  registerSource(stem: string, kind: string, filePath: string, sha256: string, testIdValue: string | null = null): void {
    const stat = fs.statSync(filePath, { bigint: true })
    const now = utcnow()
    this.tx(() => {
      this.db.prepare(`
        INSERT INTO source_files(test_id,stem,kind,path,sha256,size_bytes,modified_ns,first_seen_at,last_seen_at)
        VALUES(?,?,?,?,?,?,?,?,?)
        ON CONFLICT(path) DO UPDATE SET
          -- COALESCE, not excluded.test_id. The watcher re-registers every
          -- source on every scan (watcher.ts, discovery pass) with no test id,
          -- because the pair has not been parsed yet at that point. Assigning
          -- excluded.test_id there wiped the link written by the post-parse
          -- pass, so within one scan interval every source_files row went back
          -- to NULL and sourcePath() never resolved -- evidence downloads
          -- 404'd for every watcher-ingested test. Only ever promote NULL to a
          -- real id, never demote.
          test_id=COALESCE(excluded.test_id, source_files.test_id),
          sha256=excluded.sha256,
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

  patchTest(id: string, patch: Record<string, any>): Record<string, any> | null {
    const current = this.getTest(id)
    if (!current) return null
    const allowed = new Set([
      'project', 'cycle', 'config', 'transmission', 'lab',
      'vehicleModel', 'vinSampleId', 'vnNo',
      'catalystState', 'stt', 'startSoc', 'lowConfidence',
      'inertia', 'vehicleRld', 'overrides',
    ])
    const clean: Record<string, any> = {}
    for (const [key, value] of Object.entries(patch)) {
      if (allowed.has(key)) clean[key] = value
    }
    const updated = { ...current, ...clean }
    // cycle, inertia and road load all feed the drive-trace indices; a stored
    // result computed from superseded inputs would be silently wrong.
    if (['cycle', 'inertia', 'vehicleRld', 'overrides'].some((k) => k in clean)) {
      updated.j2951 = resultForTest(updated as never)
    }
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

  /** Write a recomputed j2951 result without logging a manual override. */
  setJ2951(id: string, j2951: Record<string, any>): boolean {
    const current = this.getTest(id)
    if (!current) return false
    const updated = { ...current, j2951 }
    return this.tx(() =>
      this.db.prepare('UPDATE tests SET data_json=?,updated_at=? WHERE id=?')
        .run(JSON.stringify(updated), utcnow(), id).changes > 0,
    )
  }

  deleteTest(id: string): boolean {
    return this.tx(() => {
      this.db.prepare("UPDATE ingestion_jobs SET status='deleted', updated_at=? WHERE test_id=?")
        .run(utcnow(), id)
      return this.db.prepare('DELETE FROM tests WHERE id=?').run(id).changes > 0
    })
  }

  createProgram(name: string, folder: string): { id: string; name: string; folder: string; created_at: string } {
    const id = createHash('sha256').update(`${folder}|${name}`).digest('hex').slice(0, 16)
    const now = utcnow()
    this.tx(() => {
      this.db.prepare('INSERT INTO programs(id,name,folder,created_at) VALUES(?,?,?,?)').run(id, name, folder, now)
    })
    return { id, name, folder, created_at: now }
  }

  listPrograms(): Record<string, any>[] {
    return this.db.prepare(`
      SELECT p.id, p.name, p.folder, p.created_at,
        (SELECT COUNT(*) FROM tests t WHERE t.program_id=p.id AND t.active=1) AS test_count
      FROM programs p ORDER BY p.created_at ASC
    `).all() as Record<string, any>[]
  }

  getProgram(id: string): Record<string, any> | null {
    const row = this.db.prepare('SELECT id,name,folder,created_at FROM programs WHERE id=?').get(id) as
      | Record<string, any> | undefined
    return row ?? null
  }

  renameProgram(id: string, name: string): boolean {
    return this.tx(() => {
      const changed = this.db.prepare('UPDATE programs SET name=? WHERE id=?').run(name, id).changes > 0
      if (changed) {
        // keep the denormalized display name on the linked tests in sync
        this.db.prepare("UPDATE tests SET project=?, data_json=json_set(data_json,'$.project',?) WHERE program_id=?")
          .run(name, name, id)
      }
      return changed
    })
  }

  deleteProgram(id: string): boolean {
    return this.tx(() => {
      // tests cascade their pollutant_results/phases/trace_points via FK; jobs
      // point at those tests with ON DELETE SET NULL. The folder stays on disk;
      // with no registered program the watcher will not re-ingest it.
      this.db.prepare('DELETE FROM tests WHERE program_id=?').run(id)
      return this.db.prepare('DELETE FROM programs WHERE id=?').run(id).changes > 0
    })
  }

  audit(id: string): Record<string, any>[] {
    const replacements = (this.db.prepare(
      'SELECT * FROM replacement_audit WHERE test_id=? ORDER BY replaced_at DESC',
    ).all(id) as Record<string, any>[]).map((r) => ({ ...r, kind: 'replacement' }) as Record<string, any>)
    const overrides = (this.db.prepare(
      'SELECT * FROM manual_overrides WHERE test_id=? ORDER BY changed_at DESC',
    ).all(id) as Record<string, any>[]).map((r) => ({ ...r, kind: 'override' }) as Record<string, any>)
    return [...replacements, ...overrides].sort((a, b) =>
      String(b.replaced_at ?? b.changed_at).localeCompare(String(a.replaced_at ?? a.changed_at)),
    )
  }
}
