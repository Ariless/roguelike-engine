import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { createGame } from '../../src/runtime/executor'
import { replayGame } from '../../src/telemetry/replayer'
import type { HeroClass, EnemyType } from '../../src/engine/types'

// ─── Auto-player ──────────────────────────────────────────────────────────────
// Mirrors simulate.ts logic — plays random cards, then ends turn.
// Returns the completed ReplayLog.

const HERO_CARDS: Record<HeroClass, string[]> = {
  paladin:   ['righteous_strike', 'divine_charge', 'stubborn_recovery'],
  bloodmage: ['chaos_bolt', 'open_the_wound', 'bloodrite'],
  berserker: ['savage_lunge', 'primal_fury', 'primal_dodge'],
  werewolf:  ['lunar_strike', 'pack_sense', 'stalk', 'rend', 'rampage', 'reality_crack'],
}

const SELF_CARDS = new Set(['primal_dodge', 'stubborn_recovery', 'divine_charge', 'reality_crack', 'rampage'])

function mulberry32(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s += 0x6D2B79F5
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function playRandom(seed: number, heroClass: HeroClass, enemyType: EnemyType) {
  const game = createGame({ seed, heroClass, enemyType })
  const rng = mulberry32(seed ^ 0xBEEF)

  for (let turn = 0; turn < 30; turn++) {
    if (game.getState().isOver) break

    const cards = shuffle(HERO_CARDS[heroClass], rng)
    const maxPlays = Math.floor(rng() * 3) + 1
    let played = 0

    for (const cardId of cards) {
      if (played >= maxPlays) break
      if (game.getState().isOver) break
      const target = game.getState().enemies.find(e => e.state !== 'dead')
      if (!target && !SELF_CARDS.has(cardId)) continue
      game.playCard(cardId, target?.id ?? '')
      played++
    }

    if (game.getState().isOver) break
    game.endTurn()
  }

  return game.getLog()
}

// ─── Arbitraries ──────────────────────────────────────────────────────────────

const heroClassArb = fc.constantFrom<HeroClass>('paladin', 'bloodmage', 'berserker', 'werewolf')
const enemyTypeArb = fc.constantFrom<EnemyType>('goblin', 'guardian', 'vampire', 'necromancer')
const seedArb = fc.integer({ min: 0, max: 99999 })

// ─── Core invariant ───────────────────────────────────────────────────────────

describe('property: любая случайная игра воспроизводится byte-perfect', () => {
  it('forAll(seeds) → replayGame(log).success === true', () => {
    fc.assert(fc.property(
      seedArb, heroClassArb, enemyTypeArb,
      (seed, heroClass, enemyType) => {
        const log = playRandom(seed, heroClass, enemyType)
        const result = replayGame(log)
        return result.success
      }
    ), { numRuns: 200 })
  })
})

// ─── Детерминизм ──────────────────────────────────────────────────────────────

describe('property: одинаковый seed → одинаковый исход', () => {
  it('два прогона одного seed дают идентичные логи', () => {
    fc.assert(fc.property(
      seedArb, heroClassArb, enemyTypeArb,
      (seed, heroClass, enemyType) => {
        const log1 = playRandom(seed, heroClass, enemyType)
        const log2 = playRandom(seed, heroClass, enemyType)

        // Одинаковый outcome
        if (log1.outcome !== log2.outcome) return false

        // Одинаковое количество событий
        if (log1.events.length !== log2.events.length) return false

        // Все postStateHash совпадают
        return log1.events.every((e, i) =>
          e.postStateHash === log2.events[i].postStateHash
        )
      }
    ), { numRuns: 200 })
  })
})

// ─── Snapshot integrity ───────────────────────────────────────────────────────

describe('property: все snapshots имеют валидные хэши', () => {
  it('forAll(seeds) → snapshot.hashValid === true для каждого сегмента', () => {
    fc.assert(fc.property(
      seedArb, heroClassArb, enemyTypeArb,
      (seed, heroClass, enemyType) => {
        const log = playRandom(seed, heroClass, enemyType)
        return log.snapshots.every(snap => snap.hashValid)
      }
    ), { numRuns: 200 })
  })

  it('количество snapshots = количество turn_end events', () => {
    fc.assert(fc.property(
      seedArb, heroClassArb, enemyTypeArb,
      (seed, heroClass, enemyType) => {
        const log = playRandom(seed, heroClass, enemyType)
        const turnEnds = log.events.filter(e => e.type === 'turn_end').length
        return log.snapshots.length === turnEnds
      }
    ), { numRuns: 200 })
  })
})

// ─── State machine invariants ─────────────────────────────────────────────────

describe('property: state machine invariants через replay', () => {
  it('HP никогда не выходит за [0, maxHp] в любом snapshot', () => {
    fc.assert(fc.property(
      seedArb, heroClassArb, enemyTypeArb,
      (seed, heroClass, enemyType) => {
        const log = playRandom(seed, heroClass, enemyType)
        return log.snapshots.every(snap => {
          const heroOk = snap.hero.hp >= 0 && snap.hero.hp <= snap.hero.maxHp
          const enemiesOk = snap.enemies.every(e => e.hp >= 0 && e.hp <= e.maxHp)
          return heroOk && enemiesOk
        })
      }
    ), { numRuns: 200 })
  })

  it('dead entity не появляется в живом состоянии в следующем snapshot', () => {
    fc.assert(fc.property(
      seedArb, heroClassArb, enemyTypeArb,
      (seed, heroClass, enemyType) => {
        const log = playRandom(seed, heroClass, enemyType)
        for (let i = 1; i < log.snapshots.length; i++) {
          const prev = log.snapshots[i - 1]
          const curr = log.snapshots[i]

          // Enemy dead in prev → must not be alive in curr
          for (const prevEnemy of prev.enemies) {
            if (prevEnemy.state === 'dead') {
              const currEnemy = curr.enemies.find(e => e.id === prevEnemy.id)
              if (currEnemy && currEnemy.state === 'alive') return false
            }
          }
        }
        return true
      }
    ), { numRuns: 200 })
  })
})

// ─── Fault injection determinism ──────────────────────────────────────────────

describe('property: fault injection детерминирован', () => {
  it('одинаковый seed + bleedOffByOne → одинаковый replay', () => {
    fc.assert(fc.property(
      seedArb,
      (seed) => {
        const faults = { bleedOffByOne: true }
        const game1 = createGame({ seed, heroClass: 'paladin', enemyType: 'necromancer', faults })
        const game2 = createGame({ seed, heroClass: 'paladin', enemyType: 'necromancer', faults })

        game1.endTurn(); game2.endTurn()
        game1.endTurn(); game2.endTurn()

        return game1.getState().hero.hp === game2.getState().hero.hp
      }
    ), { numRuns: 200 })
  })
})
