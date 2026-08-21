import { describe, it, expect } from 'vitest'
import { backfillFilenameMetadata, backfillJ2951 } from './backfill.ts'
import { CALC_VERSION } from '../src/lib/j2951.ts'

/** Minimal legacy-shaped test row -- no trace, no cycle. resultForTest is
 * crash-safe against this and returns an `unavailable` result, which is all
 * this suite needs: it only cares about calcVersion gating, not the payload. */
function legacyTest(id: string, j2951?: Record<string, any>) {
  return { id, cycle: null, trace: undefined, results: {}, ...(j2951 ? { j2951 } : {}) }
}

class FakeStore {
  rows: Record<string, any>[]
  setCalls: string[] = []
  metadataCalls: { id: string; patch: Record<string, any> }[] = []

  constructor(rows: Record<string, any>[]) {
    this.rows = rows
  }

  listTests(_includeNonaccepted = true): Record<string, any>[] {
    return this.rows
  }

  setJ2951(id: string, j2951: Record<string, any>): boolean {
    this.setCalls.push(id)
    const row = this.rows.find((r) => r.id === id)
    if (!row) return false
    row.j2951 = j2951
    return true
  }

  backfillMetadata(id: string, patch: Record<string, any>): boolean {
    this.metadataCalls.push({ id, patch })
    const row = this.rows.find((r) => r.id === id)
    if (!row) return false
    Object.assign(row, patch)
    return true
  }
}

describe('backfillJ2951', () => {
  it('computes and writes a result for a test with no j2951 at all', () => {
    const store = new FakeStore([legacyTest('a')])
    const written = backfillJ2951(store)
    expect(written).toBe(1)
    expect(store.setCalls).toEqual(['a'])
    expect(store.rows[0].j2951.calcVersion).toBe(CALC_VERSION)
  })

  it('skips a test already at CALC_VERSION -- setJ2951 is never called for it', () => {
    const store = new FakeStore([legacyTest('a', { calcVersion: CALC_VERSION, unavailable: 'no_trace' })])
    const written = backfillJ2951(store)
    expect(written).toBe(0)
    expect(store.setCalls).toEqual([])
  })

  it('recomputes a test stored at CALC_VERSION - 1', () => {
    const store = new FakeStore([legacyTest('a', { calcVersion: CALC_VERSION - 1, unavailable: 'no_trace' })])
    const written = backfillJ2951(store)
    expect(written).toBe(1)
    expect(store.setCalls).toEqual(['a'])
    expect(store.rows[0].j2951.calcVersion).toBe(CALC_VERSION)
  })

  it('is idempotent: a second pass over the freshly-written result writes zero', () => {
    const store = new FakeStore([legacyTest('a')])
    const first = backfillJ2951(store)
    expect(first).toBe(1)

    store.setCalls = []
    const second = backfillJ2951(store)
    expect(second).toBe(0)
    expect(store.setCalls).toEqual([])
  })

  it('returns the count of rows written, across a mixed batch', () => {
    const store = new FakeStore([
      legacyTest('missing'),
      legacyTest('current', { calcVersion: CALC_VERSION, unavailable: 'no_trace' }),
      legacyTest('stale', { calcVersion: CALC_VERSION - 1, unavailable: 'no_trace' }),
    ])
    const written = backfillJ2951(store)
    expect(written).toBe(2)
    expect(store.setCalls.sort()).toEqual(['missing', 'stale'])
  })
})

describe('backfillFilenameMetadata', () => {
  it('fills old RNTBCI DUSTER and R1324 Unknown config rows from source filenames', () => {
    const store = new FakeStore([
      {
        id: 'duster',
        config: 'Unknown',
        cycle: 'MIDC',
        transmission: 'AT6',
        vehicleModel: 'DUSTER',
        vnNo: '0095',
        lowConfidence: ['config'],
        source: { pdf: 'C:\\EMLAB\\Programs\\RNTBCI\\AT\\DUSTER_DCT_0095_MIDC_5163\\DUSTER_DCT_0095_MIDC_5163_2026-08-17_11-10-14_REPORT.pdf' },
      },
      {
        id: 'r1324',
        config: 'Unknown',
        cycle: 'Unknown',
        transmission: 'Unknown',
        vehicleModel: 'RNTBCI_R1324_MT_0138_MIDC_5167_2026-08-17_13-58-30',
        vnNo: '',
        lowConfidence: ['config', 'cycle', 'transmission'],
        source: { pdf: 'C:\\EMLAB\\Programs\\RNTBCI\\MT\\RNTBCI_R1324_MT_0138_MIDC_5167\\RNTBCI_R1324_MT_0138_MIDC_5167_2026-08-17_13-58-30_REPORT.pdf' },
      },
    ])

    expect(backfillFilenameMetadata(store)).toBe(2)
    expect(store.rows[0]).toMatchObject({ config: 'DUSTER', lowConfidence: [] })
    expect(store.rows[1]).toMatchObject({
      config: 'R1324',
      cycle: 'MIDC',
      transmission: 'MB6',
      vehicleModel: 'RNTBCI R1324',
      vnNo: '0138',
      lowConfidence: [],
    })
  })

  it('does not overwrite already-populated engineer metadata', () => {
    const store = new FakeStore([
      {
        id: 'kept',
        config: 'MANUAL-CFG',
        cycle: 'WLTP',
        transmission: 'CUSTOM',
        vehicleModel: 'Engineer Vehicle',
        vnNo: 'VN-KEEP',
        lowConfidence: [],
        source: { pdf: 'C:\\EMLAB\\Programs\\RNTBCI\\MT\\RNTBCI_R1324_MT_0138_MIDC_5167\\RNTBCI_R1324_MT_0138_MIDC_5167_2026-08-17_13-58-30_REPORT.pdf' },
      },
    ])

    expect(backfillFilenameMetadata(store)).toBe(0)
    expect(store.metadataCalls).toEqual([])
    expect(store.rows[0]).toMatchObject({
      config: 'MANUAL-CFG',
      cycle: 'WLTP',
      transmission: 'CUSTOM',
      vehicleModel: 'Engineer Vehicle',
      vnNo: 'VN-KEEP',
    })
  })
})
