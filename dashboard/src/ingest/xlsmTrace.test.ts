import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseTraceWorkbook, traceUnitMetadata } from './xlsmTrace'

// Real FEV trace data — confidential, never committed (see .gitignore's
// "OneDrive_*/" rule). Present on engineering machines only, so this suite
// skips itself in CI and on any machine without the fixture checked out,
// rather than failing on a file that was never meant to exist there.
const FILE = resolve(
  __dirname,
  '../../../OneDrive_3_6-20-2026 (1)/OneDrive_1_6-20-2026/CITROEN_AIRCROSS_MT_9740_5099_2026-03-18_09-51-01_TRACES.xlsm',
)
const hasFixture = existsSync(FILE)

describe.skipIf(!hasFixture)('FEV trace workbook extraction', () => {
  it('extracts trace channels with their native units', () => {
    const bytes = readFileSync(FILE)
    const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    const trace = parseTraceWorkbook(data)
    const units = traceUnitMetadata(data)

    expect(trace.dilute.length).toBeGreaterThan(1000)
    expect(trace.preCat.length).toBeGreaterThan(1000)
    expect(trace.postCat.length).toBeGreaterThan(1000)
    expect(trace.dilute[0].force).toBeCloseTo(-1.23, 2)
    expect(trace.dilute[0].THC_mass_g).toBeCloseTo(0.000373962, 8)
    expect(units.dilute.NOx).toBe('ppm')
    expect(units.dilute.CO2).toBe('%')
    expect(units.dilute.PN).toBe('1/cm3')
    expect(units.dilute.THC_mass_g).toBe('Gram')
    expect(units.preCat.NOx).toBe('ppm')
    expect(units.preCat.CO2).toBe('%')
  })
})
