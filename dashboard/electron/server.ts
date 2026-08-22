import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { bodyLimit } from 'hono/body-limit'
import { serveStatic } from '@hono/node-server/serve-static'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createHash, timingSafeEqual } from 'node:crypto'
import type { Database } from './db.ts'
import type { FolderWatcher } from './watcher.ts'
import { exportXlsx } from './export.ts'
import { uniqueProgramFolder } from './programPaths.ts'
import { mkdirWithTimeout } from './fsSafety.ts'
import type { Settings } from './config.ts'

/** Hosts this API may legitimately be addressed as. */
const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/

/** Largest accepted request body. Import payloads are the only large ones; a
 *  real 30-test browser import is a few MB, so 64 MB is generous. */
const MAX_BODY_BYTES = 64 * 1024 * 1024
const MAX_IMPORT_TESTS = 50
const WORK_PACKAGES = new Set(['base', 'emission', 'drivability', 'obd'])
const MN_CLASSES = new Set(['M1_M2', 'N1_I', 'N1_II', 'N1_III', 'N2'])
const IGNITIONS = new Set(['PI', 'CI'])
const OBD_STAGES = new Set(['OBD-I', 'OBD-II'])
const POLLUTANTS = new Set(['CO', 'THC', 'NOx', 'CO2', 'CH4', 'NMHC', 'PM', 'PN'])
const OUTLOOK_SYNC_TIMEOUT_MS = 120_000

function isLoopbackOrigin(origin: string): boolean {
  try {
    return LOOPBACK_HOST.test(new URL(origin).host)
  } catch {
    return false
  }
}

/** Strip characters that would let a filename break out of the header. */
const headerSafe = (name: string) => name.replace(/[^\w.\-() ]+/g, '_')

function sortKeysDeep(value: any): any {
  if (Array.isArray(value)) return value.map(sortKeysDeep)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeysDeep(value[key])]))
  }
  return value
}

function isPlainRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function validFiniteNumber(value: unknown, min = -Infinity, max = Infinity): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

function runOutlookDownloader(settings: Settings): Promise<{ ran: boolean; message: string }> {
  const runner = settings.outlookDownloader
  if (!runner || !fs.existsSync(runner)) return Promise.resolve({ ran: false, message: 'Outlook downloader not configured' })

  return new Promise((resolve, reject) => {
    const child = spawn('cmd.exe', ['/d', '/c', 'call', runner], {
      cwd: path.dirname(runner),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    const collect = (chunk: Buffer) => {
      output = `${output}${chunk.toString('utf8')}`.slice(-4000)
    }
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`Outlook sync timed out after ${OUTLOOK_SYNC_TIMEOUT_MS / 1000}s`))
    }, OUTLOOK_SYNC_TIMEOUT_MS)
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve({ ran: true, message: output.trim() })
      else reject(new Error(`Outlook sync failed with exit code ${code}: ${output.trim()}`))
    })
  })
}

async function readJson(c: { req: { json: () => Promise<any> } }): Promise<{ ok: true; value: any } | { ok: false; detail: string }> {
  try {
    return { ok: true, value: await c.req.json() }
  } catch {
    return { ok: false, detail: 'Invalid JSON body' }
  }
}

function validateRegulatory(value: unknown): string | null {
  if (!isPlainRecord(value)) return 'regulatory must be an object'
  if (value.family !== 'india-bs6-mn-lt-3p5t') return 'regulatory.family is not supported'
  if (!MN_CLASSES.has(String(value.category))) return 'regulatory.category is invalid'
  if (!IGNITIONS.has(String(value.ignition))) return 'regulatory.ignition is invalid'
  if (value.obdStage != null && !OBD_STAGES.has(String(value.obdStage))) return 'regulatory.obdStage is invalid'
  if (value.source != null && !['parsed', 'manual', 'default'].includes(String(value.source))) return 'regulatory.source is invalid'
  if (value.referenceMassKg != null && !validFiniteNumber(value.referenceMassKg, 0, 5000)) return 'regulatory.referenceMassKg must be 0..5000 kg'
  if (value.directInjection != null && typeof value.directInjection !== 'boolean') return 'regulatory.directInjection must be boolean'
  return null
}

