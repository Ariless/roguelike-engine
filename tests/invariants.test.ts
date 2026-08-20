import { describe, it, expect } from 'vitest'
import { assertValidGameState, TimelineCorruptedError } from '../src/engine/invariants'
import type { GameState } from '../src/engine/types'

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    seed: 1,
    turn: 1,
    isOver: false,
    hero: {
      id: 'hero',
      name: 'Paladin',
      hp: 50,
      maxHp: 50,
      state: 'alive',
      statuses: [],
      row: 'front',
      heroClass: 'paladin',
      formState: 'human',
      hand: [],
      energy: 3,
    },
    enemies: [],
    ...overrides,
  }
}

function makeEnemy(id: string, overrides: Partial<GameState['enemies'][0]> = {}): GameState['enemies'][0] {
  return {
    id,
    name: 'Goblin',
    hp: 20,
    maxHp: 20,
    state: 'alive',
    statuses: [],
    row: 'front',
    enemyType: 'goblin',
    intent: { type: 'attack', value: 6 },
    ...overrides,
  }
}

// ─── Valid state ─────────────────────────────────────────────────────────────

describe('assertValidGameState — a valid state', () => {
  it('does not throw on a valid state', () => {
    expect(() => assertValidGameState(makeState())).not.toThrow()
  })

  it('returns an empty softViolations list on a valid state', () => {
    const { softViolations } = assertValidGameState(makeState())
    expect(softViolations).toHaveLength(0)
  })
})

// ─── hp-floor ─────────────────────────────────────────────────────────────────

describe('hp-floor — hp >= 0', () => {
  it('hero HP < 0 → TimelineCorruptedError', () => {
    const state = makeState({ hero: { ...makeState().hero, hp: -1 } })
    expect(() => assertValidGameState(state)).toThrow(TimelineCorruptedError)
  })

  it('enemy HP < 0 → TimelineCorruptedError', () => {
    const state = makeState({ enemies: [makeEnemy('g1', { hp: -5 })] })
    expect(() => assertValidGameState(state)).toThrow(TimelineCorruptedError)
  })

  it('HP = 0 does not violate hp-floor', () => {
    const state = makeState({ hero: { ...makeState().hero, hp: 0, state: 'death_door' } })
    expect(() => assertValidGameState(state)).not.toThrow()
  })
})

// ─── hp-ceiling ───────────────────────────────────────────────────────────────

describe('hp-ceiling — hp <= maxHp', () => {
  it('hero HP > maxHp → TimelineCorruptedError', () => {
    const state = makeState({ hero: { ...makeState().hero, hp: 51, maxHp: 50 } })
    expect(() => assertValidGameState(state)).toThrow(TimelineCorruptedError)
  })

  it('enemy HP > maxHp → TimelineCorruptedError', () => {
    const state = makeState({ enemies: [makeEnemy('g1', { hp: 25, maxHp: 20 })] })
    expect(() => assertValidGameState(state)).toThrow(TimelineCorruptedError)
  })

  it('HP = maxHp does not violate hp-ceiling', () => {
    expect(() => assertValidGameState(makeState())).not.toThrow()
  })
})

// ─── bleed-cap ────────────────────────────────────────────────────────────────

describe('bleed-cap — bleed stacks <= 10', () => {
  it('bleed stacks > 10 on the hero → TimelineCorruptedError', () => {
    const state = makeState({
      hero: { ...makeState().hero, statuses: [{ name: 'bleed', stacks: 11 }] },
    })
    expect(() => assertValidGameState(state)).toThrow(TimelineCorruptedError)
  })

  it('bleed stacks > 10 on an enemy → TimelineCorruptedError', () => {
    const state = makeState({
      enemies: [makeEnemy('g1', { statuses: [{ name: 'bleed', stacks: 15 }] })],
    })
    expect(() => assertValidGameState(state)).toThrow(TimelineCorruptedError)
  })

  it('bleed stacks = 10 does not violate bleed-cap', () => {
    const state = makeState({
      hero: { ...makeState().hero, statuses: [{ name: 'bleed', stacks: 10 }] },
    })
    expect(() => assertValidGameState(state)).not.toThrow()
  })
})

// ─── charge-cap ───────────────────────────────────────────────────────────────

