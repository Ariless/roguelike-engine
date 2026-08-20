import { describe, it, expect } from 'vitest'
import { createRng, nextInt, pick, shuffle } from '../src/runtime/rng'
import {
  chiSquarePValue,
  normalTwoSidedPValue,
  normalCdf,
  pValueUniformity,
} from '../src/stats/distributions'

// ─── Why this file exists ─────────────────────────────────────────────────────
//
// rng.test.ts checks the generator's CONTRACT: same seed → same sequence,
// values within bounds, shuffle does not mutate its input. All of those are
// properties of an individual call.
//
// This file checks the DISTRIBUTION. A generator that passes every test in
// rng.test.ts can still roll a 1 twice as often as a 6. The contract holds, the
// balance drifts, and not one existing test would see it.
//
// ─── Why p-values rather than critical values ─────────────────────────────────
//
// An earlier version of this file compared each statistic against a critical
// value from a table and asserted "below the line". That answers one question —
// did it cross — and throws away everything else. A p-value answers how unlikely
// a deviation at least this large would be if the generator were sound, and it
// is the number RNG certification batteries report, because it can be compared
// across runs and, crucially, tested for uniformity in its own right (see the
// final block).
//
// The arithmetic behind these p-values lives in src/stats/distributions.ts and
// is verified against published table values in tests/stats/distributions.test.ts.
// If that arithmetic were wrong, this file would still print confident numbers
// and still pass — which is why it is checked separately.
//
// ─── Correspondence with published batteries ──────────────────────────────────
//
// The tests below are not an invention of this project. Most map directly onto
// the standard batteries a certification lab runs:
//
//   This file                         | Published test
//   ----------------------------------|--------------------------------------
//   monobit                           | NIST SP 800-22 §2.1 Frequency (Monobit)
//   block frequency                   | NIST SP 800-22 §2.2 Frequency within a Block
//   runs above/below the median        | NIST SP 800-22 §2.3 Runs
//   longest run of ones in a block    | NIST SP 800-22 §2.4 Longest Run of Ones
//   cumulative sums (forward)         | NIST SP 800-22 §2.13 Cumulative Sums
//   uniformity across 100 bins        | classical χ² goodness-of-fit
//   10×10 lattice of adjacent pairs   | Diehard overlapping pairs / serial test
//   lag-1 autocorrelation             | Diehard autocorrelation
//   permutation fairness (24 perms)   | Diehard permutation test (order 4)
//   uniformity of the p-values        | NIST SP 800-22 §4.2.2 (second-order check)
//
// Not implemented: the spectral (DFT) test, Maurer's universal test, linear
// complexity, and the template-matching family. Those need sequence lengths in
// the millions of bits per run and would turn a six-second suite into a batch
// job; for a 32-bit generator driving a game simulation they are out of scope,
// and saying so is more honest than implying full SP 800-22 coverage.
//
// ─── On flakiness ─────────────────────────────────────────────────────────────
//
// A statistical test on random seeds fails once every N runs by construction.
// That is fine in a lab and unacceptable in CI. Every seed here is fixed, so
// each p-value is reproducible to the last digit. The test is either always
// green or always red. Red means somebody changed the generator, not that today
// was unlucky.

// Significance level. Deliberately strict: with fixed seeds the margin is there
// to absorb small distribution shifts, not bad luck.
const ALPHA = 0.001

/** Draws `n` bits from a seeded stream, taking the high bit of each value. */
function bits(seed: number, n: number): Uint8Array {
  const rng = createRng(seed)
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) out[i] = rng() >= 0.5 ? 1 : 0
  return out
}

function chiSquare(observed: readonly number[], expected: number): number {
  return observed.reduce((acc, o) => acc + (o - expected) ** 2 / expected, 0)
}

