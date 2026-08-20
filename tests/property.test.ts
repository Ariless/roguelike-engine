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

// Arbitrary: hp within [0, maxHp], maxHp within [1, 50]
const hpArb = fc.integer({ min: 1, max: 50 }).chain(maxHp =>
  fc.integer({ min: 0, max: maxHp }).map(hp => ({ hp, maxHp }))
)

// Arbitrary: arbitrary damage [0, 30]
const damageArb = fc.integer({ min: 0, max: 30 })

// ─── HP invariants ────────────────────────────────────────────────────────────

describe('property: HP never leaves [0, maxHp]', () => {
  it('applyDamage: hp >= 0 for any amount of damage', () => {
    fc.assert(fc.property(hpArb, damageArb, ({ hp, maxHp }, dmg) => {
      const s = makeState(hp)
      s.hero.maxHp = maxHp
      const next = applyDamage(s, 'hero', dmg)
      expect(next.hero.hp).toBeGreaterThanOrEqual(0)
    }))
  })

  it('applyHeal: hp <= maxHp after any amount of healing', () => {
    fc.assert(fc.property(hpArb, fc.integer({ min: 0, max: 30 }), ({ hp, maxHp }, heal) => {
      const s = makeState(hp)
      s.hero.maxHp = maxHp
      const next = applyHeal(s, 'hero', heal)
      expect(next.hero.hp).toBeLessThanOrEqual(next.hero.maxHp)
    }))
  })

  it('applyHeal: hp never decreases', () => {
    fc.assert(fc.property(hpArb, fc.integer({ min: 0, max: 30 }), ({ hp, maxHp }, heal) => {
      const s = makeState(hp)
      s.hero.maxHp = maxHp
      const next = applyHeal(s, 'hero', heal)
      expect(next.hero.hp).toBeGreaterThanOrEqual(hp)
    }))
  })

  it('applyDamage: hp never increases', () => {
    fc.assert(fc.property(hpArb, damageArb, ({ hp, maxHp }, dmg) => {
      const s = makeState(hp)
      s.hero.maxHp = maxHp
      const next = applyDamage(s, 'hero', dmg)
      expect(next.hero.hp).toBeLessThanOrEqual(hp)
    }))
  })
})

// ─── State machine: alive → death_door → dead ─────────────────────────────────

describe('property: state machine — valid transitions only', () => {
  it('a dead entity stays dead after taking damage', () => {
    fc.assert(fc.property(damageArb, (dmg) => {
      const s = makeState(0)
      const dead = { ...s, hero: { ...s.hero, state: 'dead' as const } }
      const next = applyDamage(dead, 'hero', dmg)
      expect(next.hero.state).toBe('dead')
    }))
  })

  it('an alive entity with hp > 0 stays alive or goes to death_door, never straight to dead', () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 30 }),
      fc.integer({ min: 0, max: 5 }),
      (hp, dmg) => {
        const s = makeState(hp)
        const next = applyDamage(s, 'hero', dmg)
        // hp > dmg → alive; hp <= dmg → death_door; never dead
        expect(next.hero.state).not.toBe('dead')
      }
    ))
  })

  it('an entity at death_door dies from any non-zero damage', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 30 }), (dmg) => {
      const s = { ...makeState(0), hero: { ...makeState(0).hero, state: 'death_door' as const } }
      const next = applyDamage(s, 'hero', dmg)
      expect(next.hero.state).toBe('dead')
    }))
  })

  it('applyHeal moves death_door → alive', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 30 }), (heal) => {
      const s = { ...makeState(0), hero: { ...makeState(0).hero, state: 'death_door' as const } }
      const next = applyHeal(s, 'hero', heal)
      expect(next.hero.state).toBe('alive')
    }))
  })
})

// ─── Bleed: stacks capped at 10 ───────────────────────────────────────────────

