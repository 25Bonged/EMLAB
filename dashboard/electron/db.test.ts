import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { identityKey, testId, Database } from './db.ts'
import { CALC_VERSION } from '../src/lib/j2951.ts'

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
    expect(identityKey(base, 'nostamp')).toBe('|citroen aircross|9740|2026-03-18|wltp|')
  })

  it('uses program or project as part of identity', () => {
    expect(identityKey({ ...base, project: 'STLA' }, 'nostamp'))
      .not.toBe(identityKey({ ...base, project: 'RNTBCI' }, 'nostamp'))
    expect(identityKey({ ...base, program_id: 'p1', project: 'STLA' }, 'nostamp'))
      .not.toBe(identityKey({ ...base, program_id: 'p2', project: 'STLA' }, 'nostamp'))
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

  it('preserves first_seen_at across job updates and clears unset fields', () => {
    db.updateJob('stem-1', 'pending_pair', { pdf_path: '/a.pdf', message: 'waiting' })
    const first = db.listJobs()[0]
    expect(first.job_key).toBe('stem-1')
    expect(first.stem).toBe('stem-1')
    expect(first.status).toBe('pending_pair')
    expect(first.pdf_path).toBe('/a.pdf')

    db.updateJob('stem-1', 'accepted', { stem: 'display-stem', pdf_path: '/a.pdf', xlsm_path: '/a.xlsm' })
    const second = db.listJobs()[0]
    expect(second.stem).toBe('display-stem')
    expect(second.status).toBe('accepted')
    expect(second.first_seen_at).toBe(first.first_seen_at)
    expect(second.message).toBeNull()
  })

  it('stores nanosecond mtimes losslessly and reads them back', () => {
    const file = path.join(dir, 'sample.pdf')
    writeFileSync(file, 'x')
    db.registerSource('stem-1', 'pdf', file, 'deadbeef')

    const meta = db.sourceMeta(file)
    expect(meta).not.toBeNull()
    expect(meta!.sha256).toBe('deadbeef')

    const stat = statSync(file, { bigint: true })
    expect(meta!.modified_ns).toBe(String(stat.mtimeNs))
    expect(meta!.size_bytes).toBe(1)
    expect(db.sourceMeta('/nope')).toBeNull()
  })

  it('returns the most recent source path for a kind', () => {
    const file = path.join(dir, 'a.pdf')
    writeFileSync(file, 'x')
    const { testId: id } = db.saveTest(sampleTest(), 'stem', 'h', 'accepted', 'ok')
    db.registerSource('stem', 'pdf', file, 'hash', id)
    expect(db.sourcePath(id, 'pdf')).toBe(file)
    expect(db.sourcePath(id, 'xlsm')).toBeNull()
  })

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

  it('persists a road-load override patch instead of dropping it', () => {
    const { testId: id } = db.saveTest(sampleTest(), 'stem', 'h', 'accepted', 'ok')
    const updated = db.patchTest(id, { overrides: { vehicleRld: { A: 100, B: 0.5, C: 0.04 } } })
    expect(updated!.overrides).toEqual({ vehicleRld: { A: 100, B: 0.5, C: 0.04 } })
    expect(db.getTest(id)!.overrides).toEqual({ vehicleRld: { A: 100, B: 0.5, C: 0.04 } })
  })

  it('persists an inertia patch', () => {
    const { testId: id } = db.saveTest(sampleTest(), 'stem', 'h', 'accepted', 'ok')
    const updated = db.patchTest(id, { inertia: 1500 })
    expect(updated!.inertia).toBe(1500)
    expect(db.getTest(id)!.inertia).toBe(1500)
  })

  it('recomputes j2951 when a drive-trace input is patched', () => {
    const { testId: id } = db.saveTest(sampleTest(), 'stem', 'h', 'accepted', 'ok')
    const updated = db.patchTest(id, { inertia: 1500 })
    expect(updated!.j2951).toBeTruthy()
    expect(updated!.j2951.calcVersion).toBe(CALC_VERSION)
    expect(db.getTest(id)!.j2951.calcVersion).toBe(CALC_VERSION)
  })

  it('still drops fields outside the patch allow-list', () => {
    const { testId: id } = db.saveTest(sampleTest(), 'stem', 'h', 'accepted', 'ok')
    const updated = db.patchTest(id, { odo: 99999 } as any)
    expect(updated!.odo).not.toBe(99999)
    expect(db.getTest(id)!.odo).not.toBe(99999)
  })

  it('setJ2951 writes a recomputed result without logging a manual override', () => {
    const { testId: id } = db.saveTest(sampleTest(), 'stem', 'h', 'accepted', 'ok')
    const before = db.audit(id).filter((a) => a.kind === 'override').length
    expect(db.setJ2951(id, { calcVersion: CALC_VERSION, indices: null, verdict: null, inputs: null })).toBe(true)
    expect(db.getTest(id)!.j2951).toEqual({ calcVersion: CALC_VERSION, indices: null, verdict: null, inputs: null })
    const after = db.audit(id).filter((a) => a.kind === 'override').length
    expect(after).toBe(before)
  })

  it('setJ2951 on an unknown id returns false', () => {
    expect(db.setJ2951('missing', { calcVersion: CALC_VERSION })).toBe(false)
  })

  // Regression: the watcher's discovery pass re-registers every source on every
  // scan with no test id, because the pair has not been parsed yet. When the
  // UPSERT assigned excluded.test_id unconditionally, that wiped the link the
  // post-parse pass had written, and evidence downloads 404'd forever.
  it('does not unlink a source when re-registered without a test id', () => {
    const file = path.join(dir, 'evidence.pdf')
    writeFileSync(file, 'pdf bytes')
    const { testId } = db.saveTest(sampleTest(), 'stem', 'h-src', 'accepted', 'ok')

    db.registerSource('stem', 'pdf', file, 'hash')            // discovery pass
    expect(db.sourcePath(testId, 'pdf')).toBeNull()

    db.registerSource('stem', 'pdf', file, 'hash', testId)    // post-parse pass
    expect(db.sourcePath(testId, 'pdf')).toBe(file)

    db.registerSource('stem', 'pdf', file, 'hash2')           // next scan, no id
    expect(db.sourcePath(testId, 'pdf')).toBe(file)           // link must survive
  })

  it('creates, lists, renames (cascading to tests) and deletes programs', () => {
    const p = db.createProgram('STLA', '/root/STLA')
    expect(p.name).toBe('STLA')
    expect(db.listPrograms().map((x) => x.name)).toEqual(['STLA'])

    db.saveTest({ ...sampleTest(), program_id: p.id }, 'STLA_2026-01-01_09-00-00', 'h1', 'accepted', 'ok')
    expect(db.listTests()[0].project).toBe('STLA')
    expect(db.listPrograms()[0].test_count).toBe(1)

    expect(db.renameProgram(p.id, 'Stellantis')).toBe(true)
    expect(db.listPrograms()[0].name).toBe('Stellantis')
    expect(db.listTests()[0].project).toBe('Stellantis')

    expect(db.deleteProgram(p.id)).toBe(true)
    expect(db.listPrograms()).toEqual([])
    expect(db.listTests()).toEqual([])
  })

  it('updates a program folder without renaming the program', () => {
    const p = db.createProgram('STLA', '/onedrive/STLA')
    expect(db.updateProgramFolder(p.id, '/local/Programs/STLA')).toBe(true)
    expect(db.getProgram(p.id)!.folder).toBe('/local/Programs/STLA')
    expect(db.updateProgramFolder('missing', '/local/Programs/RNTBCI')).toBe(false)
  })
})
