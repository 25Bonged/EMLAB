import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { serveStatic } from '@hono/node-server/serve-static'
import fs from 'node:fs'
import path from 'node:path'
import { createHash, timingSafeEqual } from 'node:crypto'
import type { Database } from './db.ts'
import type { FolderWatcher } from './watcher.ts'
import { exportXlsx } from './export.ts'
import type { Settings } from './config.ts'

/** Hosts this API may legitimately be addressed as. */
const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/

/** Largest accepted request body. Import payloads are the only large ones; a
 *  real 30-test browser import is a few MB, so 64 MB is generous. */
const MAX_BODY_BYTES = 64 * 1024 * 1024

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
    c.json({ ok: true, can_edit: true, watch_folder: settings.watchFolder, database: settings.databasePath }))

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
    const patch = await c.req.json()
    const test = db.patchTest(c.req.param('id'), patch)
    return test ? c.json(test) : c.json({ detail: 'Test not found' }, 404)
  })

  app.post('/api/tests/import-parsed', async (c) => {
    const payload = await c.req.json()
    const tests: Record<string, any>[] = payload.tests ?? []
    const imported: string[] = []
    for (const test of tests) {
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

  app.get('/api/ingestion', (c) => c.json(db.listJobs()))

  app.post('/api/ingestion/rescan', async (c) => {
    await watcher.scanOnce()
    return c.json({ ok: true, jobs: db.listJobs() })
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
