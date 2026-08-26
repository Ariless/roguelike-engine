import { describe, it, expect } from 'vitest'
import {
  BERSERKER_CARDS,
  savageLunge, primalFury, primalDodge,
  isInRage, rageDamage,
  playSavageLunge, playPrimalFury, playPrimalDodge,
} from '../../src/engine/heroes/berserker'
import type { GameState } from '../../src/engine/types'

function makeState(heroHp = 28, enemyHp = 30): GameState {
  return {
    seed: 1, turn: 1,
    hero: {
      id: 'hero', name: 'Berserker',
      hp: heroHp, maxHp: 28,
      state: 'alive', statuses: [], row: 'front',
      heroClass: 'berserker', formState: 'human',
      hand: [], energy: 3,
    },
    enemies: [{
      id: 'enemy', name: 'Goblin',
      hp: enemyHp, maxHp: 30,
      state: 'alive', statuses: [], row: 'front',
      enemyType: 'goblin',
      intent: { type: 'attack', value: 6 },
    }],
    isOver: false,
  }
}

// ─── Card catalogue ──────────────────────────────────────────────────────────

describe('BERSERKER_CARDS', () => {
  it('3 cards', () => expect(BERSERKER_CARDS).toHaveLength(3))
  it('every card has heroClass: berserker', () => {
    BERSERKER_CARDS.forEach(c => expect(c.heroClass).toBe('berserker'))
  })
  it('each card has 2 axes', () => {
    BERSERKER_CARDS.forEach(c => expect(c.axes).toHaveLength(2))
  })
})

// ─── isInRage ─────────────────────────────────────────────────────────────────

describe('isInRage', () => {
  const hero = makeState(28).hero

  it('HP > 25% → rage inactive', () => {
    expect(isInRage({ ...hero, hp: 8 })).toBe(false)  // 8/28 = 28.5%
  })

  it('HP = 25% → rage active', () => {
    expect(isInRage({ ...hero, hp: 7 })).toBe(true)   // 7/28 = 25%
  })

  it('HP < 25% → rage active', () => {
    expect(isInRage({ ...hero, hp: 4 })).toBe(true)
  })

  it('HP = 0 (death_door) → rage inactive, the hero is dead', () => {
    expect(isInRage({ ...hero, hp: 0, state: 'dead' })).toBe(false)
  })

  it('HP = 0 (death_door state) → rage stays active until dead', () => {
    expect(isInRage({ ...hero, hp: 0, state: 'death_door' })).toBe(true)
  })
})

// ─── rageDamage ───────────────────────────────────────────────────────────────

describe('rageDamage', () => {
  const hero = makeState(28).hero

  it('HP > 25% → base damage, no bonus', () => {
    expect(rageDamage({ ...hero, hp: 8 }, 6)).toBe(6)
  })

  it('HP ≤ 25% → damage ×1.5', () => {
    expect(rageDamage({ ...hero, hp: 7 }, 6)).toBe(9)
  })

  it('floor of a fractional result', () => {
    expect(rageDamage({ ...hero, hp: 7 }, 5)).toBe(7)  // 5 * 1.5 = 7.5 → 7
  })
})

// ─── playSavageLunge ─────────────────────────────────────────────────────────

describe('playSavageLunge', () => {
  it('HP > 25% → 6 base damage', () => {
    const s = makeState(28)
    const next = playSavageLunge(s, 'enemy')
    expect(next.enemies[0].hp).toBe(30 - 6)
  })

  it('HP ≤ 25% → 9 damage (6 × 1.5)', () => {
    const s = makeState(7)
    const next = playSavageLunge(s, 'enemy')
    expect(next.enemies[0].hp).toBe(30 - 9)
  })

  it('pushes the target to the back row', () => {
    const next = playSavageLunge(makeState(), 'enemy')
    expect(next.enemies[0].row).toBe('back')
  })

  it('the hero row does not change', () => {
    const next = playSavageLunge(makeState(), 'enemy')
    expect(next.hero.row).toBe('front')
  })
})

// ─── playPrimalFury ──────────────────────────────────────────────────────────

