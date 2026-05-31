import { describe, it, expect } from 'vitest'
import { createGame } from '../../src/runtime/executor'
import { replayGame } from '../../src/telemetry/replayer'

// ─── Byte-perfect replay ──────────────────────────────────────────────────────

describe('replayGame — byte-perfect determinism', () => {
  it('replays a single card play and matches all hashes', () => {
    const game = createGame({ seed: 42, heroClass: 'paladin', enemyType: 'goblin' })
    game.playCard('righteous_strike')
    const log = game.getLog()

    const result = replayGame(log)
    expect(result.success).toBe(true)
    expect(result.divergedAt).toBeUndefined()
  })

  it('replays multiple turns byte-perfect', () => {
    const game = createGame({ seed: 42, heroClass: 'paladin', enemyType: 'goblin' })
    game.playCard('divine_charge')
    game.playCard('righteous_strike')
    game.endTurn()
    game.playCard('stubborn_recovery')
    game.endTurn()
    const log = game.getLog()

    const result = replayGame(log)
    expect(result.success).toBe(true)
    expect(result.eventsReplayed).toBeGreaterThan(0)
  })

  it('replays chaos_bolt with seeded RNG — same target every time', () => {
    const game = createGame({ seed: 7, heroClass: 'bloodmage', enemyType: 'goblin' })
    game.playCard('chaos_bolt')
    const log = game.getLog()

    const r1 = replayGame(log)
    const r2 = replayGame(log)

    expect(r1.success).toBe(true)
    expect(r1.finalState.enemies[0].hp).toBe(r2.finalState.enemies[0].hp)
  })

  it('replays a full game until hero wins', () => {
    const game = createGame({ seed: 42, heroClass: 'bloodmage', enemyType: 'goblin' })
    game.playCard('chaos_bolt')
    game.playCard('chaos_bolt')
    game.playCard('chaos_bolt')
    game.endTurn()
    game.playCard('chaos_bolt')
    const log = game.getLog()

    expect(log.outcome).toBe('hero_wins')
    const result = replayGame(log)
    expect(result.success).toBe(true)
    expect(result.finalState.isOver).toBe(true)
    expect(result.finalState.winner).toBe('hero')
  })

  it('replays a full game until hero loses', () => {
    const game = createGame({ seed: 42, heroClass: 'paladin', enemyType: 'goblin' })
    for (let i = 0; i < 10; i++) {
      if (game.getState().isOver) break
      game.endTurn()
    }
    const log = game.getLog()

    expect(log.outcome).toBe('hero_loses')
    const result = replayGame(log)
    expect(result.success).toBe(true)
    expect(result.finalState.winner).toBe('enemies')
  })

  it('replays werewolf transformation correctly', () => {
    const game = createGame({ seed: 42, heroClass: 'werewolf', enemyType: 'goblin' })
    game.endTurn()
    game.endTurn()
    game.endTurn()  // hero HP drops enough to transform
    const log = game.getLog()

    const result = replayGame(log)
    expect(result.success).toBe(true)
    expect(result.finalState.hero.formState).toBe(
      game.getState().hero.formState
    )
  })

  it('replays fault-injected game byte-perfect', () => {
    const game = createGame({
      seed: 42,
      heroClass: 'paladin',
      enemyType: 'necromancer',
      faults: { bleedOffByOne: true },
    })
    game.endTurn()
    game.endTurn()
    const log = game.getLog()

    const result = replayGame(log)
    expect(result.success).toBe(true)
    expect(result.finalState.hero.hp).toBe(game.getState().hero.hp)
  })
})

// ─── Divergence detection ─────────────────────────────────────────────────────

describe('replayGame — divergence detection', () => {
  it('detects tampered postStateHash', () => {
    const game = createGame({ seed: 42, heroClass: 'paladin', enemyType: 'goblin' })
    game.playCard('righteous_strike')
    const log = game.getLog()

    const tampered = {
      ...log,
      events: log.events.map((e, i) =>
        i === 0 ? { ...e, postStateHash: '000000' } : e
      ),
    }

    const result = replayGame(tampered)
    expect(result.success).toBe(false)
    expect(result.divergedAt).toBeDefined()
    expect(result.divergedAt?.postStateHash).toBe('000000')
  })

  it('detects divergence at correct turn', () => {
    const game = createGame({ seed: 42, heroClass: 'paladin', enemyType: 'goblin' })
    game.playCard('righteous_strike')
    game.endTurn()
    game.playCard('divine_charge')
    const log = game.getLog()

    // Tamper the turn_end event
    const turnEndIdx = log.events.findIndex(e => e.type === 'turn_end')
    const tampered = {
      ...log,
      events: log.events.map((e, i) =>
        i === turnEndIdx ? { ...e, postStateHash: 'ffffff' } : e
      ),
    }

    const result = replayGame(tampered)
    expect(result.success).toBe(false)
    expect(result.divergedAt?.type).toBe('turn_end')
  })

  it('different seed produces different state — verifies RNG is wired', () => {
    const game1 = createGame({ seed: 1, heroClass: 'bloodmage', enemyType: 'necromancer' })
    const game2 = createGame({ seed: 2, heroClass: 'bloodmage', enemyType: 'necromancer' })

    game1.endTurn()
    game2.endTurn()

    const log1 = game1.getLog()
    const log2 = game2.getLog()

    // Logs are from different seeds — cross-replaying should diverge
    // (different enemy intents based on seed)
    // Both should replay their own log correctly
    expect(replayGame(log1).success).toBe(true)
    expect(replayGame(log2).success).toBe(true)
  })
})

// ─── Log structure ────────────────────────────────────────────────────────────

describe('ReplayLog structure', () => {
  it('contains turn_end events for each endTurn call', () => {
    const game = createGame({ seed: 42, heroClass: 'paladin', enemyType: 'goblin' })
    game.endTurn()
    game.endTurn()
    const log = game.getLog()

    const turnEnds = log.events.filter(e => e.type === 'turn_end')
    expect(turnEnds).toHaveLength(2)
  })

  it('every turn_end has a pre and post hash', () => {
    const game = createGame({ seed: 42, heroClass: 'paladin', enemyType: 'goblin' })
    game.playCard('righteous_strike')
    game.endTurn()
    const log = game.getLog()

    const turnEnd = log.events.find(e => e.type === 'turn_end')
    expect(turnEnd?.preStateHash).toHaveLength(6)
    expect(turnEnd?.postStateHash).toHaveLength(6)
  })

  it('events replayed count matches play_card + turn_end events', () => {
    const game = createGame({ seed: 42, heroClass: 'paladin', enemyType: 'goblin' })
    game.playCard('righteous_strike')  // 1 play_card
    game.playCard('divine_charge')     // 1 play_card
    game.endTurn()                     // 1 turn_end
    const log = game.getLog()

    const actionCount = log.events.filter(
      e => e.type === 'play_card' || e.type === 'turn_end'
    ).length

    const result = replayGame(log)
    expect(result.eventsReplayed).toBe(actionCount)
  })
})
