import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import {
  checkPhases, applyCorruptionEvent, tickPhases, initialPhaseState,
  ARCHIVIST_HP, PHASE_THRESHOLDS,
} from '../../src/engine/boss/archivist'
import { assertValidGameState, TimelineCorruptedError } from '../../src/engine/invariants'
import type { GameState } from '../../src/engine/types'

function makeState(bossHp = ARCHIVIST_HP): GameState {
  return {
    seed: 42, turn: 1, isOver: false,
    hero: {
      id: 'hero', name: 'Paladin', hp: 30, maxHp: 30,
      state: 'alive', statuses: [], row: 'front',
      heroClass: 'paladin', formState: 'human', hand: [], energy: 3,
      chargeStacks: 2,  // charge stacks must survive Phase 3
    },
    enemies: [{
      id: 'archivist', name: 'The Archivist',
      hp: bossHp, maxHp: ARCHIVIST_HP,
      state: 'alive', statuses: [],
      row: 'front', enemyType: 'goblin',  // placeholder type
      intent: { type: 'attack', value: 0 },
    }],
  }
}

function makeStateWithDeadEnemy(): GameState {
  const s = makeState()
  return {
    ...s,
    enemies: [{
      ...s.enemies[0],
      hp: 0,
      state: 'dead',
    }],
  }
}

// ─── Phase triggers ───────────────────────────────────────────────────────────

describe('Archivist phase triggers', () => {
  it('Phase 1 fires when HP drops below 75%', () => {
    const hp = Math.floor(ARCHIVIST_HP * 0.74)
    const { events } = checkPhases(makeState(hp), hp, initialPhaseState())
    expect(events.some(e => e.type === 'memory_suppression')).toBe(true)
  })

  it('Phase 1 does NOT fire at exactly 75% HP', () => {
    const hp = Math.floor(ARCHIVIST_HP * 0.75)
    const { events } = checkPhases(makeState(hp), hp, initialPhaseState())
    expect(events.some(e => e.type === 'memory_suppression')).toBe(false)
  })

  it('Phase 2 fires when HP drops below 50%', () => {
    const hp = Math.floor(ARCHIVIST_HP * 0.49)
    const phases = { ...initialPhaseState(), phase1Fired: true }
    const { events } = checkPhases(makeState(hp), hp, phases)
    expect(events.some(e => e.type === 'timeline_inversion')).toBe(true)
  })

  it('Phase 3 fires when HP drops below 25%', () => {
    const hp = Math.floor(ARCHIVIST_HP * 0.24)
    const phases = { ...initialPhaseState(), phase1Fired: true, phase2Fired: true }
    const { events } = checkPhases(makeState(hp), hp, phases)
    expect(events.some(e => e.type === 'state_reset')).toBe(true)
  })

  it('Phase 4 fires when HP = 0', () => {
    const phases = { ...initialPhaseState(), phase1Fired: true, phase2Fired: true, phase3Fired: true }
    const { events } = checkPhases(makeState(0), 0, phases)
    expect(events.some(e => e.type === 'invariant_breach')).toBe(true)
    expect(events.find(e => e.type === 'invariant_breach')?.constraintViolation).toBe(true)
  })

  it('each phase fires only once', () => {
    const hp = 0
    const allFired = { ...initialPhaseState(), phase1Fired: true, phase2Fired: true, phase3Fired: true }
    // Phase 4 not fired yet — fires now
    const { events: first, phases: p1 } = checkPhases(makeState(hp), hp, allFired)
    expect(first.some(e => e.type === 'invariant_breach')).toBe(true)
    // Phase 4 already fired — should not fire again
    const { events: second } = checkPhases(makeState(hp), hp, p1)
    expect(second.some(e => e.type === 'invariant_breach')).toBe(false)
  })
})

// ─── Phase 3: State Reset ─────────────────────────────────────────────────────

