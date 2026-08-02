import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { parseReportItems, type PageItems, type TextItem } from './pdfReport'

// Real FEV report data — confidential, never committed (see .gitignore's
// "OneDrive_*/" rule). Present on engineering machines only, so this suite
// skips itself in CI and on any machine without the fixture checked out,
// rather than failing on a file that was never meant to exist there.
const DATA = resolve(__dirname, '../../../OneDrive_3_6-20-2026 (1)')
const F1 = `${DATA}/OneDrive_1_6-20-2026/CITROEN_AIRCROSS_MT_9740_5099_2026-03-18_09-51-01_REPORT.pdf`
const hasFixture = existsSync(F1)

async function load(path: string): Promise<PageItems[]> {
  const doc = await getDocument({ data: new Uint8Array(readFileSync(path)), useSystemFonts: true }).promise
  const pages: PageItems[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const vp = page.getViewport({ scale: 1 })
    const tc = await page.getTextContent()
    const items: TextItem[] = (tc.items as { str: string; transform: number[] }[])
      .filter((i) => i.str.trim() !== '')
      .map((i) => ({ s: i.str.trim(), x: +i.transform[4].toFixed(1), y: +i.transform[5].toFixed(1) }))
    pages.push({ width: vp.width, height: vp.height, items })
  }
  return pages
}

describe.skipIf(!hasFixture)('parseReportItems (FEV template, ground truth = compile workbook)', () => {
  it('extracts complete-cycle results for 18-Mar-2026 CC24/MT', async () => {
    const r = parseReportItems(await load(F1))
    // complete-cycle Specific [mg/km] — must be complete cycle, NOT Phase 1 (262.0)
    expect(r.results.CO).toBeCloseTo(325.3, 1)
    expect(r.results.THC).toBeCloseTo(7.59, 2)
    expect(r.results.NOx).toBeCloseTo(24.73, 2)
    expect(r.results.CO2).toBeCloseTo(134752.04, 0)
    expect(r.results.CH4).toBeCloseTo(2.68, 2)
    expect(r.results.NMHC).toBeCloseTo(4.42, 2)
    expect(r.results.PM).toBeCloseTo(1.32683, 4)
    expect(r.results.PN).toBeCloseTo(3.38e9, -7)
    expect(r.resultUnit).toBe('mg/km')
    expect(r.pmUnit).toBe('mg/km')
    // metadata
    expect(r.meta.cycleUsed).toBe('IN_BM_CC24_MT')
    expect(r.meta.inertia).toBe(1464)
    expect(r.meta.odo).toBe(139)
    expect(r.meta.distanceKm).toBeCloseTo(14.96, 2)
    expect(r.meta.transmissionRaw).toBe('Manual')
    expect(r.meta.testDate).toBe('2026-03-18')
    expect(r.meta.lab).toBe('FEV')
    // dyno set from page 4 remarks
    expect(r.rld.A).toBeCloseTo(48.3933, 3)
    expect(r.rld.B).toBeCloseTo(-0.111, 3)
    expect(r.rld.C).toBeCloseTo(0.04692, 4)
    expect(r.lowConfidence).not.toContain('results')
  })

  it('reads Vehicle A/B/C from the page-1 vehicle table, distinct from the dyno set', async () => {
    const r = parseReportItems(await load(F1))
    // J2951's road-load term needs these, NOT the Dyno Set values on page 4.
    // Confusing the two makes ER/EER wrong by ~2.5x on the F0 term, which is
    // exactly why this asserts both sets on the same report.
    expect(r.vehicleRld.A).toBeCloseTo(122.2, 3)
    expect(r.vehicleRld.B).toBeCloseTo(0.684, 4)
    expect(r.vehicleRld.C).toBeCloseTo(0.0434, 5)

    expect(r.vehicleRld.A).not.toBeCloseTo(r.rld.A!, 1)
    expect(r.vehicleRld.B).not.toBeCloseTo(r.rld.B!, 2)
    expect(r.lowConfidence).not.toContain('vehicleRld')
  })
})
