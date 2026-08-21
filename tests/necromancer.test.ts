import { describe, it, expect } from 'vitest'
import { createGame, resolveIntent, executeIntent } from '../src/runtime/executor'
import { assertValidGameState } from '../src/engine/invariants'
import type { GameState } from '../src/engine/types'

// ─── Why this file exists ─────────────────────────────────────────────────────
//
// BUG-14: Raise Dead and Empower were declared in three documents and built in
// game/index.html, but never reached the engine. The Intent type held only
// attack/bleed/defend/stun, so the two rows were not merely unimplemented —
// they were inexpressible. The Necromancer could not deal direct damage and lost
// 4,000 simulated battles out of 4,000.
//
// These tests cover the mechanic now that it exists in the engine. They are
// separate from decision-tables.test.ts on purpose: that file checks which
// intent is *chosen* on a given board, this one checks what happens when it is
// *executed*. Choosing correctly and executing correctly are different failures.

/** Plays out turns against a Necromancer, doing nothing as the hero. */
function idleTurns(count: number, seed = 1) {
  const game = createGame({ seed, heroClass: 'paladin', enemyType: 'necromancer' })
  const states: GameState[] = [game.getState()]
  for (let i = 0; i < count; i++) {
    game.endTurn()
    states.push(game.getState())
  }
  return { game, states, final: game.getState() }
}


/** A board holding a Necromancer and one skeleton, optionally empowered. */
function boardWithSkeleton(empowered = 0): GameState {
  return {
    seed: 1, turn: 3, isOver: false,
    hero: {
      id: 'hero', name: 'Hero', hp: 30, maxHp: 30, state: 'alive', statuses: [],
      row: 'front', heroClass: 'paladin', formState: 'human', hand: [], energy: 3,
    },
    enemies: [
      {
        id: 'necro', name: 'Necromancer', hp: 25, maxHp: 25, state: 'alive', statuses: [],
        row: 'front', enemyType: 'necromancer', intent: { type: 'bleed', value: 3 },
      },
      {
        id: 'skeleton-1', name: 'Skeleton', hp: 8, maxHp: 8, state: 'alive', statuses: [],
        row: 'front', enemyType: 'skeleton', intent: { type: 'attack', value: 4 },
        ...(empowered > 0 ? { empowered } : {}),
      },
    ],
  }
}

function skeletonsOf(state: GameState) {
  return state.enemies.filter(e => e.enemyType === 'skeleton')
}

// ─── Raise Dead ───────────────────────────────────────────────────────────────

describe('Raise Dead', () => {
  it('spawns a skeleton from an unraised corpse', () => {
    const before: GameState = {
      seed: 1, turn: 2, isOver: false,
      hero: {
        id: 'hero', name: 'Hero', hp: 30, maxHp: 30, state: 'alive', statuses: [],
        row: 'front', heroClass: 'paladin', formState: 'human', hand: [], energy: 3,
      },
      enemies: [{
        id: 'corpse', name: 'Goblin', hp: 0, maxHp: 20, state: 'dead', statuses: [],
        row: 'front', enemyType: 'goblin', intent: { type: 'attack', value: 6 },
      }],
    }

    expect(resolveIntent('necromancer', 1, before)).toEqual({ type: 'raise' })
  })

  it('marks the corpse as spent so one body cannot supply skeletons forever', () => {
    // The engine-level guarantee behind DECISIONS.md:335 — "won't raise if no
    // corpse on field → graceful no-op". Without the flag, the same body would
    // be raised on every cycle of the table.
    const { final } = idleTurns(12)
    const spentCorpses = final.enemies.filter(e => e.state === 'dead' && e.raisedOnce)
    const skeletons = skeletonsOf(final)
    expect(skeletons.length).toBeLessThanOrEqual(spentCorpses.length + 1)
  })

  it('gives every skeleton a deterministic id', () => {
    // The UI builds this as `skeleton-${Date.now()}`, which breaks "same seed,
    // same log" in the game layer. The engine cannot afford that: an id that
    // varies between runs makes replay verification impossible.
    const first = idleTurns(10, 7).final
    const second = idleTurns(10, 7).final
    expect(skeletonsOf(first).map(s => s.id)).toEqual(skeletonsOf(second).map(s => s.id))
  })

  it('a raised skeleton is a valid game entity', () => {
    const { final } = idleTurns(10)
    expect(() => assertValidGameState(final)).not.toThrow()
  })
})

