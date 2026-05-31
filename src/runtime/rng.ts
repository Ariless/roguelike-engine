// Mulberry32 — fast, seedable 32-bit PRNG.
// Engine never calls this directly — runtime passes values as arguments.

export type Rng = () => number  // returns float in [0, 1)

export function createRng(seed: number): Rng {
  let s = seed >>> 0  // coerce to uint32
  return function () {
    s += 0x6D2B79F5
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Returns integer in [min, max] inclusive.
export function nextInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1))
}

// Returns a random element from a non-empty array.
export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]
}

// Returns a shuffled copy — does not mutate the original.
export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}
