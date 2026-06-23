import fs from 'node:fs'
import path from 'node:path'
import { parseReportItems, type PageItems, type TextItem } from '../src/ingest/pdfReport'
import { parseTraceWorkbook, traceUnitMetadata } from '../src/ingest/xlsmTrace'
import { buildTest } from '../src/ingest/normalize'

const [pdfPath, xlsmPath] = process.argv.slice(2)
if (!pdfPath || !xlsmPath) {
  console.error('usage: parsePair.ts REPORT.pdf TRACES.xlsm')
  process.exit(2)
}

const pdf = fs.readFileSync(pdfPath)
const xlsm = fs.readFileSync(xlsmPath)
const stem = path.basename(pdfPath).replace(/_REPORT\.pdf$/i, '').replace(/\.pdf$/i, '')
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), disableWorker: true }).promise
const pages: PageItems[] = []
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p)
  const viewport = page.getViewport({ scale: 1 })
  const text = await page.getTextContent()
  const items: TextItem[] = text.items
    .map((item) => item as { str: string; transform: number[] })
    .filter((item) => item.str.trim() !== '')
    .map((item) => ({
      s: item.str.trim(),
      x: +item.transform[4].toFixed(1),
      y: +item.transform[5].toFixed(1),
    }))
  pages.push({ width: viewport.width, height: viewport.height, items })
}
const report = parseReportItems(pages)
const trace = parseTraceWorkbook(xlsm.buffer.slice(xlsm.byteOffset, xlsm.byteOffset + xlsm.byteLength))
const test = buildTest(
  stem,
  report,
  trace,
  { pdf: pdfPath, xlsm: xlsmPath },
  new Date().toISOString(),
)
test.units = {
  resultsCanonical: 'mg/km',
  resultsSource: report.resultUnit,
  resultSourceByPollutant: {
    CO: report.resultUnit, THC: report.resultUnit, NOx: report.resultUnit, CO2: report.resultUnit,
    CH4: report.resultUnit, NMHC: report.resultUnit, PM: report.pmUnit, PN: '#/km',
  },
  trace: traceUnitMetadata(xlsm.buffer.slice(xlsm.byteOffset, xlsm.byteOffset + xlsm.byteLength)),
}
process.stdout.write(JSON.stringify(test))
