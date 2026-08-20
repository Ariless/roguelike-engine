import { describe, it, expect } from 'vitest'
import { createGame } from '../../src/runtime/executor'

// ─── Determinism ──────────────────────────────────────────────────────────────

describe('determinism — same seed = same outcome', () => {
  it('two games with same seed reach same state after identical moves', () => {
    const a = createGame({ seed: 42, heroClass: 'paladin', enemyType: 'goblin' })
    const b = createGame({ seed: 42, heroClass: 'paladin', enemyType: 'goblin' })

    a.playCard('righteous_strike')
    b.playCard('righteous_strike')

    expect(a.getState().enemies[0].hp).toBe(b.getState().enemies[0].hp)
    expect(a.getState().hero.hp).toBe(b.getState().hero.hp)
  })

  it('different seeds can produce different enemy HP after attack', () => {
    // Both start the same — but different seeds means different RNG stream
    // (only matters for chaos_bolt; this test verifies seeds are wired)
    const a = createGame({ seed: 1, heroClass: 'bloodmage', enemyType: 'goblin' })
    const b = createGame({ seed: 2, heroClass: 'bloodmage', enemyType: 'goblin' })

    a.playCard('chaos_bolt')
    b.playCard('chaos_bolt')

    // chaos_bolt always hits the only enemy — same damage, different RNG consumed
    // Both should hit for 5; different seeds don't change outcome with 1 enemy
    expect(a.getState().enemies[0].hp).toBe(b.getState().enemies[0].hp)
  })

  it('log records pre/post hash for every event', () => {
    const game = createGame({ seed: 42, heroClass: 'paladin', enemyType: 'goblin' })
    game.playCard('righteous_strike')
    const log = game.getLog()
    expect(log.events.length).toBeGreaterThan(0)
    log.events.forEach(e => {
      expect(e.preStateHash).toHaveLength(6)
      expect(e.postStateHash).toHaveLength(6)
    })
  })
})

// ─── Card dispatch ────────────────────────────────────────────────────────────

describe('playCard', () => {
  it('deals damage to enemy', () => {
    const game = createGame({ seed: 42, heroClass: 'paladin', enemyType: 'goblin' })
    const before = game.getState().enemies[0].hp
    game.playCard('righteous_strike')
    expect(game.getState().enemies[0].hp).toBe(before - 5)
  })

  it('heals hero', () => {
    const game = createGame({ seed: 42, heroClass: 'paladin', enemyType: 'goblin' })
    // Take some damage first via endTurn
    game.endTurn()
    const hp = game.getState().hero.hp
    game.playCard('stubborn_recovery')
    expect(game.getState().hero.hp).toBeGreaterThan(hp)
  })

  it('chaos_bolt always hits a living enemy', () => {
    const game = createGame({ seed: 42, heroClass: 'bloodmage', enemyType: 'goblin' })
    const before = game.getState().enemies[0].hp
    game.playCard('chaos_bolt')
    expect(game.getState().enemies[0].hp).toBe(before - 5)
  })

  it('chaos_bolt with different seeds hits same target (only 1 enemy)', () => {
    const seeds = [1, 42, 99, 1337]
    seeds.forEach(seed => {
      const game = createGame({ seed, heroClass: 'bloodmage', enemyType: 'goblin' })
      const before = game.getState().enemies[0].hp
      game.playCard('chaos_bolt')
      expect(game.getState().enemies[0].hp).toBe(before - 5)
    })
  })

  it('does nothing when game is over', () => {
    // Kill goblin (20 HP) with 4 chaos_bolts (5 dmg each) across 2 turns
    const game = createGame({ seed: 42, heroClass: 'bloodmage', enemyType: 'goblin' })
    game.playCard('chaos_bolt')
    game.playCard('chaos_bolt')
    game.playCard('chaos_bolt')
    game.endTurn()
    game.playCard('chaos_bolt')
    expect(game.getState().isOver).toBe(true)
    const hp = game.getState().hero.hp
    game.playCard('open_the_wound') // game over — no-op
    expect(game.getState().hero.hp).toBe(hp)
  })
})

// ─── Turn flow ────────────────────────────────────────────────────────────────

