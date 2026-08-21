// Engineering analyses over the emission library. All emission values are the
// canonical mg/km (PN = #/km) stored on Test.results / phases — the same basis as
// the active limit profiles, so comparisons are unit-consistent.

import type { Pollutant, Test, TracePoint } from '../model/types'
import type { LimitProfile } from '../model/limits'
import { linregress, mean, trapz, type LinFit } from './stats'

const val = (t: Test, p: Pollutant): number | null => t.results[p]

/* ============================ Deterioration / ageing ============================ */

export interface DeteriorationGroup {
  group: string
  n: number
  fit: LinFit
  current: number // fitted value at the lowest observed mileage
  projected: number // fitted value at useful-life mileage
  df: number // deterioration factor = projected / current
  exceedsTarget: boolean
  exceedsNorm: boolean
  points: { x: number; y: number; label: string }[]
  minOdo: number
  maxOdo: number
  /** false when the fit is too weak or the mileage spread too short to trust the projection */
  reliable: boolean
  target: number | null
  norm: number | null
  mixedTarget: boolean
  mixedNorm: boolean
}

// A projection is only trustworthy with a real trend (R²), enough points, and a
// mileage spread that isn't a tiny fraction of the extrapolation distance.
const MIN_R2 = 0.5
const MIN_POINTS = 4
const MIN_SPAN_KM = 5000

/**
 * Per-group linear deterioration of `pollutant` vs odometer, projected to
 * `usefulLifeKm`. DF = projected / current(at lowest mileage). Groups need ≥3
 * points spanning a mileage range to yield a meaningful slope.
 */
export function deteriorationByGroup(
  tests: Test[],
  pollutant: Pollutant,
  groupKey: (t: Test) => string,
  usefulLifeKm: number,
  profiles: {
    target?: LimitProfile | null
    norm?: LimitProfile | null
    targetFor?: (test: Test) => LimitProfile | null
    normFor?: (test: Test) => LimitProfile | null
  } = {},
): DeteriorationGroup[] {
  const fixedTarget = profiles.target === undefined ? null : profiles.target
  const fixedNorm = profiles.norm === undefined ? null : profiles.norm
  const buckets = new Map<string, { x: number; y: number; label: string; target: number | null; norm: number | null }[]>()
  for (const t of tests) {
    const y = val(t, pollutant)
    if (y == null || t.odo == null) continue
    const key = groupKey(t)
    const arr = buckets.get(key) ?? []
    const targetProfile = profiles.targetFor ? profiles.targetFor(t) : fixedTarget
    const normProfile = profiles.normFor ? profiles.normFor(t) : fixedNorm
    arr.push({
      x: t.odo,
      y,
      label: `${t.project} ${t.config} ${t.date}`,
      target: targetProfile?.limits[pollutant] ?? null,
      norm: normProfile?.limits[pollutant] ?? null,
    })
    buckets.set(key, arr)
  }
  const out: DeteriorationGroup[] = []
  for (const [group, pts] of buckets) {
    if (pts.length < 2) continue
    const fit = linregress(pts)
    const minOdo = Math.min(...pts.map((p) => p.x))
    const maxOdo = Math.max(...pts.map((p) => p.x))
    const current = Math.max(0, fit.slope * minOdo + fit.intercept)
    const projected = Math.max(0, fit.slope * usefulLifeKm + fit.intercept)
    const df = current > 0 ? projected / current : 1
    const target = commonLimit(pts.map((p) => p.target))
    const norm = commonLimit(pts.map((p) => p.norm))
    out.push({
      group,
      n: pts.length,
      fit,
      current,
      projected,
      df,
      exceedsTarget: target.value != null && projected > target.value,
      exceedsNorm: norm.value != null && projected > norm.value,
      points: pts.sort((a, b) => a.x - b.x),
      minOdo,
      maxOdo,
      reliable: current > 0 && fit.r2 >= MIN_R2 && pts.length >= MIN_POINTS && maxOdo - minOdo >= MIN_SPAN_KM,
      target: target.value,
      norm: norm.value,
      mixedTarget: target.mixed,
      mixedNorm: norm.mixed,
    })
  }
  return out.sort((a, b) => b.df - a.df)
}

function commonLimit(values: (number | null)[]): { value: number | null; mixed: boolean } {
  const concrete = values.filter((v): v is number => v != null)
  if (!concrete.length) return { value: null, mixed: false }
  if (concrete.length !== values.length) return { value: null, mixed: true }
  const first = concrete[0]
  return concrete.every((v) => Object.is(v, first)) ? { value: first, mixed: false } : { value: null, mixed: true }
}

/* ============================ Cold-start / phase split ============================ */

