import { describe, it, expect } from 'vitest'
import { backfillJ2951 } from './backfill.ts'
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
