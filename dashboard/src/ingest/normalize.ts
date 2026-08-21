import type { Test, TraceRecord } from '../model/types'
import type { ParsedReport } from './pdfReport'
// Explicit .ts extension — reached from electron/parsePair.ts under Node's
// --experimental-strip-types loader, which has no extensionless resolution.
import { resultForTest } from '../lib/j2951ForTest.ts'

export interface FilenameMeta {
  stem: string
  model: string | null
  transmissionToken: string | null // MT / AT / DCT / CVT / DET
  cycleToken: string | null // WLTP / MIDC / NEDC / RDE
  vn: string | null
  date: string | null // ISO
}

/** Pull model / transmission / VN / date from a TRACES/REPORT filename stem. */
export function parseFilename(stem: string): FilenameMeta {
  const date = stem.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? null
  const beforeDate = date ? stem.slice(0, stem.indexOf(date)).replace(/_+$/, '') : stem
  const parts = beforeDate.replace(/^IN_BM_/, '').split('_').filter(Boolean)
  const cycleToken = parts.find((p) => /^(WLTP|MIDC|NEDC|RDE|DDCI)$/i.test(p))?.toUpperCase() ?? null
  const transmissionIndex = parts.findIndex((p) => /^(MT|MB|AT|DCT|CVT|DET)$/i.test(p))
  if (transmissionIndex >= 0) {
    const token = parts[transmissionIndex].toUpperCase()
    const tail = parts.slice(transmissionIndex + 1)
    const descriptorTokens: string[] = []
    let vn: string | null = null
    for (const p of tail) {
      if (/^(WLTP|MIDC|NEDC|RDE|DDCI)$/i.test(p)) continue
      if (/^(V|T)?\d+$/i.test(p)) {
        vn = p
        break
      }
      descriptorTokens.push(p)
    }
    const modelParts = [...parts.slice(0, transmissionIndex), ...descriptorTokens]
    return {
      stem,
      model: modelParts.join(' ') || null,
      transmissionToken: token,
      cycleToken,
      vn,
      date,
    }
  }
  return { stem, model: null, transmissionToken: null, cycleToken, vn: null, date }
}

function classifyCycle(
  cycleUsed: string | null,
  distanceKm: number | null,
  filenameCycle: string | null,
): { cycle: string; guessed: boolean } {
  const c = (cycleUsed ?? '').toUpperCase()
  if (/WLTP/.test(c)) return { cycle: 'WLTP', guessed: false }
  if (/MIDC/.test(c)) return { cycle: 'MIDC', guessed: false }
  if (/NEDC/.test(c)) return { cycle: 'NEDC', guessed: false }
  const f = (filenameCycle ?? '').toUpperCase()
  if (/WLTP/.test(f)) return { cycle: 'WLTP', guessed: false }
  if (/MIDC/.test(f)) return { cycle: 'MIDC', guessed: false }
  if (/NEDC/.test(f)) return { cycle: 'NEDC', guessed: false }
  if (/RDE|DDCI/.test(f)) return { cycle: f, guessed: false }
  // IN_BM_CCxx style: fall back to distance (WLTP ~15km/3-4 phases, MIDC ~10.6km)
  if (distanceKm != null) {
    if (distanceKm >= 13) return { cycle: 'WLTP', guessed: true }
    if (distanceKm >= 9 && distanceKm < 13) return { cycle: 'MIDC', guessed: true }
  }
  return { cycle: 'Unknown', guessed: true }
}

function classifyConfig(cycleUsed: string | null, fn: FilenameMeta, reportVin: string | null): string {
  const m = (cycleUsed ?? '').match(/CC\s?(\d+)/i)
  if (m) return `CC${m[1]}`

  const signal = [
    fn.stem,
    fn.model,
    reportVin,
  ].filter(Boolean).join(' ').toUpperCase()

  if (/AIRCROSS/.test(signal)) return 'CC24'
  if (/BASALT/.test(signal)) return 'CC22'
  if (/(^|[_\s-])C3([_\s-]|$)/.test(signal)) return 'CC21'

  if (/RNTBCI[_\s-]+DUSTER|^DUSTER[_\s-]|[_\s-]DUSTER[_\s-]/.test(signal)) return 'DUSTER'
  if (/RBC[_\s-]+HR1[03]|TRIBER|(^|[_\s-])HR1[03]([_\s-]|$)/.test(signal)) return 'HR10-TRIBER'
  if (/(^|[_\s-])R1324([_\s-]|$)/.test(signal)) return 'R1324'

  return 'Unknown'
}

function classifyTransmission(raw: string | null, token: string | null): string {
  const s = (raw ?? token ?? '').toUpperCase()
  if (/MANUAL|MT|MB/.test(s)) return 'MB6'
  if (/AUTO|AT|DCT|CVT/.test(s)) return 'AT6'
  if (/DET/.test(s)) return 'DET'
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

  // Program is assigned from the folder a report was ingested into (watcher /
  // manual import), not guessed from the filename. Left empty here.
  const cyc = classifyCycle(report?.meta.cycleUsed ?? null, report?.meta.distanceKm ?? null, fn.cycleToken)
  if (cyc.guessed) low.push('cycle')
  const config = classifyConfig(report?.meta.cycleUsed ?? null, fn, report?.meta.vin ?? null)
  if (config === 'Unknown') low.push('config')
  const transmission = classifyTransmission(report?.meta.transmissionRaw ?? null, fn.transmissionToken)

  const test: Test = {
    id: stem,
    project: '',
    wp: 'emission',
    regulatory: {
      family: 'india-bs6-mn-lt-3p5t',
      category: 'M1_M2',
      ignition: 'PI',
      referenceMassKg: report?.meta.inertia ?? null,
      directInjection: true,
      obdStage: 'OBD-II',
      source: 'default',
    },
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
