import ExcelJS from 'exceljs'
import { POLLUTANTS } from './schema.ts'

export async function exportXlsx(tests: Record<string, any>[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Emission Compilation')

  const headers = [
    'Status', 'Test Date', 'Program', 'Cycle', 'Configuration', 'Transmission', 'Lab',
    'Vehicle', 'VN No.', 'Catalyst', 'STT', 'Start SOC (%)', 'ODO (km)', 'Inertia (kg)',
    ...POLLUTANTS.flatMap((pollutant) =>
      pollutant === 'PN' ? [`${pollutant} (#/km)`] : [`${pollutant} (mg/km)`, `${pollutant} (g/km)`],
    ),
    'Source Result Unit', 'PDF Source', 'XLSM Source', 'Review Flags',
  ]
  ws.addRow(headers)

  for (const test of tests) {
    const results = test.results ?? {}
    const source = test.source ?? {}
    const emissionValues: (number | null)[] = []
    for (const pollutant of POLLUTANTS) {
      const value = results[pollutant] ?? null
      if (pollutant === 'PN') {
        emissionValues.push(value)
      } else {
        emissionValues.push(value, value != null ? value / 1000 : null)
      }
    }
    ws.addRow([
      test.status ?? null, test.date ?? null, test.project ?? null, test.cycle ?? null, test.config ?? null,
      test.transmission ?? null, test.lab ?? null, test.vehicleModel ?? null, test.vnNo ?? null,
      test.catalystState ?? null, test.stt ?? null, test.startSoc ?? null, test.odo ?? null,
      test.inertia ?? null, ...emissionValues, (test.units ?? {}).resultsSource ?? 'mg/km',
      source.pdf ?? null, source.xlsm ?? null, (test.lowConfidence ?? []).join(', '),
    ])
  }

  const headerRow = ws.getRow(1)
  headerRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF12313A' } }
    cell.font = { color: { argb: 'FFFFFFFF' }, bold: true }
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  })
  headerRow.height = 34
  ws.views = [{ state: 'frozen', ySplit: 1 }]
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } }

  const wideHeaders = new Set(['Vehicle', 'Catalyst', 'PDF Source', 'XLSM Source', 'Review Flags'])
  headers.forEach((header, index) => {
    ws.getColumn(index + 1).width = wideHeaders.has(header) ? 30 : 16
  })

  return Buffer.from(await wb.xlsx.writeBuffer())
}
