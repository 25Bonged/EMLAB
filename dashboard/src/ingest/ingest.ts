import JSZip from 'jszip'
import type { Test } from '../model/types'
import { loadPdfPages } from './pdfLoad'
import { parseReportItems } from './pdfReport'
import { parseTraceWorkbook, traceUnitMetadata } from './xlsmTrace'
import { buildTest } from './normalize'
import { parseCompilationWorkbook } from './compilationWorkbook'

export interface RawFile { name: string; data: ArrayBuffer }
export interface IngestProgress { stage: string; done: number; total: number }

const base = (name: string) => name.split('/').pop() ?? name
const isPdf = (n: string) => /_REPORT\.pdf$/i.test(n) || /\.pdf$/i.test(n)
const isXlsm = (n: string) => /\.xlsm$/i.test(n)
const isCompilationWorkbook = (n: string) => /\.xlsx$/i.test(n)
const stemOf = (n: string) =>
  base(n).replace(/_REPORT\.pdf$/i, '').replace(/_TRACES\.xlsm$/i, '').replace(/\.(pdf|xlsm)$/i, '')

/** Expand any zip entries; pass through pdf/xlsm files. */
export async function expandFiles(files: File[]): Promise<RawFile[]> {
  const out: RawFile[] = []
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) {
      const zip = await JSZip.loadAsync(await f.arrayBuffer())
      for (const entry of Object.values(zip.files)) {
        if (entry.dir) continue
        if (isPdf(entry.name) || isXlsm(entry.name)) {
          out.push({ name: entry.name, data: await entry.async('arraybuffer') })
        }
      }
    } else if (isPdf(f.name) || isXlsm(f.name)) {
      out.push({ name: f.name, data: await f.arrayBuffer() })
    }
  }
  return out
}

/** Pair pdf+xlsm by stem, parse each, return normalized Tests. */
export async function ingestFiles(
  files: File[],
  onProgress?: (p: IngestProgress) => void,
): Promise<Test[]> {
  const tests: Test[] = []
  for (const f of files.filter((file) => isCompilationWorkbook(file.name))) {
    onProgress?.({ stage: `Reading ${f.name}`, done: tests.length, total: files.length })
    tests.push(...parseCompilationWorkbook(await f.arrayBuffer(), f.name))
  }
  const raw = await expandFiles(files)
  const groups = new Map<string, { pdf?: RawFile; xlsm?: RawFile }>()
  for (const f of raw) {
    const stem = stemOf(f.name)
    const g = groups.get(stem) ?? {}
    if (isXlsm(f.name)) g.xlsm = f
    else g.pdf = f
    groups.set(stem, g)
  }

  const importedAt = new Date().toISOString()
  const entries = [...groups.entries()]
  let done = 0
  for (const [stem, g] of entries) {
    onProgress?.({ stage: `Parsing ${stem}`, done, total: entries.length })
    let report = null
    let trace = null
    try {
      if (g.pdf) report = parseReportItems(await loadPdfPages(g.pdf.data))
    } catch (e) {
      console.error('PDF parse failed', stem, e)
    }
    try {
      if (g.xlsm) trace = parseTraceWorkbook(g.xlsm.data)
    } catch (e) {
      console.error('XLSM parse failed', stem, e)
    }
    if (report || trace) {
      const test = buildTest(stem, report, trace, { pdf: g.pdf?.name, xlsm: g.xlsm?.name }, importedAt)
      if (g.xlsm) {
        test.units = {
          ...(test.units ?? { resultsCanonical: 'mg/km', resultsSource: 'mg/km' }),
          trace: traceUnitMetadata(g.xlsm.data),
        }
      }
      tests.push(test)
    }
    done++
    onProgress?.({ stage: `Parsed ${stem}`, done, total: entries.length })
  }
  return tests
}