describe('playPrimalFury', () => {
  it('HP > 25% → 4 base damage', () => {
    const next = playPrimalFury(makeState(28), 'enemy')
    expect(next.enemies[0].hp).toBe(30 - 4)
  })

  it('HP ≤ 25% → 6 damage (4 × 1.5)', () => {
    const next = playPrimalFury(makeState(7), 'enemy')
    expect(next.enemies[0].hp).toBe(30 - 6)
  })

  it('accumulates a rage stack', () => {
    const next = playPrimalFury(makeState(), 'enemy')
    expect(next.hero.rageStacks).toBe(1)
  })

  it('rage stacks accumulate', () => {
    let s = makeState()
    s = playPrimalFury(s, 'enemy')
    s = playPrimalFury(s, 'enemy')
    expect(s.hero.rageStacks).toBe(2)
  })

  it('rage stacks do not exceed 5', () => {
    let s = makeState()
    s = { ...s, hero: { ...s.hero, rageStacks: 5 } }
    expect(playPrimalFury(s, 'enemy').hero.rageStacks).toBe(5)
  })
})

// ─── playPrimalDodge ─────────────────────────────────────────────────────────

describe('playPrimalDodge', () => {
  it('gives 4 defend', () => {
    const next = playPrimalDodge(makeState())
    const def = next.hero.statuses.find(st => st.name === 'defend')
    expect(def?.stacks).toBe(4)
  })

  it('HP > 25% → energy does not increase', () => {
    const s = makeState(20)
    expect(playPrimalDodge(s).hero.energy).toBe(s.hero.energy)
  })

  it('HP ≤ 25% → +1 energy', () => {
    const s = makeState(7)
    expect(playPrimalDodge(s).hero.energy).toBe(s.hero.energy + 1)
  })
})

// ─── Mutation killing tests ───────────────────────────────────────────────────

describe('playSavageLunge — only targeted enemy goes to back row', () => {
  it('with two enemies only the target is pushed to the back row', () => {
    const s = makeState()
    const state = {
      ...s,
      enemies: [
        { ...s.enemies[0], id: 'e0', row: 'front' as const },
        { ...s.enemies[0], id: 'e1', row: 'front' as const },
      ],
    }
    const next = playSavageLunge(state, 'e0')
    expect(next.enemies[0].row).toBe('back')   // target
    expect(next.enemies[1].row).toBe('front')  // kills id===targetId → true mutant
  })
})

describe('rageDamage — exact boundary values', () => {
  const hero = makeState(28).hero

  it('HP = 8 (29% > 25%) → base damage, no bonus', () => {
    expect(rageDamage({ ...hero, hp: 8 }, 6)).toBe(6)   // kills conditional→true
  })

  it('HP = 7 (exactly 25%) → rage active, ×1.5', () => {
    expect(rageDamage({ ...hero, hp: 7 }, 6)).toBe(9)
  })

  it('HP = 8 vs HP = 7 — different results (boundary is strict)', () => {
    const above = rageDamage({ ...hero, hp: 8 }, 10)
    const at    = rageDamage({ ...hero, hp: 7 }, 10)
    expect(above).toBe(10)  // no rage
    expect(at).toBe(15)     // rage active — kills conditional→true that collapses boundary
  })
})

// ─── Card table — the fields nothing read back ────────────────────────────────
// Kill: StringLiteral "" across every card field. The table is a contract with the runtime
// (`id` is what a hand holds and what playCard dispatches on) and with the UI (name, rules
// text, axes), and no test read those fields, so blanking any of them stayed green.
//
// Asserted as present and well-formed rather than by exact text: pinning the prose would turn
// every wording change into a failure while catching nothing the runtime cares about.

describe('BERSERKER_CARDS — card metadata', () => {
  it('every card carries a non-empty id, name, rules text and narrative line', () => {
    BERSERKER_CARDS.forEach(c => {
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
    const ids = BERSERKER_CARDS.map(c => c.id)
    expect(new Set(ids).size, 'duplicate card id').toBe(ids.length)
    ids.forEach(id => expect(id, `${id} is not snake_case`).toMatch(/^[a-z]+(_[a-z]+)*$/))
    // These exact ids are what HERO_STATS hands the hero; a rename here alone leaves the
    // hero holding cards that dispatch to nothing.
    expect(ids).toEqual(['savage_lunge', 'primal_fury', 'primal_dodge'].map(String))
  })

  it('every axis is one of the four the design defines', () => {
    const AXES = ['Tempo', 'Pressure', 'Stability', 'Conversion']
    BERSERKER_CARDS.forEach(c =>
      c.axes.forEach(axis => expect(AXES, `${c.id} axis ${axis}`).toContain(axis)),
    )
  })

  it('every card costs energy a 3-energy turn can pay', () => {
    BERSERKER_CARDS.forEach(c => {
      expect(c.energyCost, `${c.id} cost`).toBeGreaterThan(0)
      expect(c.energyCost, `${c.id} cost`).toBeLessThanOrEqual(3)
    })
  })
})