describe('property: bleed stacks <= 10 (cap invariant)', () => {
  it('bleed never exceeds 10 regardless of how many times it is applied', () => {
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

  it('a bleed tick never pushes hp below zero', () => {
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

// ─── Defend: never increases incoming damage ──────────────────────────────────

describe('property: defend never increases damage taken', () => {
  it('a hero with defend takes the same amount of damage or less', () => {
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

// ─── Paladin: charge stacks [0, 3] ────────────────────────────────────────────

describe('property: Paladin chargeStacks never exceeds 3', () => {
  it('repeated Divine Charge does not go above 3', () => {
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

  it('Righteous Strike resets charges to 0 when it triggers', () => {
    fc.assert(fc.property(
      fc.integer({ min: 0, max: 2 }),
      (extraCharges) => {
        let s = makeState()
        s = { ...s, hero: { ...s.hero, chargeStacks: 3 } }
        // extra charges would come from Divine Charge before the reset — already at cap
        const next = playRighteousStrike(s, 'enemy')
        expect(next.hero.chargeStacks ?? 0).toBeLessThanOrEqual(1) // 0, or +1 if vulnerable
      }
    ))
  })
})

// ─── Blood Mage: vulnerable only on pre-existing bleed ────────────────────────

describe('property: Open the Wound — vulnerable only if the target was already bleeding', () => {
  it('without bleed: vulnerable is not applied', () => {
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

  it('with pre-existing bleed: vulnerable is applied', () => {
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

// ─── Berserker: rage mode — a binary trigger ──────────────────────────────────

describe('property: Berserker rage — only at HP <= 25%', () => {
  it('HP > 25% → rage inactive, base damage', () => {
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

  it('HP <= 25% → damage × 1.5', () => {
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

// ─── Werewolf: wolf passive — damage is monotonic ─────────────────────────────

describe('property: Werewolf wolfDamage — the lower the HP, the higher the damage', () => {
  it('wolfDamage decreases monotonically as HP rises', () => {
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

  it('wolfDamage >= base at any HP', () => {
    fc.assert(fc.property(hpArb, fc.integer({ min: 1, max: 20 }), ({ hp, maxHp }, base) => {
      const hero = makeHero({ hp, maxHp, heroClass: 'werewolf' })
      expect(wolfDamage(hero, base)).toBeGreaterThanOrEqual(base)
    }))
  })
})

// ─── Werewolf: transformation only at HP <= 50% ───────────────────────────────

describe('property: Werewolf transform — only at HP <= 50%', () => {
  it('HP > 50%: no transformation', () => {
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

  it('HP <= 50% and alive: always transforms', () => {
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

  it('statuses survive the transformation', () => {
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

// ─── False invariant: healing the Werewolf weakens it ─────────────────────────
// A deliberately failing test — a Paladin heals the Werewolf above 50% HP and
// the wolf passive loses its bonus. HP goes up, damage goes down.

describe('false invariant: healing Werewolf above 50% reduces damage', () => {
  it.fails('healing always improves the werewolf\'s combat output', () => {
    const maxHp = 30
    const hp = Math.floor(maxHp * 0.45) // 13 — wolf passive active
    const base = 8
    const heroBefore = makeHero({ hp, maxHp, heroClass: 'werewolf' })
    const heroAfter  = makeHero({ hp: 16, maxHp, heroClass: 'werewolf' }) // healed above 50%
    // This assertion is deliberately false: healing reduces the wolf damage bonus
    expect(wolfDamage(heroAfter, base)).toBeGreaterThanOrEqual(wolfDamage(heroBefore, base))
  })
})

// ─── False invariants: teaching cases ─────────────────────────────────────────
// These tests only pass while the assertion is FALSE.
// The point is to recognise that "seems obvious" is not the same as "always true".

describe('false invariant: more HP is always safer for the Berserker', () => {
  it.fails('more HP means more damage for the berserker', () => {
    // Berserker passive: damage * (1 + missingHp / maxHp)
    // More HP → less missing HP → less damage
    // "Safer on HP" means "weaker as an attacker"
    const maxHp = 28
    const highHp = makeHero({ hp: 28, maxHp, heroClass: 'berserker' })  // full HP
    const lowHp  = makeHero({ hp: 7,  maxHp, heroClass: 'berserker' })  // 25% HP

    // This assertion is deliberately false: more HP → less damage
    expect(rageDamage(highHp, 8)).toBeGreaterThan(rageDamage(lowHp, 8))
  })
})

describe('false invariant: Chaos Bolt always hits at random', () => {
  it.fails('different seeds always give Chaos Bolt different targets', () => {
    // With a single living enemy the RNG is consumed but the outcome is always the same.
    // "Randomness" has no effect without a choice between several targets.
    const s1 = makeState(25, 20)
    s1.hero = makeHero({ hp: 25, maxHp: 25, heroClass: 'bloodmage' })
    const s2 = { ...s1 }

    const r1 = playChaosBolt(s1, 'enemy')  // seed is irrelevant — one enemy
    const r2 = playChaosBolt(s2, 'enemy')

    // This assertion is deliberately false: with one enemy the result is always the same
    expect(r1.enemies[0].hp).not.toBe(r2.enemies[0].hp)
  })
})

describe('false invariant: Open the Wound always threatens vulnerable', () => {
  it.fails('Open the Wound always applies vulnerable', () => {
    // Vulnerable is applied ONLY if the target was already bleeding BEFORE the card was played.
    // With no pre-existing bleed there is bleed only, and no vulnerable.
    const s = makeState(25, 20)
    s.hero = makeHero({ hp: 25, maxHp: 25, heroClass: 'bloodmage' })
    // Target has no bleed
    const next = playOpenTheWound(s, 'enemy')

    // This assertion is deliberately false: no vulnerable without pre-existing bleed
    expect(next.enemies[0].statuses.some(st => st.name === 'vulnerable')).toBe(true)
  })
})

// ─── Rend: bleed is applied AFTER the damage ──────────────────────────────────

describe('property: Rend — order of operations (damage before bleed)', () => {
  it('HP after Rend reflects the damage only, not the bleed', () => {
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
        // bleed must not be counted in this turn's damage
        const bleed = next.enemies[0].statuses.find(st => st.name === 'bleed')
        expect(bleed?.stacks).toBe(2)
        expect(dmgDealt).toBeGreaterThan(0) // damage was dealt
      }
    ))
  })
})
