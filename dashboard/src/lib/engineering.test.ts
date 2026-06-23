import { describe, it, expect } from 'vitest'
import type { Test, TracePoint } from '../model/types'
import {
  deteriorationByGroup, coldStart, catalystLightoff, cycleMetrics, reconcile, sttPairs,
} from './engineering'

const base = (over: Partial<Test>): Test => ({
  id: 'x', project: 'STLA', cycle: 'WLTP', config: 'CC24', transmission: 'AT6', lab: 'FEV',
  vehicleModel: 'M', vinSampleId: '', vnNo: '1', date: '2026-01-01',
  rld: { A: null, B: null, C: null }, fuel: {}, conditions: {},
  results: { CO: null, THC: null, NOx: null, CO2: null, CH4: null, NMHC: null, PM: null, PN: null },
  phases: [], source: {}, lowConfidence: [], importedAt: '', ...over,
})

const r = (NOx: number): Test['results'] => ({ CO: null, THC: null, NOx, CO2: null, CH4: null, NMHC: null, PM: null, PN: null })

describe('deteriorationByGroup', () => {
  it('fits a rising trend and projects DF > 1', () => {
    const tests = [
      base({ odo: 0, results: r(20) }),
      base({ odo: 1000, results: r(25) }),
      base({ odo: 2000, results: r(30) }),
    ]
    const [g] = deteriorationByGroup(tests, 'NOx', () => 'all', 4000)
    expect(g.fit.slope).toBeCloseTo(0.005, 6) // 10 over 2000 km
    expect(g.current).toBeCloseTo(20, 6)
    expect(g.projected).toBeCloseTo(40, 6) // 20 + 0.005*4000
    expect(g.df).toBeCloseTo(2, 6)
    expect(g.exceedsTarget).toBe(true) // NOx target 20
  })
})

describe('coldStart', () => {
  it('computes phase-1 mass fraction and penalty', () => {
    const t = base({
      phases: [
        { name: 'P1', distanceKm: 3, specific: { NOx: 50 } }, // mass 0.15 g
        { name: 'P2', distanceKm: 5, specific: { NOx: 10 } }, // mass 0.05 g
        { name: 'P3', distanceKm: 7, specific: { NOx: 10 } }, // mass 0.07 g
      ],
    })
    const nox = coldStart(t).find((x) => x.pollutant === 'NOx')!
    expect(nox.totalMass).toBeCloseTo(0.27, 6)
    expect(nox.coldFraction).toBeCloseTo(0.15 / 0.27, 6)
    expect(nox.coldPenalty).toBeCloseTo(40, 6) // 50 − mean(10,10)
  })
})

describe('catalystLightoff', () => {
  it('detects time to 50% conversion and time-weighted efficiency', () => {
    const preCat: TracePoint[] = [
      { t: 0, NOx: 100 }, { t: 1, NOx: 100 }, { t: 2, NOx: 100 }, { t: 3, NOx: 100 },
    ]
    const postCat: TracePoint[] = [
      { t: 0, NOx: 100 }, { t: 1, NOx: 80 }, { t: 2, NOx: 40 }, { t: 3, NOx: 10 },
    ]
    const t = base({ trace: { dilute: [], preCat, postCat } })
    const lo = catalystLightoff(t, 'NOx')!
    expect(lo.lightoffTime).toBe(2) // conversion hits 0.6 at t=2
    expect(lo.timeWeightedConversion).toBeCloseTo((0 + 0.2 + 0.6 + 0.9) / 4, 6)
    expect(lo.peakPreCat).toBe(100)
  })
})

describe('cycleMetrics', () => {
  it('integrates distance and idle fraction from the speed trace', () => {
    // constant 36 km/h for 100 s → 36*100/3600 = 1 km
    const dilute: TracePoint[] = Array.from({ length: 101 }, (_, i) => ({ t: i, speed: 36 }))
    const m = cycleMetrics(base({ trace: { dilute, preCat: [], postCat: [] }, distanceKm: 1 }))!
    expect(m.distanceComputed).toBeCloseTo(1, 6)
    expect(m.distanceErrorPct).toBeCloseTo(0, 6)
    expect(m.idlePct).toBe(0)
    expect(m.maxSpeed).toBe(36)
  })
})

describe('reconcile', () => {
  it('integrates per-sample mass channel against the reported value', () => {
    // 0.1 g/s for 10 samples (cumulative-detected? no — flat then) — use clearly per-sample
    const dilute: TracePoint[] = [
      { t: 0, NOx_mass_g: 0.05 }, { t: 1, NOx_mass_g: 0.05 }, { t: 2, NOx_mass_g: 0.05 },
    ] // sum 0.15 g over 1 km → 150 mg/km
    const row = reconcile(base({ trace: { dilute, preCat: [], postCat: [] }, distanceKm: 1, results: r(150) }))
    expect(row[0].integrated).toBeCloseTo(150, 6)
    expect(row[0].deltaPct).toBeCloseTo(0, 6)
  })
})

describe('sttPairs', () => {
  it('matches ON/OFF on the same vehicle', () => {
    const pairs = sttPairs([
      base({ stt: 'ON', vnNo: '9', results: r(20) }),
      base({ stt: 'OFF', vnNo: '9', results: r(24) }),
    ], 'NOx')
    expect(pairs).toHaveLength(1)
    expect(pairs[0].deltaPct).toBeCloseTo(20, 6) // (24-20)/20
  })
})
