import { describe, it, expect } from 'vitest'
import { getSchedule, getScheduleById, scheduleIdForCycle } from './cycles'

describe('schedule registry', () => {
  it('ships WLTC 3b as 1478 points at 1 Hz starting at t=0', () => {
    const s = getScheduleById('WLTC_3B_LMH')
    expect(s.length).toBe(1478)
    expect(s[0]).toBe(0)
    expect(Number.isFinite(s[s.length - 1])).toBe(true)
  })

  it('reproduces the WLTC 3b theoretical distance of 15.0123 km', () => {
    const s = getScheduleById('WLTC_3B_LMH')
    let sum = 0
    for (const v of s) sum += v
    expect((sum * 1) / 3600).toBeCloseTo(15.0123, 3)
  })

  it('parses once and returns the same instance thereafter', () => {
    expect(getScheduleById('WLTC_3B_LMH')).toBe(getScheduleById('WLTC_3B_LMH'))
  })

  it('maps WLTP to the WLTC 3b schedule', () => {
    expect(scheduleIdForCycle('WLTP')).toBe('WLTC_3B_LMH')
    expect(getSchedule('WLTP')!.id).toBe('WLTC_3B_LMH')
  })

  it('gives MIDC, NEDC and Unknown no schedule rather than a guessed one', () => {
    for (const c of ['MIDC', 'NEDC', 'Unknown'] as const) {
      expect(scheduleIdForCycle(c)).toBeNull()
      expect(getSchedule(c)).toBeNull()
    }
  })
})