function validatePatchPayload(patch: unknown): string | null {
  if (!isPlainRecord(patch)) return 'Patch body must be an object'
  if ('wp' in patch && !WORK_PACKAGES.has(String(patch.wp))) return 'wp is invalid'
  if ('regulatory' in patch) {
    const detail = validateRegulatory(patch.regulatory)
    if (detail) return detail
  }
  if ('lowConfidence' in patch && (!Array.isArray(patch.lowConfidence) || patch.lowConfidence.some((x) => typeof x !== 'string' || x.length > 80))) {
    return 'lowConfidence must be a string array'
  }
  for (const key of ['inertia', 'startSoc'] as const) {
    if (key in patch && patch[key] != null && !validFiniteNumber(patch[key], 0, key === 'startSoc' ? 100 : 5000)) return `${key} is out of range`
  }
  if ('vehicleRld' in patch && patch.vehicleRld != null) {
    if (!isPlainRecord(patch.vehicleRld)) return 'vehicleRld must be an object'
    for (const key of ['A', 'B', 'C']) {
      const value = patch.vehicleRld[key]
      if (value != null && !validFiniteNumber(value, -100000, 100000)) return `vehicleRld.${key} is out of range`
    }
  }
  return null
}

function validateParsedTest(test: unknown): string | null {
  if (!isPlainRecord(test)) return 'Each imported test must be an object'
  if ('wp' in test && test.wp != null && !WORK_PACKAGES.has(String(test.wp))) return 'Imported test wp is invalid'
  if ('regulatory' in test && test.regulatory != null) {
    const detail = validateRegulatory(test.regulatory)
    if (detail) return `Imported test ${detail}`
  }
  if (!isPlainRecord(test.results)) return 'Imported test results are required'
  for (const [pollutant, value] of Object.entries(test.results)) {
    if (!POLLUTANTS.has(pollutant)) return `Unsupported pollutant ${pollutant}`
    if (value != null && !validFiniteNumber(value, 0, pollutant === 'PN' ? 1e15 : 1e8)) return `${pollutant} result is out of range`
  }
  if (!Array.isArray(test.lowConfidence)) return 'Imported test lowConfidence must be an array'
  return null
}

