// The stat tables, the spawn sites and the log detail that executor.ts owns.
//
// executor.test.ts drives behaviour — damage lands, turns advance, faults bite.
// None of it reads the tables the executor builds a game FROM, so a mutant could
// empty every hero name, blank every starting hand, or hand out the wrong enemy id
// and the whole suite stayed green. These tests assert the tables themselves.
import { describe, it, expect } from 'vitest'
import { createGame } from '../../src/runtime/executor'
import type { EnemyType, HeroClass } from '../../src/engine/types'

describe('HERO_STATS — each class is built from its own row', () => {
  // Kill: StringLiteral "" on every name/card, ArrayDeclaration [] on every hand.
  // Nothing asserted a starting hand before, so blanking one changed no test.
  const rows: Array<{ heroClass: HeroClass; name: string; hp: number; hand: string[] }> = [
    { heroClass: 'paladin', name: 'Paladin', hp: 30, hand: ['righteous_strike', 'stubborn_recovery', 'divine_charge'] },
    { heroClass: 'bloodmage', name: 'Blood Mage', hp: 25, hand: ['open_the_wound', 'bloodrite', 'chaos_bolt'] },
    { heroClass: 'berserker', name: 'Berserker', hp: 28, hand: ['savage_lunge', 'primal_fury', 'primal_dodge'] },
    { heroClass: 'werewolf', name: 'Werewolf', hp: 28, hand: ['lunar_strike', 'pack_sense', 'stalk'] },
  ]

  for (const row of rows) {
    it(`${row.heroClass} starts as ${row.name} with ${row.hp} HP and its own three cards`, () => {
      const hero = createGame({ seed: 1, heroClass: row.heroClass, enemyType: 'goblin' }).getState().hero

      expect(hero.name).toBe(row.name)
      expect(hero.hp).toBe(row.hp)
      expect(hero.maxHp).toBe(row.hp)
      expect(hero.hand).toEqual(row.hand)
      expect(hero.heroClass).toBe(row.heroClass)
    })
  }

  it('every class starts alive, in human form, with 3 energy and no statuses', () => {
    for (const row of rows) {
      const hero = createGame({ seed: 7, heroClass: row.heroClass, enemyType: 'goblin' }).getState().hero

      expect(hero.state).toBe('alive')
      expect(hero.formState).toBe('human')
      expect(hero.energy).toBe(3)
      expect(hero.statuses).toEqual([])
      expect(hero.row).toBe('front')
    }
  })

  // Kill: ObjectLiteral {} and EqualityOperator on the three conditional spreads —
  // the class-specific counters are only ever read after they have been changed.
  it('class counters are seeded only for the class that owns them', () => {
    const paladin = createGame({ seed: 1, heroClass: 'paladin', enemyType: 'goblin' }).getState().hero
    expect(paladin.chargeStacks).toBe(0)
    expect(paladin.rageStacks).toBeUndefined()
    expect(paladin.werewolfTurnsLeft).toBeUndefined()

    const berserker = createGame({ seed: 1, heroClass: 'berserker', enemyType: 'goblin' }).getState().hero
    expect(berserker.rageStacks).toBe(0)
    expect(berserker.chargeStacks).toBeUndefined()
    expect(berserker.werewolfTurnsLeft).toBeUndefined()

    const werewolf = createGame({ seed: 1, heroClass: 'werewolf', enemyType: 'goblin' }).getState().hero
    expect(werewolf.werewolfTurnsLeft).toBe(0)
    expect(werewolf.chargeStacks).toBeUndefined()
    expect(werewolf.rageStacks).toBeUndefined()
  })
})

describe('ENEMY_STATS — each encounter type spawns from its own row', () => {
  // Kill: StringLiteral "" on every enemy name and the hp values behind them.
  const rows: Array<{ enemyType: EnemyType; name: string; hp: number }> = [
    { enemyType: 'goblin', name: 'Goblin', hp: 20 },
    { enemyType: 'guardian', name: 'Guardian', hp: 35 },
    { enemyType: 'vampire', name: 'Vampire', hp: 30 },
  ]

  for (const row of rows) {
    it(`${row.enemyType} spawns as ${row.name} with ${row.hp} HP under the id "enemy"`, () => {
      const enemies = createGame({ seed: 3, heroClass: 'paladin', enemyType: row.enemyType }).getState().enemies

      expect(enemies).toHaveLength(1)
      expect(enemies[0].id).toBe('enemy')
      expect(enemies[0].name).toBe(row.name)
      expect(enemies[0].hp).toBe(row.hp)
      expect(enemies[0].maxHp).toBe(row.hp)
      expect(enemies[0].enemyType).toBe(row.enemyType)
      expect(enemies[0].state).toBe('alive')
    })
  }

  // Kill: the necromancer branch of makeEncounter — StringLiteral on 'e0'/'e1'
  // and the goblin escort itself. The escort is the body BUG-14 measured.
  it('necromancer arrives with a goblin escort, not alone', () => {
    const enemies = createGame({ seed: 3, heroClass: 'paladin', enemyType: 'necromancer' }).getState().enemies

    expect(enemies).toHaveLength(2)
    expect(enemies[0].id).toBe('e0')
    expect(enemies[0].enemyType).toBe('goblin')
    expect(enemies[0].name).toBe('Goblin')
    expect(enemies[1].id).toBe('e1')
    expect(enemies[1].enemyType).toBe('necromancer')
    expect(enemies[1].name).toBe('Necromancer')
    expect(enemies[1].hp).toBe(25)
  })

  it('every enemy starts with the first intent of its own table', () => {
    const goblin = createGame({ seed: 3, heroClass: 'paladin', enemyType: 'goblin' }).getState().enemies[0]
    expect(goblin.intent).toEqual({ type: 'attack', value: 6 })

    const necro = createGame({ seed: 3, heroClass: 'paladin', enemyType: 'necromancer' }).getState().enemies[1]
    expect(necro.intent).toEqual({ type: 'bleed', value: 3 })
  })
})