export interface ColdStartRow {
  pollutant: Pollutant
  phaseMass: number[] // g per phase = specific[mg/km]·dist[km] / 1000
  totalMass: number
  coldFraction: number // phase-1 mass / total
  coldPenalty: number // phase-1 specific − mean(hot phases), mg/km
}

const COLD_POLL: Pollutant[] = ['CO', 'THC', 'NOx', 'NMHC', 'CH4']

/** Cold-start contribution per pollutant from the phase breakdown. */
export function coldStart(test: Test): ColdStartRow[] {
  if (test.phases.length < 2) return []
  return COLD_POLL.map((p) => {
    const phaseMass = test.phases.map((ph) => {
      const spec = ph.specific[p]
      const dist = ph.distanceKm
      return spec != null && dist != null ? (spec * dist) / 1000 : 0
    })
    const totalMass = phaseMass.reduce((a, b) => a + b, 0)
    const hotSpecs = test.phases.slice(1).map((ph) => ph.specific[p]).filter((v): v is number => v != null)
    const cold = test.phases[0].specific[p] ?? 0
    return {
      pollutant: p,
      phaseMass,
      totalMass,
      coldFraction: totalMass > 0 ? phaseMass[0] / totalMass : 0,
      coldPenalty: cold - (hotSpecs.length ? mean(hotSpecs) : 0),
    }
  }).filter((r) => r.totalMass > 0)
}

/* ============================ Catalyst light-off ============================ */

export type TraceChannel = 'NOx' | 'CO' | 'THC' | 'CH4' | 'NMHC' | 'CO2'

export interface LightoffResult {
  pollutant: TraceChannel
  lightoffTime: number | null // first time conversion ≥ threshold, seconds
  timeWeightedConversion: number // mean conversion over active window, 0..1
  peakPreCat: number
  slipIndex: number // ∫ post-cat conc dt before light-off (ppm·s) — pre-cat breakthrough proxy
  series: { t: number; pre: number; post: number; eff: number | null }[]
}

/**
 * Catalyst light-off from pre/post-cat concentration traces.
 * conversion(t) = (pre − post)/pre once pre exceeds a small floor.
 */
export function catalystLightoff(test: Test, pollutant: TraceChannel, threshold = 0.5): LightoffResult | null {
  const tr = test.trace
  if (!tr || !tr.preCat.length) return null
  const postByT = new Map<number, TracePoint>(tr.postCat.map((d) => [d.t, d]))
  const series = tr.preCat.map((pre) => {
    const post = postByT.get(pre.t)
    const a = pre[pollutant] ?? 0
    const b = post?.[pollutant] ?? 0
    const eff = a > 1 ? Math.max(0, Math.min(1, (a - b) / a)) : null
    return { t: pre.t, pre: a, post: b, eff }
  })
  let lightoffTime: number | null = null
  for (const s of series) {
    if (s.eff != null && s.eff >= threshold) { lightoffTime = s.t; break }
  }
  const active = series.filter((s) => s.eff != null) as { t: number; eff: number }[]
  const timeWeightedConversion = active.length ? mean(active.map((s) => s.eff)) : 0
  const peakPreCat = Math.max(0, ...series.map((s) => s.pre))
  const preLO = lightoffTime == null ? series : series.filter((s) => s.t <= lightoffTime!)
  const slipIndex = trapz(preLO.map((s) => s.t), preLO.map((s) => s.post))
  return { pollutant, lightoffTime, timeWeightedConversion, peakPreCat, slipIndex, series }
}

/* ============================ Cycle validity (speed trace) ============================ */

export interface CycleMetrics {
  durationS: number
  distanceComputed: number // km from ∫ speed dt
  distanceReported: number | null
  distanceErrorPct: number | null
  idlePct: number
  avgSpeed: number // over whole trace, km/h
  maxSpeed: number
  maxAccel: number // m/s², positive
}

export function cycleMetrics(test: Test): CycleMetrics | null {
  const d = test.trace?.dilute
  if (!d || d.length < 2) return null
  const ts = d.map((p) => p.t)
  const sp = d.map((p) => p.speed ?? 0)
  const distanceComputed = trapz(ts, sp) / 3600
  const durationS = ts[ts.length - 1] - ts[0]
  const idle = sp.filter((v) => v < 1).length / sp.length
  let maxAccel = 0
  for (let i = 1; i < d.length; i++) {
    const dt = ts[i] - ts[i - 1]
    if (dt <= 0) continue
    const a = ((sp[i] - sp[i - 1]) / 3.6) / dt
    if (a > maxAccel) maxAccel = a
  }
  const reported = test.distanceKm ?? null
  return {
    durationS,
    distanceComputed,
    distanceReported: reported,
    distanceErrorPct: reported && reported > 0 ? ((distanceComputed - reported) / reported) * 100 : null,
    idlePct: idle * 100,
    avgSpeed: mean(sp),
    maxSpeed: Math.max(0, ...sp),
    maxAccel,
  }
}

