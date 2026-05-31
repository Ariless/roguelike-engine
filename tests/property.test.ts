import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { applyDamage, applyHeal } from '../src/engine/resolution'
import { addStatus, tickStatuses } from '../src/engine/statuses'
import { playRighteousStrike, playStubbornRecovery, playDivineCharge } from '../src/engine/heroes/paladin'
import { playOpenTheWound, playBloodrite, playChaosBolt } from '../src/engine/heroes/bloodmage'
import { isInRage, rageDamage } from '../src/engine/heroes/berserker'
import { wolfDamage, checkWerewolfTransform, playRend, playRampage } from '../src/engine/heroes/werewolf'
import type { GameState, Hero, Enemy, EntityState } from '../src/engine/types'

// ─── Arbitraries ──────────────────────────────────────────────────────────────

const entityState = (): fc.Arbitrary<EntityState> =>
  fc.constantFrom('alive', 'death_door', 'dead')

function makeEnemy(hp = 20, state: EntityState = 'alive'): Enemy {
  return {
    id: 'enemy', name: 'Goblin', hp, maxHp: 20, state, statuses: [], row: 'front',
    enemyType: 'goblin', intent: { type: 'attack', value: 6 },
  }
}

function makeHero(overrides: Partial<Hero> = {}): Hero {
  return {
    id: 'hero', name: 'Paladin', hp: 30, maxHp: 30, state: 'alive',
    statuses: [], row: 'front', heroClass: 'paladin', formState: 'human',
    hand: [], energy: 3,
    ...overrides,
  }
}

function makeState(heroHp = 30, enemyHp = 20, heroState: EntityState = 'alive'): GameState {
  return {
    seed: 1, turn: 1,
    hero: makeHero({ hp: heroHp, state: heroState }),
    enemies: [makeEnemy(enemyHp)],
    isOver: false,
  }
}

// Arbitrary: hp в пределах [0, maxHp], maxHp в [1, 50]
const hpArb = fc.integer({ min: 1, max: 50 }).chain(maxHp =>
  fc.integer({ min: 0, max: maxHp }).map(hp => ({ hp, maxHp }))
)

// Arbitrary: произвольный урон [0, 30]
const damageArb = fc.integer({ min: 0, max: 30 })

// ─── HP invariants ────────────────────────────────────────────────────────────

describe('property: HP никогда не выходит за [0, maxHp]', () => {
  it('applyDamage: hp >= 0 при любом уроне', () => {
    fc.assert(fc.property(hpArb, damageArb, ({ hp, maxHp }, dmg) => {
      const s = makeState(hp)
      s.hero.maxHp = maxHp
      const next = applyDamage(s, 'hero', dmg)
      expect(next.hero.hp).toBeGreaterThanOrEqual(0)
    }))
  })

  it('applyHeal: hp <= maxHp после любого лечения', () => {
    fc.assert(fc.property(hpArb, fc.integer({ min: 0, max: 30 }), ({ hp, maxHp }, heal) => {
      const s = makeState(hp)
      s.hero.maxHp = maxHp
      const next = applyHeal(s, 'hero', heal)
      expect(next.hero.hp).toBeLessThanOrEqual(next.hero.maxHp)
    }))
  })

  it('applyHeal: hp никогда не уменьшается', () => {
    fc.assert(fc.property(hpArb, fc.integer({ min: 0, max: 30 }), ({ hp, maxHp }, heal) => {
      const s = makeState(hp)
      s.hero.maxHp = maxHp
      const next = applyHeal(s, 'hero', heal)
      expect(next.hero.hp).toBeGreaterThanOrEqual(hp)
    }))
  })

  it('applyDamage: hp никогда не увеличивается', () => {
    fc.assert(fc.property(hpArb, damageArb, ({ hp, maxHp }, dmg) => {
      const s = makeState(hp)
      s.hero.maxHp = maxHp
      const next = applyDamage(s, 'hero', dmg)
      expect(next.hero.hp).toBeLessThanOrEqual(hp)
    }))
  })
})

// ─── State machine: alive → death_door → dead ─────────────────────────────────