describe('charge-cap — chargeStacks <= 3', () => {
  it('chargeStacks = 4 → TimelineCorruptedError', () => {
    const state = makeState({ hero: { ...makeState().hero, chargeStacks: 4 } })
    expect(() => assertValidGameState(state)).toThrow(TimelineCorruptedError)
  })

  it('chargeStacks = 3 does not violate charge-cap', () => {
    const state = makeState({ hero: { ...makeState().hero, chargeStacks: 3 } })
    expect(() => assertValidGameState(state)).not.toThrow()
  })

  it('chargeStacks = undefined does not violate charge-cap', () => {
    expect(() => assertValidGameState(makeState())).not.toThrow()
  })
})

// ─── death-door-hp ────────────────────────────────────────────────────────────

describe('death-door-hp — death_door and dead have hp = 0', () => {
  it('death_door with hp > 0 → TimelineCorruptedError', () => {
    const state = makeState({ hero: { ...makeState().hero, hp: 1, state: 'death_door' } })
    expect(() => assertValidGameState(state)).toThrow(TimelineCorruptedError)
  })

  it('dead with hp > 0 → TimelineCorruptedError', () => {
    const state = makeState({ enemies: [makeEnemy('g1', { hp: 5, state: 'dead' })] })
    expect(() => assertValidGameState(state)).toThrow(TimelineCorruptedError)
  })

  it('death_door with hp = 0 does not violate the invariant', () => {
    const state = makeState({ hero: { ...makeState().hero, hp: 0, state: 'death_door' } })
    expect(() => assertValidGameState(state)).not.toThrow()
  })
})

// ─── alive-hp ─────────────────────────────────────────────────────────────────

describe('alive-hp — an alive entity has hp > 0', () => {
  it('alive with hp = 0 → TimelineCorruptedError', () => {
    const state = makeState({ hero: { ...makeState().hero, hp: 0, state: 'alive' } })
    expect(() => assertValidGameState(state)).toThrow(TimelineCorruptedError)
  })

  it('an alive enemy with hp = 0 → TimelineCorruptedError', () => {
    const state = makeState({ enemies: [makeEnemy('g1', { hp: 0, state: 'alive' })] })
    expect(() => assertValidGameState(state)).toThrow(TimelineCorruptedError)
  })

  it('alive with hp = 1 does not violate the invariant', () => {
    const state = makeState({ hero: { ...makeState().hero, hp: 1 } })
    expect(() => assertValidGameState(state)).not.toThrow()
  })
})

// ─── TimelineCorruptedError ───────────────────────────────────────────────────

describe('TimelineCorruptedError', () => {
  it('the message contains TIMELINE CORRUPTED', () => {
    const state = makeState({ hero: { ...makeState().hero, hp: -1 } })
    try {
      assertValidGameState(state)
    } catch (e) {
      expect((e as Error).message).toContain('TIMELINE CORRUPTED')
    }
  })

  it('the message contains the invariant id', () => {
    const state = makeState({ hero: { ...makeState().hero, hp: -1 } })
    try {
      assertValidGameState(state)
    } catch (e) {
      expect((e as TimelineCorruptedError).invariantId).toBe('hp-floor')
    }
  })

  it('the message contains the seed and the turn', () => {
    const state = makeState({ seed: 882911, turn: 17, hero: { ...makeState().hero, hp: 55, maxHp: 50 } })
    try {
      assertValidGameState(state)
    } catch (e) {
      expect((e as Error).message).toContain('882911')
      expect((e as Error).message).toContain('17')
    }
  })
})

// ─── Soft invariants ──────────────────────────────────────────────────────────

describe('soft invariants — do not throw, they return violations', () => {
  it('turn > 50 returns a softViolation instead of throwing', () => {
    const state = makeState({ turn: 51 })
    expect(() => assertValidGameState(state)).not.toThrow()
    const { softViolations } = assertValidGameState(state)
    expect(softViolations.length).toBeGreaterThan(0)
    expect(softViolations[0]).toContain('combat-terminates')
  })

  it('turn = 50 does not violate combat-terminates', () => {
    const { softViolations } = assertValidGameState(makeState({ turn: 50 }))
    expect(softViolations).toHaveLength(0)
  })
})
