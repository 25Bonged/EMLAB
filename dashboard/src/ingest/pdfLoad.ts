import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { PageItems, TextItem } from './pdfReport'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

/** Extract positioned text items per page from a PDF (browser). */
export async function loadPdfPages(data: ArrayBuffer): Promise<PageItems[]> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise
  const pages: PageItems[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const vp = page.getViewport({ scale: 1 })
    const tc = await page.getTextContent()
    const items: TextItem[] = tc.items
      .map((i) => i as { str: string; transform: number[] })
      .filter((i) => i.str.trim() !== '')
      .map((i) => ({ s: i.str.trim(), x: +i.transform[4].toFixed(1), y: +i.transform[5].toFixed(1) }))
    pages.push({ width: vp.width, height: vp.height, items })
  }
  return pages
}
