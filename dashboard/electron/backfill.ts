import { CALC_VERSION } from '../src/lib/j2951.ts'
import { resultForTest } from '../src/lib/j2951ForTest.ts'
import { buildTest } from '../src/ingest/normalize.ts'

/**
 * Backfills `Test.j2951` for rows written before the drive-trace-index
 * feature existed (no `j2951` at all) and for rows whose stored result was
 * computed by an older formula (`j2951.calcVersion < CALC_VERSION`). It is
 * idempotent and version-guarded -- a row already at `CALC_VERSION` is left
 * untouched -- so it is safe to run unconditionally on every server start,
 * standalone or packaged.
 *
 * `Database.listTests()` (electron/db.ts) parses `data_json`, which is
 * `JSON.stringify(test)` for the *whole* Test, trace included. Only the HTTP
 * summary route in electron/server.ts strips `trace` for the wire payload.
 * So this pass has everything `resultForTest` needs already in memory --
 * no extra query, and no reach into the `trace_points` table.
 */

interface J2951Store {
  listTests(includeNonaccepted?: boolean): Record<string, any>[]
  setJ2951(id: string, j2951: Record<string, any>): boolean
}

interface MetadataStore {
  listTests(includeNonaccepted?: boolean): Record<string, any>[]
  backfillMetadata(id: string, patch: Record<string, any>): boolean
}

/** Recompute every stale or missing result. Returns how many were written. */
export function backfillJ2951(db: J2951Store): number {
  let written = 0
  for (const test of db.listTests(true)) {
    if (test.j2951?.calcVersion === CALC_VERSION) continue
    db.setJ2951(test.id, resultForTest(test as never))
    written += 1
  }
  return written
}

function stemFromSource(test: Record<string, any>): string | null {
  const source = test.source ?? {}
  const filePath = source.pdf ?? source.xlsm
  if (!filePath) return null
  const name = String(filePath).split(/[\\/]/).pop() ?? ''
  return name
    .replace(/_REPORT\.pdf$/i, '')
    .replace(/_TRACES\.xlsm$/i, '')
    .replace(/\.[^.]+$/, '') || null
}

function isEmpty(value: unknown): boolean {
  return value == null || value === '' || value === 'Unknown'
}

function isVinLikeVehicle(value: unknown): boolean {
  return /^MEER[A-Z0-9]+$/i.test(String(value ?? ''))
}

/**
 * Backfills display metadata that older parser versions left blank. The source
 * filename is deliberately used only as a fallback so manual/user-confirmed
 * metadata is not overwritten.
 */
export function backfillFilenameMetadata(db: MetadataStore): number {
  let written = 0
  for (const test of db.listTests(true)) {
    const stem = stemFromSource(test)
    if (!stem) continue
    const derived = buildTest(stem, null, null, {}, test.importedAt ?? new Date().toISOString())
    const patch: Record<string, any> = {}

    if (isEmpty(test.config) && derived.config !== 'Unknown') patch.config = derived.config
    if (isEmpty(test.cycle) && derived.cycle !== 'Unknown') patch.cycle = derived.cycle
    if (isEmpty(test.transmission) && derived.transmission !== 'Unknown') patch.transmission = derived.transmission
    if (isEmpty(test.vnNo) && derived.vnNo) patch.vnNo = derived.vnNo
    if ((isEmpty(test.vehicleModel) || test.vehicleModel === stem || isVinLikeVehicle(test.vehicleModel))
      && derived.vehicleModel && derived.vehicleModel !== stem) {
      patch.vehicleModel = derived.vehicleModel
    }

    const fixedFlags = new Set<string>()
    if (patch.config || !isEmpty(test.config)) fixedFlags.add('config')
    if (patch.cycle || !isEmpty(test.cycle)) fixedFlags.add('cycle')
    if (patch.transmission || !isEmpty(test.transmission)) fixedFlags.add('transmission')
    if (fixedFlags.size) {
      const lowConfidence = (test.lowConfidence ?? []).filter((flag: string) => !fixedFlags.has(flag))
      if (lowConfidence.length !== (test.lowConfidence ?? []).length) patch.lowConfidence = lowConfidence
    }
    if (!Object.keys(patch).length) continue
    if (db.backfillMetadata(test.id, patch)) written += 1
  }
  return written
}
