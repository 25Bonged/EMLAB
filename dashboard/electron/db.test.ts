import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { identityKey, testId, Database } from './db.ts'

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
    expect(first.status).toBe('pending_pair')
    expect(first.pdf_path).toBe('/a.pdf')

    db.updateJob('stem-1', 'accepted', { pdf_path: '/a.pdf', xlsm_path: '/a.xlsm' })
    const second = db.listJobs()[0]
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
})
