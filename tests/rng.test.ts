import { describe, it, expect } from 'vitest'
import { createRng, nextInt, pick, shuffle } from '../src/runtime/rng'

// ─── createRng ────────────────────────────────────────────────────────────────

describe('createRng — determinism', () => {
  it('одинаковый seed даёт одинаковую первую последовательность', () => {
    const a = createRng(42)
    const b = createRng(42)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })

  it('разные seed дают разные первые значения', () => {
    expect(createRng(1)()).not.toBe(createRng(2)())
  })

  it('значения лежат в [0, 1)', () => {
    const rng = createRng(99)
    for (let i = 0; i < 1000; i++) {
      const v = rng()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('seed 0 работает без ошибок', () => {
    expect(() => createRng(0)()).not.toThrow()
  })

  it('seed MAX_SAFE_INTEGER работает', () => {
    expect(() => createRng(Number.MAX_SAFE_INTEGER)()).not.toThrow()
  })

  it('последовательность не повторяется на первых 10 значениях', () => {
    const rng = createRng(7)
    const values = Array.from({ length: 10 }, () => rng())
    const unique = new Set(values)
    expect(unique.size).toBe(10)
  })
})

// ─── nextInt ──────────────────────────────────────────────────────────────────

describe('nextInt', () => {
  it('возвращает значение в [min, max] включительно', () => {
    const rng = createRng(1)
    for (let i = 0; i < 500; i++) {
      const v = nextInt(rng, 1, 6)
      expect(v).toBeGreaterThanOrEqual(1)
      expect(v).toBeLessThanOrEqual(6)
    }
  })

  it('детерминирован с одинаковым seed', () => {
    const a = createRng(10)
    const b = createRng(10)
    expect(nextInt(a, 0, 100)).toBe(nextInt(b, 0, 100))
  })

  it('при min === max всегда возвращает min', () => {
    const rng = createRng(5)
    for (let i = 0; i < 10; i++) {
      expect(nextInt(rng, 7, 7)).toBe(7)
    }
  })
})

// ─── pick ─────────────────────────────────────────────────────────────────────

describe('pick', () => {
  it('возвращает элемент из массива', () => {
    const rng = createRng(1)
    const items = ['a', 'b', 'c']
    const result = pick(rng, items)
    expect(items).toContain(result)
  })

  it('детерминирован: одинаковый seed → один и тот же элемент', () => {
    const items = ['x', 'y', 'z']
    expect(pick(createRng(42), items)).toBe(pick(createRng(42), items))
  })

  it('все элементы достижимы при разных seed', () => {
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
  it('не мутирует оригинальный массив', () => {
    const original = [1, 2, 3, 4]
    const rng = createRng(1)
    shuffle(rng, original)
    expect(original).toEqual([1, 2, 3, 4])
  })

  it('сохраняет все элементы', () => {
    const rng = createRng(1)
    const result = shuffle(rng, [1, 2, 3, 4, 5])
    expect(result.sort()).toEqual([1, 2, 3, 4, 5])
  })

  it('детерминирован: одинаковый seed → одинаковый порядок', () => {
    const items = [1, 2, 3, 4, 5]
    const a = shuffle(createRng(77), items)
    const b = shuffle(createRng(77), items)
    expect(a).toEqual(b)
  })

  it('разные seed дают разный порядок', () => {
    const items = [1, 2, 3, 4, 5, 6, 7]
    const a = shuffle(createRng(1), items)
    const b = shuffle(createRng(2), items)
    expect(a).not.toEqual(b)
  })
})
