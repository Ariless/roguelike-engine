import { describe, it, expect } from 'vitest'
import { tickWithFaults, NO_FAULTS } from '../../src/runtime/faults'
import { tickStatuses } from '../../src/engine/statuses'
import { createGame } from '../../src/runtime/executor'
import type { GameState, Status } from '../../src/engine/types'

// ─── Why this file exists ─────────────────────────────────────────────────────
//
// MUTATION-02: widening the mutation run from 6 files to 13 put `faults.ts` on
// the board for the first time, and it came back at 26% — 37 survivors out of
// 50, the worst-covered file in the project.
//
// That module is the instrument that proves the tests notice a planted bug. If
// it can be broken without a test noticing, fault injection silently injects
// nothing, the property tests keep passing, and "we verified the suite catches a
// deliberate defect" becomes a claim with nothing behind it. The failure is
// silent by construction: a broken injector looks exactly like a working one
// running against healthy code.
//
// So the injector is tested the way the engine is: the corrupted run must differ
// from the clean one by a specific amount, and the clean run must match byte for
// byte.

function makeState(statuses: Status[] = [], enemyStatuses: Status[] = []): GameState {
  return {
    seed: 1, turn: 1, isOver: false,
    hero: {
      id: 'hero', name: 'Hero', hp: 30, maxHp: 30, state: 'alive',
      statuses, row: 'front', heroClass: 'paladin', formState: 'human',
      hand: [], energy: 3,
    },
    enemies: [{
      id: 'e0', name: 'Goblin', hp: 20, maxHp: 20, state: 'alive',
      statuses: enemyStatuses, row: 'front', enemyType: 'goblin',
      intent: { type: 'attack', value: 6 },
    }],
  }
}

const OFF_BY_ONE = { bleedOffByOne: true }

// ─── The injection does what it claims ────────────────────────────────────────

describe('bleedOffByOne — the defect it injects', () => {
  it('removes exactly one point less than the clean tick', () => {
    // The precise amount matters. An injector that takes "somewhat less" is
    // untestable as an instrument: the suite could not distinguish a working
    // injector from a broken one.
    const state = makeState([{ name: 'bleed', stacks: 5 }])
    const clean = tickStatuses(state, 'hero')
    const faulted = tickWithFaults(state, 'hero', OFF_BY_ONE)

    expect(clean.hero.hp).toBe(25)     // 5 stacks, 5 damage
    expect(faulted.hero.hp).toBe(26)   // 4 damage — one short
    expect(faulted.hero.hp - clean.hero.hp).toBe(1)
  })

  it('injects on an enemy as well as on the hero', () => {
    // The branch for enemies is a separate code path from the hero branch, and
    // an injector that only corrupts one of them would still look alive in any
    // hero-only test.
    const state = makeState([], [{ name: 'bleed', stacks: 4 }])
    const clean = tickStatuses(state, 'e0')
    const faulted = tickWithFaults(state, 'e0', OFF_BY_ONE)

    expect(clean.enemies[0].hp).toBe(16)
    expect(faulted.enemies[0].hp).toBe(17)
  })

  it('one stack becomes zero damage, never negative healing', () => {
    const state = makeState([{ name: 'bleed', stacks: 1 }])
    const faulted = tickWithFaults(state, 'hero', OFF_BY_ONE)
    expect(faulted.hero.hp).toBe(30)
  })

  it('scales with the stack count rather than subtracting a flat amount', () => {
    for (const stacks of [2, 3, 7, 10]) {
      const state = makeState([{ name: 'bleed', stacks }])
      const clean = tickStatuses(state, 'hero')
      const faulted = tickWithFaults(state, 'hero', OFF_BY_ONE)
      expect(faulted.hero.hp - clean.hero.hp, `stacks=${stacks}`).toBe(1)
    }
  })

  it('leaves the entity one tick further from death, which is the point', () => {
    // The injected bug has to be able to change an outcome, not just a number:
    // a defect that never flips a verdict cannot be caught by a property test.
    const state = makeState([{ name: 'bleed', stacks: 3 }])
    const dying = { ...state, hero: { ...state.hero, hp: 3 } }

    expect(tickStatuses(dying, 'hero').hero.state).toBe('death_door')
    expect(tickWithFaults(dying, 'hero', OFF_BY_ONE).hero.state).toBe('alive')
  })
})

