// Statistics for the simulation reports.
// Kept apart from harness.ts: these are pure functions over numbers, they know nothing about
// the game or the seed. They can be tested in isolation from the engine.

export interface Interval {
  low: number
  high: number
}

export function mean(xs: readonly number[]): number {
  if (xs.length === 0) return NaN
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

// Sample variance (unbiased, divisor n − 1).
export function variance(xs: readonly number[]): number {
  if (xs.length < 2) return NaN
  const m = mean(xs)
  return xs.reduce((acc, x) => acc + (x - m) ** 2, 0) / (xs.length - 1)
}

export function stdDev(xs: readonly number[]): number {
  return Math.sqrt(variance(xs))
}

export function percentile(xs: readonly number[], p: number): number {
  if (xs.length === 0) return NaN
  const sorted = [...xs].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[idx]
}

// ─── Confidence interval for a proportion ────────────────────────────────────
//
// A Wilson interval rather than the plain normal one. The reason is practical: win rates in
// this project sit close to one (a class wins 99.8% of its battles). The normal
// interval in that zone gives an upper bound above 100% — that is, the report
// reports an impossible value and looks broken in exactly the place where it
// is looked at most closely. Wilson stays inside [0, 1] for any proportion,
// including 0 and 1, and needs no special handling of the edge cases.

export function wilsonInterval(successes: number, total: number, z = 1.96): Interval {
  if (total === 0) return { low: NaN, high: NaN }

  const p = successes / total
  const z2 = z * z
  const denominator = 1 + z2 / total
  const center = (p + z2 / (2 * total)) / denominator
  const spread =
    (z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) / denominator

  return {
    low: Math.max(0, center - spread),
    high: Math.min(1, center + spread),
  }
}

// Interval half-width — how much the estimate still floats at this number of runs.
export function marginOfError(successes: number, total: number, z = 1.96): number {
  const { low, high } = wilsonInterval(successes, total, z)
  return (high - low) / 2
}

// ─── Corridors ───────────────────────────────────────────────────────────────

export interface Corridor {
  min: number
  max: number
}

export type Verdict = 'PASS' | 'FAIL' | 'INCONCLUSIVE'

// The verdict comes from the confidence interval, not from the point estimate.
//
// A point estimate on the corridor boundary means nothing: at 100 runs it
// swings by tens of percent. Hence:
//   PASS         — the whole interval sits inside the corridor
//   FAIL         — the whole interval sits outside, the miss is proven
//   INCONCLUSIVE — the interval crosses the boundary: there are not enough runs to
//                  say anything. This is not "almost PASS", it is "not measured".
export function verdictFor(value: Interval, corridor: Corridor): Verdict {
  if (value.low >= corridor.min && value.high <= corridor.max) return 'PASS'
  if (value.high < corridor.min || value.low > corridor.max) return 'FAIL'
  return 'INCONCLUSIVE'
}

// ─── Histogram ───────────────────────────────────────────────────────────────

export function histogram(xs: readonly number[]): Map<number, number> {
  const result = new Map<number, number>()
  for (const x of xs) result.set(x, (result.get(x) ?? 0) + 1)
  return new Map([...result.entries()].sort((a, b) => a[0] - b[0]))
}

// ─── Comparing two measurements ──────────────────────────────────────────────
//
// Whether two runs can be told apart at all. Point estimates always differ;
// what matters is whether the difference survives the sampling. Overlapping
// intervals mean the runs cannot distinguish the builds, however far apart the
// midpoints look — reporting such a gap as a finding is reporting noise.
//
// Deliberately conservative: overlapping intervals do not prove the values are
// equal, only that this sample cannot separate them. "Not distinguishable" is
// the honest reading, not "unchanged".

export function intervalsOverlap(a: Interval, b: Interval): boolean {
  return a.low <= b.high && b.low <= a.high
}

// ─── Extremes over large collections ─────────────────────────────────────────
//
// `Math.max(...xs)` passes every element as a separate argument, so it throws
// RangeError once the array outgrows the call-stack limit — somewhere around
// 10⁵ elements, depending on the engine. It works fine at 16,000 runs and dies
// at 1,000,000, which is the worst possible failure profile: invisible until the
// scale that matters. Found by the first million-seed run (BUG-17).

export function maxOf(xs: readonly number[]): number {
  let max = -Infinity
  for (const x of xs) if (x > max) max = x
  return max
}

export function minOf(xs: readonly number[]): number {
  let min = Infinity
  for (const x of xs) if (x < min) min = x
  return min
}

// ─── Formatting ──────────────────────────────────────────────────────────────

export function pct(x: number, digits = 1): string {
  return `${(x * 100).toFixed(digits)}%`
}

export function bar(fraction: number, width = 10): string {
  const filled = Math.max(0, Math.min(width, Math.round(fraction * width)))
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}
