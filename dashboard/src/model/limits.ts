import type { Pollutant, RagLevel } from './types'
import type { MassUnit } from '../store/useUnits'

export interface LimitProfile {
  id: string
  label: string
  /** mg/km, except PN which is #/km. null = no limit (reported only). */
  limits: Record<Pollutant, number | null>
}

// BS6.2 M-class norms and STLA engineering targets, transcribed from the
// compile workbook header rows (CC24MB6_FEV sheets, rows 1-3).
export const NORM: LimitProfile = {
  id: 'bs62-m',
  label: 'BS6.2 M-class norm',
  limits: { CO: 1000, THC: 100, NOx: 60, CO2: null, CH4: null, NMHC: 68, PM: 4.5, PN: 6.0e11 },
}

export const TARGET: LimitProfile = {
  id: 'stla-target',
  label: 'STLA engineering target',
  limits: { CO: 416, THC: 47, NOx: 20, CO2: null, CH4: null, NMHC: 31, PM: 0.75, PN: 3.1e11 },
}

export const DEFAULT_PROFILES: LimitProfile[] = [NORM, TARGET]

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
  if (value == null) return '—'
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
  THC: 'ppm', CH4: 'ppm', NMHC: 'ppm', COH: '%', O2: '%', PN: '1/cm³',
  CO_mass_g: 'g', THC_mass_g: 'g', NOx_mass_g: 'g', CO2_mass_g: 'g', CH4_mass_g: 'g',
}
