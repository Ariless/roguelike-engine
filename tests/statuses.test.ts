import { describe, it, expect } from 'vitest'
import { addStatus, tickStatuses, hasStatus, canAct } from '../src/engine/statuses'
import { step9_deathResolution } from '../src/engine/turnPipeline'
import type { GameState } from '../src/engine/types'

function makeState(options: {
  heroHp?: number
  heroStatuses?: GameState['hero']['statuses']
} = {}): GameState {
  return {
    seed: 1,
    turn: 1,
    isOver: false,
    hero: {
      id: 'hero',
      name: 'Hero',
      hp: options.heroHp ?? 50,
      maxHp: 50,
      state: 'alive',
      statuses: options.heroStatuses ?? [],
      row: 'front',
      heroClass: 'paladin',
      formState: 'human',
      hand: [],
      energy: 3,
    },
    enemies: [],
  }
}

// ─── addStatus — bleed ────────────────────────────────────────────────────────

describe('addStatus — bleed', () => {
  it('adds bleed when it is absent', () => {
    const state = makeState()
    const next = addStatus(state, 'hero', { name: 'bleed', stacks: 3 })
    const bleed = next.hero.statuses.find(s => s.name === 'bleed')
    expect(bleed?.stacks).toBe(3)
  })

  it('stacks bleed onto the existing one', () => {
    const state = makeState({ heroStatuses: [{ name: 'bleed', stacks: 4 }] })
    const next = addStatus(state, 'hero', { name: 'bleed', stacks: 3 })
    const bleed = next.hero.statuses.find(s => s.name === 'bleed')
    expect(bleed?.stacks).toBe(7)
  })

  it('bleed does not exceed 10 stacks when stacking', () => {
    const state = makeState({ heroStatuses: [{ name: 'bleed', stacks: 8 }] })
    const next = addStatus(state, 'hero', { name: 'bleed', stacks: 5 })
    const bleed = next.hero.statuses.find(s => s.name === 'bleed')
    expect(bleed?.stacks).toBe(10)
  })

  it('bleed does not exceed 10 stacks on first application', () => {
    const state = makeState()
    const next = addStatus(state, 'hero', { name: 'bleed', stacks: 15 })
    const bleed = next.hero.statuses.find(s => s.name === 'bleed')
    expect(bleed?.stacks).toBe(10)
  })
})

// ─── addStatus — stun ─────────────────────────────────────────────────────────

describe('addStatus — stun', () => {
  it('adds stun with duration 1', () => {
    const state = makeState()
    const next = addStatus(state, 'hero', { name: 'stun', stacks: 1 })
    const stun = next.hero.statuses.find(s => s.name === 'stun')
    expect(stun?.duration).toBe(1)
  })

  it('stun does not stack — a repeated stun resets duration to 1', () => {
    const state = makeState({ heroStatuses: [{ name: 'stun', stacks: 1, duration: 1 }] })
    const next = addStatus(state, 'hero', { name: 'stun', stacks: 1 })
    const stunStatuses = next.hero.statuses.filter(s => s.name === 'stun')
    expect(stunStatuses).toHaveLength(1)
    expect(stunStatuses[0].duration).toBe(1)
  })
})

// ─── addStatus — defend ───────────────────────────────────────────────────────

describe('addStatus — defend', () => {
  it('adds defend when it is absent', () => {
    const state = makeState()
    const next = addStatus(state, 'hero', { name: 'defend', stacks: 5 })
    const defend = next.hero.statuses.find(s => s.name === 'defend')
    expect(defend?.stacks).toBe(5)
  })

  it('stacks defend onto the existing one', () => {
    const state = makeState({ heroStatuses: [{ name: 'defend', stacks: 4 }] })
    const next = addStatus(state, 'hero', { name: 'defend', stacks: 3 })
    const defend = next.hero.statuses.find(s => s.name === 'defend')
    expect(defend?.stacks).toBe(7)
  })
})

// ─── addStatus — vulnerable ───────────────────────────────────────────────────

describe('addStatus — vulnerable', () => {
  it('adds vulnerable when it is absent', () => {
    const state = makeState()
    const next = addStatus(state, 'hero', { name: 'vulnerable', stacks: 1 })
    expect(hasStatus(next.hero, 'vulnerable')).toBe(true)
  })

  it('vulnerable is idempotent — applying it again does not duplicate it', () => {
    const state = makeState({ heroStatuses: [{ name: 'vulnerable', stacks: 1 }] })
    const next = addStatus(state, 'hero', { name: 'vulnerable', stacks: 1 })
    const vulnerable = next.hero.statuses.filter(s => s.name === 'vulnerable')
    expect(vulnerable).toHaveLength(1)
  })
})

// ─── tickStatuses — bleed ─────────────────────────────────────────────────────

