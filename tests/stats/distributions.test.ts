import { describe, it, expect } from 'vitest'
import {
  lnGamma,
  gammaQ,
  erfc,
  chiSquarePValue,
  normalTwoSidedPValue,
  pValueUniformity,
} from '../../src/stats/distributions'
import { intervalsOverlap } from '../../scripts/lib/stats'

// ─── Why this file exists ─────────────────────────────────────────────────────
//
// The RNG battery reports p-values, and every one of them comes out of the
// functions under test here. If this arithmetic is wrong, the battery still
// prints confident-looking numbers and still passes — the failure is silent by
// construction, exactly like the biased sample in BUG-13.
//
// So these are checked against published table values rather than against
// themselves. A test that compares an implementation to its own output would be
// green no matter what the implementation does.

// ─── lnGamma ──────────────────────────────────────────────────────────────────

describe('lnGamma', () => {
  it('matches the factorial identity Γ(n) = (n−1)!', () => {
    // Γ(1) = 0! = 1, Γ(2) = 1! = 1 → ln = 0
    expect(lnGamma(1)).toBeCloseTo(0, 10)
    expect(lnGamma(2)).toBeCloseTo(0, 10)
    // Γ(5) = 4! = 24
    expect(lnGamma(5)).toBeCloseTo(Math.log(24), 10)
    // Γ(11) = 10! = 3,628,800
    expect(lnGamma(11)).toBeCloseTo(Math.log(3_628_800), 9)
  })

  it('matches Γ(1/2) = √π', () => {
    expect(lnGamma(0.5)).toBeCloseTo(Math.log(Math.sqrt(Math.PI)), 10)
  })
})

// ─── gammaQ ───────────────────────────────────────────────────────────────────

describe('gammaQ', () => {
  it('Q(a, 0) = 1 — the whole mass sits in the upper tail', () => {
    expect(gammaQ(1, 0)).toBe(1)
    expect(gammaQ(4.5, 0)).toBe(1)
  })

  it('Q(1, x) = e^(−x) — the exponential special case', () => {
    for (const x of [0.5, 1, 2, 5, 10]) {
      expect(gammaQ(1, x)).toBeCloseTo(Math.exp(-x), 10)
    }
  })

  it('crosses the series/continued-fraction boundary without a jump', () => {
    // The implementation switches strategy at x = a + 1. A discontinuity there
    // would be invisible in any single-point check.
    //
    // On the tolerance: across a step of 2e-7 the function itself moves by about
    // |Q'| · 2e-7 ≈ 3e-8, so demanding a smaller difference than that would fail
    // on a perfectly continuous function. A genuine seam between the two
    // strategies shows up at 1e-3 and above, which 1e-6 catches with room to
    // spare while staying far below the value of Q itself (~0.35 here).
    const a = 3
    const left = gammaQ(a, a + 1 - 1e-7)
    const right = gammaQ(a, a + 1 + 1e-7)
    expect(Math.abs(left - right)).toBeLessThan(1e-6)
  })

  it('decreases monotonically in x', () => {
    let previous = gammaQ(2, 0.1)
    for (const x of [0.5, 1, 2, 4, 8, 16]) {
      const current = gammaQ(2, x)
      expect(current).toBeLessThan(previous)
      previous = current
    }
  })
})

// ─── erfc ─────────────────────────────────────────────────────────────────────

describe('erfc', () => {
  it('matches published values', () => {
    expect(erfc(0)).toBeCloseTo(1, 12)
    expect(erfc(0.5)).toBeCloseTo(0.4795001222, 8)
    expect(erfc(1)).toBeCloseTo(0.1572992071, 8)
    expect(erfc(2)).toBeCloseTo(0.0046777349, 9)
  })

  it('is symmetric: erfc(−x) = 2 − erfc(x)', () => {
    for (const x of [0.25, 1, 2.5]) {
      expect(erfc(-x)).toBeCloseTo(2 - erfc(x), 10)
    }
  })
})

// ─── chi-square p-values ──────────────────────────────────────────────────────

