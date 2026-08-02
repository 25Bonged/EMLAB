import { parsePair } from '../electron/parsePair.ts'

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
