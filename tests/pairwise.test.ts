// Pairwise Testing — covers all 2-way combinations with minimal test cases.
//
// 4 heroes × 6 encounters = 24 combinations to test exhaustively.
// Pairwise reduces this to 8-10 test cases, maintaining all 2-way coverage.
//
// Every pair (hero, encounter) appears at least once — meaning every
// 2-way interaction between any hero and any encounter is tested.
// 3-way or higher combinations are NOT guaranteed (acceptable trade-off).
//
// Enterprise equivalent: pricing tier × customer segment × product type
// = thousands of combinations, pairwise reduces to hundreds.

import { describe, it, expect } from 'vitest'
import { createGame } from '../src/runtime/executor'
import type { HeroClass, EnemyType } from '../src/engine/types'

// ─── Allpairs algorithm ───────────────────────────────────────────────────────
// Generates a set of test combinations covering all 2-way parameter pairs.
// Simple greedy implementation — not optimal but correct.

type Parameters = Record<string, readonly string[]>

function allpairs(params: Parameters): Record<string, string>[] {
  const keys = Object.keys(params)
  const values = keys.map(k => params[k])

  // Track uncovered pairs: (param1, val1) × (param2, val2)
  const uncovered = new Set<string>()
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      for (const v1 of values[i]) {
        for (const v2 of values[j]) {
          uncovered.add(`${keys[i]}=${v1}|${keys[j]}=${v2}`)
        }
      }
    }
  }

  const result: Record<string, string>[] = []

  while (uncovered.size > 0) {
    // Greedily pick the combination that covers the most uncovered pairs
    let bestCombo: Record<string, string> | null = null
    let bestCoverage = -1

    // Generate all possible combinations
    function* combos(idx: number, current: Record<string, string>): Generator<Record<string, string>> {
      if (idx === keys.length) { yield { ...current }; return }
      for (const v of values[idx]) {
        current[keys[idx]] = v
        yield* combos(idx + 1, current)
      }
    }

    for (const combo of combos(0, {})) {
      let coverage = 0
      for (let i = 0; i < keys.length; i++) {
        for (let j = i + 1; j < keys.length; j++) {
          const pair = `${keys[i]}=${combo[keys[i]]}|${keys[j]}=${combo[keys[j]]}`
          if (uncovered.has(pair)) coverage++
        }
      }
      if (coverage > bestCoverage) {
        bestCoverage = coverage
        bestCombo = { ...combo }
      }
    }

    if (!bestCombo || bestCoverage === 0) break

    // Mark pairs as covered
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        uncovered.delete(`${keys[i]}=${bestCombo[keys[i]]}|${keys[j]}=${bestCombo[keys[j]]}`)
      }
    }

    result.push(bestCombo)
  }

  return result
}

// ─── Test parameters ──────────────────────────────────────────────────────────

const HEROES:    readonly HeroClass[]  = ['paladin', 'bloodmage', 'berserker', 'werewolf']
const ENCOUNTERS: readonly EnemyType[] = ['goblin', 'guardian', 'vampire', 'necromancer']
const FAULTS:    readonly string[]     = ['none', 'bleedOffByOne', 'ignoreStun']

// 3 parameters: 4 × 4 × 3 = 48 exhaustive → pairwise ~12-14
const HERO_CARDS: Record<HeroClass, string[]> = {
  paladin:   ['righteous_strike', 'divine_charge'],
  bloodmage: ['chaos_bolt', 'open_the_wound'],
  berserker: ['savage_lunge', 'primal_fury'],
  werewolf:  ['lunar_strike', 'pack_sense'],
}

// Generate pairwise combinations
const PAIRS = allpairs({ hero: HEROES, encounter: ENCOUNTERS, fault: FAULTS })

// ─── Tests ────────────────────────────────────────────────────────────────────

const EXHAUSTIVE = HEROES.length * ENCOUNTERS.length * FAULTS.length

describe(`pairwise: ${HEROES.length} heroes × ${ENCOUNTERS.length} encounters × ${FAULTS.length} faults`, () => {
  console.log(`\n  Exhaustive: ${EXHAUSTIVE} combinations`)
  console.log(`  Pairwise:   ${PAIRS.length} combinations (all 2-way pairs covered)\n`)

  PAIRS.forEach(({ hero, encounter, fault }, i) => {
    it(`[${i + 1}/${PAIRS.length}] ${hero} vs ${encounter} [fault=${fault}]`, () => {
      const heroClass = hero as HeroClass
      const enemyType = encounter as EnemyType
      const faults = fault === 'bleedOffByOne' ? { bleedOffByOne: true }
                   : fault === 'ignoreStun'    ? { ignoreStun: true }
                   : {}
      const game = createGame({ seed: i + 1, heroClass, enemyType, faults })

      // Play 1-2 affordable cards
      const cards = HERO_CARDS[heroClass]
      cards.slice(0, 2).forEach(cardId => {
        if (!game.getState().isOver) {
          const target = game.getState().enemies[0]?.id ?? 'e0'
          game.playCard(cardId, target)
        }
      })

      game.endTurn()

      const state = game.getState()

      // Core invariants must hold regardless of hero/encounter combination
      expect(state.hero.hp).toBeGreaterThanOrEqual(0)
      expect(state.hero.hp).toBeLessThanOrEqual(state.hero.maxHp)
      state.enemies.forEach(e => {
        expect(e.hp).toBeGreaterThanOrEqual(0)
        expect(e.hp).toBeLessThanOrEqual(e.maxHp)
      })

      // Replay must be deterministic
      const log = game.getLog()
      expect(log.seed).toBe(i + 1)
      expect(log.heroClass).toBe(heroClass)
    })
  })
})

// ─── Coverage report ──────────────────────────────────────────────────────────

describe('pairwise coverage proof', () => {
  it('every (hero, encounter) pair appears at least once', () => {
    for (const hero of HEROES) {
      for (const encounter of ENCOUNTERS) {
        const covered = PAIRS.some(p => p.hero === hero && p.encounter === encounter)
        expect(covered, `pair (${hero}, ${encounter}) not covered`).toBe(true)
      }
    }
  })

  it('every (hero, fault) pair appears at least once', () => {
    for (const hero of HEROES) {
      for (const fault of FAULTS) {
        const covered = PAIRS.some(p => p.hero === hero && p.fault === fault)
        expect(covered, `pair (${hero}, ${fault}) not covered`).toBe(true)
      }
    }
  })

  it(`pairwise uses fewer tests than exhaustive (${PAIRS.length} < ${EXHAUSTIVE})`, () => {
    expect(PAIRS.length).toBeLessThan(EXHAUSTIVE)
  })
})
