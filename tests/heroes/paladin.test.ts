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
  it('все 3 карты паладина присутствуют', () => {
    expect(PALADIN_CARDS).toHaveLength(3)
  })

  it('каждая карта принадлежит классу paladin', () => {
    PALADIN_CARDS.forEach(card => {
      expect(card.heroClass).toBe('paladin')
    })
  })

  it('каждая карта затрагивает ровно 2 оси', () => {
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
  it('наносит 5 урона', () => {
    const state = makeState(makeHero(), [makeEnemy('g1')])
    const next = playRighteousStrike(state, 'g1')
    expect(next.enemies[0].hp).toBe(15)
  })

  it('не меняет chargeStacks если цель не vulnerable', () => {
    const state = makeState(makeHero(50, 1), [makeEnemy('g1')])
    const next = playRighteousStrike(state, 'g1')
    expect(next.hero.chargeStacks).toBe(1)
  })

  it('прибавляет 1 заряд если цель vulnerable', () => {
    const enemy = makeEnemy('g1', 20, [{ name: 'vulnerable', stacks: 1 }])
    const state = makeState(makeHero(50, 0), [enemy])
    const next = playRighteousStrike(state, 'g1')
    expect(next.hero.chargeStacks).toBe(1)
  })

  it('vulnerable ×1.5 и +1 заряд происходят одновременно', () => {
    const enemy = makeEnemy('g1', 20, [{ name: 'vulnerable', stacks: 1 }])
    const state = makeState(makeHero(50, 0), [enemy])
    const next = playRighteousStrike(state, 'g1')
    // floor(5 * 1.5) = 7 урона, +1 заряд
    expect(next.enemies[0].hp).toBe(13)
    expect(next.hero.chargeStacks).toBe(1)
  })

  it('заряд не превышает 3 при накоплении через vulnerable', () => {
    const enemy = makeEnemy('g1', 20, [{ name: 'vulnerable', stacks: 1 }])
    const state = makeState(makeHero(50, 3), [enemy])
    // isChargeActive=true → double damage, reset→0; then +1 from vulnerable → 1
    const next = playRighteousStrike(state, 'g1')
    expect(next.hero.chargeStacks).toBe(1)
  })

  it('при 3 зарядах наносит 10 урона (×2)', () => {
    const state = makeState(makeHero(50, 3), [makeEnemy('g1')])
    const next = playRighteousStrike(state, 'g1')
    expect(next.enemies[0].hp).toBe(10)
  })

  it('заряды сбрасываются в 0 после двойного удара', () => {
    const state = makeState(makeHero(50, 3), [makeEnemy('g1')])
    const next = playRighteousStrike(state, 'g1')
    expect(next.hero.chargeStacks).toBe(0)
  })

  it('при 3 зарядах + vulnerable: 10×1.5=15 урона, заряды → 1', () => {
    const enemy = makeEnemy('g1', 20, [{ name: 'vulnerable', stacks: 1 }])
    const state = makeState(makeHero(50, 3), [enemy])
    const next = playRighteousStrike(state, 'g1')
    // floor(10 * 1.5) = 15 урона; reset→0, +1 vulnerable → 1
    expect(next.enemies[0].hp).toBe(5)
    expect(next.hero.chargeStacks).toBe(1)
  })

  it('атака в back-row при живом front-row — стейт не меняется', () => {
    const front = makeEnemy('g1', 20, [], 'front')
    const back  = makeEnemy('g2', 20, [], 'back')
    const state = makeState(makeHero(), [front, back])
    const next = playRighteousStrike(state, 'g2')
    // без rangeType → не блокируется (нет melee)
    expect(next.enemies[1].hp).toBe(15)
  })

  it('цель на death_door умирает при атаке', () => {
    const dying = { ...makeEnemy('g1', 0), state: 'death_door' as const }
    const state = makeState(makeHero(), [dying])
    const next = playRighteousStrike(state, 'g1')
    expect(next.enemies[0].state).toBe('dead')
  })
})

// ─── playStubbornRecovery ─────────────────────────────────────────────────────

describe('playStubbornRecovery', () => {
  it('восстанавливает 6 HP', () => {
    const state = makeState(makeHero(30))
    const next = playStubbornRecovery(state)
    expect(next.hero.hp).toBe(36)
  })

  it('HP не превышает maxHp', () => {
    const state = makeState(makeHero(48))
    const next = playStubbornRecovery(state)
    expect(next.hero.hp).toBe(50)
  })

  it('не меняет chargeStacks', () => {
    const state = makeState(makeHero(30, 2))
    const next = playStubbornRecovery(state)
    expect(next.hero.chargeStacks).toBe(2)
  })

  it('не затрагивает врагов', () => {
    const state = makeState(makeHero(30), [makeEnemy('g1')])
    const next = playStubbornRecovery(state)
    expect(next.enemies[0].hp).toBe(20)
  })
})

// ─── playDivineCharge ─────────────────────────────────────────────────────────

describe('playDivineCharge', () => {
  it('прибавляет 1 заряд с нуля (undefined → 1)', () => {
    const state = makeState(makeHero())
    const next = playDivineCharge(state)
    expect(next.hero.chargeStacks).toBe(1)
  })

  it('прибавляет 1 заряд к существующим', () => {
    const state = makeState(makeHero(50, 1))
    const next = playDivineCharge(state)
    expect(next.hero.chargeStacks).toBe(2)
  })

  it('максимум ровно 3 стака', () => {
    const state = makeState(makeHero(50, 2))
    const next = playDivineCharge(state)
    expect(next.hero.chargeStacks).toBe(3)
  })

  it('при уже 3 зарядах остаётся 3 — не накапливается выше', () => {
    const state = makeState(makeHero(50, 3))
    const next = playDivineCharge(state)
    expect(next.hero.chargeStacks).toBe(3)
  })

  it('не меняет HP и статусы героя', () => {
    const state = makeState(makeHero(35))
    const next = playDivineCharge(state)
    expect(next.hero.hp).toBe(35)
    expect(next.hero.statuses).toHaveLength(0)
  })

  it('три последовательных броска дают 3 заряда', () => {
    const s1 = playDivineCharge(makeState(makeHero()))
    const s2 = playDivineCharge(s1)
    const s3 = playDivineCharge(s2)
    expect(s3.hero.chargeStacks).toBe(3)
  })

  it('четвёртый бросок не увеличивает до 4', () => {
    const s1 = playDivineCharge(makeState(makeHero()))
    const s2 = playDivineCharge(s1)
    const s3 = playDivineCharge(s2)
    const s4 = playDivineCharge(s3)
    expect(s4.hero.chargeStacks).toBe(3)
  })

  // Kill: L58 ?? 0 → && 0 (chargeStacks undefined treated as 0)
  it('первый заряд с chargeStacks=undefined даёт 1, не 0', () => {
    const s = makeState({ ...makeHero(), chargeStacks: undefined })
    const next = playDivineCharge(s)
    expect(next.hero.chargeStacks).toBe(1)  // kills ?? 0 → && 0 mutant
  })

  it('vulnerable даёт +1 заряд из undefined (не из 0)', () => {
    // RighteousStrike: если target vulnerable, gain 1 charge from chargeStacks ?? 0
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
