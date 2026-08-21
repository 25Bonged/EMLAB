import { describe, it, expect } from 'vitest'
import { buildTest, parseFilename } from './normalize'

describe('parseFilename', () => {
  it('parses current mail attachment stems with AT and V-prefixed vehicle numbers', () => {
    expect(parseFilename('AIRCROSS_12L_AT_V031942_5124_2026-08-19_21-30-18')).toMatchObject({
      model: 'AIRCROSS 12L',
      transmissionToken: 'AT',
      vn: 'V031942',
      date: '2026-08-19',
    })
  })

  it('treats DCT attachment stems as automatic-capable filename metadata', () => {
    expect(parseFilename('RNTBCI_DUSTER_DCT_0095_5104_2026-08-19_19-33-41')).toMatchObject({
      model: 'RNTBCI DUSTER',
      transmissionToken: 'DCT',
      cycleToken: null,
      vn: '0095',
      date: '2026-08-19',
    })
  })

  it('parses RNTBCI DET and MIDC filename metadata without depending on PDF text', () => {
    expect(parseFilename('RBC_HR10_DET_CNG_6992_5155_2026-08-20_11-48-08')).toMatchObject({
      model: 'RBC HR10 CNG',
      transmissionToken: 'DET',
      cycleToken: null,
      vn: '6992',
      date: '2026-08-20',
    })

    expect(parseFilename('RNTBCI_R1324_MT_0138_MIDC_5167_2026-08-17_13-58-30')).toMatchObject({
      model: 'RNTBCI R1324',
      transmissionToken: 'MT',
      cycleToken: 'MIDC',
      vn: '0138',
      date: '2026-08-17',
    })
  })
})

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

  it('classifies DCT attachment stems as automatic transmission', () => {
    const test = buildTest(
      'RNTBCI_DUSTER_DCT_0095_5104_2026-08-19_19-33-41',
      null,
      null,
      {},
      '2026-08-20T00:00:00Z',
    )
    expect(test.transmission).toBe('AT6')
    expect(test.vehicleModel).toBe('RNTBCI DUSTER')
    expect(test.vnNo).toBe('0095')
  })

  it('maps STLA attachment stems to CC configuration names', () => {
    expect(buildTest(
      'AIRCROSS_12L_AT_V031942_5124_2026-08-19_21-30-18',
      null,
      null,
      {},
      '2026-08-20T00:00:00Z',
    ).config).toBe('CC24')

    expect(buildTest('BASALT_MT_1234_2026-08-20_10-00-00', null, null, {}, '2026-08-20T00:00:00Z').config)
      .toBe('CC22')
    expect(buildTest('C3_MT_1234_2026-08-20_10-00-00', null, null, {}, '2026-08-20T00:00:00Z').config)
      .toBe('CC21')
  })

  it('maps RNTBCI attachment stems to vehicle configuration names', () => {
    expect(buildTest(
      'RNTBCI_DUSTER_DCT_0095_5104_2026-08-19_19-33-41',
      null,
      null,
      {},
      '2026-08-20T00:00:00Z',
    ).config).toBe('DUSTER')

    expect(buildTest(
      'RBC_HR10_DET_CNG_6992_5155_2026-08-20_11-48-08',
      null,
      null,
      {},
      '2026-08-20T00:00:00Z',
    ).config).toBe('HR10-TRIBER')

    const r1324 = buildTest(
      'RNTBCI_R1324_MT_0138_MIDC_5167_2026-08-17_13-58-30',
      null,
      null,
      {},
      '2026-08-20T00:00:00Z',
    )
    expect(r1324.config).toBe('R1324')
    expect(r1324.cycle).toBe('MIDC')
    expect(r1324.vehicleModel).toBe('RNTBCI R1324')
    expect(r1324.vnNo).toBe('0138')
    expect(r1324.lowConfidence).not.toContain('config')
    expect(r1324.lowConfidence).not.toContain('cycle')
  })
})
