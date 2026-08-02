import type {
  J2951Indices, J2951Inputs, J2951Result, J2951Unavailable, J2951Verdict, RagLevel,
} from '../model/types'

/** Bump to force `electron/backfill.ts` to recompute the whole library. */
export const CALC_VERSION = 1

/** AIS-175 Annex B2 §3.1 rotating-mass factor. */
export const DEFAULT_KR = 1.03

/**
 * Pass bands. IWR ±4.0 % and RMSSE ≤ 1.3 km/h come from the calculator sheet.
 * The 5.0 % marginal threshold is an INFERENCE — the workbook labels a
 * −4.038 % run MARGINAL but never states the cutoff. Isolated here so it is a
 * one-line correction if a cited source turns up.
 */
export const BANDS = { iwrPass: 4.0, iwrWarn: 5.0, rmssePass: 1.3 } as const

/** Median of the sample intervals, used only by the sample-rate guard. */
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export interface J2951Options {
  dt: number
  massKg: number | null
  f0: number | null
  f1: number | null
  f2: number | null
  kr?: number
}

/** Σ of positive kinetic-energy increments, J/kg. One-sided by definition. */
function inertialWork(v: readonly number[]): number {
  let iw = 0
  for (let i = 1; i < v.length; i++) {
    const ke = 0.5 * (v[i] / 3.6) ** 2 - 0.5 * (v[i - 1] / 3.6) ** 2
    if (ke > 0) iw += ke
  }
  return iw
}

/** Σv·dt/3600, km. */
function distanceKm(v: readonly number[], dt: number): number {
  let s = 0
  for (let i = 0; i < v.length; i++) s += v[i]
  return (s * dt) / 3600
}

/** Σ|Δv|, km/h — the ASCR numerator/denominator. */
function absSpeedChange(v: readonly number[]): number {
  let s = 0
  for (let i = 1; i < v.length; i++) s += Math.abs(v[i] - v[i - 1])
  return s
}

/**
 * Σ of positive road-load + inertia power, kWh.
 *
 * Two boundary conventions are inherited verbatim from the workbook, because
 * changing either changes the answer:
 *  - first sample: a₀ uses (v₁ − v₀)/(2·dt) — the workbook's H30 substitutes
 *    v₀ for the nonexistent v₋₁ while still dividing by 2·dt;
 *  - last sample: contributes nothing (no vᵢ₊₁ exists), so the sum runs to N−2.
 */
function energyKWh(
  v: readonly number[], dt: number, f0: number, f1: number, f2: number, kr: number, massKg: number,
): number {
  let e = 0
  for (let i = 0; i < v.length - 1; i++) {
    const prev = i === 0 ? v[0] : v[i - 1]
    const accel = ((v[i + 1] - prev) / (2 * dt)) / 3.6
    const road = f0 * v[i] + f1 * v[i] ** 2 + f2 * v[i] ** 3
    const p = (road + kr * massKg * accel * v[i]) / 3600
    if (p > 0) e += p
  }
  return (e * dt) / 3600
}

/**
 * The six indices, from two already-aligned 1 Hz traces of equal length.
 * Pure: no guards, no I/O. `er`/`eer` are null when road load or mass is absent.
 */
export function computeIndices(
  target: readonly number[], actual: readonly number[], o: J2951Options,
): J2951Indices {
  const { dt } = o
  const kr = o.kr ?? DEFAULT_KR

  const iwTargetJkg = inertialWork(target)
  const iwActualJkg = inertialWork(actual)
  const iwr = 100 * (iwActualJkg - iwTargetJkg) / iwTargetJkg

  let sq = 0
  for (let i = 0; i < actual.length; i++) sq += (actual[i] - target[i]) ** 2
  const rmsse = Math.sqrt(sq / actual.length)

  const distTargetKm = distanceKm(target, dt)
  const distActualKm = distanceKm(actual, dt)
  const dr = distActualKm / distTargetKm

  const ascr = absSpeedChange(actual) / absSpeedChange(target)

  const hasLoad = o.f0 != null && o.f1 != null && o.f2 != null && o.massKg != null
  let er: number | null = null
  let eer: number | null = null
  if (hasLoad) {
    const eT = energyKWh(target, dt, o.f0!, o.f1!, o.f2!, kr, o.massKg!)
    const eA = energyKWh(actual, dt, o.f0!, o.f1!, o.f2!, kr, o.massKg!)
    er = eA / eT
    eer = dr / er
  }

  return { iwr, rmsse, dr, er, eer, ascr, distTargetKm, distActualKm, iwTargetJkg, iwActualJkg }
}