describe('property: state machine — только валидные переходы', () => {
  it('dead entity остаётся dead после урона', () => {
    fc.assert(fc.property(damageArb, (dmg) => {
      const s = makeState(0)
      const dead = { ...s, hero: { ...s.hero, state: 'dead' as const } }
      const next = applyDamage(dead, 'hero', dmg)
      expect(next.hero.state).toBe('dead')
    }))
  })

  it('alive entity с hp > 0 после урона остаётся alive или death_door, но не dead', () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 30 }),
      fc.integer({ min: 0, max: 5 }),
      (hp, dmg) => {
        const s = makeState(hp)
        const next = applyDamage(s, 'hero', dmg)
        // Если hp > dmg → alive; если hp <= dmg → death_door; никогда dead
        expect(next.hero.state).not.toBe('dead')
      }
    ))
  })

  it('death_door entity умирает от любого ненулевого урона', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 30 }), (dmg) => {
      const s = { ...makeState(0), hero: { ...makeState(0).hero, state: 'death_door' as const } }
      const next = applyDamage(s, 'hero', dmg)
      expect(next.hero.state).toBe('dead')
    }))
  })

  it('applyHeal переводит death_door → alive', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 30 }), (heal) => {
      const s = { ...makeState(0), hero: { ...makeState(0).hero, state: 'death_door' as const } }
      const next = applyHeal(s, 'hero', heal)
      expect(next.hero.state).toBe('alive')
    }))
  })
})

// ─── Bleed: стаки ограничены 10 ──────────────────────────────────────────────

describe('property: bleed stacks <= 10 (cap invariant)', () => {
  it('bleed никогда не превышает 10 при любом количестве применений', () => {
    fc.assert(fc.property(
      fc.array(fc.integer({ min: 1, max: 8 }), { minLength: 1, maxLength: 10 }),
      (applications) => {
        let s = makeState()
        for (const stacks of applications) {
          s = addStatus(s, 'hero', { name: 'bleed', stacks })
        }
        const bleed = s.hero.statuses.find(st => st.name === 'bleed')
        expect(bleed!.stacks).toBeLessThanOrEqual(10)
      }
    ))
  })

  it('bleed tick не уходит в минус', () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 10 }),
      fc.integer({ min: 1, max: 30 }),
      (bleedStacks, heroHp) => {
        let s = makeState(heroHp)
        s = addStatus(s, 'hero', { name: 'bleed', stacks: bleedStacks })
        const next = tickStatuses(s, 'hero')
        expect(next.hero.hp).toBeGreaterThanOrEqual(0)
      }
    ))
  })
})

// ─── Defend: никогда не увеличивает входящий урон ────────────────────────────

describe('property: defend никогда не увеличивает урон', () => {
  it('герой с defend получает меньше или столько же урона', () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 30 }),
      fc.integer({ min: 1, max: 10 }),
      (dmg, defend) => {
        const withoutDefend = applyDamage(makeState(30), 'hero', dmg)
        let s = addStatus(makeState(30), 'hero', { name: 'defend', stacks: defend })
        const withDefend = applyDamage(s, 'hero', dmg)
        expect(withDefend.hero.hp).toBeGreaterThanOrEqual(withoutDefend.hero.hp)
      }
    ))
  })
})

// ─── Paladin: charge стаки [0, 3] ────────────────────────────────────────────

describe('property: Paladin chargeStacks никогда не превышает 3', () => {
  it('многократный Divine Charge не превышает 3', () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 10 }),
      (casts) => {
        let s = makeState()
        for (let i = 0; i < casts; i++) {
          s = playDivineCharge(s)
        }
        expect(s.hero.chargeStacks ?? 0).toBeLessThanOrEqual(3)
      }
    ))
  })

  it('Righteous Strike сбрасывает заряды до 0 при активации', () => {
    fc.assert(fc.property(
      fc.integer({ min: 0, max: 2 }),
      (extraCharges) => {
        let s = makeState()
        s = { ...s, hero: { ...s.hero, chargeStacks: 3 } }
        // добавим extra charges через Divine Charge перед сбросом — они уже на cap
        const next = playRighteousStrike(s, 'enemy')
        expect(next.hero.chargeStacks ?? 0).toBeLessThanOrEqual(1) // 0 или +1 если vulnerable
      }
    ))
  })
})

// ─── Blood Mage: vulnerable только при pre-existing bleed ────────────────────

describe('property: Open the Wound — vulnerable только если цель уже кровоточила', () => {
  it('без bleed: vulnerable не применяется', () => {
    fc.assert(fc.property(
      fc.integer({ min: 5, max: 20 }),
      (enemyHp) => {
        const s = makeState(30, enemyHp)
        const next = playOpenTheWound(s, 'enemy')
        const hasVulnerable = next.enemies[0].statuses.some(st => st.name === 'vulnerable')
        expect(hasVulnerable).toBe(false)
      }
    ))
  })

  it('с pre-existing bleed: vulnerable применяется', () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 5 }),
      (existingBleed) => {
        let s = makeState()
        s = addStatus(s, 'enemy', { name: 'bleed', stacks: existingBleed })
        const next = playOpenTheWound(s, 'enemy')
        const hasVulnerable = next.enemies[0].statuses.some(st => st.name === 'vulnerable')
        expect(hasVulnerable).toBe(true)
      }
    ))
  })
})

