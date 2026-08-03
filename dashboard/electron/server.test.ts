import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Database } from './db.ts'
import { FolderWatcher } from './watcher.ts'
import { createServer } from './server.ts'

function sampleTest(overrides: Record<string, any> = {}) {
  return {
    id: 'sample', project: 'STLA', cycle: 'WLTP', vehicleModel: 'CITROEN AIRCROSS', vnNo: '9740',
    date: '2026-03-18', results: { CO: 10, THC: 1, NOx: 2, CO2: 3, CH4: 4, NMHC: 5, PM: 0.1, PN: 1e9 },
    phases: [] as any[], trace: { dilute: [{ t: 1, NOx: 2 }] }, source: {}, lowConfidence: [] as string[],
    importedAt: '2026-06-20T00:00:00Z', ...overrides,
  }
}

describe('server', () => {
  let dir: string, db: Database, watcher: FolderWatcher, app: ReturnType<typeof createServer>

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'emlab-srv-'))
    mkdirSync(path.join(dir, 'watch'))
    db = new Database(path.join(dir, 'test.db'))
    watcher = new FolderWatcher({ watchFolder: path.join(dir, 'watch'), scanIntervalSeconds: 1 }, db, async () => sampleTest())
    app = createServer(db, watcher, {
      watchFolder: path.join(dir, 'watch'), databasePath: path.join(dir, 'test.db'),
      port: 0, scanIntervalSeconds: 1, dashboardDist: path.join(dir, 'nonexistent-dist'),
    })
  })
  afterEach(() => {
    watcher.stop()
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('reports health', async () => {
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    expect(((await res.json()) as any).ok).toBe(true)
  })

  it('lists and fetches a test, 404ing for an unknown id', async () => {
    const { testId: id } = db.saveTest(sampleTest(), 'stem', 'h', 'accepted', 'ok')

    const list = (await (await app.request('/api/tests')).json()) as any[]
    expect(list).toHaveLength(1)
    expect(list[0].trace).toBeNull()

    const detail = await app.request(`/api/tests/${id}`)
    expect(detail.status).toBe(200)
    expect(((await detail.json()) as any).trace).toBeTruthy()

    expect((await app.request('/api/tests/missing')).status).toBe(404)
  })

  it('patches, approves, quarantines, and deletes a test', async () => {
    const { testId: id } = db.saveTest(sampleTest(), 'stem', 'h', 'quarantined', 'ok')

    const patched = await app.request(`/api/tests/${id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ vehicleModel: 'EDITED' }),
    })
    expect(((await patched.json()) as any).vehicleModel).toBe('EDITED')

    expect((await app.request(`/api/tests/${id}/approve`, { method: 'POST' })).status).toBe(200)
    expect(db.getTest(id)!.status).toBe('accepted')

    expect((await app.request(`/api/tests/${id}/quarantine`, { method: 'POST' })).status).toBe(200)
    expect(db.getTest(id)!.status).toBe('quarantined')

    expect((await app.request(`/api/tests/${id}`, { method: 'DELETE' })).status).toBe(200)
    expect(db.getTest(id)).toBeNull()
    expect((await app.request(`/api/tests/${id}/approve`, { method: 'POST' })).status).toBe(404)
  })

  it('imports parsed tests from the browser', async () => {
    const res = await app.request('/api/tests/import-parsed', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tests: [sampleTest({ id: 'a' }), sampleTest({ id: 'b', vnNo: '1111', lowConfidence: ['results'] })] }),
    })
    const body = (await res.json()) as any
    expect(body.count).toBe(2)
    expect(db.listTests()).toHaveLength(2)
  })

  it('serves evidence files with a content-disposition header, 404ing when absent', async () => {
    const { testId: id } = db.saveTest(sampleTest(), 'stem', 'h', 'accepted', 'ok')
    const pdfPath = path.join(dir, 'watch', 'stem_REPORT.pdf')
    writeFileSync(pdfPath, 'pdf-bytes')
    db.registerSource('stem', 'pdf', pdfPath, 'hash', id)

    const res = await app.request(`/api/tests/${id}/evidence/pdf`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toContain('stem_REPORT.pdf')
    expect((await app.request(`/api/tests/${id}/evidence/xlsm`)).status).toBe(404)
    expect((await app.request(`/api/tests/${id}/evidence/bogus`)).status).toBe(400)
  })

  it('lists ingestion jobs and triggers a rescan', async () => {
    writeFileSync(path.join(dir, 'watch', 'a_REPORT.pdf'), 'x')
    const res = await app.request('/api/ingestion/rescan', { method: 'POST' })
    expect(res.status).toBe(200)
    const jobs = (await (await app.request('/api/ingestion')).json()) as any[]
    expect(jobs).toHaveLength(1)
    expect(jobs[0].status).toBe('pending_pair')
  })

  it('exports an xlsx workbook', async () => {
    db.saveTest(sampleTest(), 'stem', 'h', 'accepted', 'ok')
    const res = await app.request('/api/export.xlsx')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('spreadsheetml')
    const buf = Buffer.from(await res.arrayBuffer())
    expect(buf.length).toBeGreaterThan(0)
  })
})

describe('server security guards', () => {
  let dir: string, db: Database, watcher: FolderWatcher, app: ReturnType<typeof createServer>

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'emlab-sec-'))
    mkdirSync(path.join(dir, 'watch'))
    db = new Database(path.join(dir, 'test.db'))
    watcher = new FolderWatcher({ watchFolder: path.join(dir, 'watch'), scanIntervalSeconds: 1 }, db, async () => sampleTest())
    app = createServer(db, watcher, {
      watchFolder: path.join(dir, 'watch'), databasePath: path.join(dir, 'test.db'),
      port: 0, scanIntervalSeconds: 1, dashboardDist: path.join(dir, 'nonexistent-dist'),
    })
  })
  afterEach(() => {
    watcher.stop()
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  const importBody = JSON.stringify({ tests: [sampleTest({ id: 'injected' })] })

  // A cross-origin POST with Content-Type: text/plain is a "simple request":
  // browsers send it with no preflight, so before this guard any page the user
  // visited could inject rows and trigger rescans.
  it('refuses a cross-origin mutating request', async () => {
    const res = await app.request('/api/tests/import-parsed', {
      method: 'POST',
      headers: { host: '127.0.0.1:8000', origin: 'https://evil.example', 'content-type': 'text/plain' },
      body: importBody,
    })
    expect(res.status).toBe(403)
    expect(db.listTests()).toHaveLength(0)
  })

  it('refuses a cross-origin rescan', async () => {
    const res = await app.request('/api/ingestion/rescan', {
      method: 'POST',
      headers: { host: '127.0.0.1:8000', origin: 'https://evil.example' },
    })
    expect(res.status).toBe(403)
  })

  it('allows a same-origin mutating request', async () => {
    const res = await app.request('/api/tests/import-parsed', {
      method: 'POST',
      headers: { host: '127.0.0.1:8000', origin: 'http://127.0.0.1:8000', 'content-type': 'application/json' },
      body: importBody,
    })
    expect(res.status).toBe(200)
    expect(db.listTests()).toHaveLength(1)
  })

  // Non-browser clients (curl, these tests) send no Origin. They are not a
  // CSRF vector, so they must keep working.
  it('allows a mutating request with no Origin at all', async () => {
    const res = await app.request('/api/tests/import-parsed', {
      method: 'POST', headers: { host: 'localhost:8000' }, body: importBody,
    })
    expect(res.status).toBe(200)
  })

  // DNS rebinding: the attacker's domain resolves to 127.0.0.1, but the Host
  // header still names it. Without this the whole confidential library is readable.
  it('refuses a non-loopback Host even on a GET', async () => {
    const res = await app.request('/api/tests', { headers: { host: 'evil.example' } })
    expect(res.status).toBe(403)
  })

  it('accepts loopback Host spellings', async () => {
    for (const host of ['127.0.0.1:8000', 'localhost:8000', 'localhost', '[::1]:8000']) {
      const res = await app.request('/api/health', { headers: { host } })
      expect(res.status, host).toBe(200)
    }
  })

  it('marks API responses no-store and nosniff', async () => {
    const res = await app.request('/api/tests', { headers: { host: '127.0.0.1:8000' } })
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('omits traces from the summary listing but keeps them on detail', async () => {
    const { testId } = db.saveTest(sampleTest(), 'stem', 'h', 'accepted', 'ok')
    const list = await (await app.request('/api/tests', { headers: { host: '127.0.0.1:8000' } })).json() as any[]
    expect(list[0].trace).toBeNull()
    expect(list[0].id).toBe(testId)
    const detail = await (await app.request(`/api/tests/${testId}`, { headers: { host: '127.0.0.1:8000' } })).json() as any
    expect(detail.trace.dilute).toHaveLength(1)
  })
})
