import type { Cycle } from './types'
// Explicit .ts extension — reached from the Electron backend, which runs under
// --experimental-strip-types and cannot resolve extensionless specifiers.
import { WLTC_3B_LMH_CSV } from './wltc3b.ts'

/**
 * Registry of 1 Hz target speed traces, keyed by schedule id.
 *
 * Only WLTC 3b ships. MIDC and NEDC deliberately get no entry: no verified
 * source is available, and scoring a run against a guessed schedule would be
 * worse than reporting no index at all. They resolve to `no_schedule`.
 */
export type ScheduleId = 'WLTC_3B_LMH'

const CSV: Record<ScheduleId, string> = { WLTC_3B_LMH: WLTC_3B_LMH_CSV }

/** Parsed once on first use — the CSV is ~6.2 KB and never changes. */
const cache = new Map<ScheduleId, Float64Array>()

export function getScheduleById(id: ScheduleId): Float64Array {
  const hit = cache.get(id)
  if (hit) return hit
  const parsed = Float64Array.from(CSV[id].split(',').map(Number))
  cache.set(id, parsed)
  return parsed
}

/** Maps a test's cycle to its schedule id, or null when none is committed. */
export function scheduleIdForCycle(cycle: Cycle): ScheduleId | null {
  return cycle === 'WLTP' ? 'WLTC_3B_LMH' : null
}

export interface Schedule {
  id: ScheduleId
  speeds: Float64Array
}

/** Convenience: resolve a cycle straight to its trace, or null. */
export function getSchedule(cycle: Cycle): Schedule | null {
  const id = scheduleIdForCycle(cycle)
  return id ? { id, speeds: getScheduleById(id) } : null
}
