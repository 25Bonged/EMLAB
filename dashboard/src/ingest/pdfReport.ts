import type { Pollutant } from '../model/types'

export interface TextItem { s: string; x: number; y: number }
export interface PageItems { width: number; height: number; items: TextItem[] }

export interface ParsedReport {
  results: Record<Pollutant, number | null>
  phases: { name: string; distanceKm: number | null; specific: Partial<Record<Pollutant, number>> }[]
  meta: {
    cycleUsed: string | null
    distanceKm: number | null
    inertia: number | null
    odo: number | null
    transmissionRaw: string | null
    gears: string | null
    vin: string | null
    fuelName: string | null
    phaseCount: number | null
    testDate: string | null // ISO
    lab: string | null
    ambientC: number | null
    cellPressure: number | null
    fuelL100: number | null
  }
  /** Dyno Set A/B/C from the page-4 remarks line. */
  rld: { A: number | null; B: number | null; C: number | null }
  /** Vehicle A/B/C from the page-1 vehicle table — what J2951 road load uses. */
  vehicleRld: { A: number | null; B: number | null; C: number | null }
  lowConfidence: string[]
  resultUnit: 'mg/km' | 'g/km'
  pmUnit: 'mg/km' | 'g/km'
}

const POLL_COLS = ['CO', 'THC', 'NOx', 'CO2', 'CH4', 'NMHC'] as const
const near = (a: number, b: number, t = 6) => Math.abs(a - b) <= t
const num = (s: string | undefined | null): number | null => {
  if (s == null) return null
  const v = parseFloat(s.replace(/,/g, ''))
  return Number.isFinite(v) ? v : null
}
const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

function rowAt(items: TextItem[], y: number, ytol = 3): TextItem[] {
  return items.filter((i) => near(i.y, y, ytol)).sort((a, b) => a.x - b.x)
}

/** value item immediately to the right of an exact label on the same row, optionally requiring numeric. */
function rightOf(items: TextItem[], label: string, opts: { numeric?: boolean } = {}): string | null {
  const anchors = items.filter((i) => norm(i.s) === label)
  for (const a of anchors) {
    const right = items
      .filter((i) => near(i.y, a.y, 3) && i.x > a.x + 2)
      .sort((p, q) => p.x - q.x)
    const cand = opts.numeric ? right.find((i) => /^-?[\d.]+$/.test(i.s.replace(/,/g, ''))) : right[0]
    if (cand) return cand.s
  }
  return null
}

/**
 * Vehicle A/B/C from the page-1 vehicle table — the road-load coefficients
 * SAE J2951 needs. Deliberately NOT `rightOf`: that requires an exact label
 * match, and the C label is split across items ("Vehicle C [N/(km/h)" plus a
 * stray "]"), so it would silently miss. Matched by prefix instead.
 *
 * These are a different quantity from the Dyno Set A/B/C in the page-4 remarks
 * that populate `rld` (122.2/0.684/0.0434 vs 48.3933/-0.111/0.04692 on the
 * sample report). Only page 1 is searched, so the two cannot be confused.
 *
 * Naively taking the leftmost numeric on each row is wrong: the "²" in the
 * Vehicle C unit ("[N/(km/h)²]") is emitted by pdfjs as its own text item
 * ("2"), superscripted and sitting *left* of the actual value, so it wins a
 * leftmost-numeric race. It's only ~2pt off the value's dy, too close to the
 * label's row to reliably separate with a y-tolerance tweak — a fix like that
 * is exactly how this bug got introduced (tuned against one extractor's
 * spacing, broke on another's). Instead we use the table's structure: A, B
 * and C's real values all sit in the same x column, and stray items like the
 * superscript don't. So collect every numeric candidate per row, then keep
 * only the leftmost x column shared by all found anchors (columns compared
 * with a small tolerance since digit widths shift x slightly row to row).
 */
function vehicleRldFrom(p1: TextItem[]): { A: number | null; B: number | null; C: number | null } {
  const letters = ['A', 'B', 'C'] as const
  const candidatesByLetter: Partial<Record<'A' | 'B' | 'C', TextItem[]>> = {}
  for (const letter of letters) {
    const re = new RegExp(`^Vehicle ${letter}\\b`)
    const a = p1.find((i) => re.test(norm(i.s)))
    if (!a) continue
    candidatesByLetter[letter] = p1
      .filter((i) => near(i.y, a.y, 3) && i.x > a.x + 2 && /^-?[\d.]+$/.test(i.s.replace(/,/g, '')))
      .sort((p, q) => p.x - q.x)
  }
  const found = letters.filter((l) => candidatesByLetter[l])
  if (found.length < 3) return { A: null, B: null, C: null }

  // Leftmost x column whose value is present (within tolerance) in every row.
  const [first, ...rest] = found.map((l) => candidatesByLetter[l]!)
  const sharedX = first
    .map((c) => c.x)
    .sort((a, b) => a - b)
    .find((x) => rest.every((cands) => cands.some((c) => near(c.x, x, 2))))
  if (sharedX == null) return { A: null, B: null, C: null }

  const pick = (letter: 'A' | 'B' | 'C'): number | null => {
    const cand = candidatesByLetter[letter]?.find((c) => near(c.x, sharedX, 2))
    return cand ? num(cand.s) : null
  }
  return { A: pick('A'), B: pick('B'), C: pick('C') }
}

