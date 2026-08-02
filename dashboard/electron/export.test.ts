import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { exportXlsx } from './export.ts'

describe('exportXlsx', () => {
  it('writes one header row plus one row per test with derived g/km columns', async () => {
    const buffer = await exportXlsx([
      {
        status: 'accepted', date: '2026-03-18', project: 'STLA', cycle: 'WLTP',
        vehicleModel: 'CITROEN AIRCROSS', vnNo: '9740',
        results: { CO: 325.3, THC: 7.59, NOx: 24.73, CO2: 134752, CH4: 2.68, NMHC: 4.42, PM: 1.32, PN: 3.38e9 },
        units: { resultsSource: 'mg/km' }, source: { pdf: 'a.pdf', xlsm: 'a.xlsm' }, lowConfidence: [],
      },
    ])
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer)
    const ws = wb.getWorksheet('Emission Compilation')!
    expect(ws.rowCount).toBe(2)

    const headerValues = (ws.getRow(1).values as any[]).slice(1)
    expect(headerValues[0]).toBe('Status')
    expect(headerValues).toContain('CO (mg/km)')
    expect(headerValues).toContain('CO (g/km)')
    expect(headerValues).toContain('PN (#/km)')
    expect(headerValues).not.toContain('PN (g/km)')

    const dataRow = (ws.getRow(2).values as any[]).slice(1)
    expect(dataRow[headerValues.indexOf('CO (mg/km)')]).toBeCloseTo(325.3)
    expect(dataRow[headerValues.indexOf('CO (g/km)')]).toBeCloseTo(0.3253)
    expect(dataRow[headerValues.indexOf('PN (#/km)')]).toBeCloseTo(3.38e9)
  })

  it('leaves missing pollutant values as blank rather than throwing', async () => {
    const buffer = await exportXlsx([
      { status: 'quarantined', results: {}, source: {}, lowConfidence: ['results'] },
    ])
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer)
    const ws = wb.getWorksheet('Emission Compilation')!
    const headerValues = (ws.getRow(1).values as any[]).slice(1)
    const dataRow = (ws.getRow(2).values as any[]).slice(1)
    // ExcelJS's row.values is a sparse array: a cell explicitly set to `null`
    // becomes a hole, so indexing it yields `undefined`, not `null`. (Verified
    // directly against the written/reloaded workbook — getCell(...).value is
    // `null`; the sparse `.values` array reports the hole as `undefined`.)
    expect(dataRow[headerValues.indexOf('CO (mg/km)')]).toBeUndefined()
    expect(dataRow[headerValues.indexOf('Review Flags')]).toBe('results')
  })
})
