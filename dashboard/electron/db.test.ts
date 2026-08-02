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
