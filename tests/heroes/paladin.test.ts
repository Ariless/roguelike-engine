import { describe, it, expect } from 'vitest'
import {
  PALADIN_CARDS,
  divineCharge,
  righteousStrike,
  stubbornRecovery,
  playDivineCharge,
  playRighteousStrike,
  playStubbornRecovery,
} from '../../src/engine/heroes/paladin'
import type { GameState } from '../../src/engine/types'

function makeHero(hp = 50, chargeStacks?: number): GameState['hero'] {
  return {
    id: 'hero',
    name: 'Paladin',
    hp,
    maxHp: 50,
    state: 'alive',
    statuses: [],
    row: 'front',
    heroClass: 'paladin',
    formState: 'human',
    hand: [],
    energy: 3,
    chargeStacks,
  }
}

function makeEnemy(
  id: string,
  hp = 20,
  statuses: GameState['enemies'][0]['statuses'] = [],
  row: 'front' | 'back' = 'front',
) {
  return {
    id,
    name: 'Goblin',
    hp,
    maxHp: 20,
    state: 'alive' as const,
    statuses,
    row,
    enemyType: 'goblin' as const,
    intent: { type: 'attack' as const, value: 6 },
  }
}

function makeState(hero: GameState['hero'], enemies: GameState['enemies'] = []): GameState {
  return { seed: 1, turn: 1, isOver: false, hero, enemies }
}

// ─── Card definitions ─────────────────────────────────────────────────────────

describe('card definitions', () => {
  it('all 3 paladin cards are present', () => {
    expect(PALADIN_CARDS).toHaveLength(3)
  })

  it('every card belongs to the paladin class', () => {
    PALADIN_CARDS.forEach(card => {
      expect(card.heroClass).toBe('paladin')
    })
  })

  it('each card touches exactly 2 axes', () => {
    PALADIN_CARDS.forEach(card => {
      expect(card.axes).toHaveLength(2)
    })
  })

  it('Righteous Strike — Tempo + Conversion', () => {
    expect(righteousStrike.axes).toEqual(['Tempo', 'Conversion'])
  })

  it('Stubborn Recovery — Stability + Conversion', () => {
    expect(stubbornRecovery.axes).toEqual(['Stability', 'Conversion'])
  })

  it('Divine Charge — Tempo + Conversion', () => {
    expect(divineCharge.axes).toEqual(['Tempo', 'Conversion'])
  })
})

// ─── playRighteousStrike ──────────────────────────────────────────────────────

describe('playRighteousStrike', () => {
  it('deals 5 damage', () => {
    const state = makeState(makeHero(), [makeEnemy('g1')])
    const next = playRighteousStrike(state, 'g1')
    expect(next.enemies[0].hp).toBe(15)
  })

  it('leaves chargeStacks alone when the target is not vulnerable', () => {
    const state = makeState(makeHero(50, 1), [makeEnemy('g1')])
    const next = playRighteousStrike(state, 'g1')
    expect(next.hero.chargeStacks).toBe(1)
  })

  it('adds 1 charge when the target is vulnerable', () => {
    const enemy = makeEnemy('g1', 20, [{ name: 'vulnerable', stacks: 1 }])
    const state = makeState(makeHero(50, 0), [enemy])
    const next = playRighteousStrike(state, 'g1')
    expect(next.hero.chargeStacks).toBe(1)
  })

  it('vulnerable ×1.5 and +1 charge happen together', () => {
    const enemy = makeEnemy('g1', 20, [{ name: 'vulnerable', stacks: 1 }])
    const state = makeState(makeHero(50, 0), [enemy])
    const next = playRighteousStrike(state, 'g1')
    // floor(5 * 1.5) = 7 damage, +1 charge
    expect(next.enemies[0].hp).toBe(13)
    expect(next.hero.chargeStacks).toBe(1)
  })

  it('charges do not exceed 3 when accumulated through vulnerable', () => {
    const enemy = makeEnemy('g1', 20, [{ name: 'vulnerable', stacks: 1 }])
    const state = makeState(makeHero(50, 3), [enemy])
    // isChargeActive=true → double damage, reset→0; then +1 from vulnerable → 1
    const next = playRighteousStrike(state, 'g1')
    expect(next.hero.chargeStacks).toBe(1)
  })

  it('with 3 charges it deals 10 damage (×2)', () => {
    const state = makeState(makeHero(50, 3), [makeEnemy('g1')])
    const next = playRighteousStrike(state, 'g1')
    expect(next.enemies[0].hp).toBe(10)
  })

  it('charges reset to 0 after the double strike', () => {
    const state = makeState(makeHero(50, 3), [makeEnemy('g1')])
    const next = playRighteousStrike(state, 'g1')
    expect(next.hero.chargeStacks).toBe(0)
  })

  it('with 3 charges + vulnerable: 10×1.5=15 damage, charges → 1', () => {
    const enemy = makeEnemy('g1', 20, [{ name: 'vulnerable', stacks: 1 }])
    const state = makeState(makeHero(50, 3), [enemy])
    const next = playRighteousStrike(state, 'g1')
    // floor(10 * 1.5) = 15 damage; reset→0, +1 vulnerable → 1
    expect(next.enemies[0].hp).toBe(5)
    expect(next.hero.chargeStacks).toBe(1)
  })

  it('an attack into the back row with a living front row leaves the state unchanged', () => {
    const front = makeEnemy('g1', 20, [], 'front')
    const back  = makeEnemy('g2', 20, [], 'back')
    const state = makeState(makeHero(), [front, back])
    const next = playRighteousStrike(state, 'g2')
    // no rangeType → not blocked (not melee)
    expect(next.enemies[1].hp).toBe(15)
  })

  it('a target at death_door dies when attacked', () => {
    const dying = { ...makeEnemy('g1', 0), state: 'death_door' as const }
    const state = makeState(makeHero(), [dying])
    const next = playRighteousStrike(state, 'g1')
    expect(next.enemies[0].state).toBe('dead')
  })
})