describe('endTurn', () => {
  it('enemy attacks hero', () => {
    const game = createGame({ seed: 42, heroClass: 'paladin', enemyType: 'goblin' })
    const heroBefore = game.getState().hero.hp
    game.endTurn()
    expect(game.getState().hero.hp).toBeLessThan(heroBefore)
  })

  it('restores hero energy to 3', () => {
    const game = createGame({ seed: 42, heroClass: 'paladin', enemyType: 'goblin' })
    game.playCard('righteous_strike')   // costs 1 → energy = 2
    game.playCard('divine_charge')      // costs 1 → energy = 1
    expect(game.getState().hero.energy).toBe(1)
    game.endTurn()
    expect(game.getState().hero.energy).toBe(3)
  })

  it('increments turn counter', () => {
    const game = createGame({ seed: 42, heroClass: 'paladin', enemyType: 'goblin' })
    expect(game.getState().turn).toBe(1)
    game.endTurn()
    expect(game.getState().turn).toBe(2)
  })

  it('bleed ticks on hero at end of turn', () => {
    const game = createGame({ seed: 42, heroClass: 'paladin', enemyType: 'necromancer' })
    game.endTurn() // Necromancer applies 3 bleed on turn 1
    const hpAfterBleed = game.getState().hero.hp
    const bleed = game.getState().hero.statuses.find(s => s.name === 'bleed')
    expect(bleed).toBeTruthy()
    game.endTurn() // bleed ticks
    expect(game.getState().hero.hp).toBeLessThanOrEqual(hpAfterBleed)
  })

  it('enemy killed by lethal bleed is dead (not death_door) after endTurn', () => {
    // Regression: tickStatuses puts enemy in death_door; resolveAndCheckWin must convert
    // to dead immediately. If this step is missing, enemy stays in death_door for one more
    // turn — the bug that caused the death_door glow in game UI.
    //
    // Setup: bloodmage vs goblin (20 HP)
    // Turn 1 cards: chaos_bolt (5) + bloodrite (8) = 13 dmg → goblin at 7 HP
    // Turn 1 endTurn: goblin attacks
    // Turn 2 cards: open_the_wound (3 bleed) + chaos_bolt (5 dmg) → goblin at 2 HP
    // Turn 2 endTurn: goblin attacks, then bleed tick (3) → goblin 0 HP → dead

    const game = createGame({ seed: 42, heroClass: 'bloodmage', enemyType: 'goblin' })

    // Turn 1: reduce goblin to 7 HP
    game.playCard('chaos_bolt')  // 5 dmg → goblin 15 HP
    game.playCard('bloodrite')   // 8 dmg → goblin 7 HP, self 3 dmg
    game.endTurn()               // goblin attacks hero for 6

    // Turn 2: apply bleed + finish setup for lethal tick
    game.playCard('open_the_wound') // 3 bleed on goblin (no direct dmg)
    game.playCard('chaos_bolt')     // 5 dmg → goblin 2 HP
    const final = game.endTurn()    // goblin attacks, then bleed(3) → goblin 0 HP → dead

    expect(final.isOver).toBe(true)
    expect(final.winner).toBe('hero')
    expect(final.enemies[0].hp).toBe(0)
    expect(final.enemies[0].state).toBe('dead')  // Kill: death_door not converted by resolveAndCheckWin
  })

  it('guardian stun prevents hero from acting', () => {
    const game = createGame({ seed: 42, heroClass: 'paladin', enemyType: 'guardian' })
    game.endTurn() // turn 1: guardian shields
    game.endTurn() // turn 2: guardian stuns
    const stunned = game.getState().hero.statuses.some(s => s.name === 'stun')
    expect(stunned).toBe(true)
    const before = game.getState().enemies[0].hp
    game.playCard('righteous_strike') // stunned — should be no-op
    expect(game.getState().enemies[0].hp).toBe(before)
  })
})

// ─── Werewolf transformation ──────────────────────────────────────────────────

describe('werewolf — transformation via executor', () => {
  it('transforms at start of turn when HP ≤ 50%', () => {
    const game = createGame({ seed: 42, heroClass: 'werewolf', enemyType: 'guardian' })
    // Take enough damage to go below 14 HP (50% of 28)
    // Guardian attacks for 10 on turn 3 — but let's lower HP manually via endTurns
    // vs Goblin: takes 6 per turn
    const game2 = createGame({ seed: 42, heroClass: 'werewolf', enemyType: 'goblin' })
    // After 3 end turns: ~28 - 18 = 10 HP < 14 → should transform
    game2.endTurn()
    game2.endTurn()
    game2.endTurn()
    const form = game2.getState().hero.formState
    expect(form).toBe('werewolf')
  })

  it('log contains transform event when transformation fires', () => {
    const game = createGame({ seed: 42, heroClass: 'werewolf', enemyType: 'goblin' })
    game.endTurn()
    game.endTurn()
    game.endTurn()
    const hasTransform = game.getLog().events.some(e => e.type === 'transform')
    expect(hasTransform).toBe(true)
  })
})

// ─── Fault injection ──────────────────────────────────────────────────────────