// ─── With the fault off, nothing may change ───────────────────────────────────

describe('the injector is inert when disabled', () => {
  const cases: Array<[string, Status[]]> = [
    ['bleed present',   [{ name: 'bleed', stacks: 5 }]],
    ['no bleed',        [{ name: 'defend', stacks: 3 }]],
    ['no statuses',     []],
    ['expiring status', [{ name: 'stun', stacks: 1, duration: 1 }]],
  ]

  it.each(cases)('matches the clean tick exactly — %s', (_label, statuses) => {
    // Byte-for-byte, not "close enough". An injector that perturbs the run while
    // switched off would make every clean baseline in the suite wrong.
    const state = makeState(statuses)
    expect(tickWithFaults(state, 'hero', NO_FAULTS)).toEqual(tickStatuses(state, 'hero'))
    expect(tickWithFaults(state, 'hero', {})).toEqual(tickStatuses(state, 'hero'))
    expect(tickWithFaults(state, 'hero', { bleedOffByOne: false }))
      .toEqual(tickStatuses(state, 'hero'))
  })

  it('an unrelated fault flag does not switch bleed injection on', () => {
    // Guards against a mutant that turns the guard condition into something
    // permanently true.
    const state = makeState([{ name: 'bleed', stacks: 5 }])
    expect(tickWithFaults(state, 'hero', { ignoreStun: true }))
      .toEqual(tickStatuses(state, 'hero'))
  })
})

// ─── Cases where injection has nothing to corrupt ─────────────────────────────

describe('bleedOffByOne falls through cleanly', () => {
  it('with no bleed on the entity', () => {
    const state = makeState([{ name: 'defend', stacks: 3 }])
    expect(tickWithFaults(state, 'hero', OFF_BY_ONE)).toEqual(tickStatuses(state, 'hero'))
  })

  it('with bleed at zero stacks', () => {
    const state = makeState([{ name: 'bleed', stacks: 0 }])
    expect(tickWithFaults(state, 'hero', OFF_BY_ONE)).toEqual(tickStatuses(state, 'hero'))
  })

  it('with an entity id that does not exist', () => {
    const state = makeState([{ name: 'bleed', stacks: 5 }])
    expect(tickWithFaults(state, 'nobody', OFF_BY_ONE)).toEqual(tickStatuses(state, 'nobody'))
  })
})

// ─── Blast radius ─────────────────────────────────────────────────────────────

describe('the injection touches only its target', () => {
  it('does not mutate the state it was given', () => {
    const state = makeState([{ name: 'bleed', stacks: 5 }])
    const snapshot = JSON.stringify(state)
    tickWithFaults(state, 'hero', OFF_BY_ONE)
    expect(JSON.stringify(state)).toBe(snapshot)
  })

  it('leaves other statuses on the same entity alone', () => {
    const state = makeState([
      { name: 'bleed', stacks: 5 },
      { name: 'defend', stacks: 3 },
    ])
    const faulted = tickWithFaults(state, 'hero', OFF_BY_ONE)
    expect(faulted.hero.statuses.find(s => s.name === 'defend')?.stacks).toBe(3)
  })

  it('leaves the enemy alone when the hero is the target', () => {
    const state = makeState([{ name: 'bleed', stacks: 5 }], [{ name: 'bleed', stacks: 4 }])
    const faulted = tickWithFaults(state, 'hero', OFF_BY_ONE)
    expect(faulted.enemies[0].hp).toBe(20)
    expect(faulted.enemies[0].statuses.find(s => s.name === 'bleed')?.stacks).toBe(4)
  })

  it('leaves the hero alone when an enemy is the target', () => {
    const state = makeState([{ name: 'bleed', stacks: 5 }], [{ name: 'bleed', stacks: 4 }])
    const faulted = tickWithFaults(state, 'e0', OFF_BY_ONE)
    expect(faulted.hero.hp).toBe(30)
  })
})

// ─── The other fault flags, through the executor ──────────────────────────────
//
// These are read by executor.ts rather than by faults.ts, but they belong to the
// same instrument: if one of them silently stops injecting, every test that
// relies on it becomes decorative.

