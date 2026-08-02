import { Hono } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { Database } from './db.ts'
import type { FolderWatcher } from './watcher.ts'
import { exportXlsx } from './export.ts'
import type { Settings } from './config.ts'

function sortKeysDeep(value: any): any {
  if (Array.isArray(value)) return value.map(sortKeysDeep)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeysDeep(value[key])]))
  }
  return value
}

export function createServer(db: Database, watcher: FolderWatcher, settings: Settings): Hono {
  const app = new Hono()

  app.get('/api/health', (c) =>
    c.json({ ok: true, can_edit: true, watch_folder: settings.watchFolder, database: settings.databasePath }))

  app.get('/api/tests', (c) => {
    const includeNonaccepted = c.req.query('include_nonaccepted') !== 'false'
    const summary = c.req.query('summary') !== 'false'
    const rows = db.listTests(includeNonaccepted)
    return c.json(summary ? rows.map((test) => ({ ...test, trace: null, phases: [] })) : rows)
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
      headers: { 'Content-Disposition': `attachment; filename="${path.basename(filePath)}"` },
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
