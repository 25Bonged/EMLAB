import { describe, it, expect } from 'vitest'
import { mean, stdev, linregress, cpu, wilson, percentile, trapz } from './stats'

describe('stats', () => {
  it('mean and stdev', () => {
    expect(mean([2, 4, 6])).toBe(4)
    expect(stdev([2, 4, 6])).toBeCloseTo(2, 6) // sample sd
    expect(stdev([5])).toBe(0)
  })

  it('linregress recovers a known line y = 2x + 1', () => {
    const fit = linregress([0, 1, 2, 3, 4].map((x) => ({ x, y: 2 * x + 1 })))
    expect(fit.slope).toBeCloseTo(2, 9)
    expect(fit.intercept).toBeCloseTo(1, 9)
    expect(fit.r2).toBeCloseTo(1, 9)
    expect(fit.n).toBe(5)
  })

  it('linregress r2 < 1 for noisy data', () => {
    const fit = linregress([
      { x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 2 }, { x: 3, y: 5 },
    ])
    expect(fit.r2).toBeGreaterThan(0)
    expect(fit.r2).toBeLessThan(1)
  })

  it('cpu upper capability', () => {
    // mean 10, sd 2, usl 20 → (20-10)/(3*2) = 1.667
    const vals = [8, 10, 12, 10, 10] // mean 10, sd 1.414
    const c = cpu(vals, 20)!
    expect(c).toBeCloseTo((20 - 10) / (3 * stdev(vals)), 9)
    expect(cpu([5, 5, 5], 10)).toBeNull() // zero variance
  })

  it('wilson interval brackets the proportion', () => {
    const w = wilson(8, 10)
    expect(w.p).toBeCloseTo(0.8, 9)
    expect(w.lo).toBeGreaterThan(0.4)
    expect(w.hi).toBeLessThan(1)
    expect(w.lo).toBeLessThan(w.p)
    expect(w.hi).toBeGreaterThan(w.p)
    expect(wilson(0, 0)).toEqual({ lo: 0, hi: 0, p: 0 })
  })

  it('percentile interpolates', () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBeCloseTo(2.5, 9)
    expect(percentile([10], 0.95)).toBe(10)
    expect(percentile([0, 10], 0.95)).toBeCloseTo(9.5, 9)
  })

  it('trapz integrates a constant and a ramp', () => {
    expect(trapz([0, 1, 2], [2, 2, 2])).toBeCloseTo(4, 9) // area = 2*2
    expect(trapz([0, 2], [0, 4])).toBeCloseTo(4, 9) // triangle 0.5*2*4
  })
})