describe('the remaining fault flags', () => {
  function runTurns(count: number, faults = {}) {
    const game = createGame({ seed: 5, heroClass: 'paladin', enemyType: 'guardian', faults })
    for (let i = 0; i < count && !game.getState().isOver; i++) game.endTurn()
    return game.getState()
  }

  it('a clean run and a NO_FAULTS run are identical', () => {
    const a = runTurns(6)
    const b = runTurns(6, NO_FAULTS)
    expect(a.hero.hp).toBe(b.hero.hp)
    expect(a.enemies.map(e => e.hp)).toEqual(b.enemies.map(e => e.hp))
  })

  it('ignoreDeathDoor keeps an enemy at death_door instead of resolving it', () => {
    // Uses a bleed kill on purpose. Death by status tick resolves inside the
    // executor, which is where the fault is read. Death from a card hit is
    // resolved in applyDamage — inside engine/, which by design knows nothing
    // about faults. See the note below the pinned gaps.
    function run(faults = {}) {
      const game = createGame({ seed: 11, heroClass: 'bloodmage', enemyType: 'goblin', faults })
      for (let i = 0; i < 20 && !game.getState().isOver; i++) {
        game.playCard('open_the_wound', 'enemy')
        game.endTurn()
      }
      return game.getState()
    }

    expect(run().enemies[0].state).toBe('dead')
    expect(run({ ignoreDeathDoor: true }).enemies[0].state).toBe('death_door')
  })

  // ─── Pinned gaps in the injector ────────────────────────────────────────────
  //
  // Two flags do not work, and they are pinned here rather than quietly deleted,
  // the same way tests/decision-tables.test.ts pins engine/spec divergences. A
  // fault flag that injects nothing is worse than a missing one: every test that
  // relies on it looks like it proves something.
  //
  // Recorded as BUG-18. Both tests fail the moment either flag starts working,
  // which is the signal to close it.

  it('BUG-18: ignoreStun is unreachable — nothing can stun an enemy', () => {
    // No hero card applies stun to an enemy: the only source of stun in the game
    // is the Guardian, and it stuns the hero. The guard this flag modified was
    // therefore never evaluated with isStunned = true, and the dead branch was
    // removed on 2026-08-26. The flag itself survives in FaultConfig and in the
    // replay log; this test pins that switching it on still changes nothing.
    const clean = runTurns(8)
    const faulted = runTurns(8, { ignoreStun: true })
    expect(faulted.hero.hp).toBe(clean.hero.hp)
    expect(faulted.enemies.map(e => e.hp)).toEqual(clean.enemies.map(e => e.hp))
  })

  it('BUG-18: ignoreDeathDoor reaches only the executor, not the engine', () => {
    // Partially working rather than broken, and the boundary is architectural:
    // `engine/` takes no FaultConfig, so a death resolved by applyDamage — the
    // second hit on an entity already at death_door — cannot be suppressed. The
    // flag's own comment promises "no kill on second hit", which is more than it
    // delivers. Pinned so the discrepancy is visible rather than assumed.
    function killWithCards(faults = {}) {
      const game = createGame({ seed: 3, heroClass: 'bloodmage', enemyType: 'goblin', faults })
      for (let i = 0; i < 12 && !game.getState().isOver; i++) {
        game.playCard('chaos_bolt', 'enemy')
        game.endTurn()
      }
      return game.getState()
    }

    expect(killWithCards().enemies[0].state).toBe('dead')
    expect(killWithCards({ ignoreDeathDoor: true }).enemies[0].state).toBe('dead')
  })

  it('BUG-18: allowDeadToAct is declared but never read', () => {
    // Declared in FaultConfig and documented as "dead entities can still execute
    // intents (triggers TIMELINE CORRUPTED)". No code reads it. A test relying
    // on it to prove the invariants catch a dead entity acting would be proving
    // nothing whatsoever.
    const clean = runTurns(8)
    const faulted = runTurns(8, { allowDeadToAct: true })
    expect(faulted.hero.hp).toBe(clean.hero.hp)
    expect(faulted.enemies.map(e => e.hp)).toEqual(clean.enemies.map(e => e.hp))
  })
})