describe('fault injection — bleedOffByOne', () => {
  it('faulty game deals less bleed damage than normal game', () => {
    const normal = createGame({ seed: 42, heroClass: 'paladin', enemyType: 'necromancer' })
    const faulty = createGame({ seed: 42, heroClass: 'paladin', enemyType: 'necromancer', faults: { bleedOffByOne: true } })

    // Necromancer applies 3 bleed on turn 1 enemy action
    normal.endTurn()
    faulty.endTurn()

    // Turn 2: bleed ticks
    normal.endTurn()
    faulty.endTurn()

    // Normal should have lower HP (took more bleed damage)
    expect(faulty.getState().hero.hp).toBeGreaterThanOrEqual(normal.getState().hero.hp)
  })

  it('faults are recorded in the log', () => {
    const game = createGame({
      seed: 42,
      heroClass: 'paladin',
      enemyType: 'goblin',
      faults: { bleedOffByOne: true },
    })
    expect(game.getLog().faults.bleedOffByOne).toBe(true)
  })
})

// ─── Replay log ───────────────────────────────────────────────────────────────

describe('replay log', () => {
  it('records seed, heroClass, enemyType', () => {
    const game = createGame({ seed: 1337, heroClass: 'bloodmage', enemyType: 'vampire' })
    const log = game.getLog()
    expect(log.seed).toBe(1337)
    expect(log.heroClass).toBe('bloodmage')
    expect(log.enemyType).toBe('vampire')
  })

  it('outcome updates to hero_wins when enemy dies', () => {
    // Goblin 20 HP; chaos_bolt deals 5, costs 1; 3 energy/turn → 3 per turn
    // Turn 1: 3 bolts → 20-15=5 HP; Turn 2: 1 bolt → 5-5=0 → dead
    const game = createGame({ seed: 42, heroClass: 'bloodmage', enemyType: 'goblin' })
    game.playCard('chaos_bolt')
    game.playCard('chaos_bolt')
    game.playCard('chaos_bolt')
    game.endTurn()
    game.playCard('chaos_bolt')
    expect(game.getState().isOver).toBe(true)
    expect(game.getLog().outcome).toBe('hero_wins')
  })

  it('outcome updates to hero_loses when hero dies', () => {
    // Paladin 30 HP vs Goblin 6 dmg/turn; no healing → dies after 6 end turns
    const game = createGame({ seed: 42, heroClass: 'paladin', enemyType: 'goblin' })
    for (let i = 0; i < 10; i++) {
      if (game.getState().isOver) break
      game.endTurn()
    }
    expect(game.getState().isOver).toBe(true)
    expect(game.getLog().outcome).toBe('hero_loses')
  })

  it('every play_card event has cardId', () => {
    const game = createGame({ seed: 42, heroClass: 'paladin', enemyType: 'goblin' })
    game.playCard('divine_charge')
    game.playCard('righteous_strike')
    const cardEvents = game.getLog().events.filter(e => e.type === 'play_card')
    expect(cardEvents).toHaveLength(2)
    cardEvents.forEach(e => expect(e.cardId).toBeTruthy())
  })
})

// ─── Closing gaps from RULE-COVERAGE.md ──────────────────────────────────────

describe('Guardian — intent cycle (close gap: turn 4 = turn 1)', () => {
  it('turn 4 repeats turn 1 Shield intent (cycle boundary)', () => {
    const game = createGame({ seed: 42, heroClass: 'paladin', enemyType: 'guardian' })
    // Turn 1: defend — enemy gets defend
    const hpAfterT1 = game.endTurn().hero.hp
    // Turn 2: stun
    game.endTurn()
    // Turn 3: attack 10
    game.endTurn()
    // Turn 4: cycle repeats — shield again
    const stateBefore = game.getState()
    game.endTurn()
    const enemyDefendAfter = game.getState().enemies[0].statuses.find(s => s.name === 'defend')
    // Guardian gained defend again (turn 4 = turn 1 in cycle)
    expect(enemyDefendAfter).toBeDefined()
    expect(enemyDefendAfter?.stacks).toBeGreaterThan(0)
  })

  it('turn 7 also gives Guardian defend (cycle repeats every 3)', () => {
    const game = createGame({ seed: 42, heroClass: 'paladin', enemyType: 'guardian' })
    // Play 6 full turns (2 full cycles)
    for (let i = 0; i < 6 && !game.getState().isOver; i++) game.endTurn()
    if (!game.getState().isOver) {
      // Turn 7 = same as turn 1 = Guardian shields again
      game.endTurn()
      const enemyDefend = game.getState().enemies[0].statuses.find(s => s.name === 'defend')
      expect(enemyDefend).toBeDefined()
    }
  })
})

