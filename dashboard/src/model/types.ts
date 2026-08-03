export const POLLUTANTS = ['CO', 'THC', 'NOx', 'CO2', 'CH4', 'NMHC', 'PM', 'PN'] as const
export type Pollutant = (typeof POLLUTANTS)[number]

export type Project = 'STLA' | 'Honda' | 'RNTBCI' | string
export type Cycle = 'WLTP' | 'MIDC' | 'NEDC' | 'Unknown' | string
export type Lab = 'FEV' | 'ARAI' | string

export interface PhaseResult {
  name: string
  distanceKm: number | null
  specific: Partial<Record<Pollutant, number>>
  fuelL100?: number | null
}

export interface TracePoint {
  t: number
  speed?: number
  force?: number
  power?: number
  CO?: number
  THC?: number
  NOx?: number
  CO2?: number
  CH4?: number
  NMHC?: number
  COH?: number
  O2?: number
  PN?: number
  CO_mass_g?: number
  THC_mass_g?: number
  NOx_mass_g?: number
  CO2_mass_g?: number
  CH4_mass_g?: number
}

export interface TraceRecord {
  dilute: TracePoint[]
  preCat: TracePoint[]
  postCat: TracePoint[]
}

export interface UnitMetadata {
  resultsCanonical: 'mg/km'
  resultsSource: 'mg/km' | 'g/km'
  resultSourceByPollutant?: Partial<Record<Pollutant, 'mg/km' | 'g/km' | '#/km'>>
  trace?: {
    dilute: Partial<Record<keyof TracePoint, string>>
    preCat: Partial<Record<keyof TracePoint, string>>
    postCat: Partial<Record<keyof TracePoint, string>>
  }
}

/** A single emission test = one PDF report (+ optional XLSM trace). */
export interface Test {
  id: string // filename stem
  project: Project
  program_id?: string // stable link to the owning program (folder)
  cycle: Cycle
  config: string // CC24 / CC22 / Unknown
  transmission: string // MB6 / AT6 / Unknown
  lab: Lab
  vehicleModel: string
  vinSampleId: string
  vnNo: string
  date: string // ISO yyyy-mm-dd
  catalystState?: string
  stt?: 'ON' | 'OFF' | null
  startSoc?: number | null
  inertia?: number | null
  odo?: number | null
  distanceKm?: number | null
  phaseCount?: number | null
  /** Dyno Set A/B/C from the report remarks line — the dyno's own setting. */
  rld: { A: number | null; B: number | null; C: number | null }
  /** Vehicle A/B/C from the page-1 vehicle table — the coefficients J2951 needs.
   *  Distinct from `rld`; do not substitute one for the other. */
  vehicleRld: { A: number | null; B: number | null; C: number | null }
  fuel: { name?: string | null; consumptionL100?: number | null; economyKmL?: number | null }
  conditions: { ambientC?: number | null; humidity?: number | null; cellPressure?: number | null }
  results: Record<Pollutant, number | null> // complete-cycle Specific [mg/km] (PN = #/km)
  phases: PhaseResult[]
  trace?: TraceRecord
  j2951?: J2951Result | null
  units?: UnitMetadata
  source: { pdf?: string; xlsm?: string; xlsx?: string; sheet?: string; row?: number }
  /** fields the parser could not read with confidence */
  lowConfidence: string[]
  /** user manual overrides applied on top of parsed values */
  overrides?: Partial<Record<keyof Test, unknown>>
  importedAt: string
  status?: IngestionStatus
}

export type RagLevel = 'pass' | 'warn' | 'fail' | 'na'
export type IngestionStatus = 'pending_pair' | 'processing' | 'quarantined' | 'accepted' | 'replaced'

/* ---------------------------- SAE J2951 drive trace ---------------------------- */

export interface J2951PhaseIwr {
  name: string
  iwr: number
}

export interface J2951Indices {
  iwr: number // %
  rmsse: number // km/h
  dr: number
  er: number | null // null when vehicle road load is unavailable
  eer: number | null
  ascr: number
  distTargetKm: number
  distActualKm: number
  iwTargetJkg: number
  iwActualJkg: number
  /** IWR restricted to each cycle phase — localises where the excess
   *  kinetic work was generated. Empty when the schedule defines no phases. */
  phaseIwr: J2951PhaseIwr[]
}

export interface J2951Inputs {
  massKg: number
  f0: number
  f1: number
  f2: number
  kr: number
  source: 'parsed' | 'override'
}

export type J2951Unavailable = 'no_trace' | 'no_schedule' | 'sample_rate' | 'length_mismatch'

export interface J2951Verdict {
  iwr: RagLevel
  rmsse: RagLevel
  /** Driven distance vs the schedule: ±1 % legal, rejection past 1.5 %. */
  distance: RagLevel
  overall: RagLevel
}

export interface J2951Result {
  calcVersion: number
  scheduleId: string | null
  sampleRateHz: number | null
  indices: J2951Indices | null
  verdict: J2951Verdict | null
  inputs: J2951Inputs | null
  unavailable?: J2951Unavailable
  detail?: string
}
