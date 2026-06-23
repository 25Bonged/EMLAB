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
  rld: { A: number | null; B: number | null; C: number | null }
  fuel: { name?: string | null; consumptionL100?: number | null; economyKmL?: number | null }
  conditions: { ambientC?: number | null; humidity?: number | null; cellPressure?: number | null }
  results: Record<Pollutant, number | null> // complete-cycle Specific [mg/km] (PN = #/km)
  phases: PhaseResult[]
  trace?: TraceRecord
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
