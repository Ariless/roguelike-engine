import { describe, it, expect } from 'vitest'
import {
  BLOODMAGE_CARDS,
  openTheWound,
  bloodrite,
  chaosBolt,
  playOpenTheWound,
  playBloodrite,
  playChaosBolt,
} from '../../src/engine/heroes/bloodmage'
import type { GameState } from '../../src/engine/types'

function makeState(heroHp = 30, enemyHp = 20): GameState {
  return {
    seed: 1,
    turn: 1,
    hero: {
      id: 'hero',
      name: 'Blood Mage',
      hp: heroHp,
      maxHp: 30,
      state: 'alive',
      statuses: [],
      row: 'front',
      heroClass: 'bloodmage',
      formState: 'human',
      hand: [],
      energy: 3,
    },
    enemies: [{
      id: 'enemy',
      name: 'Goblin',
      hp: enemyHp,
      maxHp: 20,
      state: 'alive',
      statuses: [],
      row: 'front',
      enemyType: 'goblin',
      intent: { type: 'attack', value: 6 },
    }],
    isOver: false,
  }
}

// ─── Card definitions ─────────────────────────────────────────────────────────

describe('BLOODMAGE_CARDS', () => {
  it('contains 3 cards', () => {
    expect(BLOODMAGE_CARDS).toHaveLength(3)
  })

  it('all cards have heroClass bloodmage', () => {
    BLOODMAGE_CARDS.forEach(c => expect(c.heroClass).toBe('bloodmage'))
  })

  it('all cards have exactly 2 axes', () => {
    BLOODMAGE_CARDS.forEach(c => expect(c.axes).toHaveLength(2))
  })

  it('openTheWound costs 1 energy', () => {
    expect(openTheWound.energyCost).toBe(1)
  })

  it('bloodrite costs 2 energy', () => {
    expect(bloodrite.energyCost).toBe(2)
  })

  it('chaosBolt costs 1 energy', () => {
    expect(chaosBolt.energyCost).toBe(1)
  })
})

// ─── playOpenTheWound ─────────────────────────────────────────────────────────

describe('playOpenTheWound', () => {
  it('applies 3 bleed to target', () => {
    const s = playOpenTheWound(makeState(), 'enemy')
    const bleed = s.enemies[0].statuses.find(st => st.name === 'bleed')
    expect(bleed?.stacks).toBe(3)
  })

  it('does NOT apply vulnerable when target has no bleed', () => {
    const s = playOpenTheWound(makeState(), 'enemy')
    const vuln = s.enemies[0].statuses.find(st => st.name === 'vulnerable')
    expect(vuln).toBeUndefined()
  })

  it('applies vulnerable when target was already bleeding', () => {
    const state = makeState()
    state.enemies[0].statuses = [{ name: 'bleed', stacks: 2 }]
    const s = playOpenTheWound(state, 'enemy')
    const vuln = s.enemies[0].statuses.find(st => st.name === 'vulnerable')
    expect(vuln).toBeDefined()
  })

  it('checks bleed BEFORE adding new bleed — 1 stack does not self-trigger', () => {
    // target has 1 bleed → "already bleeding" = true → vulnerable applied
    // (this is expected: even 1 stack counts as "already bleeding")
    const state = makeState()
    state.enemies[0].statuses = [{ name: 'bleed', stacks: 1 }]
    const s = playOpenTheWound(state, 'enemy')
    const vuln = s.enemies[0].statuses.find(st => st.name === 'vulnerable')
    expect(vuln).toBeDefined()
  })

  it('stacks bleed on top of existing bleed (capped at 10)', () => {
    const state = makeState()
    state.enemies[0].statuses = [{ name: 'bleed', stacks: 9 }]
    const s = playOpenTheWound(state, 'enemy')
    const bleed = s.enemies[0].statuses.find(st => st.name === 'bleed')
    expect(bleed?.stacks).toBe(10) // capped at 10
  })

  it('does not deal HP damage directly', () => {
    const s = playOpenTheWound(makeState(), 'enemy')
    expect(s.enemies[0].hp).toBe(20)
  })
})

// ─── playBloodrite ────────────────────────────────────────────────────────────

describe('playBloodrite', () => {
  it('deals 8 damage to target', () => {
    const s = playBloodrite(makeState(), 'enemy')
    expect(s.enemies[0].hp).toBe(12)
  })

  it('takes 3 self-damage', () => {
    const s = playBloodrite(makeState(), 'enemy')
    expect(s.hero.hp).toBe(27)
  })

  it('self-damage bypasses defend — defend on hero does not absorb it', () => {
    const state = makeState()
    state.hero.statuses = [{ name: 'defend', stacks: 5 }]
    const s = playBloodrite(state, 'enemy')
    // Hero should lose 3 HP despite having defend 5
    expect(s.hero.hp).toBe(27)
  })

  it('self-damage triggers death_door at 0 HP', () => {
    const state = makeState(3) // hero has 3 HP
    const s = playBloodrite(state, 'enemy')
    expect(s.hero.hp).toBe(0)
    expect(s.hero.state).toBe('death_door')
  })

  it('self-damage kills hero already at death_door', () => {
    const state = makeState(2)
    state.hero.state = 'death_door'
    const s = playBloodrite(state, 'enemy')
    expect(s.hero.state).toBe('dead')
  })

  it('vulnerable on target amplifies the 8 damage', () => {
    const state = makeState()
    state.enemies[0].statuses = [{ name: 'vulnerable', stacks: 1 }]
    const s = playBloodrite(state, 'enemy')
    // 8 × 1.5 = 12 damage
    expect(s.enemies[0].hp).toBe(8)
  })

  it('puts target at death_door when HP reaches 0', () => {
    const state = makeState(30, 8)
    const s = playBloodrite(state, 'enemy')
    expect(s.enemies[0].hp).toBe(0)
    expect(s.enemies[0].state).toBe('death_door')
  })
})

