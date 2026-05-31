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

// ─── Валидный стейт ───────────────────────────────────────────────────────────

describe('assertValidGameState — валидный стейт', () => {
  it('не бросает на корректном стейте', () => {
    expect(() => assertValidGameState(makeState())).not.toThrow()
  })

  it('возвращает пустой список softViolations на корректном стейте', () => {
    const { softViolations } = assertValidGameState(makeState())
    expect(softViolations).toHaveLength(0)
  })
})

// ─── hp-floor ─────────────────────────────────────────────────────────────────

describe('hp-floor — hp >= 0', () => {
  it('HP героя < 0 → TimelineCorruptedError', () => {
    const state = makeState({ hero: { ...makeState().hero, hp: -1 } })
    expect(() => assertValidGameState(state)).toThrow(TimelineCorruptedError)
  })

  it('HP врага < 0 → TimelineCorruptedError', () => {
    const state = makeState({ enemies: [makeEnemy('g1', { hp: -5 })] })
    expect(() => assertValidGameState(state)).toThrow(TimelineCorruptedError)
  })

  it('HP = 0 не нарушает hp-floor', () => {
    const state = makeState({ hero: { ...makeState().hero, hp: 0, state: 'death_door' } })
    expect(() => assertValidGameState(state)).not.toThrow()
  })
})

// ─── hp-ceiling ───────────────────────────────────────────────────────────────

describe('hp-ceiling — hp <= maxHp', () => {
  it('HP героя > maxHp → TimelineCorruptedError', () => {
    const state = makeState({ hero: { ...makeState().hero, hp: 51, maxHp: 50 } })
    expect(() => assertValidGameState(state)).toThrow(TimelineCorruptedError)
  })

  it('HP врага > maxHp → TimelineCorruptedError', () => {
    const state = makeState({ enemies: [makeEnemy('g1', { hp: 25, maxHp: 20 })] })
    expect(() => assertValidGameState(state)).toThrow(TimelineCorruptedError)
  })

  it('HP = maxHp не нарушает hp-ceiling', () => {
    expect(() => assertValidGameState(makeState())).not.toThrow()
  })
})

// ─── bleed-cap ────────────────────────────────────────────────────────────────

describe('bleed-cap — bleed stacks <= 10', () => {
  it('bleed stacks > 10 на герое → TimelineCorruptedError', () => {
    const state = makeState({
      hero: { ...makeState().hero, statuses: [{ name: 'bleed', stacks: 11 }] },
    })
    expect(() => assertValidGameState(state)).toThrow(TimelineCorruptedError)
  })

  it('bleed stacks > 10 на враге → TimelineCorruptedError', () => {
    const state = makeState({
      enemies: [makeEnemy('g1', { statuses: [{ name: 'bleed', stacks: 15 }] })],
    })
    expect(() => assertValidGameState(state)).toThrow(TimelineCorruptedError)
  })

  it('bleed stacks = 10 не нарушает bleed-cap', () => {
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

  it('chargeStacks = 3 не нарушает charge-cap', () => {
    const state = makeState({ hero: { ...makeState().hero, chargeStacks: 3 } })
    expect(() => assertValidGameState(state)).not.toThrow()
  })

  it('chargeStacks = undefined не нарушает charge-cap', () => {
    expect(() => assertValidGameState(makeState())).not.toThrow()
  })
})

// ─── death-door-hp ────────────────────────────────────────────────────────────

describe('death-door-hp — death_door и dead имеют hp = 0', () => {
  it('death_door с hp > 0 → TimelineCorruptedError', () => {
    const state = makeState({ hero: { ...makeState().hero, hp: 1, state: 'death_door' } })
    expect(() => assertValidGameState(state)).toThrow(TimelineCorruptedError)
  })

  it('dead с hp > 0 → TimelineCorruptedError', () => {
    const state = makeState({ enemies: [makeEnemy('g1', { hp: 5, state: 'dead' })] })
    expect(() => assertValidGameState(state)).toThrow(TimelineCorruptedError)
  })

  it('death_door с hp = 0 не нарушает инвариант', () => {
    const state = makeState({ hero: { ...makeState().hero, hp: 0, state: 'death_door' } })
    expect(() => assertValidGameState(state)).not.toThrow()
  })
})

// ─── alive-hp ─────────────────────────────────────────────────────────────────

describe('alive-hp — alive сущность имеет hp > 0', () => {
  it('alive с hp = 0 → TimelineCorruptedError', () => {
    const state = makeState({ hero: { ...makeState().hero, hp: 0, state: 'alive' } })
    expect(() => assertValidGameState(state)).toThrow(TimelineCorruptedError)
  })

  it('alive враг с hp = 0 → TimelineCorruptedError', () => {
    const state = makeState({ enemies: [makeEnemy('g1', { hp: 0, state: 'alive' })] })
    expect(() => assertValidGameState(state)).toThrow(TimelineCorruptedError)
  })

  it('alive с hp = 1 не нарушает инвариант', () => {
    const state = makeState({ hero: { ...makeState().hero, hp: 1 } })
    expect(() => assertValidGameState(state)).not.toThrow()
  })
})

// ─── TimelineCorruptedError ───────────────────────────────────────────────────

describe('TimelineCorruptedError', () => {
  it('сообщение содержит TIMELINE CORRUPTED', () => {
    const state = makeState({ hero: { ...makeState().hero, hp: -1 } })
    try {
      assertValidGameState(state)
    } catch (e) {
      expect((e as Error).message).toContain('TIMELINE CORRUPTED')
    }
  })

  it('сообщение содержит id инварианта', () => {
    const state = makeState({ hero: { ...makeState().hero, hp: -1 } })
    try {
      assertValidGameState(state)
    } catch (e) {
      expect((e as TimelineCorruptedError).invariantId).toBe('hp-floor')
    }
  })

  it('сообщение содержит seed и turn', () => {
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

describe('soft invariants — не бросают, возвращают нарушения', () => {
  it('turn > 50 возвращает softViolation, не бросает', () => {
    const state = makeState({ turn: 51 })
    expect(() => assertValidGameState(state)).not.toThrow()
    const { softViolations } = assertValidGameState(state)
    expect(softViolations.length).toBeGreaterThan(0)
    expect(softViolations[0]).toContain('combat-terminates')
  })

  it('turn = 50 не нарушает combat-terminates', () => {
    const { softViolations } = assertValidGameState(makeState({ turn: 50 }))
    expect(softViolations).toHaveLength(0)
  })
})
