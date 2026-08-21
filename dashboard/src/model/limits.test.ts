import { describe, expect, it } from 'vitest'
import { defaultRegulatoryBasis, engineeringTargetFor, limitContext, regulatoryProfileFor } from './limits'
import type { Test } from './types'

const baseTest = (over: Partial<Test> = {}): Test => ({
  id: 'x',
  project: 'RNTBCI',
  wp: 'emission',
  cycle: 'WLTP',
  config: 'DUSTER',
  transmission: 'AT6',
  lab: 'FEV',
  vehicleModel: 'DUSTER',
  vinSampleId: '',
  vnNo: '0095',
  date: '2026-08-21',
  inertia: 1280,
  rld: { A: null, B: null, C: null },
  vehicleRld: { A: null, B: null, C: null },
  fuel: {},
  conditions: {},
  results: { CO: 1, THC: 1, NOx: 1, CO2: 1, CH4: 1, NMHC: 1, PM: 1, PN: 1 },
  phases: [],
  source: {},
  lowConfidence: [],
  importedAt: '',
  ...over,
})

describe('M/N limit profiles', () => {
  it('uses M1/M2 PI as the safe passenger-car default', () => {
    const p = regulatoryProfileFor('emission', defaultRegulatoryBasis())!
    expect(p.label).toContain('M1/M2 PI')
    expect(p.limits.CO).toBe(1000)
    expect(p.limits.NOx).toBe(60)
    expect(p.limits.PN).toBe(6e11)
  })

  it('classifies N1 mass bands from reference mass when no explicit class is supplied', () => {
    expect(defaultRegulatoryBasis({ inertia: 1305 }).category).toBe('N1_I')
    expect(defaultRegulatoryBasis({ inertia: 1306 }).category).toBe('N1_II')
    expect(defaultRegulatoryBasis({ inertia: 1761 }).category).toBe('N1_III')
  })

  it('resolves OBD-II threshold separately from tailpipe limits', () => {
    const p = regulatoryProfileFor('obd', {
      family: 'india-bs6-mn-lt-3p5t',
      category: 'N1_II',
      ignition: 'PI',
      obdStage: 'OBD-II',
      source: 'manual',
    })!
    expect(p.kind).toBe('obdThreshold')
    expect(p.limits.CO).toBe(3400)
    expect(p.limits.NOx).toBe(110)
    expect(p.limits.PM).toBe(12)
  })

  it('does not assign an engineering target to non-STLA projects', () => {
    expect(engineeringTargetFor(baseTest())).toBeNull()
    expect(limitContext(baseTest()).target).toBeNull()
  })

  it('treats parser defaults as unconfirmed regulatory basis', () => {
    const ctx = limitContext(baseTest({
      regulatory: {
        family: 'india-bs6-mn-lt-3p5t',
        category: 'M1_M2',
        ignition: 'PI',
        source: 'default',
      },
    }))
    expect(ctx.basisStatus).toBe('unconfirmed')
    expect(ctx.message).toContain('Unconfirmed')
  })

  it('treats manual regulatory edits as confirmed basis', () => {
    const ctx = limitContext(baseTest({
      regulatory: {
        family: 'india-bs6-mn-lt-3p5t',
        category: 'N1_II',
        ignition: 'CI',
        source: 'manual',
      },
    }))
    expect(ctx.basisStatus).toBe('confirmed')
    expect(ctx.message).toBeUndefined()
  })

  it('keeps the STLA engineering target scoped to STLA emission work', () => {
    expect(engineeringTargetFor(baseTest({ project: 'STLA' }))?.limits.NOx).toBe(20)
    expect(engineeringTargetFor(baseTest({ project: 'STLA', wp: 'obd' }))).toBeNull()
  })
})