describe('tickStatuses — bleed', () => {
  it('bleed removes HP equal to the number of stacks', () => {
    const state = makeState({ heroHp: 30, heroStatuses: [{ name: 'bleed', stacks: 4 }] })
    const next = tickStatuses(state, 'hero')
    expect(next.hero.hp).toBe(26)
  })

  it('bleed does not push HP below 0', () => {
    const state = makeState({ heroHp: 2, heroStatuses: [{ name: 'bleed', stacks: 10 }] })
    const next = tickStatuses(state, 'hero')
    expect(next.hero.hp).toBe(0)
  })

  it('bleed triggers death_door when HP reaches 0', () => {
    const state = makeState({ heroHp: 3, heroStatuses: [{ name: 'bleed', stacks: 5 }] })
    const next = tickStatuses(state, 'hero')
    expect(next.hero.state).toBe('death_door')
  })

  it('bleed leaves the state alone while HP stays above 0', () => {
    const state = makeState({ heroHp: 20, heroStatuses: [{ name: 'bleed', stacks: 3 }] })
    const next = tickStatuses(state, 'hero')
    expect(next.hero.state).toBe('alive')
  })
})

// ─── tickStatuses — stun expire ───────────────────────────────────────────────

describe('tickStatuses — stun expire', () => {
  it('stun is removed after the tick (duration 1 → 0)', () => {
    const state = makeState({ heroStatuses: [{ name: 'stun', stacks: 1, duration: 1 }] })
    const next = tickStatuses(state, 'hero')
    expect(hasStatus(next.hero, 'stun')).toBe(false)
  })
})

// ─── tickStatuses — defend expire ────────────────────────────────────────────

describe('tickStatuses — defend expire', () => {
  it('defend is removed after the tick (duration 1 → 0)', () => {
    const state = makeState({ heroStatuses: [{ name: 'defend', stacks: 5, duration: 1 }] })
    const next = tickStatuses(state, 'hero')
    expect(hasStatus(next.hero, 'defend')).toBe(false)
  })

  it('defend without duration survives the tick', () => {
    const state = makeState({ heroStatuses: [{ name: 'defend', stacks: 5 }] })
    const next = tickStatuses(state, 'hero')
    expect(hasStatus(next.hero, 'defend')).toBe(true)
  })
})

// ─── canAct ───────────────────────────────────────────────────────────────────

describe('canAct', () => {
  it('returns true when there is no stun', () => {
    const state = makeState()
    expect(canAct(state.hero)).toBe(true)
  })

  it('returns false when stun is present', () => {
    const state = makeState({ heroStatuses: [{ name: 'stun', stacks: 1, duration: 1 }] })
    expect(canAct(state.hero)).toBe(false)
  })

  it('returns true once stun has expired', () => {
    const state = makeState({ heroStatuses: [{ name: 'stun', stacks: 1, duration: 1 }] })
    const next = tickStatuses(state, 'hero')
    expect(canAct(next.hero)).toBe(true)
  })
})

// ─── Mutation killing tests ───────────────────────────────────────────────────
// Each test is written to kill one specific surviving mutant.

describe('hasStatus — negative cases (kill hasStatus always-true mutant)', () => {
  it('returns false when the status is absent', () => {
    const state = makeState()
    expect(hasStatus(state.hero, 'bleed')).toBe(false)
    expect(hasStatus(state.hero, 'stun')).toBe(false)
    expect(hasStatus(state.hero, 'defend')).toBe(false)
    expect(hasStatus(state.hero, 'vulnerable')).toBe(false)
  })

  it('returns false for another status when only bleed is present', () => {
    const state = makeState({ heroStatuses: [{ name: 'bleed', stacks: 3 }] })
    expect(hasStatus(state.hero, 'bleed')).toBe(true)
    expect(hasStatus(state.hero, 'stun')).toBe(false)   // ← kills always-true mutant
    expect(hasStatus(state.hero, 'defend')).toBe(false)
  })

  it('hasStatus matches a specific name, not any status', () => {
    const state = makeState({ heroStatuses: [{ name: 'stun', stacks: 1, duration: 1 }] })
    expect(hasStatus(state.hero, 'stun')).toBe(true)
    expect(hasStatus(state.hero, 'bleed')).toBe(false)  // ← kills always-true mutant
  })
})

describe('tickStatuses — duration filter (kill filter condition mutant)', () => {
  it('a status WITHOUT a duration field is not removed by the tick', () => {
    // bleed has no duration — it has to survive the tick (stacks do not decay in the engine)
    const state = makeState({ heroHp: 20, heroStatuses: [{ name: 'bleed', stacks: 3 }] })
    const next = tickStatuses(state, 'hero')
    expect(hasStatus(next.hero, 'bleed')).toBe(true)  // ← kills filter-to-false mutant
    expect(next.hero.statuses[0].stacks).toBe(3)      // stacks do not decay in the engine, only HP does
    expect(next.hero.hp).toBe(17)                     // HP dropped by 3
  })

  it('a status WITH duration:1 is removed after the tick', () => {
    const state = makeState({ heroStatuses: [{ name: 'stun', stacks: 1, duration: 1 }] })
    const next = tickStatuses(state, 'hero')
    expect(hasStatus(next.hero, 'stun')).toBe(false)
  })

  it('a status WITH duration:2 is NOT removed by a single tick', () => {
    const state = makeState({ heroStatuses: [{ name: 'stun', stacks: 1, duration: 2 }] })
    const next = tickStatuses(state, 'hero')
    expect(hasStatus(next.hero, 'stun')).toBe(true)   // ← kills filter-to-false mutant
    expect(next.hero.statuses[0].duration).toBe(1)    // duration decremented
  })

  it('duration decrements by 1 per tick', () => {
    let state = makeState({ heroStatuses: [{ name: 'stun', stacks: 1, duration: 3 }] })
    state = tickStatuses(state, 'hero')
    expect(state.hero.statuses[0].duration).toBe(2)
    state = tickStatuses(state, 'hero')
    expect(state.hero.statuses[0].duration).toBe(1)
    state = tickStatuses(state, 'hero')
    expect(hasStatus(state.hero, 'stun')).toBe(false)  // removed after 3 ticks
  })
})