/* ============================ Trace ↔ bag reconciliation ============================ */

const MASS_KEY: Partial<Record<Pollutant, keyof TracePoint>> = {
  CO: 'CO_mass_g', THC: 'THC_mass_g', NOx: 'NOx_mass_g', CO2: 'CO2_mass_g', CH4: 'CH4_mass_g',
}

export interface ReconcileRow {
  pollutant: Pollutant
  reported: number // mg/km
  integrated: number // mg/km from trace mass channel
  deltaPct: number
}

/**
 * Cross-check reported specific results against the trace mass channels.
 * Mass channels are auto-detected as cumulative (monotonic) or per-sample.
 */
export function reconcile(test: Test): ReconcileRow[] {
  const d = test.trace?.dilute
  const dist = test.distanceKm
  if (!d || !d.length || !dist) return []
  const out: ReconcileRow[] = []
  for (const [poll, key] of Object.entries(MASS_KEY) as [Pollutant, keyof TracePoint][]) {
    const masses = d.map((p) => (p[key] as number | undefined) ?? null)
    if (masses.some((m) => m == null)) continue
    const vals = masses as number[]
    // Cumulative channels are non-decreasing AND actually grow end-to-end;
    // a flat or fluctuating channel is per-sample (g/s) and must be summed.
    const nonDecreasing = vals.every((m, i) => i === 0 || m >= vals[i - 1] - 1e-9)
    const grew = vals[vals.length - 1] > vals[0] + 1e-9
    const totalG = nonDecreasing && grew ? vals[vals.length - 1] - vals[0] : vals.reduce((a, b) => a + b, 0)
    const integrated = (totalG * 1000) / dist // mg/km
    const reported = test.results[poll]
    if (reported == null || reported === 0) continue
    out.push({ pollutant: poll, reported, integrated, deltaPct: ((integrated - reported) / reported) * 100 })
  }
  return out
}

/* ============================ STT (start-stop) paired study ============================ */

export interface SttPair {
  key: string
  on: number
  off: number
  deltaPct: number // (off − on)/on
  config: string
  cycle: string
}

/** Matched STT ON/OFF pairs on the same vehicle/catalyst/config/cycle. */
export function sttPairs(tests: Test[], pollutant: Pollutant): SttPair[] {
  const groups = new Map<string, Test[]>()
  for (const t of tests) {
    if (t.stt !== 'ON' && t.stt !== 'OFF') continue
    if (val(t, pollutant) == null) continue
    const key = `${projectKey(t)}·${t.config}·${t.transmission}·${t.cycle}·${t.catalystState ?? ''}·${t.vnNo}`
    groups.set(key, [...(groups.get(key) ?? []), t])
  }
  const out: SttPair[] = []
  for (const [key, rows] of groups) {
    const on = rows.filter((t) => t.stt === 'ON').map((t) => val(t, pollutant)!)
    const off = rows.filter((t) => t.stt === 'OFF').map((t) => val(t, pollutant)!)
    if (!on.length || !off.length) continue
    const onM = mean(on)
    const offM = mean(off)
    out.push({
      key,
      on: onM,
      off: offM,
      deltaPct: onM > 0 ? ((offM - onM) / onM) * 100 : 0,
      config: rows[0].config,
      cycle: rows[0].cycle,
    })
  }
  return out
}

/* ============================ Inter-lab correlation ============================ */

export interface LabRow {
  group: string
  labA: { lab: string; mean: number; n: number }
  labB: { lab: string; mean: number; n: number }
  deltaPct: number
}

/** Compare two labs on comparable config/cycle/transmission cohorts. */
export function interLab(tests: Test[], pollutant: Pollutant): LabRow[] {
  const groups = new Map<string, Test[]>()
  for (const t of tests) {
    if (val(t, pollutant) == null) continue
    const key = `${projectKey(t)}·${t.config}·${t.transmission}·${t.cycle}`
    groups.set(key, [...(groups.get(key) ?? []), t])
  }
  const out: LabRow[] = []
  for (const [group, rows] of groups) {
    const byLab = new Map<string, number[]>()
    for (const t of rows) byLab.set(t.lab, [...(byLab.get(t.lab) ?? []), val(t, pollutant)!])
    const labs = [...byLab.entries()]
    if (labs.length < 2) continue
    const [a, b] = labs
    const aM = mean(a[1])
    const bM = mean(b[1])
    out.push({
      group,
      labA: { lab: a[0], mean: aM, n: a[1].length },
      labB: { lab: b[0], mean: bM, n: b[1].length },
      deltaPct: aM > 0 ? ((bM - aM) / aM) * 100 : 0,
    })
  }
  return out
}

function projectKey(test: Test): string {
  return test.program_id || String(test.project || 'Unknown')
}
