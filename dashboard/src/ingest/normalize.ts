import type { Test, TraceRecord } from '../model/types'
import type { ParsedReport } from './pdfReport'
// Explicit .ts extension — reached from electron/parsePair.ts under Node's
// --experimental-strip-types loader, which has no extensionless resolution.
import { resultForTest } from '../lib/j2951ForTest.ts'

export interface FilenameMeta {
  stem: string
  model: string | null
  transmissionToken: string | null // MT / AT
  vn: string | null
  date: string | null // ISO
}

/** Pull model / transmission / VN / date from a TRACES/REPORT filename stem. */
export function parseFilename(stem: string): FilenameMeta {
  const m = stem.match(/^(?:IN_BM_)?(.+?)_(MT|AT)_(\d+)_\d+_(\d{4}-\d{2}-\d{2})/)
  if (m) {
    return { stem, model: m[1].replace(/_/g, ' '), transmissionToken: m[2], vn: m[3], date: m[4] }
  }
  const d = stem.match(/(\d{4}-\d{2}-\d{2})/)
  return { stem, model: null, transmissionToken: null, vn: null, date: d ? d[1] : null }
}

function classifyProject(model: string | null, vin: string | null): { project: string; guessed: boolean } {
  const s = `${model ?? ''} ${vin ?? ''}`.toUpperCase()
  if (/CITROEN|PEUGEOT|JEEP|FIAT|OPEL|STLA/.test(s)) return { project: 'STLA', guessed: false }
  if (/HONDA/.test(s)) return { project: 'Honda', guessed: false }
  if (/NISSAN|RENAULT|DATSUN|RNTBCI/.test(s)) return { project: 'RNTBCI', guessed: false }
  return { project: 'STLA', guessed: true }
}

function classifyCycle(
  cycleUsed: string | null,
  distanceKm: number | null,
): { cycle: string; guessed: boolean } {
  const c = (cycleUsed ?? '').toUpperCase()
  if (/WLTP/.test(c)) return { cycle: 'WLTP', guessed: false }
  if (/MIDC/.test(c)) return { cycle: 'MIDC', guessed: false }
  if (/NEDC/.test(c)) return { cycle: 'NEDC', guessed: false }
  // IN_BM_CCxx style: fall back to distance (WLTP ~15km/3-4 phases, MIDC ~10.6km)
  if (distanceKm != null) {
    if (distanceKm >= 13) return { cycle: 'WLTP', guessed: true }
    if (distanceKm >= 9 && distanceKm < 13) return { cycle: 'MIDC', guessed: true }
  }
  return { cycle: 'Unknown', guessed: true }
}

function classifyConfig(cycleUsed: string | null): string {
  const m = (cycleUsed ?? '').match(/CC\s?(\d+)/i)
  return m ? `CC${m[1]}` : 'Unknown'
}

function classifyTransmission(raw: string | null, token: string | null): string {
  const s = (raw ?? token ?? '').toUpperCase()
  if (/MANUAL|MT|MB/.test(s)) return 'MB6'
  if (/AUTO|AT|DCT|CVT/.test(s)) return 'AT6'
  return 'Unknown'
}

const EMPTY_RESULTS = { CO: null, THC: null, NOx: null, CO2: null, CH4: null, NMHC: null, PM: null, PN: null }

/** Build a normalized Test from a parsed PDF (+ optional trace) and filename. */
export function buildTest(
  stem: string,
  report: ParsedReport | null,
  trace: TraceRecord | null,
  sources: { pdf?: string; xlsm?: string },
  importedAt: string,
): Test {
  const fn = parseFilename(stem)
  const low = [...(report?.lowConfidence ?? [])]
  if (!report) low.push('results', 'metadata')

  const proj = classifyProject(fn.model, report?.meta.vin ?? null)
  if (proj.guessed) low.push('project')
  const cyc = classifyCycle(report?.meta.cycleUsed ?? null, report?.meta.distanceKm ?? null)
  if (cyc.guessed) low.push('cycle')
  const config = classifyConfig(report?.meta.cycleUsed ?? null)
  if (config === 'Unknown') low.push('config')
  const transmission = classifyTransmission(report?.meta.transmissionRaw ?? null, fn.transmissionToken)

  const test: Test = {
    id: stem,
    project: proj.project,
    cycle: cyc.cycle,
    config,
    transmission,
    lab: report?.meta.lab ?? 'Unknown',
    vehicleModel: fn.model ?? report?.meta.vin ?? stem,
    vinSampleId: report?.meta.vin ?? '',
    vnNo: fn.vn ?? '',
    date: report?.meta.testDate ?? fn.date ?? '',
    inertia: report?.meta.inertia ?? null,
    odo: report?.meta.odo ?? null,
    distanceKm: report?.meta.distanceKm ?? null,
    phaseCount: report?.meta.phaseCount ?? null,
    stt: null,
    startSoc: null,
    rld: report?.rld ?? { A: null, B: null, C: null },
    // Vehicle A/B/C from the page-1 vehicle table — distinct from `rld`, which
    // is the Dyno Set from the remarks line. J2951 reads only this field; using
    // the dyno values instead is wrong by ~2.5x on the F0 term.
    vehicleRld: report?.vehicleRld ?? { A: null, B: null, C: null },
    fuel: { name: report?.meta.fuelName ?? null, consumptionL100: report?.meta.fuelL100 ?? null },
    conditions: {
      ambientC: report?.meta.ambientC ?? null,
      humidity: null,
      cellPressure: report?.meta.cellPressure ?? null,
    },
    results: report?.results ?? { ...EMPTY_RESULTS },
    phases: report?.phases ?? [],
    trace: trace ?? undefined,
    units: report ? {
      resultsCanonical: 'mg/km',
      resultsSource: report.resultUnit,
      resultSourceByPollutant: {
        CO: report.resultUnit, THC: report.resultUnit, NOx: report.resultUnit, CO2: report.resultUnit,
        CH4: report.resultUnit, NMHC: report.resultUnit, PM: report.pmUnit, PN: '#/km',
      },
    } : undefined,
    source: sources,
    lowConfidence: [...new Set(low)],
    importedAt,
  }
  test.j2951 = resultForTest(test)
  return test
}