describe('win check reads every enemy, not any enemy', () => {
  // Kill: MethodExpression every → some in checkWin. With an escort on the field
  // that swap ends the battle the moment the goblin dies, while the necromancer
  // is still standing. Single-enemy encounters cannot tell the two apart.
  it('killing the escort does not end a battle the necromancer is still in', () => {
    const game = createGame({ seed: 11, heroClass: 'paladin', enemyType: 'necromancer' })

    // Goblin has 20 HP; Righteous Strike deals 5 and costs 1 of 3 energy per turn.
    for (let turn = 0; turn < 3; turn++) {
      for (let card = 0; card < 3; card++) {
        if (game.getState().enemies[0].state === 'dead') break
        game.playCard('righteous_strike', 'e0')
      }
      if (game.getState().enemies[0].state === 'dead') break
      game.endTurn()
    }

    const state = game.getState()
    expect(state.enemies[0].state).toBe('dead')
    expect(state.enemies[1].state).toBe('alive')
    expect(state.isOver).toBe(false)
    expect(state.winner).toBeUndefined()
  })
})

describe('Raise Dead — the skeleton the executor spawns', () => {
  /** Plays until the necromancer has raised a skeleton, or gives up. */
  function raiseSkeleton(seed: number) {
    const game = createGame({ seed, heroClass: 'paladin', enemyType: 'necromancer' })

    for (let turn = 0; turn < 8; turn++) {
      for (let card = 0; card < 3; card++) {
        if (game.getState().enemies[0].state === 'dead') break
        game.playCard('righteous_strike', 'e0')
      }
      game.endTurn()
      if (game.getState().enemies.some(e => e.enemyType === 'skeleton')) break
    }

    return game
  }

  // Kill: StringLiteral "" on the `skeleton-${n}` id and on the skeleton's own
  // stat row — nothing had ever read a raised skeleton through the executor.
  it('raises a skeleton with a deterministic id and its own stat row', () => {
    const skeleton = raiseSkeleton(11).getState().enemies.find(e => e.enemyType === 'skeleton')

    expect(skeleton).toBeDefined()
    expect(skeleton!.id).toBe('skeleton-1')
    expect(skeleton!.name).toBe('Skeleton')
    expect(skeleton!.hp).toBe(8)
    expect(skeleton!.maxHp).toBe(8)
    expect(skeleton!.state).toBe('alive')
  })

  // BUG-22 — currently false. The skeleton is spawned with SKELETON_INTENT, and the
  // "Advance turn" block then overwrites the intent of every enemy on the field with
  // the encounter type's row. The skeleton is the one enemy that executes its stored
  // intent rather than resolving its own type (executor.ts:508), so it never performs
  // the attack it was spawned with. Fix the overwrite and this test starts passing —
  // it.fails will then fail, which is the signal to promote it to a plain `it`.
  it.fails('the raised skeleton carries its own attack intent', () => {
    const skeleton = raiseSkeleton(11).getState().enemies.find(e => e.enemyType === 'skeleton')

    expect(skeleton!.intent).toEqual({ type: 'attack', value: 4 })
  })

  // The same defect from the other side: today the skeleton, the necromancer and the
  // goblin corpse all hold one identical intent object copied from the encounter row.
  it.fails('the skeleton does not share the encounter row with the corpse beside it', () => {
    const enemies = raiseSkeleton(11).getState().enemies
    const skeleton = enemies.find(e => e.enemyType === 'skeleton')!
    const corpse = enemies.find(e => e.enemyType === 'goblin')!

    expect(skeleton.intent).not.toEqual(corpse.intent)
  })

  // Kill: EqualityOperator/BooleanLiteral on `raisedOnce !== true` — the flag that
  // stops one body from supplying skeletons forever.
  it('a corpse is consumed by the raise that used it', () => {
    const game = raiseSkeleton(11)
    const corpse = game.getState().enemies.find(e => e.state === 'dead' && e.enemyType === 'goblin')

    expect(corpse).toBeDefined()
    expect(corpse!.raisedOnce).toBe(true)

    // Keep playing: the same body must not produce a second skeleton.
    for (let turn = 0; turn < 6; turn++) game.endTurn()

    const skeletons = game.getState().enemies.filter(e => e.enemyType === 'skeleton')
    const ids = skeletons.map(s => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(skeletons.filter(s => s.id === 'skeleton-1')).toHaveLength(1)
  })
})

describe('transform — the hand swaps with the form', () => {
  // Kill: ArrayDeclaration []/StringLiteral "" on the wolf hand and the
  // ConditionalExpression choosing between the two hands. The existing transform
  // tests assert formState and the log event, never the cards in hand.
  it('turning wolf replaces the human hand with the wolf hand', () => {
    const game = createGame({ seed: 42, heroClass: 'werewolf', enemyType: 'goblin' })
    expect(game.getState().hero.hand).toEqual(['lunar_strike', 'pack_sense', 'stalk'])

    game.endTurn()
    game.endTurn()
    game.endTurn()

    const hero = game.getState().hero
    expect(hero.formState).toBe('werewolf')
    expect(hero.hand).toEqual(['rend', 'rampage', 'reality_crack'])
  })
})