// ─── playChaosBolt ────────────────────────────────────────────────────────────

describe('playChaosBolt', () => {
  it('deals 5 damage to the given targetId', () => {
    const s = playChaosBolt(makeState(), 'enemy')
    expect(s.enemies[0].hp).toBe(15)
  })

  it('applies vulnerable modifier if target is vulnerable', () => {
    const state = makeState()
    state.enemies[0].statuses = [{ name: 'vulnerable', stacks: 1 }]
    const s = playChaosBolt(state, 'enemy')
    // 5 × 1.5 = 7 damage
    expect(s.enemies[0].hp).toBe(13)
  })

  it('does not damage caster — hero HP unchanged', () => {
    const s = playChaosBolt(makeState(), 'enemy')
    expect(s.hero.hp).toBe(30)
  })

  // ─── Mutation killing tests ────────────────────────────────────────────────
  // Kill: L84 &&→|| in self-damage state transition

  it('self-damage: hero 1 HP → alive → death_door (NOT dead)', () => {
    const s = makeState(1, 20)
    const next = playBloodrite(s, 'enemy')
    expect(next.hero.hp).toBe(0)
    expect(next.hero.state).toBe('death_door')  // kills &&→|| (would set dead instead)
  })

  it('self-damage: hero 4 HP → alive stays alive (HP drops to 1, state unchanged)', () => {
    const s = makeState(4, 20)
    const next = playBloodrite(s, 'enemy')
    expect(next.hero.hp).toBe(1)
    expect(next.hero.state).toBe('alive')  // kills condition→true mutant
  })

  it('self-damage: hero at death_door → dead', () => {
    const s = makeState(0, 20)
    const doored = { ...s, hero: { ...s.hero, state: 'death_door' as const } }
    const next = playBloodrite(doored, 'enemy')
    expect(next.hero.state).toBe('dead')
  })

  it('can target back-row enemy (no rangeType = not melee, no positional block)', () => {
    const state = makeState()
    state.enemies[0].row = 'back'
    // Add a front-row enemy — for melee this would block, for ranged it should not
    state.enemies.push({
      id: 'front-enemy',
      name: 'Goblin2',
      hp: 10,
      maxHp: 10,
      state: 'alive',
      statuses: [],
      row: 'front',
      enemyType: 'goblin',
      intent: { type: 'attack', value: 6 },
    })
    const s = playChaosBolt(state, 'enemy')
    // Back-row enemy should take 5 damage
    expect(s.enemies[0].hp).toBe(15)
  })
})

// ─── Card table — the fields nothing read back ────────────────────────────────
// Kill: StringLiteral "" across every card field. The table is a contract with the runtime
// (`id` is what a hand holds and what playCard dispatches on) and with the UI (name, rules
// text, axes), and no test read those fields, so blanking any of them stayed green.
//
// Asserted as present and well-formed rather than by exact text: pinning the prose would turn
// every wording change into a failure while catching nothing the runtime cares about.

describe('BLOODMAGE_CARDS — card metadata', () => {
  it('every card carries a non-empty id, name, rules text and narrative line', () => {
    BLOODMAGE_CARDS.forEach(c => {
      expect(c.id, `${c.name} id`).toBeTruthy()
      expect(c.name, `${c.id} name`).toBeTruthy()
      expect(c.rulesText, `${c.id} rulesText`).toBeTruthy()
      // narrativeLine is optional in the Card type and unevenly filled in — every werewolf,
      // bloodmage and berserker card has one, the paladin has one of three. Asserted only
      // where it exists, so a blanked string still fails without the test doubling as a
      // demand for missing copy.
      if ('narrativeLine' in c) expect(c.narrativeLine, `${c.id} narrativeLine`).toBeTruthy()
    })
  })

  it('card ids are unique, snake_case, and the ones the executor deals', () => {
    const ids = BLOODMAGE_CARDS.map(c => c.id)
    expect(new Set(ids).size, 'duplicate card id').toBe(ids.length)
    ids.forEach(id => expect(id, `${id} is not snake_case`).toMatch(/^[a-z]+(_[a-z]+)*$/))
    // These exact ids are what HERO_STATS hands the hero; a rename here alone leaves the
    // hero holding cards that dispatch to nothing.
    expect(ids).toEqual(['open_the_wound', 'bloodrite', 'chaos_bolt'].map(String))
  })

  it('every axis is one of the four the design defines', () => {
    const AXES = ['Tempo', 'Pressure', 'Stability', 'Conversion']
    BLOODMAGE_CARDS.forEach(c =>
      c.axes.forEach(axis => expect(AXES, `${c.id} axis ${axis}`).toContain(axis)),
    )
  })

  it('every card costs energy a 3-energy turn can pay', () => {
    BLOODMAGE_CARDS.forEach(c => {
      expect(c.energyCost, `${c.id} cost`).toBeGreaterThan(0)
      expect(c.energyCost, `${c.id} cost`).toBeLessThanOrEqual(3)
    })
  })
})