/** value item directly below a label (same x column), matching an optional pattern. */
function belowOf(items: TextItem[], label: string, pattern?: RegExp): string | null {
  const a = items.find((i) => norm(i.s) === label)
  if (!a) return null
  const below = items
    .filter((i) => i.y < a.y && a.y - i.y < 16 && near(i.x, a.x, 20))
    .sort((p, q) => q.y - p.y)
  const cand = pattern ? below.find((i) => pattern.test(i.s)) : below[0]
  return cand ? cand.s : null
}

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
}
function toIso(d: string | null): string | null {
  if (!d) return null
  const m = d.match(/(\d{1,2})[-/ ]([A-Za-z]{3})[-/ ](\d{4})/)
  if (m) return `${m[3]}-${MONTHS[m[2].toLowerCase()] ?? '01'}-${m[1].padStart(2, '0')}`
  const m2 = d.match(/(\d{2})[.](\d{2})[.](\d{4})/)
  if (m2) return `${m2[3]}-${m2[2]}-${m2[1]}`
  return null
}

/** Locate pollutant column x-positions from the topmost CO/THC/NOx/... header row on a page. */
function pollutantColumns(page: TextItem[]): Record<string, number> | null {
  const heads = page.filter((i) => (POLL_COLS as readonly string[]).includes(i.s))
  if (!heads.length) return null
  const topY = Math.max(...heads.map((i) => i.y))
  const cols: Record<string, number> = {}
  for (const nm of POLL_COLS) {
    const h = heads.find((i) => i.s === nm && near(i.y, topY, 2))
    if (h) cols[nm] = h.x
  }
  return Object.keys(cols).length >= 4 ? cols : null
}

function readSpecificRow(rowCells: TextItem[], cols: Record<string, number>): Partial<Record<Pollutant, number>> {
  const out: Partial<Record<Pollutant, number>> = {}
  for (const [nm, x] of Object.entries(cols)) {
    const c = rowCells.find((i) => near(i.x, x, 9) && /^-?[\d.]/.test(i.s))
    if (c) out[nm as Pollutant] = num(c.s) ?? undefined
  }
  return out
}

/**
 * Pure parser over positioned text. Works on the FEV `F_BO2_05/V05` template.
 * Complete-cycle results are the TOPMOST `Specific [mg/km]` row on the results page.
 */
