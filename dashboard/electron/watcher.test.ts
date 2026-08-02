import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Database } from './db.ts'
import { FolderWatcher, stemOf } from './watcher.ts'

function parsedTest() {
  return {
    id: 'FEV_SAMPLE', project: 'STLA', cycle: 'WLTP', config: 'CC24', transmission: 'MB6', lab: 'FEV',
    vehicleModel: 'CITROEN AIRCROSS', vinSampleId: 'VIN', vnNo: '9740', date: '2026-03-18',
    catalystState: 'Fresh', stt: 'ON', startSoc: 96, inertia: 1464, odo: 139, distanceKm: 14.96,
    phaseCount: 3, rld: { A: 48.3, B: -0.1, C: 0.04 }, fuel: { name: 'E20' }, conditions: {},
    results: { CO: 325.3, THC: 7.59, NOx: 24.73, CO2: 134752, CH4: 2.68, NMHC: 4.42, PM: 1.32, PN: 3.38e9 },
    phases: [] as any[], trace: { dilute: [], preCat: [], postCat: [] },
    units: {
      resultsCanonical: 'mg/km', resultsSource: 'mg/km',
      trace: { dilute: { NOx: 'ppm' }, preCat: { NOx: 'ppm' }, postCat: { NOx: 'ppm' } },
    },
    source: {}, lowConfidence: [] as string[], importedAt: '2026-06-20T00:00:00Z',
  }
}

describe('stemOf', () => {
  it('strips the known suffixes case-insensitively', () => {
    expect(stemOf('/x/FEV_SAMPLE_REPORT.pdf')).toBe('FEV_SAMPLE')
    expect(stemOf('/x/FEV_SAMPLE_TRACES.xlsm')).toBe('FEV_SAMPLE')
    expect(stemOf('/x/other.txt')).toBe('other')
  })
})

describe('FolderWatcher', () => {
  let dir: string, watch: string, db: Database, parse: ReturnType<typeof vi.fn>, watcher: FolderWatcher
  let pdf: string, xlsm: string

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'emlab-w-'))
    watch = path.join(dir, 'watch')
    mkdirSync(watch)
    db = new Database(path.join(dir, 'test.db'))
    parse = vi.fn(async () => parsedTest())
    watcher = new FolderWatcher({ watchFolder: watch, scanIntervalSeconds: 1 }, db, parse)
    pdf = path.join(watch, 'FEV_SAMPLE_REPORT.pdf')
    xlsm = path.join(watch, 'FEV_SAMPLE_TRACES.xlsm')
  })
  afterEach(() => {
    watcher.stop()
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('waits for a pair, then ingests idempotently and reparses on correction', async () => {
    writeFileSync(pdf, 'pdf-v1')
    await watcher.scanOnce()
    expect(db.listJobs()[0].status).toBe('pending_pair')

    writeFileSync(xlsm, 'xlsm-v1')
    await watcher.scanOnce()
    const job = db.listJobs()[0]
    expect(job.status).toBe('accepted')
    expect(parse).toHaveBeenCalledTimes(1)

    await watcher.scanOnce()
    expect(parse).toHaveBeenCalledTimes(1)
    expect(db.audit(job.test_id)).toHaveLength(0)

    writeFileSync(pdf, 'pdf-corrected')
    await watcher.scanOnce()
    expect(parse).toHaveBeenCalledTimes(2)
    expect(db.audit(job.test_id)).toHaveLength(1)
  })

  it('keeps same-day repeat runs distinct', async () => {
    for (const ts of ['09-51-01', '15-22-40']) {
      const stem = `CITROEN_AIRCROSS_MT_9740_5099_2026-03-18_${ts}`
      writeFileSync(path.join(watch, `${stem}_REPORT.pdf`), `pdf-${ts}`)
      writeFileSync(path.join(watch, `${stem}_TRACES.xlsm`), `xlsm-${ts}`)
    }
    await watcher.scanOnce()
    expect(db.listTests()).toHaveLength(2)
    expect(parse).toHaveBeenCalledTimes(2)
  })

  it('does not re-hash unchanged files', async () => {
    writeFileSync(pdf, 'pdf-v1')
    writeFileSync(xlsm, 'xlsm-v1')
    // Spy on computeHash (the expensive disk read), not hashFile (the cache
    // wrapper, which is always called once per file per scan regardless of
    // whether it hits the cache). Spying on the wrapper would pass even if
    // caching were completely broken.
    const spy = vi.spyOn(watcher, 'computeHash')
    await watcher.scanOnce()
    expect(spy).toHaveBeenCalledTimes(2) // pdf + xlsm hashed once each
    await watcher.scanOnce() // nothing changed
    expect(spy).toHaveBeenCalledTimes(2) // still 2 — the second scan hit the cache for both
    expect(parse).toHaveBeenCalledTimes(1)
  })

  it('does not resurrect a deleted test from an unchanged source', async () => {
    writeFileSync(pdf, 'pdf-v1')
    writeFileSync(xlsm, 'xlsm-v1')
    await watcher.scanOnce()
    const id = db.listJobs()[0].test_id
    expect(db.deleteTest(id)).toBe(true)
    expect(db.listTests()).toHaveLength(0)

    await watcher.scanOnce()
    expect(db.listTests()).toHaveLength(0)
    expect(parse).toHaveBeenCalledTimes(1)
  })

  it('does not reparse an unchanged quarantined record, preserving manual edits', async () => {
    const quarantined = parsedTest()
    quarantined.lowConfidence = ['results']
    parse.mockResolvedValue(quarantined)
    writeFileSync(pdf, 'pdf-v1')
    writeFileSync(xlsm, 'xlsm-v1')
    await watcher.scanOnce()
    expect(db.listTests()[0].status).toBe('quarantined')
    const id = db.listJobs()[0].test_id

    db.patchTest(id, { vehicleModel: 'EDITED MODEL' })
    await watcher.scanOnce()
    expect(parse).toHaveBeenCalledTimes(1)
    expect(db.getTest(id)!.vehicleModel).toBe('EDITED MODEL')
  })
})
