import { CALC_VERSION } from '../src/lib/j2951.ts'
import { resultForTest } from '../src/lib/j2951ForTest.ts'

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