describe('updateEntity — every enemy is updated independently (kill always-true map mutant)', () => {
  it('addStatus on one enemy does not affect the other', () => {
    const baseEnemy = {
      id: 'e0', name: 'G1', hp: 20, maxHp: 20, state: 'alive' as const,
      statuses: [], row: 'front' as const, enemyType: 'goblin' as const,
      intent: { type: 'attack' as const, value: 6 },
    }
    const state: GameState = {
      seed: 1, turn: 1, isOver: false,
      hero: makeState().hero,
      enemies: [
        { ...baseEnemy, id: 'e0', name: 'G1' },
        { ...baseEnemy, id: 'e1', name: 'G2' },
      ],
    }
    const next = addStatus(state, 'e0', { name: 'bleed', stacks: 3 })
    expect(hasStatus(next.enemies[0], 'bleed')).toBe(true)
    expect(hasStatus(next.enemies[1], 'bleed')).toBe(false)  // ← kills always-true map mutant
  })
})

// ─── tickStatuses — enemy bleed ───────────────────────────────────────────────
// Engine contract: tickStatuses puts enemies into death_door (like heroes) when HP → 0.
// The executor converts enemy death_door → dead via resolveAndCheckWin after each tick.
// Heroes stay at death_door and can be healed; enemies cannot.

describe('tickStatuses — enemy bleed (engine layer)', () => {
  function makeStateWithEnemy(options: {
    enemyHp?: number
    enemyStatuses?: GameState['enemies'][number]['statuses']
  } = {}): GameState {
    return {
      seed: 1, turn: 1, isOver: false,
      hero: makeState().hero,
      enemies: [{
        id: 'e0',
        name: 'Goblin',
        hp: options.enemyHp ?? 20,
        maxHp: 20,
        state: 'alive' as const,
        statuses: options.enemyStatuses ?? [],
        row: 'front' as const,
        enemyType: 'goblin' as const,
        intent: { type: 'attack' as const, value: 6 },
      }],
    }
  }

  it('bleed removes enemy HP equal to the stacks', () => {
    const state = makeStateWithEnemy({ enemyHp: 20, enemyStatuses: [{ name: 'bleed', stacks: 4 }] })
    const next = tickStatuses(state, 'e0')
    expect(next.enemies[0].hp).toBe(16)
    expect(next.enemies[0].state).toBe('alive')
  })

  it('lethal bleed puts an enemy into death_door at the engine layer', () => {
    // tickStatuses in the engine does not distinguish hero from enemy — both go to death_door.
    // The death_door → dead conversion for enemies is done by executor.resolveAndCheckWin.
    const state = makeStateWithEnemy({ enemyHp: 3, enemyStatuses: [{ name: 'bleed', stacks: 5 }] })
    const next = tickStatuses(state, 'e0')
    expect(next.enemies[0].hp).toBe(0)
    expect(next.enemies[0].state).toBe('death_door')
  })

  it('step9_deathResolution does not convert death_door → dead, only alive → death_door', () => {
    // Kill: if step9 did the conversion, enemies would die without resolveAndCheckWin.
    // This test documents that step9 alone is not enough — resolveAndCheckWin is required.
    const state = makeStateWithEnemy({ enemyHp: 3, enemyStatuses: [{ name: 'bleed', stacks: 5 }] })
    const afterTick = tickStatuses(state, 'e0')
    expect(afterTick.enemies[0].state).toBe('death_door')  // after the tick

    const afterStep9 = step9_deathResolution(afterTick)
    expect(afterStep9.enemies[0].state).toBe('death_door') // step9 leaves death_door → dead alone
  })

  it('a hero at death_door stays at death_door after bleed (and can be healed)', () => {
    // A contrast test: for a hero, death_door is not the end (until the next hit or a heal).
    const state = makeState({ heroHp: 3, heroStatuses: [{ name: 'bleed', stacks: 5 }] })
    const next = tickStatuses(state, 'hero')
    expect(next.hero.state).toBe('death_door')
    // Hero and enemy behave identically at the engine layer — the difference is what the executor does next
  })
})
