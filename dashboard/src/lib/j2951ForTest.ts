import type { Test, J2951Result, J2951Inputs } from '../model/types'
// Runtime imports carry explicit .ts extensions: this module is reached from
// electron/db.ts, which runs under Node's --experimental-strip-types loader.
// That loader does not do extensionless resolution, so omitting them breaks
// the backend at startup while Vite and Vitest still resolve it happily.
import { computeJ2951 } from './j2951.ts'
import { getSchedule } from '../model/cycles.ts'

type VehicleRld = { A: number | null; B: number | null; C: number | null }

function isVehicleRldLike(v: unknown): v is VehicleRld {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  const isNumOrNull = (x: unknown) => x === null || typeof x === 'number'
  return 'A' in o && 'B' in o && 'C' in o && isNumOrNull(o.A) && isNumOrNull(o.B) && isNumOrNull(o.C)
}

/**
 * Shared Test -> J2951Result adapter. Kept out of normalize.ts because the
 * PATCH handler (electron/db.ts) and the backfill pass (electron/backfill.ts)
 * both need to recompute this from a Test the same way ingest does.
 */
export function resultForTest(test: Test): J2951Result {
  const points = (test.trace?.dilute ?? []).filter((p) => p.speed != null)
  const times = points.map((p) => p.t)
  const actualSpeeds = points.map((p) => p.speed!)
  const actualStartsAtT = points.length ? points[0].t : 0

  const schedule = getSchedule(test.cycle)

  const overrideRld = test.overrides?.vehicleRld
  let vehicleRld = test.vehicleRld
  let inputSource: J2951Inputs['source'] = 'parsed'
  if (isVehicleRldLike(overrideRld)) {
    vehicleRld = overrideRld
    inputSource = 'override'
  }

  return computeJ2951({
    scheduleId: schedule?.id ?? null,
    target: schedule ? Array.from(schedule.speeds) : null,
    actualSpeeds,
    actualStartsAtT,
    dt: 1,
    massKg: test.inertia ?? null,
    vehicleRld,
    inputSource,
    times,
  })
}
