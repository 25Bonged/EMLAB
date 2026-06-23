import { describe, expect, it } from 'vitest'
import { displayUnit, displayValue, fmt } from './limits'

describe('emission unit conversions', () => {
  it('converts canonical mg/km values to g/km without changing PN', () => {
    expect(displayValue(325.3, 'CO', 'g/km')).toBeCloseTo(0.3253, 6)
    expect(fmt(325.3, 'CO', 'g/km')).toBe('0.3253')
    expect(displayValue(134752.04, 'CO2', 'g/km')).toBeCloseTo(134.75204, 6)
    expect(fmt(134752.04, 'CO2', 'g/km')).toBe('134.75')
    expect(displayValue(3.38e9, 'PN', 'g/km')).toBe(3.38e9)
    expect(displayUnit('PN', 'g/km')).toBe('#/km')
  })

  it('keeps canonical report values unchanged in mg/km', () => {
    expect(displayValue(24.73, 'NOx', 'mg/km')).toBe(24.73)
    expect(fmt(24.73, 'NOx', 'mg/km')).toBe('24.73')
    expect(displayUnit('NOx', 'mg/km')).toBe('mg/km')
  })
})
