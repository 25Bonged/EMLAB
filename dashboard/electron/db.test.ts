import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
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
})