// ─── playStubbornRecovery ─────────────────────────────────────────────────────

describe('playStubbornRecovery', () => {
  it('restores 6 HP', () => {
    const state = makeState(makeHero(30))
    const next = playStubbornRecovery(state)
    expect(next.hero.hp).toBe(36)
  })

  it('HP never exceeds maxHp', () => {
    const state = makeState(makeHero(48))
    const next = playStubbornRecovery(state)
    expect(next.hero.hp).toBe(50)
  })

  it('leaves chargeStacks alone', () => {
    const state = makeState(makeHero(30, 2))
    const next = playStubbornRecovery(state)
    expect(next.hero.chargeStacks).toBe(2)
  })

  it('leaves the enemies alone', () => {
    const state = makeState(makeHero(30), [makeEnemy('g1')])
    const next = playStubbornRecovery(state)
    expect(next.enemies[0].hp).toBe(20)
  })
})

// ─── playDivineCharge ─────────────────────────────────────────────────────────

describe('playDivineCharge', () => {
  it('adds 1 charge from nothing (undefined → 1)', () => {
    const state = makeState(makeHero())
    const next = playDivineCharge(state)
    expect(next.hero.chargeStacks).toBe(1)
  })

  it('adds 1 charge to the existing ones', () => {
    const state = makeState(makeHero(50, 1))
    const next = playDivineCharge(state)
    expect(next.hero.chargeStacks).toBe(2)
  })

  it('caps at exactly 3 stacks', () => {
    const state = makeState(makeHero(50, 2))
    const next = playDivineCharge(state)
    expect(next.hero.chargeStacks).toBe(3)
  })

  it('at 3 charges it stays 3 and does not go higher', () => {
    const state = makeState(makeHero(50, 3))
    const next = playDivineCharge(state)
    expect(next.hero.chargeStacks).toBe(3)
  })

  it('leaves hero HP and statuses alone', () => {
    const state = makeState(makeHero(35))
    const next = playDivineCharge(state)
    expect(next.hero.hp).toBe(35)
    expect(next.hero.statuses).toHaveLength(0)
  })

  it('three consecutive casts give 3 charges', () => {
    const s1 = playDivineCharge(makeState(makeHero()))
    const s2 = playDivineCharge(s1)
    const s3 = playDivineCharge(s2)
    expect(s3.hero.chargeStacks).toBe(3)
  })

  it('a fourth cast does not push it to 4', () => {
    const s1 = playDivineCharge(makeState(makeHero()))
    const s2 = playDivineCharge(s1)
    const s3 = playDivineCharge(s2)
    const s4 = playDivineCharge(s3)
    expect(s4.hero.chargeStacks).toBe(3)
  })

  // Kill: L58 ?? 0 → && 0 (chargeStacks undefined treated as 0)
  it('the first charge from chargeStacks=undefined gives 1, not 0', () => {
    const s = makeState({ ...makeHero(), chargeStacks: undefined })
    const next = playDivineCharge(s)
    expect(next.hero.chargeStacks).toBe(1)  // kills ?? 0 → && 0 mutant
  })

  it('vulnerable gives +1 charge from undefined (not from 0)', () => {
    // RighteousStrike: if the target is vulnerable, gain 1 charge from chargeStacks ?? 0
    const enemy = makeEnemy('enemy', 20, [{ name: 'vulnerable', stacks: 1 }])
    const s = makeState({ ...makeHero(), chargeStacks: undefined }, [enemy])
    const next = playRighteousStrike(s, 'enemy')
    expect(next.hero.chargeStacks).toBe(1)  // kills ?? 0 → && 0 mutant
  })
})

