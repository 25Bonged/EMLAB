import { parsePair } from '../electron/parsePair.ts'

// pdfjs decides Node-vs-browser with:
//   !(process.versions.electron && process.type && process.type !== "browser")
// In a utilityProcess `process.type` is "utility", so pdfjs concludes it is in
// a browser and reaches for DOM globals that do not exist here -- the parse
// dies on "DOMMatrix is not defined" and every report fails to ingest.
// Clearing process.type makes pdfjs take its Node path: the same path the
// passing pdfReport/xlsmTrace unit tests already exercise under plain Node.
// This runs before pdfjs loads -- parsePair imports it dynamically inside the
// function, and nothing in this worker's static import graph pulls it in.
// Safe to scope here: this process does nothing but parse.
Object.defineProperty(process, 'type', { value: undefined, configurable: true })

interface ParseRequest {
  id: number
  pdfPath: string
  xlsmPath: string
}

process.parentPort.on('message', (event) => {
  const { id, pdfPath, xlsmPath } = event.data as ParseRequest
  parsePair(pdfPath, xlsmPath)
    .then((result) => process.parentPort.postMessage({ id, ok: true, result }))
    .catch((error) => process.parentPort.postMessage({ id, ok: false, error: String(error?.message ?? error) }))
})
