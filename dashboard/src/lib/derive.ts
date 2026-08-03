import type { Pollutant, RagLevel, Test } from '../model/types'
import { NORM, TARGET, rag, margin, type LimitProfile } from '../model/limits'

/** Pollutants that have a regulated limit (CO2 & CH4 are reported only). */
export const LIMITED: Pollutant[] = ['CO', 'THC', 'NOx', 'NMHC', 'PM', 'PN']
export const ALL_POLL: Pollutant[] = ['CO', 'THC', 'NOx', 'CO2', 'CH4', 'NMHC', 'PM', 'PN']

const RANK: Record<RagLevel, number> = { fail: 3, warn: 2, pass: 1, na: 0 }

export interface TestCompliance {
  perPollutant: Record<Pollutant, { value: number | null; rag: RagLevel; margin: number | null }>
  overall: RagLevel
}

export function compliance(test: Test, profile: LimitProfile): TestCompliance {
  const per = {} as TestCompliance['perPollutant']
  let worst: RagLevel = 'na'
  for (const p of ALL_POLL) {
    const v = test.results[p]
    const lim = profile.limits[p]
    const r = rag(v, lim)
    per[p] = { value: v, rag: r, margin: margin(v, lim) }
    if (LIMITED.includes(p) && RANK[r] > RANK[worst]) worst = r
  }
  return { perPollutant: per, overall: worst }
}

export const verdictVs = (test: Test, profile: LimitProfile = TARGET) => compliance(test, profile).overall
export const passesNorm = (test: Test) => compliance(test, NORM).overall !== 'fail'
export const passesTarget = (test: Test) => compliance(test, TARGET).overall !== 'fail'

/** distinct sorted values of a field across tests */
export function distinct<K extends keyof Test>(tests: Test[], key: K): string[] {
  return [...new Set(tests.map((t) => String(t[key])).filter((v) => v && v !== 'Unknown'))].sort()
}

// Programs are user-created (see usePrograms); nothing is seeded.
export const PROJECT_ORDER: string[] = []
export const CYCLE_ORDER = ['WLTP', 'MIDC', 'NEDC', 'Unknown']
