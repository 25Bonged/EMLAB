// Pure statistical primitives used across the engineering analyses.
// Kept dependency-free and fully unit-tested — these numbers go in front of clients.

export const mean = (xs: number[]): number =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0

/** Sample standard deviation (n-1). Returns 0 for n < 2. */
export const stdev = (xs: number[]): number => {
  if (xs.length < 2) return 0
  const m = mean(xs)
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)
  return Math.sqrt(v)
}

/** Linear least-squares y = slope·x + intercept, with coefficient of determination. */
export interface LinFit {
  slope: number
  intercept: number
  r2: number
  n: number
}
export function linregress(points: { x: number; y: number }[]): LinFit {
  const n = points.length
  if (n < 2) return { slope: 0, intercept: n ? points[0].y : 0, r2: 0, n }
  const mx = mean(points.map((p) => p.x))
  const my = mean(points.map((p) => p.y))
  let sxx = 0
  let sxy = 0
  let syy = 0
  for (const p of points) {
    sxx += (p.x - mx) ** 2
    sxy += (p.x - mx) * (p.y - my)
    syy += (p.y - my) ** 2
  }
  if (sxx === 0) return { slope: 0, intercept: my, r2: 0, n }
  const slope = sxy / sxx
  const intercept = my - slope * mx
  const r2 = syy === 0 ? 1 : (sxy * sxy) / (sxx * syy)
  return { slope, intercept, r2, n }
}

/**
 * One-sided upper process capability (Cpu). For tailpipe emissions the lower
 * bound is a physical 0, so only the upper spec limit constrains capability.
 * Cpu = (USL − mean) / (3σ).  Higher is better; ≥1.33 is the usual release bar.
 */
export function cpu(values: number[], usl: number): number | null {
  const s = stdev(values)
  if (s === 0 || !values.length) return null
  return (usl - mean(values)) / (3 * s)
}

/** Wilson score interval for a binomial proportion (default 95%, z=1.96). */
export function wilson(passes: number, n: number, z = 1.96): { lo: number; hi: number; p: number } {
  if (n === 0) return { lo: 0, hi: 0, p: 0 }
  const p = passes / n
  const z2 = z * z
  const denom = 1 + z2 / n
  const centre = p + z2 / (2 * n)
  const margin = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))
  return { lo: Math.max(0, (centre - margin) / denom), hi: Math.min(1, (centre + margin) / denom), p }
}

/** Linear-interpolated percentile (p in [0,1]). */
export function percentile(values: number[], p: number): number {
  if (!values.length) return 0
  const s = [...values].sort((a, b) => a - b)
  if (s.length === 1) return s[0]
  const idx = p * (s.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return s[lo]
  return s[lo] + (s[hi] - s[lo]) * (idx - lo)
}

/** Trapezoidal integral of y over x (e.g. concentration·time, speed·time). */
export function trapz(xs: number[], ys: number[]): number {
  let area = 0
  for (let i = 1; i < xs.length; i++) {
    area += ((ys[i] + ys[i - 1]) / 2) * (xs[i] - xs[i - 1])
  }
  return area
}