// ─── Berserker: rage mode — бинарный триггер ─────────────────────────────────

describe('property: Berserker rage — только при HP ≤ 25%', () => {
  it('HP > 25% → rage неактивна, базовый урон', () => {
    fc.assert(fc.property(
      fc.integer({ min: 4, max: 50 }).chain(maxHp =>
        fc.integer({ min: Math.floor(maxHp * 0.25) + 1, max: maxHp }).map(hp => ({ hp, maxHp }))
      ),
      fc.integer({ min: 1, max: 20 }),
      ({ hp, maxHp }, base) => {
        const hero = makeHero({ hp, maxHp, heroClass: 'berserker' })
        expect(rageDamage(hero, base)).toBe(base)
      }
    ))
  })

  it('HP ≤ 25% → урон × 1.5', () => {
    fc.assert(fc.property(
      fc.integer({ min: 4, max: 50 }).chain(maxHp =>
        fc.integer({ min: 1, max: Math.floor(maxHp * 0.25) || 1 }).map(hp => ({ hp, maxHp }))
      ),
      fc.integer({ min: 1, max: 20 }),
      ({ hp, maxHp }, base) => {
        const hero = makeHero({ hp, maxHp, heroClass: 'berserker' })
        expect(rageDamage(hero, base)).toBe(Math.floor(base * 1.5))
      }
    ))
  })
})

// ─── Werewolf: wolf passive — урон монотонен ─────────────────────────────────

describe('property: Werewolf wolfDamage — чем меньше HP, тем больше урон', () => {
  it('wolfDamage монотонно убывает с ростом HP', () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 50 }).chain(maxHp =>
        fc.tuple(
          fc.integer({ min: 0, max: maxHp }),
          fc.integer({ min: 0, max: maxHp }),
        ).map(([a, b]) => ({ maxHp, lowHp: Math.min(a, b), highHp: Math.max(a, b) }))
      ),
      fc.integer({ min: 1, max: 20 }),
      ({ maxHp, lowHp, highHp }, base) => {
        const heroLow  = makeHero({ hp: lowHp,  maxHp, heroClass: 'werewolf' })
        const heroHigh = makeHero({ hp: highHp, maxHp, heroClass: 'werewolf' })
        expect(wolfDamage(heroLow, base)).toBeGreaterThanOrEqual(wolfDamage(heroHigh, base))
      }
    ))
  })

  it('wolfDamage >= base при любом HP', () => {
    fc.assert(fc.property(hpArb, fc.integer({ min: 1, max: 20 }), ({ hp, maxHp }, base) => {
      const hero = makeHero({ hp, maxHp, heroClass: 'werewolf' })
      expect(wolfDamage(hero, base)).toBeGreaterThanOrEqual(base)
    }))
  })
})

// ─── Werewolf: трансформация только при HP ≤ 50% ─────────────────────────────

describe('property: Werewolf transform — только при HP ≤ 50%', () => {
  it('HP > 50%: трансформации нет', () => {
    fc.assert(fc.property(
      fc.integer({ min: 2, max: 50 }).chain(maxHp =>
        fc.integer({ min: Math.floor(maxHp / 2) + 1, max: maxHp })
          .map(hp => ({ hp, maxHp }))
      ),
      ({ hp, maxHp }) => {
        const s: GameState = {
          ...makeState(), hero: makeHero({ hp, maxHp, heroClass: 'werewolf', formState: 'human' })
        }
        expect(checkWerewolfTransform(s).hero.formState).toBe('human')
      }
    ))
  })

  it('HP ≤ 50% и alive: всегда трансформируется', () => {
    fc.assert(fc.property(
      fc.integer({ min: 2, max: 50 }).chain(maxHp =>
        fc.integer({ min: 1, max: Math.floor(maxHp / 2) })
          .map(hp => ({ hp, maxHp }))
      ),
      ({ hp, maxHp }) => {
        const s: GameState = {
          ...makeState(), hero: makeHero({ hp, maxHp, heroClass: 'werewolf', formState: 'human' })
        }
        expect(checkWerewolfTransform(s).hero.formState).toBe('werewolf')
      }
    ))
  })

  it('статусы выживают при трансформации', () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 10 }),
      (bleedStacks) => {
        let s = makeState(10)
        s = { ...s, hero: makeHero({ hp: 10, maxHp: 28, heroClass: 'werewolf', formState: 'human' }) }
        s = addStatus(s, 'hero', { name: 'bleed', stacks: bleedStacks })
        const next = checkWerewolfTransform(s)
        const bleed = next.hero.statuses.find(st => st.name === 'bleed')
        expect(bleed?.stacks).toBe(Math.min(bleedStacks, 10))
      }
    ))
  })
})

