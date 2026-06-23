import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { parseCompilationWorkbook } from './compilationWorkbook'

describe('compilation workbook unit normalization', () => {
  it('normalizes g/km source columns into canonical mg/km', () => {
    const rows = Array.from({ length: 9 }, () => Array(34).fill(null))
    rows[1][4] = 'WLTP - CC24 MB6 FEV'
    rows[5][0] = 'Test Date'
    rows[5][1] = 'Test conducted'
    rows[5][4] = 'VN No.'
    rows[5][6] = 'Transmission'
    rows[5][11] = 'Cycle'
    rows[5][13] = 'Emission Results'
    rows[6][14] = 'CO g/km'
    rows[6][15] = 'THC g/km'
    rows[6][16] = 'NOx g/km'
    rows[6][17] = 'CO2 g/km'
    rows[6][18] = 'CH4 g/km'
    rows[6][19] = 'NMHC g/km'
    rows[6][20] = 'PM g/km'
    rows[6][21] = 'PN #/km'
    rows[8][0] = '18.03.2026'
    rows[8][1] = 'FEV'
    rows[8][4] = '9740'
    rows[8][6] = 'MB6'
    rows[8][11] = 'WLTP'
    rows[8][14] = 0.3253
    rows[8][16] = 0.02473
    rows[8][17] = 134.75204
    rows[8][20] = 0.00132683
    rows[8][21] = 3.38e9

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'CC24MB6_FEV - WLTP')
    const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const [test] = parseCompilationWorkbook(bytes, 'g-source.xlsx')

    expect(test.results.CO).toBeCloseTo(325.3, 4)
    expect(test.results.NOx).toBeCloseTo(24.73, 4)
    expect(test.results.CO2).toBeCloseTo(134752.04, 2)
    expect(test.results.PM).toBeCloseTo(1.32683, 5)
    expect(test.results.PN).toBe(3.38e9)
    expect(test.units?.resultsSource).toBe('g/km')
  })
})
