import type {
  IgnitionType, MnVehicleClass, ObdStage, Pollutant, RagLevel, RegulatoryBasis, Test, WorkPackage,
} from './types'
import type { MassUnit } from '../store/useUnits'

export type LimitKind = 'tailpipe' | 'obdThreshold' | 'engineeringTarget'

export interface LimitProfile {
  id: string
  label: string
  kind: LimitKind
  source: string
  /** mg/km, except PN which is #/km. null = no limit (reported only). */
  limits: Record<Pollutant, number | null>
  notes?: string[]
}

export interface LimitContext {
  workPackage: WorkPackage
  regulatory: LimitProfile | null
  target: LimitProfile | null
  basis: RegulatoryBasis
  basisStatus: 'confirmed' | 'unconfirmed'
  message?: string
}

export const WORK_PACKAGES: { id: WorkPackage; label: string }[] = [
  { id: 'base', label: 'Base' },
  { id: 'emission', label: 'Emission' },
  { id: 'drivability', label: 'Drivability' },
  { id: 'obd', label: 'OBD' },
]

const SOURCE_MN = 'ARAI Indian Emission Regulation Booklet, BS VI, M & N category vehicle with GVW < 3.5 tons, pages 39-42'

const blank = (): Record<Pollutant, number | null> => ({
  CO: null, THC: null, NOx: null, CO2: null, CH4: null, NMHC: null, PM: null, PN: null,
})

const profile = (
  id: string,
  label: string,
  kind: LimitKind,
  limits: Partial<Record<Pollutant, number | null>>,
  notes: string[] = [],
): LimitProfile => ({ id, label, kind, source: SOURCE_MN, limits: { ...blank(), ...limits }, notes })

const piTailpipe: Record<MnVehicleClass, Partial<Record<Pollutant, number>>> = {
  M1_M2: { CO: 1000, THC: 100, NMHC: 68, NOx: 60, PM: 4.5, PN: 6.0e11 },
  N1_I: { CO: 1000, THC: 100, NMHC: 68, NOx: 60, PM: 4.5, PN: 6.0e11 },
  N1_II: { CO: 1810, THC: 130, NMHC: 90, NOx: 75, PM: 4.5, PN: 6.0e11 },
  N1_III: { CO: 2270, THC: 160, NMHC: 108, NOx: 82, PM: 4.5, PN: 6.0e11 },
  N2: { CO: 2270, THC: 160, NMHC: 108, NOx: 82, PM: 4.5, PN: 6.0e11 },
}

const ciTailpipe: Record<MnVehicleClass, Partial<Record<Pollutant, number>>> = {
  M1_M2: { CO: 500, NOx: 80, PM: 4.5, PN: 6.0e11 },
  N1_I: { CO: 500, NOx: 80, PM: 4.5, PN: 6.0e11 },
  N1_II: { CO: 630, NOx: 105, PM: 4.5, PN: 6.0e11 },
  N1_III: { CO: 740, NOx: 125, PM: 4.5, PN: 6.0e11 },
  N2: { CO: 740, NOx: 125, PM: 4.5, PN: 6.0e11 },
}

const obdI: Record<MnVehicleClass, Record<IgnitionType, Partial<Record<Pollutant, number>>>> = {
  M1_M2: { PI: { CO: 1900, NMHC: 170, NOx: 150, PM: 25 }, CI: { CO: 1750, NMHC: 290, NOx: 180, PM: 25 } },
  N1_I: { PI: { CO: 1900, NMHC: 170, NOx: 150, PM: 25 }, CI: { CO: 1750, NMHC: 290, NOx: 180, PM: 25 } },
  N1_II: { PI: { CO: 3400, NMHC: 225, NOx: 190, PM: 25 }, CI: { CO: 2200, NMHC: 320, NOx: 220, PM: 25 } },
  N1_III: { PI: { CO: 4300, NMHC: 270, NOx: 210, PM: 30 }, CI: { CO: 2500, NMHC: 350, NOx: 280, PM: 30 } },
  N2: { PI: { CO: 4300, NMHC: 270, NOx: 210, PM: 30 }, CI: { CO: 2500, NMHC: 350, NOx: 280, PM: 30 } },
}