export function parseReportItems(pages: PageItems[]): ParsedReport {
  const low: string[] = []
  const p1 = pages[0]?.items ?? []
  // results page = the page whose first "Specific [mg/km]" sits highest; in practice page 3 (index 2)
  const specificUnit = (items: TextItem[]): 'mg/km' | 'g/km' =>
    items.some((i) => /Specific \[g\/km\]/i.test(norm(i.s))) ? 'g/km' : 'mg/km'
  const resultsPageIdx = pages.findIndex((pg) => pg.items.some((i) => /^Specific \[(m?g)\/km\]$/i.test(norm(i.s))))
  const pr = pages[resultsPageIdx]?.items ?? []
  const resultUnit = specificUnit(pr)

  // ---- complete-cycle Specific [mg/km] (topmost) ----
  const cols = pollutantColumns(pr) ?? { CO: 198.4, THC: 254.8, NOx: 311.2, CO2: 367.7, CH4: 424.1, NMHC: 484.1 }
  const specAnchors = pr.filter((i) => /^Specific \[(m?g)\/km\]$/i.test(norm(i.s))).sort((a, b) => b.y - a.y)
  const results: Record<Pollutant, number | null> = {
    CO: null, THC: null, NOx: null, CO2: null, CH4: null, NMHC: null, PM: null, PN: null,
  }
  if (specAnchors.length) {
    const cc = readSpecificRow(rowAt(pr, specAnchors[0].y), cols)
    for (const k of POLL_COLS) {
      const value = cc[k] ?? null
      results[k] = value != null && resultUnit === 'g/km' ? value * 1000 : value
    }
  } else {
    low.push('results')
  }

  // ---- PM + PN (page 2 usually) ----
  let pmUnit: 'mg/km' | 'g/km' = 'mg/km'
  for (const pg of pages) {
    const it = pg.items
    const pmAnchor = it.find((i) => norm(i.s).startsWith('Flow through filters'))
    if (pmAnchor && results.PM == null) {
      // "Specific [mg/km] :" value is the rightmost numeric on that row
      const cell = rowAt(it, pmAnchor.y).filter((i) => /^[\d.]+$/.test(i.s) && i.x > 450).pop()
      pmUnit = specificUnit(it)
      const value = num(cell?.s ?? null)
      results.PM = value != null && pmUnit === 'g/km' ? value * 1000 : value
    }
    const pnAnchor = it.find((i) => norm(i.s) === 'N [#/km]')
    if (pnAnchor && results.PN == null) {
      const cell = rowAt(it, pnAnchor.y).filter((i) => /E\+|^[\d.]+$/i.test(i.s) && i.x > pnAnchor.x).pop()
      results.PN = num(cell?.s ?? null)
    }
  }
  if (results.PM == null) low.push('PM')
  if (results.PN == null) low.push('PN')

  // ---- phases: distances from page-1 "Cycle Run" table + per-phase specific rows ----
  const phaseDist: Record<number, number | null> = {}
  for (const i of p1) {
    const m = norm(i.s).match(/^Phase (\d)$/)
    if (m) {
      const d = rowAt(p1, i.y).filter((c) => c.x > i.x && /^[\d.]+$/.test(c.s))[0]
      phaseDist[+m[1]] = num(d?.s ?? null)
    }
  }
  const phaseSpecRows = specAnchors.slice(1).sort((a, b) => b.y - a.y) // after complete-cycle, top→down
  // gather phase specific rows across all pages in document order
  const allPhaseSpec: { name: string; specific: Partial<Record<Pollutant, number>> }[] = []
  let pn = 1
  for (let pi = resultsPageIdx; pi < pages.length; pi++) {
    const it = pages[pi].items
    const colsP = pollutantColumns(it) ?? cols
    const anchors = it
      .filter((i) => /^Specific \[(m?g)\/km\]$/i.test(norm(i.s)))
      .sort((a, b) => b.y - a.y)
    const skipTop = pi === resultsPageIdx ? 1 : 0 // skip complete-cycle on results page
    for (const a of anchors.slice(skipTop)) {
      const source = readSpecificRow(rowAt(it, a.y), colsP)
      const unit = specificUnit(it)
      const specific = Object.fromEntries(
        Object.entries(source).map(([key, value]) => [key, value != null && unit === 'g/km' ? value * 1000 : value]),
      ) as Partial<Record<Pollutant, number>>
      allPhaseSpec.push({ name: `Phase ${pn}`, specific })
      pn++
    }
  }
  void phaseSpecRows
  const phases = allPhaseSpec.map((ph, idx) => ({
    name: ph.name,
    distanceKm: phaseDist[idx + 1] ?? null,
    specific: ph.specific,
  }))

  // ---- metadata (page 1) ----
  const distRaw = num(rightOf(p1, 'Distance [km]', { numeric: true }))
  const meta = {
    cycleUsed: rightOf(p1, 'Cycle Used'),
    distanceKm: distRaw,
    inertia: num(rightOf(p1, 'Inertia [kg]', { numeric: true })),
    odo: num(rightOf(p1, 'Odo Before Test [km]', { numeric: true })),
    transmissionRaw: rightOf(p1, 'Transmission type'),
    gears: rightOf(p1, 'Number of gears'),
    vin: rightOf(p1, 'VIN[Sample ID]'),
    fuelName: rightOf(p1, 'Fuel name:'),
    phaseCount: num(rightOf(p1, 'Number of Phases', { numeric: true })),
    testDate: toIso(belowOf(p1, 'Test Date', /\d{1,2}-[A-Za-z]{3}-\d{4}/)),
    lab: /FEV/i.test(pages.map((p) => p.items.map((i) => i.s).join(' ')).join(' ')) ? 'FEV'
      : /ARAI/i.test(pages.map((p) => p.items.map((i) => i.s).join(' ')).join(' ')) ? 'ARAI' : null,
    ambientC: num(rightOf(p1, 'Ambient Temperature [°C]:', { numeric: true })),
    cellPressure: num(rightOf(p1, 'Cell Pressure [mbar]:', { numeric: true })),
    fuelL100: num(rightOf(pr, 'Consumption [l/100km]', { numeric: true })),
  }
  if (meta.distanceKm == null) low.push('distance')
  if (!meta.cycleUsed) low.push('cycleUsed')

  // ---- dyno set (A/B/C) from remarks, any page ----
  const allText = pages.map((p) => p.items.map((i) => i.s).join(' ')).join(' ')
  const dm = allText.match(/A\s*=\s*(-?[\d.]+).*?B\s*=\s*(-?[\d.]+).*?C\s*=\s*(-?[\d.]+)/)
  const rld = dm ? { A: +dm[1], B: +dm[2], C: +dm[3] } : { A: null, B: null, C: null }
  if (!dm) low.push('rld')

  // ---- vehicle A/B/C from the page-1 vehicle table (J2951 road load) ----
  const vehicleRld = vehicleRldFrom(p1)
  if (vehicleRld.A == null || vehicleRld.B == null || vehicleRld.C == null) low.push('vehicleRld')

  return { results, phases, meta, rld, vehicleRld, lowConfidence: low, resultUnit, pmUnit }
}
