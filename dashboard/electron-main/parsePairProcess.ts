import { utilityProcess, type UtilityProcess } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ParsePair } from '../electron/parsePair.ts'

const WORKER_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'parseWorker.ts')

interface PendingRequest {
  resolve: (value: Record<string, any>) => void
  reject: (error: Error) => void
}

export function createParsePairProcess(): { parsePair: ParsePair; dispose: () => void } {
  let child: UtilityProcess | null = null
  let nextId = 1
  const pending = new Map<number, PendingRequest>()

  function ensureChild(): UtilityProcess {
    if (child) return child
    child = utilityProcess.fork(WORKER_PATH, [], { execArgv: ['--experimental-strip-types'] })
    child.on('message', (message: { id: number; ok: boolean; result?: any; error?: string }) => {
      const request = pending.get(message.id)
      if (!request) return
      pending.delete(message.id)
      if (message.ok) request.resolve(message.result)
      else request.reject(new Error(message.error))
    })
    child.on('exit', (code) => {
      for (const request of pending.values()) request.reject(new Error(`parse worker exited with code ${code}`))
      pending.clear()
      child = null
    })
    return child
  }

  const parsePair: ParsePair = (pdfPath, xlsmPath) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      ensureChild().postMessage({ id, pdfPath, xlsmPath })
    })

  return {
    parsePair,
    dispose: () => { child?.kill(); child = null },
  }
}