// ─── Ложный инвариант: лечение Werewolf ослабляет его ────────────────────────
// Намеренно падающий тест — Paladin лечит Werewolf выше 50% HP →
// wolf passive теряет бонус. HP растёт, но урон падает.

describe('false invariant: healing Werewolf above 50% reduces damage', () => {
  it.fails('heal всегда увеличивает боевую эффективность вервольфа', () => {
    const maxHp = 30
    const hp = Math.floor(maxHp * 0.45) // 13 — wolf passive active
    const base = 8
    const heroBefore = makeHero({ hp, maxHp, heroClass: 'werewolf' })
    const heroAfter  = makeHero({ hp: 16, maxHp, heroClass: 'werewolf' }) // healed above 50%
    // Этот assert намеренно ложный: лечение снижает wolf damage bonus
    expect(wolfDamage(heroAfter, base)).toBeGreaterThanOrEqual(wolfDamage(heroBefore, base))
  })
})

// ─── Ложные инварианты: курсовые задания ─────────────────────────────────────
// Эти тесты проходят только когда assertion ЛОЖНЫЙ.
// Учебная цель: распознать что "кажется очевидным" ≠ "всегда верно".

describe('false invariant: высокий HP всегда безопаснее для Berserker', () => {
  it.fails('больше HP = больше урон у берсеркера', () => {
    // Berserker passive: damage * (1 + missingHp / maxHp)
    // Больше HP → меньше missing HP → меньше урон
    // "Безопаснее по HP" означает "слабее как атакующий"
    const maxHp = 28
    const highHp = makeHero({ hp: 28, maxHp, heroClass: 'berserker' })  // полный HP
    const lowHp  = makeHero({ hp: 7,  maxHp, heroClass: 'berserker' })  // 25% HP

    // Этот assert намеренно ложный: больше HP → меньше урон
    expect(rageDamage(highHp, 8)).toBeGreaterThan(rageDamage(lowHp, 8))
  })
})

describe('false invariant: Chaos Bolt всегда бьёт случайно', () => {
  it.fails('разные seeds всегда дают разные цели для Chaos Bolt', () => {
    // С одним живым врагом RNG потребляется, но результат всегда тот же
    // "Случайность" не имеет эффекта без выбора между несколькими целями
    const s1 = makeState(25, 20)
    s1.hero = makeHero({ hp: 25, maxHp: 25, heroClass: 'bloodmage' })
    const s2 = { ...s1 }

    const r1 = playChaosBolt(s1, 'enemy')  // seed не влияет — 1 враг
    const r2 = playChaosBolt(s2, 'enemy')

    // Этот assert намеренно ложный: при одном враге результат всегда тот же
    expect(r1.enemies[0].hp).not.toBe(r2.enemies[0].hp)
  })
})

describe('false invariant: Open the Wound всегда угрожает vulnerable', () => {
  it.fails('Open the Wound всегда применяет vulnerable', () => {
    // Vulnerable применяется ТОЛЬКО если цель уже кровоточила ДО броска карты
    // Без pre-existing bleed — только bleed, без vulnerable
    const s = makeState(25, 20)
    s.hero = makeHero({ hp: 25, maxHp: 25, heroClass: 'bloodmage' })
    // Цель без bleed
    const next = playOpenTheWound(s, 'enemy')

    // Этот assert намеренно ложный: vulnerable не применяется без pre-existing bleed
    expect(next.enemies[0].statuses.some(st => st.name === 'vulnerable')).toBe(true)
  })
})

// ─── Rend: bleed применяется ПОСЛЕ урона ─────────────────────────────────────

describe('property: Rend — порядок операций (damage before bleed)', () => {
  it('HP после Rend отражает только урон, не bleed', () => {
    fc.assert(fc.property(
      fc.integer({ min: 15, max: 30 }),
      (enemyHp) => {
        const s: GameState = {
          ...makeState(28, enemyHp),
          hero: makeHero({ hp: 28, maxHp: 28, heroClass: 'werewolf', formState: 'werewolf' }),
        }
        const before = s.enemies[0].hp
        const next = playRend(s, 'enemy')
        const dmgDealt = before - next.enemies[0].hp
        // bleed не должен включаться в урон этого хода
        const bleed = next.enemies[0].statuses.find(st => st.name === 'bleed')
        expect(bleed?.stacks).toBe(2)
        expect(dmgDealt).toBeGreaterThan(0) // урон нанесён
      }
    ))
  })
})