describe('chiSquarePValue', () => {
  it('matches the critical values the battery is calibrated against', () => {
    // Standard table: the statistic at α gives back that α.
    expect(chiSquarePValue(3.841, 1)).toBeCloseTo(0.05, 3)
    expect(chiSquarePValue(10.828, 1)).toBeCloseTo(0.001, 4)
    expect(chiSquarePValue(11.070, 5)).toBeCloseTo(0.05, 3)
    expect(chiSquarePValue(20.515, 5)).toBeCloseTo(0.001, 4)
    expect(chiSquarePValue(27.877, 9)).toBeCloseTo(0.001, 4)
    expect(chiSquarePValue(49.728, 23)).toBeCloseTo(0.001, 4)
    expect(chiSquarePValue(148.230, 99)).toBeCloseTo(0.001, 4)
  })

  it('a statistic of zero means a perfect fit, p = 1', () => {
    expect(chiSquarePValue(0, 5)).toBe(1)
  })

  it('p-value falls as the statistic grows', () => {
    let previous = 1
    for (const statistic of [1, 5, 10, 30, 100]) {
      const p = chiSquarePValue(statistic, 5)
      expect(p).toBeLessThan(previous)
      previous = p
    }
  })

  it('stays inside [0, 1] far into the tail', () => {
    const p = chiSquarePValue(500, 5)
    expect(p).toBeGreaterThanOrEqual(0)
    expect(p).toBeLessThan(1e-20)
  })

  it('rejects a degrees-of-freedom value that cannot occur', () => {
    expect(() => chiSquarePValue(1, 0)).toThrow(RangeError)
  })
})

// ─── normal p-values ──────────────────────────────────────────────────────────

describe('normalTwoSidedPValue', () => {
  it('matches the z thresholds used across the battery', () => {
    expect(normalTwoSidedPValue(1.959964)).toBeCloseTo(0.05, 5)
    expect(normalTwoSidedPValue(2.575829)).toBeCloseTo(0.01, 5)
    expect(normalTwoSidedPValue(3.290527)).toBeCloseTo(0.001, 5)
  })

  it('z = 0 gives p = 1', () => {
    expect(normalTwoSidedPValue(0)).toBeCloseTo(1, 12)
  })

  it('is two-sided: sign of z does not matter', () => {
    expect(normalTwoSidedPValue(-2.1)).toBeCloseTo(normalTwoSidedPValue(2.1), 12)
  })
})

// ─── uniformity of p-values ───────────────────────────────────────────────────

describe('pValueUniformity', () => {
  it('evenly spread p-values are not flagged', () => {
    const spread = Array.from({ length: 1000 }, (_, i) => (i + 0.5) / 1000)
    expect(pValueUniformity(spread)).toBeGreaterThan(0.99)
  })

  it('p-values piled up at one end are flagged', () => {
    // Every run "passes" individually — all p-values are above 0.01 — while the
    // distribution says the deviations are systematic. This is the case the
    // second-order check exists for.
    const piled = Array.from({ length: 1000 }, (_, i) => 0.02 + (i / 1000) * 0.08)
    expect(pValueUniformity(piled)).toBeLessThan(1e-6)
  })

  it('rejects an empty sample instead of returning a number', () => {
    expect(() => pValueUniformity([])).toThrow(RangeError)
  })
})

// ─── Interval comparison ──────────────────────────────────────────────────────
// Used by `npm run delta` to decide whether two runs can be told apart. The
// verdict a regression report prints rests on this three-line function, which is
// exactly the kind of code nobody re-derives while reading a report.

describe('intervalsOverlap', () => {
  it('separate intervals do not overlap', () => {
    expect(intervalsOverlap({ low: 0.10, high: 0.20 }, { low: 0.30, high: 0.40 })).toBe(false)
    expect(intervalsOverlap({ low: 0.30, high: 0.40 }, { low: 0.10, high: 0.20 })).toBe(false)
  })

  it('intervals that touch at a single point count as overlapping', () => {
    // The conservative reading: a shared boundary is not evidence of difference.
    expect(intervalsOverlap({ low: 0.10, high: 0.20 }, { low: 0.20, high: 0.30 })).toBe(true)
  })

  it('a contained interval overlaps its container', () => {
    expect(intervalsOverlap({ low: 0.10, high: 0.50 }, { low: 0.20, high: 0.30 })).toBe(true)
    expect(intervalsOverlap({ low: 0.20, high: 0.30 }, { low: 0.10, high: 0.50 })).toBe(true)
  })

  it('the order of arguments does not matter', () => {
    const a = { low: 0.68, high: 0.72 }
    const b = { low: 0.71, high: 0.75 }
    expect(intervalsOverlap(a, b)).toBe(intervalsOverlap(b, a))
  })

  it('real case: the BUG-14 regression was distinguishable', () => {
    // bloodmage before [93.4%, 94.7%] and after [71.4%, 74.1%] — far apart, and
    // the delta report calls it SIGNIFICANT.
    expect(intervalsOverlap({ low: 0.934, high: 0.947 }, { low: 0.714, high: 0.741 })).toBe(false)
  })

  it('real case: two runs of the same build are not distinguishable', () => {
    // Same build, different sample: the intervals sit on top of each other, and
    // calling that a change would make every re-run look like a regression.
    expect(intervalsOverlap({ low: 0.689, high: 0.720 }, { low: 0.695, high: 0.699 })).toBe(true)
  })
})