describe('Phase 3 — State Reset', () => {
  it('clears all statuses from hero', () => {
    const s = makeState()
    const withStatuses: GameState = {
      ...s,
      hero: {
        ...s.hero,
        statuses: [
          { name: 'bleed', stacks: 3 },
          { name: 'stun', stacks: 1, duration: 1 },
        ],
      },
    }
    const after = applyCorruptionEvent(withStatuses, {
      type: 'state_reset', appliedAt: 1,
      scope: 'permanent', reversible: false, constraintViolation: false,
    })
    expect(after.hero.statuses).toHaveLength(0)
  })

  it('clears statuses from enemies', () => {
    const s = makeState()
    const withStatuses: GameState = {
      ...s,
      enemies: [{ ...s.enemies[0], statuses: [{ name: 'vulnerable', stacks: 1 }] }],
    }
    const after = applyCorruptionEvent(withStatuses, {
      type: 'state_reset', appliedAt: 1,
      scope: 'permanent', reversible: false, constraintViolation: false,
    })
    expect(after.enemies[0].statuses).toHaveLength(0)
  })

  it('charge stacks SURVIVE state reset (not a status)', () => {
    const s = makeState()  // hero.chargeStacks = 2
    const after = applyCorruptionEvent(s, {
      type: 'state_reset', appliedAt: 1,
      scope: 'permanent', reversible: false, constraintViolation: false,
    })
    expect(after.hero.chargeStacks).toBe(2)  // survives!
  })
})

// ─── Phase 4: Invariant Breach ────────────────────────────────────────────────
// The single most important test in the project.
// "Boss and test suite are the same adversary."

describe('Phase 4 — Invariant Breach', () => {
  it('assertValidGameState() throws TIMELINE CORRUPTED after invariant_breach', () => {
    const corrupted = applyCorruptionEvent(makeStateWithDeadEnemy(), {
      type: 'invariant_breach', appliedAt: 1,
      scope: 'permanent', reversible: false, constraintViolation: true,
    })

    expect(() => assertValidGameState(corrupted)).toThrow(TimelineCorruptedError)
  })

  it('TIMELINE CORRUPTED message contains invariant id', () => {
    const corrupted = applyCorruptionEvent(makeState(), {
      type: 'invariant_breach', appliedAt: 5,
      scope: 'permanent', reversible: false, constraintViolation: true,
    })

    expect(() => assertValidGameState(corrupted))
      .toThrow(/TIMELINE CORRUPTED/)
  })

  it('corrupted state IS invalid — detection works', () => {
    const corrupted = applyCorruptionEvent(makeStateWithDeadEnemy(), {
      type: 'invariant_breach', appliedAt: 1,
      scope: 'permanent', reversible: false, constraintViolation: true,
    })

    let caught = false
    try {
      assertValidGameState(corrupted)
    } catch (e) {
      caught = e instanceof TimelineCorruptedError
    }
    expect(caught).toBe(true)
  })

  it('property: forAll(states) → invariant_breach always triggers TIMELINE CORRUPTED', () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 60 }),
      (seed) => {
        const state = { ...makeStateWithDeadEnemy(), seed }
        const corrupted = applyCorruptionEvent(state, {
          type: 'invariant_breach', appliedAt: 1,
          scope: 'permanent', reversible: false, constraintViolation: true,
        })
        let threw = false
        try { assertValidGameState(corrupted) } catch { threw = true }
        return threw
      }
    ), { numRuns: 50 })
  })
})

// ─── tickPhases ───────────────────────────────────────────────────────────────

describe('tickPhases', () => {
  it('memorySuppression decrements each turn', () => {
    const p = { ...initialPhaseState(), memorySuppression: 2 }
    const p1 = tickPhases(p)
    expect(p1.memorySuppression).toBe(1)
    const p2 = tickPhases(p1)
    expect(p2.memorySuppression).toBe(0)
  })

  it('timelineInversion clears after 1 turn', () => {
    const p = { ...initialPhaseState(), timelineInversion: true }
    expect(tickPhases(p).timelineInversion).toBe(false)
  })
})
