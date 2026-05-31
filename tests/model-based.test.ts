// Model-Based Testing — reference implementation vs real engine.
//
// Pattern:
//   Reference model: ~20 lines, simplified, no optimizations, pure logic
//   Real engine:     src/engine/ — full implementation with edge cases
//   Test:           forAll(inputs) → reference(input) === real(input)
//
// Finds divergences between "what it should do" and "what it does".
// Classic technique: rare in QA courses, common in financial/insurance systems.

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { applyDamage, applyHeal } from '../src/engine/resolution'
import { addStatus, tickStatuses } from '../src/engine/statuses'
import type { GameState, EntityState } from '../src/engine/types'

// ─── Reference model ──────────────────────────────────────────────────────────
// Simplified, obviously-correct implementation.
// Intentionally verbose — clarity over performance.

interface EntitySnapshot { hp: number; maxHp: number; state: EntityState }  // EntityState includes 'dead'

function referenceApplyDamage(e: EntitySnapshot, dmg: number): EntitySnapshot {
  if (e.state === 'dead') return e
  const newHp = Math.max(0, e.hp - dmg)
  let newState: EntityState = e.state
  if (newHp === 0 && e.state === 'alive')      newState = 'death_door'
  if (newHp === 0 && e.state === 'death_door') newState = 'dead'
  return { ...e, hp: newHp, state: newState }
}

function referenceApplyHeal(e: EntitySnapshot, amount: number): EntitySnapshot {
  if (e.state === 'dead') return e
  const newHp = Math.min(e.maxHp, e.hp + amount)
  const newState = e.state === 'death_door' ? 'alive' : e.state
  return { ...e, hp: newHp, state: newState }
}

function referenceBleedTick(hp: number, maxHp: number, state: EntityState, stacks: number): EntitySnapshot {
  if (state === 'dead') return { hp, maxHp, state }
  const newHp = Math.max(0, hp - stacks)
  let newState = state
  if (newHp === 0 && state === 'alive') newState = 'death_door'
  return { hp: newHp, maxHp, state: newState }
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeMinimalState(hp: number, maxHp: number, state: EntityState = 'alive'): GameState {
  return {
    seed: 1, turn: 1, isOver: false,
    hero: {
      id: 'hero', name: 'Hero', hp, maxHp, state,
      statuses: [], row: 'front', heroClass: 'paladin',
      formState: 'human', hand: [], energy: 3,
    },
    enemies: [{
      id: 'enemy', name: 'Goblin', hp: 20, maxHp: 20, state: 'alive',
      statuses: [], row: 'front', enemyType: 'goblin',
      intent: { type: 'attack', value: 6 },
    }],
  }
}

// ─── Model-based tests ────────────────────────────────────────────────────────

describe('model-based: applyDamage vs reference', () => {
  it('forAll(hp, dmg) → same hp result', () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 100 }).chain(maxHp =>
        fc.tuple(
          fc.integer({ min: 0, max: maxHp }),
          fc.integer({ min: 0, max: 150 }),
        ).map(([hp, dmg]) => ({ hp, maxHp, dmg }))
      ),
      ({ hp, maxHp, dmg }) => {
        const ref = referenceApplyDamage({ hp, maxHp, state: 'alive' }, dmg)
        const real = applyDamage(makeMinimalState(hp, maxHp), 'hero', dmg)
        return ref.hp === real.hero.hp
      }
    ))
  })

  it('forAll(hp, dmg) → same state transition', () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 100 }).chain(maxHp =>
        fc.integer({ min: 0, max: maxHp }).map(hp => ({ hp, maxHp }))
      ),
      fc.integer({ min: 0, max: 150 }),
      ({ hp, maxHp }, dmg) => {
        const ref = referenceApplyDamage({ hp, maxHp, state: 'alive' }, dmg)
        const real = applyDamage(makeMinimalState(hp, maxHp), 'hero', dmg)
        return ref.state === real.hero.state
      }
    ))
  })

  it('dead entity: reference and real both no-op on damage', () => {
    fc.assert(fc.property(
      fc.integer({ min: 0, max: 50 }),
      (dmg) => {
        const ref = referenceApplyDamage({ hp: 0, maxHp: 30, state: 'dead' }, dmg)
        const s = makeMinimalState(0, 30, 'dead')
        const real = applyDamage(s, 'hero', dmg)
        return ref.hp === real.hero.hp && ref.state === real.hero.state
      }
    ))
  })
})

describe('model-based: applyHeal vs reference', () => {
  it('forAll(hp, heal) → same hp result', () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 100 }).chain(maxHp =>
        fc.tuple(
          fc.integer({ min: 0, max: maxHp }),
          fc.integer({ min: 0, max: 50 }),
        ).map(([hp, heal]) => ({ hp, maxHp, heal }))
      ),
      ({ hp, maxHp, heal }) => {
        const ref = referenceApplyHeal({ hp, maxHp, state: 'alive' }, heal)
        const real = applyHeal(makeMinimalState(hp, maxHp), 'hero', heal)
        return ref.hp === real.hero.hp
      }
    ))
  })

  it('heal on death_door → both models clear it to alive', () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 50 }),
      (healAmount) => {
        const ref = referenceApplyHeal({ hp: 0, maxHp: 30, state: 'death_door' }, healAmount)
        const s = makeMinimalState(0, 30, 'death_door')
        const real = applyHeal(s, 'hero', healAmount)
        return ref.state === 'alive' && real.hero.state === 'alive'
      }
    ))
  })
})

describe('model-based: bleed tick vs reference', () => {
  it('forAll(hp, stacks) → same damage dealt', () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 100 }).chain(maxHp =>
        fc.integer({ min: 1, max: maxHp }).map(hp => ({ hp, maxHp }))
      ),
      fc.integer({ min: 1, max: 10 }),
      ({ hp, maxHp }, stacks) => {
        const ref = referenceBleedTick(hp, maxHp, 'alive', stacks)
        const s = addStatus(makeMinimalState(hp, maxHp), 'hero', { name: 'bleed', stacks })
        const real = tickStatuses(s, 'hero')
        return ref.hp === real.hero.hp
      }
    ))
  })

  it('bleed tick can trigger death_door — both models agree', () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 10 }),
      (stacks) => {
        // Hero HP = stacks → bleed tick reduces to exactly 0 → death_door
        const ref = referenceBleedTick(stacks, 30, 'alive', stacks)
        const s = addStatus(makeMinimalState(stacks, 30), 'hero', { name: 'bleed', stacks })
        const real = tickStatuses(s, 'hero')
        return ref.state === real.hero.state  // both should be death_door
      }
    ))
  })
})
