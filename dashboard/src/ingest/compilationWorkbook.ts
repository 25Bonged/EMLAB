import * as XLSX from 'xlsx'
import type { Pollutant, Test } from '../model/types'

const asText = (value: unknown) => value == null ? '' : String(value).trim()
const normalized = (value: unknown) => asText(value).replace(/\s+/g, ' ').toUpperCase()

function asNumber(value: unknown): number | null {
  if (value == null || value === '' || value === '-') return null
  const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

function isoDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10)
  if (typeof value === 'number') {
    const d = XLSX.SSF.parse_date_code(value)
    if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
  }
  const s = asText(value)
  const dmY = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/)
  if (dmY) {
    const year = dmY[3].length === 2 ? `20${dmY[3]}` : dmY[3]
    return `${year}-${dmY[2].padStart(2, '0')}-${dmY[1].padStart(2, '0')}`
  }
  const parsed = Date.parse(s)
  return Number.isNaN(parsed) ? '' : new Date(parsed).toISOString().slice(0, 10)
}

function sheetMeta(name: string, title: string) {
  const source = `${name} ${title}`.toUpperCase()
  const config = source.match(/CC\s?(\d{2})/)?.[1]
  return {
    config: config ? `CC${config}` : 'Unknown',
    transmission: source.match(/(MB6|MT6|AT6|AMT|DCT|CVT)/)?.[1] ?? 'Unknown',
    cycle: source.match(/(WLTP|MIDC|DDCI|NEDC|RDE)/)?.[1] ?? 'Unknown',
    lab: source.match(/(FEV|ARAI|ICAT|GARC)/)?.[1] ?? 'Unknown',
  }
}

function parseSheet(name: string, rows: unknown[][], sourceName: string, importedAt: string): Test[] {
  if (name === 'All Data' || rows.length < 9) return []
  const headerRow = rows.findIndex((r) => asText(r[0]).toLowerCase() === 'test date')
  if (headerRow < 0) return []
  const title = asText(rows[1]?.[4])
  const meta = sheetMeta(name, title)
  const tests: Test[] = []
  const mainHeaders = rows[headerRow] ?? []
  const subHeaders = rows[headerRow + 1] ?? []
  const mainCol = (pattern: RegExp) => mainHeaders.findIndex((cell) => pattern.test(normalized(cell)))
  const subCol = (pattern: RegExp) => subHeaders.findIndex((cell) => pattern.test(normalized(cell)))
  const pollutantColumns: Record<Pollutant, number> = {
    CO: subCol(/^CO\b/),
    THC: subCol(/^THC\b/),
    NOx: subCol(/^NOX\b/),
    CO2: subCol(/^CO2\b/),
    CH4: subCol(/^CH4\b/),
    NMHC: subCol(/^NMHC\b/),
    PM: subCol(/^PM\b/),
    PN: subCol(/^PN\b/),
  }
  const sourceUnit = (index: number): 'mg/km' | 'g/km' => {
    const header = asText(subHeaders[index]).replace(/\s+/g, ' ').toLowerCase()
    const match = header.match(/(?:^|\s)(mg|g)\s*\/\s*km\b/)
    return match?.[1] === 'g' ? 'g/km' : 'mg/km'
  }
  const col = {
    date: mainCol(/^TEST DATE$/),
    lab: mainCol(/^TEST CONDUCTED$/),
    ambient: mainCol(/^START TCO/),
    vn: mainCol(/^VN NO/),
    transmission: mainCol(/^TRANSMISSION$/),
    fuel: mainCol(/^FUEL$/),
    cycle: mainCol(/^CYCLE$/),
    catalyst: mainCol(/^CATALYST$/),
    rld: mainCol(/^RLD/),
    inertia: mainCol(/^INERTIA/),
    odo: mainCol(/^ODO/),
    stt: mainCol(/^STT$/),
    soc: mainCol(/^START SOC/),
    economy: subCol(/\[KM\/L\]/),
    distance: subCol(/^DISTANCE/),
  }

  for (let i = headerRow + 3; i < rows.length; i++) {
    const r = rows[i] ?? []
    const date = isoDate(r[col.date])
    const vnNo = asText(r[col.vn])
    const hasResults = Object.values(pollutantColumns).some((index) => index >= 0 && asNumber(r[index]) != null)
    if (!date || !hasResults) continue

    const results = {} as Test['results']
    for (const [pollutant, index] of Object.entries(pollutantColumns) as [Pollutant, number][]) {
      const value = index >= 0 ? asNumber(r[index]) : null
      results[pollutant] = value != null && pollutant !== 'PN' && sourceUnit(index) === 'g/km' ? value * 1000 : value
    }

    const sttRaw = asText(r[col.stt]).toUpperCase()
    const lowConfidence: string[] = []
    if (meta.config === 'Unknown') lowConfidence.push('config')
    if (meta.transmission === 'Unknown') lowConfidence.push('transmission')
    if (meta.cycle === 'Unknown') lowConfidence.push('cycle')
    if (!vnNo) lowConfidence.push('vnNo')

    tests.push({
      id: `compile::${name}::${date}::${vnNo || i}`,
      project: 'STLA',
      cycle: meta.cycle,
      config: meta.config,
      transmission: asText(r[col.transmission]) || meta.transmission,
      lab: asText(r[col.lab]) || meta.lab,
      vehicleModel: title || name,
      vinSampleId: '',
      vnNo,
      date,
      catalystState: asText(r[col.catalyst]) || undefined,
      stt: sttRaw === 'ON' || sttRaw === 'OFF' ? sttRaw : null,
      startSoc: asNumber(r[col.soc]),
      inertia: asNumber(r[col.inertia]),
      odo: asNumber(r[col.odo]),
      distanceKm: asNumber(r[col.distance]),
      phaseCount: null,
      rld: {
        A: col.rld >= 0 ? asNumber(r[col.rld]) : null,
        B: col.rld >= 0 ? asNumber(r[col.rld + 1]) : null,
        C: col.rld >= 0 ? asNumber(r[col.rld + 2]) : null,
      },
      // The compilation workbook carries only the dyno RLD, not the page-1
      // vehicle A/B/C that J2951 needs. Left null so ER/EER report unavailable
      // rather than being computed from the wrong coefficients.
      vehicleRld: { A: null, B: null, C: null },
      fuel: { name: asText(r[col.fuel]) || null, consumptionL100: null, economyKmL: asNumber(r[col.economy]) },
      conditions: { ambientC: asNumber(r[col.ambient]), humidity: null, cellPressure: null },
      results,
      phases: [],
      units: {
        resultsCanonical: 'mg/km',
        resultsSource: Object.entries(pollutantColumns).some(([p, index]) => p !== 'PN' && sourceUnit(index) === 'g/km') ? 'g/km' : 'mg/km',
        resultSourceByPollutant: Object.fromEntries(
          Object.entries(pollutantColumns).map(([p, index]) => [p, p === 'PN' ? '#/km' : sourceUnit(index)]),
        ),
      },
      source: { xlsx: sourceName, sheet: name, row: i + 1 },
      lowConfidence,
      importedAt,
    })
  }
  return tests
}

export function parseCompilationWorkbook(data: ArrayBuffer, sourceName: string): Test[] {
  const workbook = XLSX.read(data, { type: 'array', cellDates: true })
  const importedAt = new Date().toISOString()
  return workbook.SheetNames.flatMap((name) => {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], {
      header: 1, defval: null, raw: true,
    })
    return parseSheet(name, rows, sourceName, importedAt)
  })
}
