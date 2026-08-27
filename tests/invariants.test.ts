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

// ─── The message a violation carries ─────────────────────────────────────────
// The existing tests assert that a violation throws and that the message names the
// invariant, the seed and the turn. What none of them read is the detail line each
// invariant builds — and that is where the survivors were: emptying a message body,
// or flipping the comparison that finds the offending entity, changed nothing any
// test looked at. A TIMELINE CORRUPTED report whose detail line is blank tells the
// person holding the failing seed nothing about what went wrong.

describe('violation messages name the offender and its numbers', () => {
    function violation(state: GameState): TimelineCorruptedError {
        try {
            assertValidGameState(state)
        } catch (err) {
            return err as TimelineCorruptedError
        }
        throw new Error('expected the state to violate a hard invariant')
    }

    it('hp-floor names the entity and the negative value', () => {
        const err = violation(makeState({ enemies: [makeEnemy('e0', { hp: -5 })] }))

        expect(err.invariantId).toBe('hp-floor')
        expect(err.message).toContain('e0')
        expect(err.message).toContain('-5')
    })

    it('hp-ceiling names the entity, its hp and its maxHp', () => {
        const err = violation(makeState({ enemies: [makeEnemy('e0', { hp: 44, maxHp: 20 })] }))

        expect(err.invariantId).toBe('hp-ceiling')
        expect(err.message).toContain('e0')
        expect(err.message).toContain('44')
        expect(err.message).toContain('20')
    })

    it('bleed-cap names the entity and the stack count', () => {
        const err = violation(
            makeState({ enemies: [makeEnemy('e0', { statuses: [{ name: 'bleed', stacks: 17 }] })] }),
        )

        expect(err.invariantId).toBe('bleed-cap')
        expect(err.message).toContain('e0')
        expect(err.message).toContain('17')
    })

    it('charge-cap names the hero and the stack count', () => {
        const err = violation(makeState({ hero: { ...makeState().hero, chargeStacks: 9 } }))

        expect(err.invariantId).toBe('charge-cap')
        expect(err.message).toContain('9')
    })

    it('death-door-hp names the entity and the hp it should not have', () => {
        const err = violation(makeState({ enemies: [makeEnemy('e0', { state: 'death_door', hp: 7 })] }))

        expect(err.invariantId).toBe('death-door-hp')
        expect(err.message).toContain('e0')
        expect(err.message).toContain('7')
    })

    it('alive-hp names the entity sitting at zero', () => {
        const err = violation(makeState({ enemies: [makeEnemy('e0', { state: 'alive', hp: 0 })] }))

        expect(err.invariantId).toBe('alive-hp')
        expect(err.message).toContain('e0')
    })

    it('the soft violation carries its id and detail rather than throwing', () => {
        const { softViolations } = assertValidGameState(makeState({ turn: 99 }))

        expect(softViolations).toHaveLength(1)
        expect(softViolations[0]).toContain('combat-terminates')
        expect(softViolations[0]).toContain('99')
    })
})

// ─── every, not some ─────────────────────────────────────────────────────────
// Kill: MethodExpression every → some across the registry. With a single entity in the
// state the two are indistinguishable, which is why the existing tests could not tell
// them apart — they violate the invariant on the only entity present. These states hold
// one healthy entity alongside the offender, so `some` would report the board as valid.

describe('an invariant holds for every entity, not merely for one', () => {
    it('hp-floor still fires when only the second enemy is negative', () => {
        const state = makeState({ enemies: [makeEnemy('e0'), makeEnemy('e1', { hp: -1 })] })

        expect(() => assertValidGameState(state)).toThrow(TimelineCorruptedError)
    })

    it('hp-ceiling still fires when only one enemy is over its maximum', () => {
        const state = makeState({ enemies: [makeEnemy('e0'), makeEnemy('e1', { hp: 99, maxHp: 20 })] })

        expect(() => assertValidGameState(state)).toThrow(TimelineCorruptedError)
    })

    it('bleed-cap still fires when the healthy enemy is listed first', () => {
        const state = makeState({
            enemies: [
                makeEnemy('e0', { statuses: [{ name: 'bleed', stacks: 3 }] }),
                makeEnemy('e1', { statuses: [{ name: 'bleed', stacks: 11 }] }),
            ],
        })

        expect(() => assertValidGameState(state)).toThrow(TimelineCorruptedError)
    })

    it('alive-hp still fires when the hero is healthy and an enemy is not', () => {
        const state = makeState({ enemies: [makeEnemy('e0'), makeEnemy('e1', { state: 'alive', hp: 0 })] })

        expect(() => assertValidGameState(state)).toThrow(TimelineCorruptedError)
    })
})