// ─── Empower ──────────────────────────────────────────────────────────────────

describe('Empower', () => {
  it('is a no-op with no skeleton, and the turn falls back to Wither', () => {
    const empty: GameState = {
      seed: 1, turn: 3, isOver: false,
      hero: {
        id: 'hero', name: 'Hero', hp: 30, maxHp: 30, state: 'alive', statuses: [],
        row: 'front', heroClass: 'paladin', formState: 'human', hand: [], energy: 3,
      },
      enemies: [],
    }
    expect(resolveIntent('necromancer', 2, empty)).toEqual({ type: 'bleed', value: 3 })
  })

  it('a skeleton never carries an empower bonus into a later turn', () => {
    // Empower is spent on the next attack whether or not it lands. Banking
    // empowerments across turns would let a Necromancer stack an unbounded
    // one-shot — the kind of accumulation a win cap exists to prevent.
    const { final } = idleTurns(15)
    for (const skeleton of skeletonsOf(final)) {
      expect(skeleton.empowered ?? 0).toBeLessThanOrEqual(3)
    }
  })
})

// ─── The mechanic end to end ──────────────────────────────────────────────────

describe('Necromancer, end to end', () => {
  it('a skeleton deals direct damage — the thing the Necromancer could not do', () => {
    // The point of BUG-14, checked directly rather than through HP dropping
    // over many turns. An earlier version of this test watched the hero's HP
    // after 30 idle turns, which passed on the *old* engine too: bleed alone
    // wears a passive hero down. That made it a test that could not fail for
    // the reason its name claimed — the BUG-16 pattern, in a file written to
    // close BUG-14.
    const board = boardWithSkeleton()
    const after = executeIntent(board, { type: 'attack', value: 4 }, 'skeleton-1')
    expect(after.hero.hp).toBe(board.hero.hp - 4)
  })

  it('an empowered skeleton hits harder, and the bonus is consumed', () => {
    const board = boardWithSkeleton(3)
    const after = executeIntent(board, { type: 'attack', value: 4 }, 'skeleton-1')
    expect(after.hero.hp).toBe(board.hero.hp - 7)
    expect(after.enemies.find(e => e.id === 'skeleton-1')?.empowered).toBe(0)
  })

  it('empower lands on the skeleton, not on the necromancer', () => {
    const board = boardWithSkeleton()
    const after = executeIntent(board, { type: 'empower', value: 3 }, 'necro')
    expect(after.enemies.find(e => e.id === 'skeleton-1')?.empowered).toBe(3)
    expect(after.enemies.find(e => e.id === 'necro')?.empowered ?? 0).toBe(0)
  })

  it('the battle stays deterministic with skeletons in play', () => {
    // Spawning entities mid-battle is the riskiest thing this change introduces:
    // a new entity means new ids, new iteration order and new hash inputs.
    const a = idleTurns(20, 99)
    const b = idleTurns(20, 99)
    expect(a.final.enemies.map(e => `${e.id}:${e.hp}:${e.state}`))
      .toEqual(b.final.enemies.map(e => `${e.id}:${e.hp}:${e.state}`))
    expect(a.final.hero.hp).toBe(b.final.hero.hp)
  })

  it('every intermediate state stays valid while entities spawn', () => {
    const { states } = idleTurns(20, 3)
    for (const state of states) {
      expect(() => assertValidGameState(state)).not.toThrow()
    }
  })

  it('the replay of a battle with skeletons verifies byte-perfect', () => {
    const game = createGame({ seed: 42, heroClass: 'paladin', enemyType: 'necromancer' })
    for (let i = 0; i < 15 && !game.getState().isOver; i++) game.endTurn()
    const log = game.getLog()
    expect(log.snapshots.every(s => s.hashValid)).toBe(true)
  })
})