/** Constant-time compare, so a wrong token cannot be recovered by timing. */
function tokenMatches(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function createServer(
  db: Database,
  watcher: FolderWatcher,
  settings: Settings,
  /** Shared secret the renderer must present. Omit to run unauthenticated
   *  (standalone dev only — the Electron app always supplies one). */
  authToken?: string,
): Hono {
  const app = new Hono()

  // The renderer and this API are same-origin in the packaged app (both
  // served from resolvedAppUrl -- see electron-main/index.ts), so no browser
  // CORS check ever applies there. In `electron:dev`/`npm run dev` they are
  // NOT: the renderer loads from Vite's own origin (http://127.0.0.1:5173)
  // while this API listens on a different port (a random one in Electron,
  // :8000 standalone). Without a CORS response, Chromium blocks every
  // request before it reaches the Origin/token checks below with "No
  // 'Access-Control-Allow-Origin' header is present" -- the API and its auth
  // are working fine, the browser just never lets the renderer see the
  // response. Must run before the auth-token middleware: the CORS preflight
  // (OPTIONS) never carries the x-emlab-token header, so if auth ran first
  // it would 401 every preflight and produce the exact same symptom.
  // Reuses isLoopbackOrigin so "which origins are trusted" stays defined in
  // one place, matching the CSRF guard further down.
  app.use('*', cors({
    origin: (origin) => (isLoopbackOrigin(origin) ? origin : ''),
    allowHeaders: ['Content-Type', 'x-emlab-token'],
    allowMethods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'],
  }))

  // Loopback binding stops remote machines, and the Origin/Host guards below
  // stop browsers. Neither stops another *local* process from reading the
  // whole confidential library over 127.0.0.1. The renderer gets this token
  // through Electron's IPC bridge, which no other process can read.
  if (authToken) {
    app.use('/api/*', async (c, next) => {
      const supplied = c.req.header('x-emlab-token') ?? ''
      if (!supplied || !tokenMatches(supplied, authToken)) {
        return c.json({ detail: 'Unauthorized' }, 401)
      }
      await next()
    })
  }

  // The server binds 127.0.0.1, but that alone protects nothing against a
  // browser: any page the user visits can reach it. Two distinct attacks and
  // two distinct guards.
  //
  // 1. DNS rebinding. An attacker domain that re-resolves to 127.0.0.1 makes
  //    the browser treat this API as same-origin, giving the page read access
  //    to every confidential emission result. The Host header still carries
  //    the attacker's domain, so rejecting non-loopback Hosts closes it.
  //
  // 2. CSRF. A cross-origin POST with Content-Type: text/plain is a "simple
  //    request" — no preflight, so the browser sends it and the handler runs.
  //    Verified: this previously let any page inject rows via import-parsed
  //    and trigger rescans. Browsers always attach Origin to such requests,
  //    so refusing a non-loopback Origin on mutating verbs closes it. A
  //    missing Origin is allowed: that is a non-browser client (curl, tests),
  //    which is not a CSRF vector since an attacker cannot drive it.
  app.use('*', async (c, next) => {
    // Over real HTTP the Host header is always present. Fall back to the URL's
    // authority so this also holds for fetch-style Requests, which imply it.
    const host = c.req.header('host') ?? new URL(c.req.url).host
    if (!LOOPBACK_HOST.test(host)) {
      return c.json({ detail: 'Refused: EMLAB only serves loopback hosts' }, 403)
    }
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      const origin = c.req.header('origin')
      if (origin && !isLoopbackOrigin(origin)) {
        return c.json({ detail: 'Refused: cross-origin request' }, 403)
      }
    }
    await next()
    // Emission data is confidential; keep it out of caches and stop the
    // browser from sniffing a download into something executable.
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('Referrer-Policy', 'no-referrer')
    if (c.req.path.startsWith('/api/')) c.header('Cache-Control', 'no-store')
  })

  // An unbounded body is a trivial way to exhaust memory on a machine that is
  // also running the test cell's tooling.
  app.use('*', bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: (c) => c.json({ detail: 'Request body too large' }, 413),
  }))

  app.get('/api/health', (c) =>
    c.json({
      ok: true,
      can_edit: true,
      watch_folder: settings.watchFolder,
      database: settings.databasePath,
      outlook_sync_available: Boolean(settings.outlookDownloader && fs.existsSync(settings.outlookDownloader)),
    }))

  app.get('/api/tests', (c) => {
    const includeNonaccepted = c.req.query('include_nonaccepted') !== 'false'
    const summary = c.req.query('summary') !== 'false'
    // The summary path used to parse every row's full data_json — traces
    // included, ~580 KB per test — only to null the trace out again. That is
    // ~29 MB of JSON parsed per call at 50 tests, and this route is hit on
    // load, on refresh, and after every mutation. listTestSummaries drops the
    // trace inside SQLite so it is never parsed at all.
    const rows = summary ? db.listTestSummaries(includeNonaccepted) : db.listTests(includeNonaccepted)
    return c.json(rows)
  })

  app.get('/api/tests/:id', (c) => {
    const test = db.getTest(c.req.param('id'))
    return test ? c.json(test) : c.json({ detail: 'Test not found' }, 404)
  })

  app.patch('/api/tests/:id', async (c) => {
    const parsed = await readJson(c)
    if (!parsed.ok) return c.json({ detail: parsed.detail }, 400)
    const patch = parsed.value
    const invalid = validatePatchPayload(patch)
    if (invalid) return c.json({ detail: invalid }, 400)
    const test = db.patchTest(c.req.param('id'), patch)
    return test ? c.json(test) : c.json({ detail: 'Test not found' }, 404)
  })

  app.post('/api/tests/import-parsed', async (c) => {
    const parsed = await readJson(c)
    if (!parsed.ok) return c.json({ detail: parsed.detail }, 400)
    const payload = parsed.value
    if (!isPlainRecord(payload)) return c.json({ detail: 'Import body must be an object' }, 400)
    const tests: Record<string, any>[] = payload.tests ?? []
    if (!Array.isArray(tests)) return c.json({ detail: 'tests must be an array' }, 400)
    if (tests.length > MAX_IMPORT_TESTS) return c.json({ detail: `At most ${MAX_IMPORT_TESTS} tests can be imported at once` }, 400)
    for (const test of tests) {
      const invalid = validateParsedTest(test)
      if (invalid) return c.json({ detail: invalid }, 400)
    }
    const program = payload.program_id ? db.getProgram(payload.program_id) : null
    const imported: string[] = []
    for (const test of tests) {
      if (program) { test.program_id = program.id; test.project = program.name }
      const stem = test.id ?? 'manual-import'
      const digest = createHash('sha256').update(JSON.stringify(sortKeysDeep(test))).digest('hex')
      const status = test.lowConfidence?.length ? 'quarantined' : 'accepted'
      const { testId: id } = db.saveTest(test, stem, digest, status, 'manual browser import')
      imported.push(id)
    }
    return c.json({ count: imported.length, ids: imported })
  })

  app.post('/api/tests/:id/approve', (c) =>
    db.setStatus(c.req.param('id'), 'accepted') ? c.json({ ok: true }) : c.json({ detail: 'Test not found' }, 404))

  app.post('/api/tests/:id/quarantine', (c) =>
    db.setStatus(c.req.param('id'), 'quarantined') ? c.json({ ok: true }) : c.json({ detail: 'Test not found' }, 404))

  app.delete('/api/tests/:id', (c) =>
    db.deleteTest(c.req.param('id')) ? c.json({ ok: true }) : c.json({ detail: 'Test not found' }, 404))

  app.get('/api/tests/:id/audit', (c) => c.json(db.audit(c.req.param('id'))))

  app.get('/api/tests/:id/evidence/:kind', (c) => {
    const kind = c.req.param('kind')
    if (kind !== 'pdf' && kind !== 'xlsm') return c.json({ detail: 'Evidence kind must be pdf or xlsm' }, 400)
    const filePath = db.sourcePath(c.req.param('id'), kind)
    if (!filePath || !fs.existsSync(filePath)) return c.json({ detail: 'Evidence file not found' }, 404)
    return new Response(new Uint8Array(fs.readFileSync(filePath)), {
      headers: {
        // Filenames come from the watched folder, so they are not fully under
        // our control; unescaped quotes or newlines would split the header.
        'Content-Disposition': `attachment; filename="${headerSafe(path.basename(filePath))}"`,
        'Content-Type': kind === 'pdf' ? 'application/pdf' : 'application/vnd.ms-excel.sheet.macroEnabled.12',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  })

  app.get('/api/programs', (c) => c.json(db.listPrograms()))

  app.post('/api/programs', async (c) => {
    const { name } = await c.req.json()
    const trimmed = String(name ?? '').trim()
    if (!trimmed) return c.json({ detail: 'Program name is required' }, 400)
    if (trimmed.length > 80) return c.json({ detail: 'Program name is too long (max 80 characters)' }, 400)
    const clash = db.listPrograms().some((p) => String(p.name).toLowerCase() === trimmed.toLowerCase())
    if (clash) return c.json({ detail: 'A program with that name already exists' }, 409)
    const folder = uniqueProgramFolder(settings.watchFolder, trimmed, (p) => fs.existsSync(p))
    // Defence in depth: the sanitizer already strips traversal, but never create
    // or register a folder that resolves outside the watch root.
    const root = path.resolve(settings.watchFolder)
    if (path.resolve(folder) !== root && !path.resolve(folder).startsWith(root + path.sep)) {
      return c.json({ detail: 'Invalid program name' }, 400)
    }
    try {
      // Sync mkdirSync here would block the whole Hono server -- Node is
      // single-threaded, so a slow write (a monitored/synced folder; see
      // fsSafety.ts) would freeze every other in-flight request too, not
      // just this one. The async+timeout version can't hang forever, and
      // failing with a real error beats the "Saving..." button that never
      // resolves this used to produce.
      await mkdirWithTimeout(folder)
    } catch (error) {
      return c.json({ detail: error instanceof Error ? error.message : String(error) }, 503)
    }
    return c.json(db.createProgram(trimmed, folder))
  })

  app.patch('/api/programs/:id', async (c) => {
    const { name } = await c.req.json()
    const trimmed = String(name ?? '').trim()
    if (!trimmed) return c.json({ detail: 'Program name is required' }, 400)
    if (trimmed.length > 80) return c.json({ detail: 'Program name is too long (max 80 characters)' }, 400)
    const clash = db.listPrograms().some(
      (p) => p.id !== c.req.param('id') && String(p.name).toLowerCase() === trimmed.toLowerCase())
    if (clash) return c.json({ detail: 'A program with that name already exists' }, 409)
    return db.renameProgram(c.req.param('id'), trimmed)
      ? c.json({ ok: true }) : c.json({ detail: 'Program not found' }, 404)
  })

  app.delete('/api/programs/:id', (c) =>
    db.deleteProgram(c.req.param('id')) ? c.json({ ok: true }) : c.json({ detail: 'Program not found' }, 404))

  app.get('/api/ingestion', (c) => c.json(db.listJobs()))

  app.post('/api/ingestion/rescan', async (c) => {
    const outlook = await runOutlookDownloader(settings)
    await watcher.scanOnce()
    return c.json({ ok: true, outlook, jobs: db.listJobs() })
  })

  app.get('/api/export.xlsx', async (c) => {
    const includeNonaccepted = c.req.query('include_nonaccepted') === 'true'
    const buffer = await exportXlsx(db.listTests(includeNonaccepted))
    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename=emission_compilation.xlsx',
      },
    })
  })

  if (fs.existsSync(settings.dashboardDist)) {
    app.use('/*', serveStatic({ root: settings.dashboardDist }))
    app.get('*', serveStatic({ path: path.join(settings.dashboardDist, 'index.html') }))
  }

  return app
}
