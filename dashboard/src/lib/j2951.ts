import type {
  J2951Indices, J2951Inputs, J2951Result, J2951Unavailable, J2951Verdict, RagLevel,
} from '../model/types'

/** Bump to force `electron/backfill.ts` to recompute the whole library. */
export const CALC_VERSION = 4

/** AIS-175 Annex B2 §3.1 rotating-mass factor. */
export const DEFAULT_KR = 1.03

/**
 * Accept/reject criteria — PRIMARY SOURCE: AIS-175, Annex B6,
 * paragraph 2.6.8.3.1.3 "Tolerance (3)" (Type I test) and 2.6.8.3.1.4
 * "Tolerance (4)" (CoP test), which are numerically identical:
 *
 *   (a) IWR shall be in the range of (- 2.0 < IWR < + 4.0) per cent;
 *   (b) RMSSE, less than 1.3 km/h.
 *
 * Note the STRICT inequalities. Exactly -2.0 or exactly +4.0 is outside the
 * range, as is exactly 1.3 km/h. The calculation itself is defined by
 * Annex B7 paragraph 7.2: "The following indices shall be calculated
 * according to SAE J2951 (Revised JAN2014)" - and only IWR and RMSSE are
 * regulated. DR, ER, EER and ASCR are computed and reported for engineering
 * use, but they are not pass/fail criteria and are excluded from the verdict.
 *
 * The band is ASYMMETRIC. An earlier version used +/-4.0 %, from the analyser
 * workbook's uncited LIMITS note, which wrongly passed economical-but-illegal
 * runs down to -4 %.
 *
 * `distance*` is NOT from AIS-175 - the regulation only requires distance to
 * be recorded per phase (Annex B6 2.6.8.2). The +/-1 % legal / 1.5 % reject
 * figures come from CC24MB6_IWR_TestCell_SOP, so they are a house rule and
 * are banded warn-then-fail rather than treated as regulatory.
 *
 * A separate band exists for OVC-HEV charge-depleting tests (Annex B7 7.4.2.2:
 * individual cycles "not less than -3.0 nor greater than +5.0 per cent").
 * EMLAB scores pure-ICE Type I tests, so it is not applied here.
 */
export const BANDS = {
  iwrMin: -2.0,
  iwrMax: 4.0,
  rmsseMax: 1.3,
  /** Advisory target from the test-cell SOP, not a limit. */
  rmsseTarget: 1.0,
  distancePass: 0.01,
  distanceReject: 0.015,
} as const

/** Median of the sample intervals, used only by the sample-rate guard. */
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export interface J2951Phase {
  name: string
  /** Half-open [startS, endS) in seconds. */
  startS: number
  endS: number
}

export interface J2951Options {
  dt: number
  massKg: number | null
  f0: number | null
  f1: number | null
  f2: number | null
  kr?: number
  /** Cycle phases for the per-phase IWR breakdown. Omit for whole-cycle only. */
  phases?: readonly J2951Phase[]
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

  // Per-phase IWR, matching data/iwr1.py: mask the grid with (t >= a) & (t < b),
  // then take positive KE increments *within* the slice. Diffing the slice
  // means the step across a phase boundary belongs to neither phase — that is
  // the reference script's behaviour and the numbers depend on it.
  const phaseIwr: { name: string; iwr: number }[] = []
  for (const ph of o.phases ?? []) {
    const lo = Math.max(0, Math.round(ph.startS / dt))
    const hi = Math.min(target.length, Math.round(ph.endS / dt))
    if (hi - lo < 2) continue
    const t = target.slice(lo, hi)
    const a = actual.slice(lo, hi)
    const iwT = inertialWork(t)
    if (iwT <= 0) continue
    phaseIwr.push({ name: ph.name, iwr: (100 * (inertialWork(a) - iwT)) / iwT })
  }

  const hasLoad = o.f0 != null && o.f1 != null && o.f2 != null && o.massKg != null
  let er: number | null = null
  let eer: number | null = null
  if (hasLoad) {
    const eT = energyKWh(target, dt, o.f0!, o.f1!, o.f2!, kr, o.massKg!)
    const eA = energyKWh(actual, dt, o.f0!, o.f1!, o.f2!, kr, o.massKg!)
    er = eA / eT
    eer = dr / er
  }

  return {
    iwr, rmsse, dr, er, eer, ascr, distTargetKm, distActualKm, iwTargetJkg, iwActualJkg, phaseIwr,
  }
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
  // Binary by the SOP's own wording: outside the band the run is not a valid
  // Type-I trace. No "marginal" tier is invented for IWR or RMSSE.
  // Strict inequalities, exactly as the regulation words them:
  // "(- 2.0 < IWR < + 4.0)" and "RMSSE, less than 1.3 km/h".
  const iwr: RagLevel = i.iwr > BANDS.iwrMin && i.iwr < BANDS.iwrMax ? 'pass' : 'fail'
  const rmsse: RagLevel = i.rmsse < BANDS.rmsseMax ? 'pass' : 'fail'
  const driftPct = i.distTargetKm > 0 ? Math.abs(i.distActualKm - i.distTargetKm) / i.distTargetKm : 0
  const distance: RagLevel = driftPct <= BANDS.distancePass ? 'pass'
    : driftPct <= BANDS.distanceReject ? 'warn' : 'fail'
  return { iwr, rmsse, distance, overall: worse(worse(iwr, rmsse), distance) }
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
  /** Cycle phases, for the per-phase IWR breakdown. */
  phases?: readonly J2951Phase[]
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
 * KNOWN DEVIATION FROM AIS-175, Annex B7 paragraph 7.1:
 *
 *   "In the case that the accelerator control is fully activated, the
 *    prescribed speed shall be used instead of the actual vehicle speed for
 *    drive trace index calculations during such periods of operation."
 *
 * That substitution is NOT applied here, because the bench's
 * Dilute_Results_Trace carries speed, force, power and gas channels but no
 * accelerator-position signal, and the regulation names OBD/ECU monitoring as
 * the way to detect it. Without that channel the condition cannot be
 * identified, so full-throttle stretches where the vehicle physically could
 * not hold the trace are scored as if they were driver error.
 *
 * Effect: for a vehicle that cannot meet the cycle's acceleration or top
 * speed, the reported IWR and RMSSE are PESSIMISTIC. For a vehicle with
 * adequate performance -- which the WLTC 3b runs here are, peaking at ~31 kW
 * of 81 kW available -- there is no difference. Revisit if an accelerator
 * channel is ever added to the trace export.
 */
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
    dt, massKg, f0: vehicleRld.A, f1: vehicleRld.B, f2: vehicleRld.C, kr, phases: args.phases,
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
