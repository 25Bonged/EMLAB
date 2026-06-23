import * as XLSX from 'xlsx'
import type { TraceRecord, TracePoint, UnitMetadata } from '../model/types'

function rows(wb: XLSX.WorkBook, sheet: string): unknown[][] {
  const ws = wb.Sheets[sheet]
  if (!ws) return []
  return XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false }) as unknown[][]
}
const n = (v: unknown): number | undefined => {
  const x = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(x) ? x : undefined
}

/** Parse the trace sheets from a *_TRACES.xlsm workbook (rows 0=names, 1=units, 2+=data). */
export function parseTraceWorkbook(data: ArrayBuffer): TraceRecord {
  const wb = XLSX.read(data, { type: 'array' })

  // Dilute_Results_Trace: Time, Speed, Force, Power, Nox, CO, CO2, THC, CH4, Concentration(PN), [grams x5]
  const dilute: TracePoint[] = rows(wb, 'Dilute_Results_Trace')
    .slice(2)
    .map((r) => ({
      t: n(r[0]) ?? 0,
      speed: n(r[1]),
      force: n(r[2]),
      power: n(r[3]),
      NOx: n(r[4]),
      CO: n(r[5]),
      CO2: n(r[6]),
      THC: n(r[7]),
      CH4: n(r[8]),
      PN: n(r[9]),
      CO_mass_g: n(r[10]),
      THC_mass_g: n(r[11]),
      NOx_mass_g: n(r[12]),
      CO2_mass_g: n(r[13]),
      CH4_mass_g: n(r[14]),
    }))
    .filter((p) => p.t > 0)

  // Raw_PreCat / Raw_PostCat: Time, Nox, CO, CO2, THC, CH4, NMHC, COH, O2
  const raw = (sheet: string): TracePoint[] =>
    rows(wb, sheet)
      .slice(2)
      .map((r) => ({
        t: n(r[0]) ?? 0,
        NOx: n(r[1]),
        CO: n(r[2]),
        CO2: n(r[3]),
        THC: n(r[4]),
        CH4: n(r[5]),
        NMHC: n(r[6]),
        COH: n(r[7]),
        O2: n(r[8]),
      }))
      .filter((p) => p.t > 0)

  return { dilute, preCat: raw('Raw_PreCat_Trace'), postCat: raw('Raw_PostCat_Trace') }
}

export function traceUnitMetadata(data: ArrayBuffer): NonNullable<UnitMetadata['trace']> {
  const wb = XLSX.read(data, { type: 'array' })
  const unitRow = (sheet: string) => rows(wb, sheet)[1] ?? []
  const dilute = unitRow('Dilute_Results_Trace')
  const pre = unitRow('Raw_PreCat_Trace')
  const mapRaw = (r: unknown[]) => ({
    t: String(r[0] ?? 's'), NOx: String(r[1] ?? 'ppm'), CO: String(r[2] ?? 'ppm'),
    CO2: String(r[3] ?? '%'), THC: String(r[4] ?? 'ppm'), CH4: String(r[5] ?? 'ppm'),
    NMHC: String(r[6] ?? 'ppm'), COH: String(r[7] ?? '%'), O2: String(r[8] ?? '%'),
  })
  return {
    dilute: {
      t: String(dilute[0] ?? 's'), speed: String(dilute[1] ?? 'km/h'),
      force: String(dilute[2] ?? 'N'), power: String(dilute[3] ?? 'kW'),
      NOx: String(dilute[4] ?? 'ppm'), CO: String(dilute[5] ?? 'ppm'),
      CO2: String(dilute[6] ?? '%'), THC: String(dilute[7] ?? 'ppm'),
      CH4: String(dilute[8] ?? 'ppm'), PN: String(dilute[9] ?? '1/cm3'),
      CO_mass_g: String(dilute[10] ?? 'g'), THC_mass_g: String(dilute[11] ?? 'g'),
      NOx_mass_g: String(dilute[12] ?? 'g'), CO2_mass_g: String(dilute[13] ?? 'g'),
      CH4_mass_g: String(dilute[14] ?? 'g'),
    },
    preCat: mapRaw(pre),
    postCat: mapRaw(unitRow('Raw_PostCat_Trace')),
  }
}