// ─── Table-driven tests ───────────────────────────────────────────────────────
// Each row = one combination of inputs/outputs. Gaps visible as missing rows.
// Pattern: each row = one rule; cross-rows = interaction tests.
// Applies to any rule engine: pricing, insurance, loan approval.

describe('table-driven: Righteous Strike — all combinations', () => {
  const enemy = makeEnemy('enemy')
  const vulnerableEnemy = makeEnemy('enemy', 20, [{ name: 'vulnerable', stacks: 1 }])

  const TABLE = [
    // charges | vuln  | baseDmg | vulnDmg (×1.5) | chargesAfter | description
    { charges: 0, vuln: false, baseDmg: 5,  finalDmg: 5,  chargesAfter: 0, desc: 'no charges, no vuln → base' },
    { charges: 0, vuln: true,  baseDmg: 5,  finalDmg: 7,  chargesAfter: 1, desc: 'no charges + vuln → +1 charge' },
    { charges: 1, vuln: false, baseDmg: 5,  finalDmg: 5,  chargesAfter: 1, desc: '1 charge, no vuln → no change' },
    { charges: 1, vuln: true,  baseDmg: 5,  finalDmg: 7,  chargesAfter: 2, desc: '1 charge + vuln → +1 charge' },
    { charges: 2, vuln: false, baseDmg: 5,  finalDmg: 5,  chargesAfter: 2, desc: '2 charges, no vuln → no change' },
    { charges: 2, vuln: true,  baseDmg: 5,  finalDmg: 7,  chargesAfter: 3, desc: '2 charges + vuln → cap 3' },
    { charges: 3, vuln: false, baseDmg: 10, finalDmg: 10, chargesAfter: 0, desc: '3 charges → double, reset' },
    { charges: 3, vuln: true,  baseDmg: 10, finalDmg: 15, chargesAfter: 1, desc: '3 charges + vuln → double×1.5, reset, +1' },
  ]

  TABLE.forEach(({ charges, vuln, finalDmg, chargesAfter, desc }) => {
    it(`charges=${charges} vuln=${vuln} → enemyHp=${20-finalDmg} charges→${chargesAfter} [${desc}]`, () => {
      const hero = makeHero(50, charges)
      const enemies = vuln ? [vulnerableEnemy] : [enemy]
      const s = makeState(hero, enemies)
      const next = playRighteousStrike(s, 'enemy')

      expect(next.enemies[0].hp).toBe(20 - finalDmg)
      expect(next.hero.chargeStacks ?? 0).toBe(chargesAfter)
    })
  })
})

// ─── Card table — the fields nothing read back ────────────────────────────────
// Kill: StringLiteral "" across every card field. The table is a contract with the runtime
// (`id` is what a hand holds and what playCard dispatches on) and with the UI (name, rules
// text, axes), and no test read those fields, so blanking any of them stayed green.
//
// Asserted as present and well-formed rather than by exact text: pinning the prose would turn
// every wording change into a failure while catching nothing the runtime cares about.

describe('PALADIN_CARDS — card metadata', () => {
  it('every card carries a non-empty id, name, rules text and narrative line', () => {
    PALADIN_CARDS.forEach(c => {
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
    const ids = PALADIN_CARDS.map(c => c.id)
    expect(new Set(ids).size, 'duplicate card id').toBe(ids.length)
    ids.forEach(id => expect(id, `${id} is not snake_case`).toMatch(/^[a-z]+(_[a-z]+)*$/))
    // These exact ids are what HERO_STATS hands the hero; a rename here alone leaves the
    // hero holding cards that dispatch to nothing.
    expect(ids).toEqual(['righteous_strike', 'stubborn_recovery', 'divine_charge'].map(String))
  })

  it('every axis is one of the four the design defines', () => {
    const AXES = ['Tempo', 'Pressure', 'Stability', 'Conversion']
    PALADIN_CARDS.forEach(c =>
      c.axes.forEach(axis => expect(AXES, `${c.id} axis ${axis}`).toContain(axis)),
    )
  })

  it('every card costs energy a 3-energy turn can pay', () => {
    PALADIN_CARDS.forEach(c => {
      expect(c.energyCost, `${c.id} cost`).toBeGreaterThan(0)
      expect(c.energyCost, `${c.id} cost`).toBeLessThanOrEqual(3)
    })
  })
})