/**
 * The schedule starts at t=0; `Dilute_Results_Trace` starts at t=1. The
 * workbook reconciled that by prepending a (0,0) sample. Done explicitly here —
 * never by truncating, which would quietly change every index.
 */
export function alignActual(speeds: readonly number[], startsAtT: number): number[] {
  return startsAtT === 0 ? [...speeds] : [0, ...speeds]
}

function worse(a: RagLevel, b: RagLevel): RagLevel {
  const rank: Record<RagLevel, number> = { pass: 0, warn: 1, fail: 2, na: 3 }
  return rank[a] >= rank[b] ? a : b
}

export function verdictFor(i: J2951Indices): J2951Verdict {
  const mag = Math.abs(i.iwr)
  const iwr: RagLevel = mag <= BANDS.iwrPass ? 'pass' : mag <= BANDS.iwrWarn ? 'warn' : 'fail'
  const rmsse: RagLevel = i.rmsse <= BANDS.rmssePass ? 'pass' : 'fail'
  return { iwr, rmsse, overall: worse(iwr, rmsse) }
}

export interface ComputeJ2951Args {
  scheduleId: string | null
  target: readonly number[] | null
  actualSpeeds: readonly number[]
  /** First timestamp of the measured trace — 1 for Dilute_Results_Trace. */
  actualStartsAtT: number
  /** Median sample interval of the measured trace, seconds. */
  dt: number
  massKg: number | null
  vehicleRld: { A: number | null; B: number | null; C: number | null }
  /** 'override' when vehicleRld came from `Test.overrides`. */
  inputSource?: J2951Inputs['source']
  /** Raw sample times; when given, dt is re-derived from their median interval. */
  times?: readonly number[]
}

function unavailable(
  code: J2951Unavailable, scheduleId: string | null, sampleRateHz: number | null, detail?: string,
): J2951Result {
  return {
    calcVersion: CALC_VERSION, scheduleId, sampleRateHz,
    indices: null, verdict: null, inputs: null, unavailable: code,
    ...(detail ? { detail } : {}),
  }
}

/**
 * Guarded entry point. Every failure mode returns a distinct reason code with
 * null indices — never a plausible-looking number computed from bad input.
 */
export function computeJ2951(args: ComputeJ2951Args): J2951Result {
  const { scheduleId, target, actualSpeeds, actualStartsAtT, massKg, vehicleRld } = args

  const dt = args.times && args.times.length > 1
    ? median(args.times.slice(1).map((t, i) => t - args.times![i]))
    : args.dt
  const sampleRateHz = dt > 0 ? 1 / dt : null

  if (!actualSpeeds || actualSpeeds.length === 0) {
    return unavailable('no_trace', scheduleId, sampleRateHz)
  }
  if (!scheduleId || !target || target.length === 0) {
    return unavailable('no_schedule', scheduleId, sampleRateHz)
  }
  // The guard that matters most: IWR is a one-sided sum, so high-frequency
  // ripple adds work that never cancels (the workbook's own runs moved from
  // +8.05 % at 10 Hz to +1.43 % at 1 Hz). Refuse rather than report noise.
  if (!(Math.abs(dt - 1) <= 0.01)) {
    return unavailable('sample_rate', scheduleId, sampleRateHz, `median interval ${dt.toFixed(4)} s, expected 1 s`)
  }

  const aligned = alignActual(actualSpeeds, actualStartsAtT)
  if (aligned.length !== target.length) {
    return unavailable(
      'length_mismatch', scheduleId, sampleRateHz,
      `actual ${aligned.length} vs target ${target.length}`,
    )
  }

  const kr = DEFAULT_KR
  const indices = computeIndices(target, aligned, {
    dt, massKg, f0: vehicleRld.A, f1: vehicleRld.B, f2: vehicleRld.C, kr,
  })

  const hasLoad = vehicleRld.A != null && vehicleRld.B != null && vehicleRld.C != null && massKg != null
  const inputs: J2951Inputs | null = hasLoad
    ? { massKg: massKg!, f0: vehicleRld.A!, f1: vehicleRld.B!, f2: vehicleRld.C!, kr, source: args.inputSource ?? 'parsed' }
    : null

  return {
    calcVersion: CALC_VERSION, scheduleId, sampleRateHz,
    indices, verdict: verdictFor(indices), inputs,
  }
}
