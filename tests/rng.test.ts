import { describe, it, expect } from 'vitest'
import { createRng, nextInt, pick, shuffle } from '../src/runtime/rng'

// ─── createRng ────────────────────────────────────────────────────────────────

describe('createRng — determinism', () => {
  it('the same seed produces the same opening sequence', () => {
    const a = createRng(42)
    const b = createRng(42)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })

  it('different seeds give different first values', () => {
    expect(createRng(1)()).not.toBe(createRng(2)())
  })

  it('values lie in [0, 1)', () => {
    const rng = createRng(99)
    for (let i = 0; i < 1000; i++) {
      const v = rng()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('seed 0 works without errors', () => {
    expect(() => createRng(0)()).not.toThrow()
  })

  it('seed MAX_SAFE_INTEGER works', () => {
    expect(() => createRng(Number.MAX_SAFE_INTEGER)()).not.toThrow()
  })

  it('the sequence does not repeat within the first 10 values', () => {
    const rng = createRng(7)
    const values = Array.from({ length: 10 }, () => rng())
    const unique = new Set(values)
    expect(unique.size).toBe(10)
  })
})

// ─── nextInt ──────────────────────────────────────────────────────────────────

describe('nextInt', () => {
  it('returns a value in [min, max] inclusive', () => {
    const rng = createRng(1)
    for (let i = 0; i < 500; i++) {
      const v = nextInt(rng, 1, 6)
      expect(v).toBeGreaterThanOrEqual(1)
      expect(v).toBeLessThanOrEqual(6)
    }
  })

  it('is deterministic for the same seed', () => {
    const a = createRng(10)
    const b = createRng(10)
    expect(nextInt(a, 0, 100)).toBe(nextInt(b, 0, 100))
  })

  it('returns min whenever min === max', () => {
    const rng = createRng(5)
    for (let i = 0; i < 10; i++) {
      expect(nextInt(rng, 7, 7)).toBe(7)
    }
  })
})

// ─── pick ─────────────────────────────────────────────────────────────────────

describe('pick', () => {
  it('returns an element from the array', () => {
    const rng = createRng(1)
    const items = ['a', 'b', 'c']
    const result = pick(rng, items)
    expect(items).toContain(result)
  })

  it('is deterministic: the same seed → the same element', () => {
    const items = ['x', 'y', 'z']
    expect(pick(createRng(42), items)).toBe(pick(createRng(42), items))
  })

  it('every element is reachable across different seeds', () => {
    const items = [1, 2, 3, 4, 5]
    const seen = new Set<number>()
    for (let seed = 0; seed < 100; seed++) {
      seen.add(pick(createRng(seed), items))
    }
    expect(seen.size).toBe(5)
  })
})

// ─── shuffle ──────────────────────────────────────────────────────────────────

describe('shuffle', () => {
  it('does not mutate the original array', () => {
    const original = [1, 2, 3, 4]
    const rng = createRng(1)
    shuffle(rng, original)
    expect(original).toEqual([1, 2, 3, 4])
  })

  it('preserves every element', () => {
    const rng = createRng(1)
    const result = shuffle(rng, [1, 2, 3, 4, 5])
    expect(result.sort()).toEqual([1, 2, 3, 4, 5])
  })

  it('is deterministic: the same seed → the same order', () => {
    const items = [1, 2, 3, 4, 5]
    const a = shuffle(createRng(77), items)
    const b = shuffle(createRng(77), items)
    expect(a).toEqual(b)
  })

  it('different seeds give a different order', () => {
    const items = [1, 2, 3, 4, 5, 6, 7]
    const a = shuffle(createRng(1), items)
    const b = shuffle(createRng(2), items)
    expect(a).not.toEqual(b)
  })
})