const obdII: Record<MnVehicleClass, Record<IgnitionType, Partial<Record<Pollutant, number>>>> = {
  M1_M2: { PI: { CO: 1900, NMHC: 170, NOx: 90, PM: 12 }, CI: { CO: 1750, NMHC: 290, NOx: 140, PM: 12 } },
  N1_I: { PI: { CO: 1900, NMHC: 170, NOx: 90, PM: 12 }, CI: { CO: 1750, NMHC: 290, NOx: 140, PM: 12 } },
  N1_II: { PI: { CO: 3400, NMHC: 225, NOx: 110, PM: 12 }, CI: { CO: 2200, NMHC: 320, NOx: 180, PM: 12 } },
  N1_III: { PI: { CO: 4300, NMHC: 270, NOx: 120, PM: 12 }, CI: { CO: 2500, NMHC: 350, NOx: 220, PM: 12 } },
  N2: { PI: { CO: 4300, NMHC: 270, NOx: 120, PM: 12 }, CI: { CO: 2500, NMHC: 350, NOx: 220, PM: 12 } },
}

function classLabel(category: MnVehicleClass): string {
  return category === 'M1_M2' ? 'M1/M2'
    : category === 'N1_I' ? 'N1 class I'
    : category === 'N1_II' ? 'N1 class II'
    : category === 'N1_III' ? 'N1 class III'
    : 'N2'
}

export function classFromReferenceMass(referenceMassKg: number | null | undefined): MnVehicleClass {
  if (referenceMassKg == null || !Number.isFinite(referenceMassKg)) return 'M1_M2'
  if (referenceMassKg <= 1305) return 'N1_I'
  if (referenceMassKg <= 1760) return 'N1_II'
  return 'N1_III'
}

export function defaultRegulatoryBasis(test?: Pick<Test, 'inertia' | 'regulatory'>): RegulatoryBasis {
  const explicit = test?.regulatory
  const referenceMassKg = explicit?.referenceMassKg ?? test?.inertia ?? null
  return {
    family: 'india-bs6-mn-lt-3p5t',
    category: explicit?.category ?? classFromReferenceMass(referenceMassKg),
    ignition: explicit?.ignition ?? 'PI',
    referenceMassKg,
    directInjection: explicit?.directInjection ?? true,
    obdStage: explicit?.obdStage ?? 'OBD-II',
    source: explicit?.source ?? 'default',
  }
}

export function regulatoryProfileFor(workPackage: WorkPackage, basis: RegulatoryBasis): LimitProfile | null {
  if (workPackage !== 'emission' && workPackage !== 'obd') return null
  const category = basis.category
  const ignition = basis.ignition
  if (workPackage === 'obd') {
    const stage: ObdStage = basis.obdStage ?? 'OBD-II'
    const table = stage === 'OBD-I' ? obdI : obdII
    return profile(
      `india-bs6-mn-${stage.toLowerCase()}-${category.toLowerCase()}-${ignition.toLowerCase()}`,
      `India BS VI ${stage} threshold - ${classLabel(category)} ${ignition}`,
      'obdThreshold',
      table[category][ignition],
      ['OBD thresholds are not tailpipe type-approval limits. Use only for OBD work package evidence.'],
    )
  }
  const limits = ignition === 'PI' ? piTailpipe[category] : ciTailpipe[category]
  const notes = ignition === 'CI'
    ? ['The booklet specifies HC+NOx combined limits for CI; this app currently evaluates the separate pollutants available in uploaded reports.']
    : ['PM/PN applicability for PI depends on direct-injection applicability in the source regulation.']
  return profile(
    `india-bs6-mn-tailpipe-${category.toLowerCase()}-${ignition.toLowerCase()}`,
    `India BS VI tailpipe - ${classLabel(category)} ${ignition}`,
    'tailpipe',
    limits,
    notes,
  )
}

