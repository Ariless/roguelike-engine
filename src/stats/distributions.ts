// Distribution functions needed to turn a test statistic into a p-value.
//
// Why this file exists. A statistical test can be reported in two ways. The
// cheap way compares the statistic against a critical value from a table and
// prints PASS or FAIL: it answers "did it cross the line" and nothing else.
// The p-value answers a different question — how unlikely is a deviation at
// least this large if the generator is sound — and it is the number RNG
// certification batteries report, because it can be aggregated, compared
// across runs, and tested for uniformity in its own right.
//
// The functions are implemented here rather than pulled from a library on
// purpose: they are the arithmetic the report rests on, and a reviewer should
// be able to read them. Algorithms follow Numerical Recipes (§6.1–6.2).
//
// All functions are pure and deterministic. No RNG, no I/O.

// ─── Log-gamma (Lanczos approximation) ────────────────────────────────────────

const LANCZOS = [
  76.18009172947146, -86.50532032941677, 24.01409824083091,
  -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5,
]

/** ln Γ(x) for x > 0. Accurate to ~1e-10 over the range used here. */
export function lnGamma(x: number): number {
  let y = x
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5)
  let ser = 1.000000000190015
  for (const c of LANCZOS) ser += c / ++y
  return -tmp + Math.log((2.5066282746310005 * ser) / x)
}

// ─── Regularised incomplete gamma ─────────────────────────────────────────────

const ITMAX = 300
const EPS = 3e-12
const FPMIN = 1e-300

/** Series expansion for P(a, x); converges quickly when x < a + 1. */
function gammaPSeries(a: number, x: number): number {
  if (x <= 0) return 0
  let ap = a
  let sum = 1 / a
  let del = sum
  for (let n = 0; n < ITMAX; n++) {
    ap++
    del *= x / ap
    sum += del
    if (Math.abs(del) < Math.abs(sum) * EPS) break
  }
  return sum * Math.exp(-x + a * Math.log(x) - lnGamma(a))
}

/** Continued fraction for Q(a, x); converges quickly when x >= a + 1. */
function gammaQContinuedFraction(a: number, x: number): number {
  let b = x + 1 - a
  let c = 1 / FPMIN
  let d = 1 / b
  let h = d
  for (let i = 1; i <= ITMAX; i++) {
    const an = -i * (i - a)
    b += 2
    d = an * d + b
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = b + an / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < EPS) break
  }
  return Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h
}

/**
 * Regularised upper incomplete gamma Q(a, x) = 1 − P(a, x).
 * This is the tail probability every test below is expressed through.
 */
export function gammaQ(a: number, x: number): number {
  if (x < 0 || a <= 0) throw new RangeError(`gammaQ: invalid arguments a=${a}, x=${x}`)
  if (x === 0) return 1
  return x < a + 1 ? 1 - gammaPSeries(a, x) : gammaQContinuedFraction(a, x)
}

// ─── p-values ─────────────────────────────────────────────────────────────────

/**
 * Upper-tail p-value of a chi-square statistic with `df` degrees of freedom.
 * P(χ²_df >= statistic) — the probability of a deviation at least this large
 * when the null hypothesis (the generator is uniform) holds.
 */
export function chiSquarePValue(statistic: number, df: number): number {
  if (df < 1) throw new RangeError(`chiSquarePValue: df must be >= 1, got ${df}`)
  if (statistic <= 0) return 1
  return gammaQ(df / 2, statistic / 2)
}

/** Complementary error function, expressed through the same gamma tail. */
export function erfc(x: number): number {
  if (x === 0) return 1
  const q = gammaQ(0.5, x * x)
  return x > 0 ? q : 2 - q
}

/**
 * Two-sided p-value of a standard normal statistic: P(|Z| >= |z|).
 * NIST SP 800-22 reports monobit and runs this way.
 */
export function normalTwoSidedPValue(z: number): number {
  return erfc(Math.abs(z) / Math.SQRT2)
}

/** Standard normal CDF Φ(x) = P(Z <= x). */
export function normalCdf(x: number): number {
  return 0.5 * erfc(-x / Math.SQRT2)
}

// ─── Uniformity of p-values ───────────────────────────────────────────────────

/**
 * Second-order check recommended by NIST SP 800-22 §4.2.2: across many
 * independent runs the p-values themselves must be uniform on [0, 1]. A
 * generator can clear every individual threshold while its p-values pile up at
 * one end, which means the deviations are systematic rather than random.
 *
 * Returns the p-value of a chi-square goodness-of-fit test over `bins` equal
 * intervals — so the result is itself interpreted the same way as any other.
 */
export function pValueUniformity(pValues: readonly number[], bins = 10): number {
  if (pValues.length === 0) throw new RangeError('pValueUniformity: no p-values given')
  const counts = new Array(bins).fill(0)
  for (const p of pValues) {
    const index = Math.min(bins - 1, Math.max(0, Math.floor(p * bins)))
    counts[index]++
  }
  const expected = pValues.length / bins
  const statistic = counts.reduce((acc, observed) => acc + (observed - expected) ** 2 / expected, 0)
  return chiSquarePValue(statistic, bins - 1)
}
