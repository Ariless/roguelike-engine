import { describe, it, expect } from 'vitest'
import { createRng, nextInt, pick, shuffle } from '../src/runtime/rng'

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
// On flakiness: a statistical test on random seeds fails once every N runs by
// construction. That is fine in a lab and unacceptable in CI. Every seed here is
// fixed, so each metric is reproducible to the last digit. The test is either
// always green or always red. Red means somebody changed the generator, not
// that today was unlucky.

// ─── Statistical apparatus ────────────────────────────────────────────────────

function chiSquare(observed: number[], expected: number): number {
  return observed.reduce((acc, o) => acc + (o - expected) ** 2 / expected, 0)
}

// Critical χ² values at α = 0.001. The threshold is deliberately strict: the
// seeds are fixed, so the margin is there to absorb small distribution shifts,
// not bad luck.
const CHI2_CRITICAL: Record<number, number> = {
  4:  18.467,
  5:  20.515,
  9:  27.877,
  23: 49.728,
  99: 148.230,
}

// Two-sided normal threshold at α = 0.001
const Z_CRITICAL = 3.291

function meanOf(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

// ─── Uniformity of a single stream ────────────────────────────────────────────

describe('createRng distribution', () => {
  it('values are uniform across 100 bins on four independent seeds', () => {
    const N = 200_000
    const BINS = 100

    for (const seed of [1, 12345, 99999, 2 ** 31 - 1]) {
      const bins = new Array(BINS).fill(0)
      const rng = createRng(seed)
      for (let i = 0; i < N; i++) bins[Math.floor(rng() * BINS)]++

      expect(chiSquare(bins, N / BINS)).toBeLessThan(CHI2_CRITICAL[99])
    }
  })

  it('pairs of consecutive values are uniform across a 10×10 lattice', () => {
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

    expect(chiSquare(cells, N / (SIDE * SIDE))).toBeLessThan(CHI2_CRITICAL[99])
  })

  it('the high bit comes up half the time (monobit)', () => {
    const N = 500_000
    const rng = createRng(31337)
    let ones = 0
    for (let i = 0; i < N; i++) if (rng() >= 0.5) ones++

    // The proportion ~ N(0.5, 1/(4N)) → z = (2·ones − N) / √N
    const z = (2 * ones - N) / Math.sqrt(N)
    expect(Math.abs(z)).toBeLessThan(Z_CRITICAL)
  })

  it('runs above and below the median have the expected length (runs test)', () => {
    // A generator can produce a perfectly uniform histogram and still walk in
    // long streaks of "all above the median / all below it". The histogram
    // would miss that entirely.
    const N = 200_000
    const rng = createRng(4242)

    const bits: boolean[] = new Array(N)
    let ones = 0
    for (let i = 0; i < N; i++) {
      const above = rng() >= 0.5
      bits[i] = above
      if (above) ones++
    }
    const zeros = N - ones

    let runs = 1
    for (let i = 1; i < N; i++) if (bits[i] !== bits[i - 1]) runs++

    const expectedRuns = (2 * ones * zeros) / N + 1
    const varianceRuns =
      (2 * ones * zeros * (2 * ones * zeros - N)) / (N * N * (N - 1))
    const z = (runs - expectedRuns) / Math.sqrt(varianceRuns)

    expect(Math.abs(z)).toBeLessThan(Z_CRITICAL)
  })

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

    // Under independence r ≈ N(0, 1/N)
    expect(Math.abs(r) * Math.sqrt(N)).toBeLessThan(Z_CRITICAL)
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

    expect(chiSquare(bins, N / 6)).toBeLessThan(CHI2_CRITICAL[5])
  })

  it('a range that is not a power of two is unbiased', () => {
    // 1..10 — 10 does not divide 2³², which is exactly the case where reducing
    // an integer generator to a range usually drifts.
    const N = 500_000
    const bins = new Array(10).fill(0)
    const rng = createRng(555)
    for (let i = 0; i < N; i++) bins[nextInt(rng, 1, 10) - 1]++

    expect(chiSquare(bins, N / 10)).toBeLessThan(CHI2_CRITICAL[9])
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

    expect(chiSquare(Object.values(counts), N / items.length))
      .toBeLessThan(CHI2_CRITICAL[4])
  })
})

describe('shuffle distribution', () => {
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
    expect(chiSquare([...permutations.values()], N / 24))
      .toBeLessThan(CHI2_CRITICAL[23])
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
      expect(chiSquare(row, N / SIZE)).toBeLessThan(CHI2_CRITICAL[4])
    }
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
    // mulberry32 advances its state by adding the constant 0x6D2B79F5. So the
    // seed does not choose a stream, it chooses an entry point into one shared
    // stream of length 2³². Two seeds differing by exactly that constant give
    // the same sequence, offset by a single step.
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