const STLA_TARGET = profile(
  'stla-engineering-target',
  'STLA engineering target',
  'engineeringTarget',
  { CO: 416, THC: 47, NOx: 20, NMHC: 31, PM: 0.75, PN: 3.1e11 },
  ['Project-specific development target transcribed from STLA compilation workbook header rows.'],
)

export function engineeringTargetFor(test: Pick<Test, 'project' | 'wp'>): LimitProfile | null {
  if ((test.wp ?? 'emission') !== 'emission') return null
  return String(test.project).toUpperCase() === 'STLA' ? STLA_TARGET : null
}

export function limitContext(test: Test): LimitContext {
  const workPackage = test.wp ?? 'emission'
  const basis = defaultRegulatoryBasis(test)
  const confirmed = basis.source === 'manual' || basis.source === 'parsed'
  return {
    workPackage,
    regulatory: regulatoryProfileFor(workPackage, basis),
    target: engineeringTargetFor(test),
    basis,
    basisStatus: confirmed ? 'confirmed' : 'unconfirmed',
    message: confirmed ? undefined : 'Unconfirmed M/N basis: default values are shown for orientation only until vehicle class and ignition are confirmed.',
  }
}

export const DEFAULT_REGULATORY_PROFILE = regulatoryProfileFor('emission', defaultRegulatoryBasis())!
export const DEFAULT_TARGET_PROFILE = STLA_TARGET
export const NORM = DEFAULT_REGULATORY_PROFILE
export const TARGET = DEFAULT_TARGET_PROFILE
export const DEFAULT_PROFILES: LimitProfile[] = [DEFAULT_REGULATORY_PROFILE, DEFAULT_TARGET_PROFILE]

/** Fraction of limit remaining: (limit - value)/limit. Higher = more headroom. */
export function margin(value: number | null, limit: number | null): number | null {
  if (value == null || limit == null || limit === 0) return null
  return (limit - value) / limit
}

/** RAG vs a limit: fail if over limit, warn if <20% headroom, else pass. */
export function rag(value: number | null, limit: number | null): RagLevel {
  const m = margin(value, limit)
  if (m == null) return 'na'
  if (m < 0) return 'fail'
  if (m < 0.2) return 'warn'
  return 'pass'
}

export const RAG_COLOR: Record<RagLevel, string> = {
  pass: '#16a34a',
  warn: '#d97706',
  fail: '#dc2626',
  na: '#94a3b8',
}

/** Format a pollutant value for display (PN/PM get special handling). */
export function displayValue(value: number | null, p: Pollutant, unit: MassUnit = 'mg/km'): number | null {
  if (value == null) return null
  return p === 'PN' || unit === 'mg/km' ? value : value / 1000
}

export function fmt(value: number | null, p: Pollutant, unit: MassUnit = 'mg/km'): string {
  if (value == null) return '-'
  if (p === 'PN') return value.toExponential(2)
  const shown = displayValue(value, p, unit)!
  if (unit === 'g/km') {
    if (p === 'CO2') return shown.toFixed(2)
    if (p === 'PM') return shown.toFixed(6)
    return shown.toFixed(4)
  }
  if (p === 'CO2') return shown.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (p === 'PM') return shown.toFixed(3)
  return shown.toFixed(2)
}

export function displayUnit(p: Pollutant, unit: MassUnit = 'mg/km'): string {
  return p === 'PN' ? '#/km' : unit
}

export const UNIT: Record<Pollutant, string> = {
  CO: 'mg/km', THC: 'mg/km', NOx: 'mg/km', CO2: 'mg/km',
  CH4: 'mg/km', NMHC: 'mg/km', PM: 'mg/km', PN: '#/km',
}

export const TRACE_UNIT: Partial<Record<keyof import('./types').TracePoint, string>> = {
  t: 's', speed: 'km/h', force: 'N', power: 'kW', NOx: 'ppm', CO: 'ppm', CO2: '%',
  THC: 'ppm', CH4: 'ppm', NMHC: 'ppm', COH: '%', O2: '%', PN: '1/cm3',
  CO_mass_g: 'g', THC_mass_g: 'g', NOx_mass_g: 'g', CO2_mass_g: 'g', CH4_mass_g: 'g',
}