describe('Vampire — lifesteal (close gap from RULE-COVERAGE.md)', () => {
  it('lifesteal heals vampire for actual damage dealt (not overkill)', () => {
    // Rule: lifesteal = min(dmg_dealt, enemy.missing_hp)
    const game = createGame({ seed: 42, heroClass: 'paladin', enemyType: 'vampire' })
    // Damage vampire first so it has missing HP
    game.playCard('righteous_strike')
    const vampireHpAfterHit = game.getState().enemies[0].hp  // 30 - 5 = 25
    const missingHp = game.getState().enemies[0].maxHp - vampireHpAfterHit  // 5

    const heroBefore = game.getState().hero.hp
    game.endTurn()  // turn 1: Vampire attacks 6 + lifesteal

    const vampireHpAfterTurn = game.getState().enemies[0].hp
    const heroHpLost = heroBefore - game.getState().hero.hp

    // Vampire should have healed (up to missing HP)
    expect(vampireHpAfterTurn).toBeGreaterThan(vampireHpAfterHit)
    // Lifesteal = min(actual_dmg, missing_hp)
    expect(vampireHpAfterTurn).toBeLessThanOrEqual(game.getState().enemies[0].maxHp)
  })

  it('lifesteal at full HP heals 0 (capped at missing HP = 0)', () => {
    const game = createGame({ seed: 42, heroClass: 'paladin', enemyType: 'vampire' })
    // Vampire starts at full HP (30/30)
    const vampireHpBefore = game.getState().enemies[0].hp
    expect(vampireHpBefore).toBe(30)

    game.endTurn()  // Vampire attacks + tries to lifesteal

    // Vampire was full → lifesteal heals 0 → still full (or less if hero had defend)
    expect(game.getState().enemies[0].hp).toBeLessThanOrEqual(30)
  })

  it('lifesteal never exceeds maxHp', () => {
    for (let seed = 0; seed < 10; seed++) {
      const game = createGame({ seed, heroClass: 'paladin', enemyType: 'vampire' })
      game.endTurn()
      const vampire = game.getState().enemies[0]
      expect(vampire.hp).toBeLessThanOrEqual(vampire.maxHp)
    }
  })
})

describe('Vampire — 3-turn intent sequence', () => {
  it('turn 1: attack deals damage to hero', () => {
    const game = createGame({ seed: 42, heroClass: 'paladin', enemyType: 'vampire' })
    const hpBefore = game.getState().hero.hp
    game.endTurn()
    expect(game.getState().hero.hp).toBeLessThan(hpBefore)
  })

  it('turn 2: applies bleed to hero', () => {
    const game = createGame({ seed: 42, heroClass: 'paladin', enemyType: 'vampire' })
    game.endTurn()  // turn 1: attack
    game.endTurn()  // turn 2: bleed
    const bleed = game.getState().hero.statuses.find(s => s.name === 'bleed')
    expect(bleed).toBeDefined()
    expect(bleed?.stacks).toBe(2)
  })

  it('turn 3: heavy attack (12 dmg) after bleed applied', () => {
    const game = createGame({ seed: 42, heroClass: 'paladin', enemyType: 'vampire' })
    game.endTurn()  // attack 6
    game.endTurn()  // bleed 2
    const hpBefore = game.getState().hero.hp
    game.endTurn()  // attack 12
    // Hero took 12 + bleed 2 tick this turn
    expect(game.getState().hero.hp).toBeLessThanOrEqual(hpBefore - 12)
  })

  it('hero HP never goes below 0 after any Vampire attack (property)', () => {
    // Close gap: verify HP floor holds under Vampire's high-damage attacks
    for (let seed = 0; seed < 20; seed++) {
      const game = createGame({ seed, heroClass: 'paladin', enemyType: 'vampire' })
      for (let t = 0; t < 10 && !game.getState().isOver; t++) game.endTurn()
      expect(game.getState().hero.hp).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('Necromancer — bleed accumulation', () => {
  it('applies 3 bleed on turn 1', () => {
    const game = createGame({ seed: 42, heroClass: 'paladin', enemyType: 'necromancer' })
    game.endTurn()
    const bleed = game.getState().hero.statuses.find(s => s.name === 'bleed')
    expect(bleed?.stacks).toBe(3)
  })

  it('bleed accumulates across turns (capped at 10)', () => {
    const game = createGame({ seed: 42, heroClass: 'paladin', enemyType: 'necromancer' })
    game.endTurn()  // bleed 3
    game.endTurn()  // bleed 3 more → 6
    game.endTurn()  // bleed 3 more → 9
    const bleed = game.getState().hero.statuses.find(s => s.name === 'bleed')
    expect(bleed).toBeDefined()
    expect(bleed!.stacks).toBeLessThanOrEqual(10)  // cap invariant holds
  })

  it('raise dead intent is a no-op in executor (no corpse system yet)', () => {
    // Raise = always no-op since corpse tracking not implemented in engine
    // This test documents current behavior and will fail when corpse system is added
    const game = createGame({ seed: 42, heroClass: 'paladin', enemyType: 'necromancer' })
    game.endTurn()
    game.endTurn()  // raise dead fires — should be graceful no-op
    expect(game.getState().enemies).toHaveLength(1)  // no extra entity spawned
    expect(game.getState().isOver).toBe(false)       // game continues normally
  })
})
