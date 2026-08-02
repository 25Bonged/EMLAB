import { describe, it, expect } from 'vitest'
import { buildTest } from './normalize'

describe('buildTest', () => {
  it('populates j2951 as no_trace when there is no report and no trace', () => {
    const test = buildTest('SAMPLE_STEM', null, null, {}, '2026-06-20T00:00:00Z')
    expect(test.j2951).toBeTruthy()
    expect(test.j2951!.unavailable).toBe('no_trace')
    expect(test.j2951!.indices).toBeNull()
  })

  it('still reports no_trace when a trace record exists but has no dilute points', () => {
    const test = buildTest('SAMPLE_STEM', null, { dilute: [], preCat: [], postCat: [] }, {}, '2026-06-20T00:00:00Z')
    expect(test.j2951!.unavailable).toBe('no_trace')
  })
})