function meanOf(xs: readonly number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

// ─── NIST §2.1 — Frequency (Monobit) ──────────────────────────────────────────

describe('NIST §2.1 Frequency (Monobit)', () => {
  it('ones and zeros are balanced', () => {
    const N = 500_000
    const b = bits(31337, N)
    let ones = 0
    for (const bit of b) ones += bit

    // S_n / √n is asymptotically standard normal
    const z = (2 * ones - N) / Math.sqrt(N)
    expect(normalTwoSidedPValue(z)).toBeGreaterThan(ALPHA)
  })
})

// ─── NIST §2.2 — Frequency within a Block ─────────────────────────────────────

describe('NIST §2.2 Frequency within a Block', () => {
  it('the balance holds inside blocks, not only overall', () => {
    // A stream that is half ones overall can still be all ones in its first
    // half and all zeros in its second. Monobit passes that; this does not.
    const M = 1000
    const N = 500
    const b = bits(24680, M * N)

    let statistic = 0
    for (let i = 0; i < N; i++) {
      let ones = 0
      for (let j = 0; j < M; j++) ones += b[i * M + j]
      const pi = ones / M
      statistic += (pi - 0.5) ** 2
    }
    statistic *= 4 * M

    expect(chiSquarePValue(statistic, N)).toBeGreaterThan(ALPHA)
  })
})

// ─── NIST §2.3 — Runs ─────────────────────────────────────────────────────────

describe('NIST §2.3 Runs', () => {
  it('runs above and below the median have the expected length', () => {
    // A generator can produce a perfectly uniform histogram and still walk in
    // long streaks of "all above the median / all below it". The histogram
    // would miss that entirely.
    const N = 200_000
    const b = bits(4242, N)

    let ones = 0
    for (const bit of b) ones += bit
    const zeros = N - ones

    let runs = 1
    for (let i = 1; i < N; i++) if (b[i] !== b[i - 1]) runs++

    const expectedRuns = (2 * ones * zeros) / N + 1
    const varianceRuns = (2 * ones * zeros * (2 * ones * zeros - N)) / (N * N * (N - 1))
    const z = (runs - expectedRuns) / Math.sqrt(varianceRuns)

    expect(normalTwoSidedPValue(z)).toBeGreaterThan(ALPHA)
  })
})

// ─── NIST §2.4 — Longest Run of Ones in a Block ───────────────────────────────

describe('NIST §2.4 Longest Run of Ones in a Block', () => {
  it('the longest streak per block follows the expected distribution', () => {
    // Catches a generator that is balanced and has the right number of runs but
    // gets the tail wrong — streaks that are systematically too long or too
    // short. Configuration and probabilities are the ones tabulated by NIST for
    // M = 128: categories are longest run <=4, 5, 6, 7, 8, >=9.
    const M = 128
    const N = 49
    const PROBABILITIES = [0.1174, 0.2430, 0.2493, 0.1752, 0.1027, 0.1124]
    const b = bits(13579, M * N)

    const counts = new Array(PROBABILITIES.length).fill(0)
    for (let i = 0; i < N; i++) {
      let longest = 0
      let current = 0
      for (let j = 0; j < M; j++) {
        if (b[i * M + j] === 1) {
          current++
          if (current > longest) longest = current
        } else {
          current = 0
        }
      }
      const category = Math.min(Math.max(longest, 4), 9) - 4
      counts[category]++
    }

    const statistic = counts.reduce((acc, observed, index) => {
      const expected = N * PROBABILITIES[index]
      return acc + (observed - expected) ** 2 / expected
    }, 0)

    // K = 5 degrees of freedom for six categories
    expect(chiSquarePValue(statistic, PROBABILITIES.length - 1)).toBeGreaterThan(ALPHA)
  })
})

// ─── NIST §2.13 — Cumulative Sums ─────────────────────────────────────────────

describe('NIST §2.13 Cumulative Sums', () => {
  it('the random walk does not drift too far from the origin', () => {
    // Treats the stream as a ±1 walk. Monobit only looks at where the walk ends;
    // this looks at how far it wandered on the way, which catches a drift that
    // cancels out by the end.
    const N = 20_000
    const b = bits(97531, N)

    let sum = 0
    let z = 0
    for (const bit of b) {
      sum += bit === 1 ? 1 : -1
      if (Math.abs(sum) > z) z = Math.abs(sum)
    }

    const sqrtN = Math.sqrt(N)
    let pValue = 1

    const upper = Math.floor((N / z - 1) / 4)
    for (let k = Math.floor((-N / z + 1) / 4); k <= upper; k++) {
      pValue -= normalCdf(((4 * k + 1) * z) / sqrtN) - normalCdf(((4 * k - 1) * z) / sqrtN)
    }
    for (let k = Math.floor((-N / z - 3) / 4); k <= upper; k++) {
      pValue += normalCdf(((4 * k + 3) * z) / sqrtN) - normalCdf(((4 * k + 1) * z) / sqrtN)
    }

    expect(pValue).toBeGreaterThan(ALPHA)
    expect(pValue).toBeLessThanOrEqual(1)
  })
})

// ─── Classical χ² goodness-of-fit ─────────────────────────────────────────────

describe('uniformity of the value stream', () => {
  it('values are uniform across 100 bins on four independent seeds', () => {
    const N = 200_000
    const BINS = 100

    for (const seed of [1, 12345, 99999, 2 ** 31 - 1]) {
      const bins = new Array(BINS).fill(0)
      const rng = createRng(seed)
      for (let i = 0; i < N; i++) bins[Math.floor(rng() * BINS)]++

      const p = chiSquarePValue(chiSquare(bins, N / BINS), BINS - 1)
      expect(p, `seed ${seed}`).toBeGreaterThan(ALPHA)
    }
  })
})

// ─── Diehard overlapping pairs / serial ───────────────────────────────────────

describe('Diehard serial — adjacent pairs', () => {
  it('pairs of consecutive values fill the 10×10 lattice', () => {
    // Catches lattice structure: with weak generators the points (x_i, x_i+1)
    // land on a small number of hyperplanes instead of filling the square.
    const N = 200_000
    const SIDE = 10
    const cells = new Array(SIDE * SIDE).fill(0)
    const rng = createRng(777)

    for (let i = 0; i < N; i++) {
      const x = Math.floor(rng() * SIDE)
      const y = Math.floor(rng() * SIDE)
      cells[x * SIDE + y]++
    }

    const p = chiSquarePValue(chiSquare(cells, N / (SIDE * SIDE)), SIDE * SIDE - 1)
    expect(p).toBeGreaterThan(ALPHA)
  })
})

// ─── Diehard autocorrelation ──────────────────────────────────────────────────

describe('Diehard autocorrelation', () => {
  it('consecutive values are uncorrelated (lag-1)', () => {
    const N = 500_000
    const rng = createRng(999)

    let sx = 0, sy = 0, sxy = 0, sxx = 0, syy = 0
    let prev = rng()
    for (let i = 0; i < N; i++) {
      const cur = rng()
      sx += prev; sy += cur; sxy += prev * cur
      sxx += prev * prev; syy += cur * cur
      prev = cur
    }

    const r =
      (N * sxy - sx * sy) /
      Math.sqrt((N * sxx - sx * sx) * (N * syy - sy * sy))

    // Under independence r ≈ N(0, 1/N), so r·√N is standard normal
    expect(normalTwoSidedPValue(r * Math.sqrt(N))).toBeGreaterThan(ALPHA)
  })
})

// ─── Uniformity of the derived functions ──────────────────────────────────────
// The generator can be flawless while the wrapper around it is biased. The
// classic case: reducing to an integer via a modulo gives extra weight to the
// lower values.

describe('nextInt distribution', () => {
  it('a six-sided die is unbiased', () => {
    const N = 600_000
    const bins = new Array(6).fill(0)
    const rng = createRng(2024)
    for (let i = 0; i < N; i++) bins[nextInt(rng, 1, 6) - 1]++

    expect(chiSquarePValue(chiSquare(bins, N / 6), 5)).toBeGreaterThan(ALPHA)
  })

  it('a range that is not a power of two is unbiased', () => {
    // 1..10 — 10 does not divide 2³², which is exactly the case where reducing
    // an integer generator to a range usually drifts.
    const N = 500_000
    const bins = new Array(10).fill(0)
    const rng = createRng(555)
    for (let i = 0; i < N; i++) bins[nextInt(rng, 1, 10) - 1]++

    expect(chiSquarePValue(chiSquare(bins, N / 10), 9)).toBeGreaterThan(ALPHA)
  })

  it('the mean over a range converges to the midpoint', () => {
    const N = 200_000
    const rng = createRng(8080)
    const values: number[] = new Array(N)
    for (let i = 0; i < N; i++) values[i] = nextInt(rng, 0, 100)

    expect(meanOf(values)).toBeCloseTo(50, 1)
  })
})

describe('pick distribution', () => {
  it('every element is chosen equally often', () => {
    const N = 500_000
    const items = ['a', 'b', 'c', 'd', 'e']
    const counts: Record<string, number> = { a: 0, b: 0, c: 0, d: 0, e: 0 }
    const rng = createRng(60606)
    for (let i = 0; i < N; i++) counts[pick(rng, items)]++

    expect(chiSquarePValue(chiSquare(Object.values(counts), N / items.length), 4))
      .toBeGreaterThan(ALPHA)
  })
})

// ─── Diehard permutation test ─────────────────────────────────────────────────

describe('Diehard permutation — shuffle fairness', () => {
  it('all 24 permutations of four elements are equally likely', () => {
    // A correctness test for Fisher-Yates. The naive implementation (a random
    // index across the whole length instead of the remaining tail) still
    // produces every permutation, but with different probabilities — visible
    // only in a histogram like this one.
    const N = 240_000
    const permutations = new Map<string, number>()
    const rng = createRng(1234)

    for (let i = 0; i < N; i++) {
      const key = shuffle(rng, [0, 1, 2, 3]).join('')
      permutations.set(key, (permutations.get(key) ?? 0) + 1)
    }

    expect(permutations.size).toBe(24)
    expect(chiSquarePValue(chiSquare([...permutations.values()], N / 24), 23))
      .toBeGreaterThan(ALPHA)
  })

  it('every element lands in every position equally often', () => {
    const N = 200_000
    const SIZE = 5
    const positions = Array.from({ length: SIZE }, () => new Array(SIZE).fill(0))
    const rng = createRng(4321)

    for (let i = 0; i < N; i++) {
      const result = shuffle(rng, [0, 1, 2, 3, 4])
      for (let pos = 0; pos < SIZE; pos++) positions[result[pos]][pos]++
    }

    for (const row of positions) {
      expect(chiSquarePValue(chiSquare(row, N / SIZE), SIZE - 1)).toBeGreaterThan(ALPHA)
    }
  })
})

// ─── NIST §4.2.2 — uniformity of the p-values ─────────────────────────────────

describe('NIST §4.2.2 second-order check', () => {
  it('p-values across many seeds are themselves uniform', () => {
    // The check every individual test above cannot perform on itself. A
    // generator can clear the threshold on all 300 seeds while its p-values pile
    // up at one end of [0, 1] — which means the deviations are systematic, not
    // random, and the battery has been reporting "pass" to a biased stream.
    const SEEDS = 300
    const N = 20_000

    const pValues: number[] = []
    for (let seed = 1; seed <= SEEDS; seed++) {
      const b = bits(seed * 7919, N)
      let ones = 0
      for (const bit of b) ones += bit
      pValues.push(normalTwoSidedPValue((2 * ones - N) / Math.sqrt(N)))
    }

    // Every individual run has to pass first — otherwise this is a different failure
    expect(Math.min(...pValues)).toBeGreaterThan(1e-6)

    expect(pValueUniformity(pValues)).toBeGreaterThan(ALPHA)
  })
})

// ─── Proof that the battery can go red ────────────────────────────────────────
//
// Every test above passes. On its own that says nothing: a test whose assertion
// is too loose passes too, and BUG-16 in this very project is exactly that — a
// UI test named "skeleton appears" that asserted "at least two panels" and could
// never fail. A statistical battery is especially exposed to it, because the
// arithmetic is elaborate enough that nobody re-derives it by hand.
//
// So the generator is deliberately corrupted here and the same statistics are
// recomputed. Two things have to hold: the corrupted stream must be rejected,
// and it must be rejected by the right test. A battery where every test fires at
// every defect is not a battery, it is one test written five times.

describe('fault injection on the battery itself', () => {
  /** Recomputes the three bit-level statistics over an arbitrary bit source. */
  function statisticsOver(nextBit: (r: () => number) => boolean, seed = 31337, N = 200_000) {
    const rng = createRng(seed)
    const b = new Uint8Array(N)
    for (let i = 0; i < N; i++) b[i] = nextBit(rng) ? 1 : 0

    let ones = 0
    for (const bit of b) ones += bit
    const zeros = N - ones
    const monobit = normalTwoSidedPValue((2 * ones - N) / Math.sqrt(N))

    let runs = 1
    for (let i = 1; i < N; i++) if (b[i] !== b[i - 1]) runs++
    const expectedRuns = (2 * ones * zeros) / N + 1
    const varianceRuns = (2 * ones * zeros * (2 * ones * zeros - N)) / (N * N * (N - 1))
    const runsP = normalTwoSidedPValue((runs - expectedRuns) / Math.sqrt(varianceRuns))

    const M = 1000
    const blocks = N / M
    let statistic = 0
    for (let i = 0; i < blocks; i++) {
      let o = 0
      for (let j = 0; j < M; j++) o += b[i * M + j]
      statistic += (o / M - 0.5) ** 2
    }
    const blockP = chiSquarePValue(statistic * 4 * M, blocks)

    return { monobit, runsP, blockP }
  }

  it('the real generator passes all three', () => {
    const { monobit, runsP, blockP } = statisticsOver(r => r() >= 0.5)
    expect(monobit).toBeGreaterThan(ALPHA)
    expect(runsP).toBeGreaterThan(ALPHA)
    expect(blockP).toBeGreaterThan(ALPHA)
  })

  it('a 51/49 bias is caught by monobit and block frequency, not by runs', () => {
    // Two percentage points of skew. Invisible to the eye in any sample, and
    // invisible to the runs test by construction: the alternation rate is
    // untouched. In a payout table this is the difference between a house edge
    // that was signed off and one that was not.
    const { monobit, runsP, blockP } = statisticsOver(r => r() >= 0.49)
    expect(monobit).toBeLessThan(ALPHA)
    expect(blockP).toBeLessThan(ALPHA)
    expect(runsP).toBeGreaterThan(ALPHA) // runs is blind to balance — as it should be
  })

  it('a stream that repeats each bit is caught by runs, and barely dents monobit', () => {
    // The mirror image: ones and zeros stay balanced, so monobit sees nothing
    // wrong, while the sequence has a third of the alternations it should.
    let last = false
    let index = 0
    const sticky = (r: () => number) => {
      if (index++ % 3 === 0) last = r() >= 0.5
      return last
    }
    const { monobit, runsP } = statisticsOver(sticky)
    expect(runsP).toBeLessThan(ALPHA)
    expect(monobit).toBeGreaterThan(ALPHA) // balance intact, structure broken
  })
})

// ─── Seed space: where the generator stops keeping its promise ────────────────
//
// Everything above is about the quality of one stream. What follows is about
// there being fewer streams than it looks. For a simulation that matters more
// than uniformity: two runs believed to be independent may turn out to be the
// same run.

describe('seed space', () => {
  it('the seed is truncated to 32 bits: seed and seed + 2³² give one stream', () => {
    // rng.ts:7 — `let s = seed >>> 0`. Anything above 2³² is silently lost.
    // rng.test.ts:30 checks that createRng(MAX_SAFE_INTEGER) does not throw,
    // and it passes, because truncation does not throw. The test is green while
    // the seed is not the one that was passed in.
    const a = createRng(7)
    const b = createRng(7 + 2 ** 32)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])

    // Number.MAX_SAFE_INTEGER collapses into 2³² − 1
    expect(createRng(Number.MAX_SAFE_INTEGER)()).toBe(createRng(4294967295)())
  })

  it('there are exactly 2³² distinguishable seeds, and that caps independent runs', () => {
    // A direct consequence of the truncation: however many runs are requested,
    // from 2³² onwards they start repeating runs already counted.
    const DISTINCT_SEEDS = 2 ** 32

    expect(createRng(0)()).toBe(createRng(DISTINCT_SEEDS)())
    expect(createRng(1)()).toBe(createRng(DISTINCT_SEEDS + 1)())
  })

  it('adjacent seeds give non-overlapping streams', () => {
    // The working case: simulate.ts takes seed = run number. This checks that
    // the streams really do diverge across the range actually in use.
    for (let seed = 0; seed < 200; seed++) {
      const a = createRng(seed)
      const b = createRng(seed + 1)
      const headA = [a(), a(), a(), a(), a()]
      const headB = [b(), b(), b(), b(), b()]
      expect(headA).not.toEqual(headB)
      expect(headA.slice(1)).not.toEqual(headB.slice(0, 4))
    }
  })

  it.fails('different seeds give independent streams', () => {
    // A false invariant — it documents how the generator is actually built.
    //
    // mulberry32 advances its state by adding the constant 0x6D2B79F5, so a
    // seed chooses an entry point into one shared stream of length 2³². Two
    // seeds differing by exactly that constant give the same sequence, offset
    // by a single step.
    //
    // For simulate.ts with seeds 0…N this is safe: the distance between
    // adjacent entry points is enormous. The danger appears the moment seeds
    // start coming from a clock, a hash, or a counter with a stride — then two
    // "independent" runs can turn out to be one, and the statistics over them
    // will count a single result twice.
    const DELTA = 0x6D2B79F5
    const a = createRng(1)
    const b = createRng((1 + DELTA) >>> 0)

    const headA = [a(), a(), a(), a(), a()]
    const headB = [b(), b(), b(), b(), b()]

    // The assertion is deliberately false: headB is headA shifted by one step
    expect(headA.slice(1)).not.toEqual(headB.slice(0, 4))
  })
})
