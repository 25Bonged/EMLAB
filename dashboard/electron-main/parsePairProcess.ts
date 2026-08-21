import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import type { UtilityProcess } from 'electron'

// See the matching comment in electron-main/index.ts: 'electron' must be
// reached via a real CJS require (Electron's bootstrap only reliably patches
// that path), with `typeof import('electron')` restoring full typing without
// re-triggering the ESM import that's actually broken.
const electron = createRequire(import.meta.url)('electron') as typeof import('electron')
const { utilityProcess } = electron
import type { ParsePair } from '../electron/parsePair.ts'

// Match the worker's extension to this file's own runtime extension: '.ts' in
// dev (running the uncompiled source via --experimental-strip-types) or '.js'
// once compiled for production (tsconfig.build.json). Hardcoding '.ts' here
// would silently break every packaged build -- TypeScript compiles the string
// literal unchanged, so the forked path would point at a .ts file that was
// never included in the release (only build-electron/**/*.js is).
const SELF = fileURLToPath(import.meta.url)
const WORKER_PATH = path.join(path.dirname(SELF), `parseWorker${path.extname(SELF)}`)

const PARSE_TIMEOUT_MS = 180_000 // matches the original Python subprocess's timeout=180

interface PendingRequest {
  resolve: (value: Record<string, any>) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export function createParsePairProcess(): { parsePair: ParsePair; dispose: () => void } {
  let child: UtilityProcess | null = null
  let nextId = 1
  const pending = new Map<number, PendingRequest>()

  function settle(id: number, fn: (request: PendingRequest) => void): void {
    const request = pending.get(id)
    if (!request) return
    pending.delete(id)
    clearTimeout(request.timer)
    fn(request)
  }

  function ensureChild(): UtilityProcess {
    if (child) return child
    child = utilityProcess.fork(WORKER_PATH, [], { execArgv: ['--experimental-strip-types'] })
    child.on('message', (message: { id: number; ok: boolean; result?: any; error?: string }) => {
      settle(message.id, (request) =>
        message.ok ? request.resolve(message.result) : request.reject(new Error(message.error)))
    })
    child.on('exit', (code) => {
      for (const [id, request] of pending) {
        clearTimeout(request.timer)
        request.reject(new Error(`parse worker exited with code ${code}`))
        pending.delete(id)
      }
      child = null
    })
    return child
  }

  const parsePair: ParsePair = (pdfPath, xlsmPath) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`parse timed out after ${PARSE_TIMEOUT_MS}ms: ${pdfPath}`))
        // The worker may be stuck (e.g. on a malformed PDF) -- discard it
        // rather than leave a wedged process handling future requests.
        child?.kill()
        child = null
      }, PARSE_TIMEOUT_MS)
      pending.set(id, { resolve, reject, timer })
      ensureChild().postMessage({ id, pdfPath, xlsmPath })
    })

  return {
    parsePair,
    dispose: () => {
      for (const request of pending.values()) clearTimeout(request.timer)
      pending.clear()
      child?.kill()
      child = null
    },
  }
}
