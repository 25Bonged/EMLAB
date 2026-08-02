import { describe, it, expect } from 'vitest'
import type { Test, TracePoint } from '../model/types'
import { getSchedule } from '../model/cycles'
import { resultForTest } from './j2951ForTest'

function baseTest(overrides: Partial<Test> = {}): Test {
  return {
    id: 'sample', project: 'STLA', cycle: 'WLTP', config: 'CC24', transmission: 'MB6', lab: 'FEV',
    vehicleModel: 'CITROEN AIRCROSS', vinSampleId: 'VIN', vnNo: '9740', date: '2026-03-18',
    inertia: 1464,
    rld: { A: null, B: null, C: null },
    vehicleRld: { A: 122.2, B: 0.684, C: 0.0434 },
    fuel: {}, conditions: {},
    results: { CO: null, THC: null, NOx: null, CO2: null, CH4: null, NMHC: null, PM: null, PN: null },
    phases: [], source: {}, lowConfidence: [], importedAt: '2026-06-20T00:00:00Z',
    ...overrides,
  }
}

/** WLTC 3b dilute trace matching the schedule exactly, t=1..1477 (t=0 omitted). */
function matchingDiluteTrace(): TracePoint[] {
  const schedule = getSchedule('WLTP')!
  const dilute: TracePoint[] = []
  for (let t = 1; t < schedule.speeds.length; t++) dilute.push({ t, speed: schedule.speeds[t] })
  return dilute
}

describe('resultForTest', () => {
  it('scores ~0 IWR and an overall pass when the measured trace equals the schedule', () => {
    const test = baseTest({ trace: { dilute: matchingDiluteTrace(), preCat: [], postCat: [] } })
    const r = resultForTest(test)
    expect(r.unavailable).toBeUndefined()
    expect(r.indices!.iwr).toBeCloseTo(0, 6)
    expect(r.verdict!.overall).toBe('pass')
  })

  it('reports no_schedule for a cycle with no committed target (MIDC)', () => {
    const test = baseTest({
      cycle: 'MIDC', trace: { dilute: [{ t: 1, speed: 10 }, { t: 2, speed: 12 }], preCat: [], postCat: [] },
    })
    const r = resultForTest(test)
    expect(r.unavailable).toBe('no_schedule')
    expect(r.indices).toBeNull()
  })

  it('reports no_trace when there is no measured speed trace', () => {
    const test = baseTest()
    const r = resultForTest(test)
    expect(r.unavailable).toBe('no_trace')
    expect(r.indices).toBeNull()
  })

  it('prefers overrides.vehicleRld and reports inputs.source as override', () => {
    const test = baseTest({
      trace: { dilute: matchingDiluteTrace(), preCat: [], postCat: [] },
      overrides: { vehicleRld: { A: 999, B: 1, C: 2 } },
    })
    const r = resultForTest(test)
    expect(r.unavailable).toBeUndefined()
    expect(r.inputs!.source).toBe('override')
    expect(r.inputs!.f0).toBe(999)
  })

  it('still computes IWR/RMSSE/DR/ASCR with null ER/EER when vehicleRld is all null', () => {
    const test = baseTest({
      vehicleRld: { A: null, B: null, C: null },
      trace: { dilute: matchingDiluteTrace(), preCat: [], postCat: [] },
    })
    const r = resultForTest(test)
    expect(r.unavailable).toBeUndefined()
    expect(r.indices!.iwr).not.toBeNull()
    expect(r.indices!.rmsse).not.toBeNull()
    expect(r.indices!.dr).not.toBeNull()
    expect(r.indices!.ascr).not.toBeNull()
    expect(r.indices!.er).toBeNull()
    expect(r.indices!.eer).toBeNull()
  })

  it('ignores a malformed overrides.vehicleRld and falls back to the parsed values', () => {
    const test = baseTest({
      trace: { dilute: matchingDiluteTrace(), preCat: [], postCat: [] },
      overrides: { vehicleRld: 'not-an-object' },
    })
    const r = resultForTest(test)
    expect(r.unavailable).toBeUndefined()
    expect(r.inputs!.source).toBe('parsed')
    expect(r.inputs!.f0).toBe(122.2)
  })
})
