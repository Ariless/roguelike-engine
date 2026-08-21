// Shared run layer for the simulation scripts.
// simulate.ts and stability.ts run the same auto-player — if the two drift apart
// between the scripts, their reports will start contradicting each other, and telling which one is
// right will no longer be possible.

import { createGame } from '../../src/runtime/executor'
import { createRng, shuffle } from '../../src/runtime/rng'
import { saveFailingRun } from '../../src/telemetry/artifacts'
import { payoutsFrom, economyOf, combineEconomies, type EconomyStats } from './economy'
import type { HeroClass, EnemyType } from '../../src/engine/types'
import type { ReplayLog } from '../../src/telemetry/types'

export const HERO_CLASSES: readonly HeroClass[] =
  ['paladin', 'bloodmage', 'berserker', 'werewolf']

export const ENEMY_TYPES: readonly EnemyType[] =
  ['goblin', 'guardian', 'vampire', 'necromancer']

// Cards available to the auto-player. Exported because the chaos agent plays by
// its own strategy but with the same cards — and a deck divergence between the scripts
// would mean they run different games under identical report headings.
export const HERO_CARDS: Record<HeroClass, string[]> = {
  paladin:   ['righteous_strike', 'divine_charge', 'stubborn_recovery'],
  bloodmage: ['chaos_bolt', 'open_the_wound', 'bloodrite'],
  berserker: ['savage_lunge', 'primal_fury', 'primal_dodge'],
  werewolf:  ['lunar_strike', 'pack_sense', 'stalk', 'rend', 'rampage', 'reality_crack'],
}

// Cards that do not need a living target.
export const SELF_ONLY = [
  'primal_dodge', 'stubborn_recovery', 'divine_charge', 'reality_crack', 'rampage',
]

// ─── Mapping seeds onto configurations ───────────────────────────────────────
//
// Both coordinates used to come from the same remainder:
//     heroClass = HERO_CLASSES[seed % 4]
//     enemyType = ENEMY_TYPES[seed % 4]
// so the seed was choosing not a pair but the diagonal of a 4×4 matrix. Paladin only ever met
// the Goblin, Werewolf only the Necromancer, and 12 of the 16 combinations
// were never checked on any seed, however many runs were requested. The win rates
// 99.8% and 100% are not a property of the heroes but a consequence of each of them
// being handed a fixed opponent.
//
// Now the second coordinate comes from the high part of the seed: a full cycle over
// all 16 pairs, each getting exactly 1/16 of the runs.

export function configFor(seed: number): { heroClass: HeroClass; enemyType: EnemyType } {
  return {
    heroClass: HERO_CLASSES[seed % HERO_CLASSES.length],
    enemyType: ENEMY_TYPES[Math.floor(seed / HERO_CLASSES.length) % ENEMY_TYPES.length],
  }
}

export function matchupKey(heroClass: HeroClass, enemyType: EnemyType): string {
  return `${heroClass}|${enemyType}`
}

// ─── Auto-player ─────────────────────────────────────────────────────────────
// Random-greedy: each turn it plays 1–3 available cards in random
// order. It plays sub-optimally on purpose. The win rate of sub-optimal
// play shows whether the fight has any challenge at all; the win rate of perfect play would show
// would give only the ceiling.

export function autoPlay(seed: number, heroClass: HeroClass, enemyType: EnemyType): ReplayLog {
  const game = createGame({ seed, heroClass, enemyType })
  const rng = createRng(seed ^ 0xDEAD)  // a separate stream for choosing cards

  for (let turn = 0; turn < 50; turn++) {
    if (game.getState().isOver) break

    const cards = shuffle(rng, HERO_CARDS[heroClass])
    const maxPlays = Math.floor(rng() * 3) + 1
    let played = 0

    for (const cardId of cards) {
      if (played >= maxPlays) break
      const s = game.getState()
      if (s.isOver) break

      const target = s.enemies.find(e => e.state !== 'dead')
      if (!target && !SELF_ONLY.includes(cardId)) continue

      game.playCard(cardId, target?.id ?? '')
      played++
    }

    if (game.getState().isOver) break
    game.endTurn()
  }

  return game.getLog()
}

// ─── Batch ───────────────────────────────────────────────────────────────────

export interface ClassStats {
  wins: number
  losses: number
  turns: number[]
  corrupted: number
  /** Per-run economies, folded together at the end of the batch. */
  economies: EconomyStats[]
}

export interface MatchupStats {
  wins: number
  losses: number
  turns: number[]
}

export interface BatchResult {
  runs: number
  baseSeed: number
  perClass: Record<HeroClass, ClassStats>
  perMatchup: Map<string, MatchupStats>
  corrupted: number
  failingSeeds: number[]
}

function emptyClassStats(): ClassStats {
  return { wins: 0, losses: 0, turns: [], corrupted: 0, economies: [] }
}

export interface BatchOptions {
  // Archive failing runs into /artifacts/. Disabled in the multi-batch
  // mode: a hundred batches would bury the directory in hundreds of files about the same thing.
  archiveFailures?: boolean
  onProgress?: (done: number, total: number) => void
}

export function runBatch(runs: number, baseSeed = 0, options: BatchOptions = {}): BatchResult {
  const { archiveFailures = true, onProgress } = options

  const perClass: Record<HeroClass, ClassStats> = {
    paladin:   emptyClassStats(),
    bloodmage: emptyClassStats(),
    berserker: emptyClassStats(),
    werewolf:  emptyClassStats(),
  }
  const perMatchup = new Map<string, MatchupStats>()
  const failingSeeds: number[] = []
  let corrupted = 0

  for (let i = 0; i < runs; i++) {
    const seed = baseSeed + i
    const { heroClass, enemyType } = configFor(seed)

    let log: ReplayLog
    try {
      log = autoPlay(seed, heroClass, enemyType)
    } catch {
      // An invariant broke — the timeline is corrupted, the outcome is undefined
      corrupted++
      failingSeeds.push(seed)
      perClass[heroClass].corrupted++
      onProgress?.(i + 1, runs)
      continue
    }

    const key = matchupKey(heroClass, enemyType)
    if (!perMatchup.has(key)) perMatchup.set(key, { wins: 0, losses: 0, turns: [] })
    const matchup = perMatchup.get(key)!

    const finalTurn = log.snapshots.length > 0
      ? log.snapshots[log.snapshots.length - 1].turn
      : 0

    if (log.outcome === 'hero_wins') {
      perClass[heroClass].wins++
      matchup.wins++
    } else if (log.outcome === 'hero_loses') {
      perClass[heroClass].losses++
      matchup.losses++
    }

    if (log.outcome !== 'in_progress') {
      perClass[heroClass].turns.push(finalTurn)
      matchup.turns.push(finalTurn)
    }

    // Return metrics are derived from the log after the fact — the engine is
    // untouched, so collecting them cannot affect determinism.
    perClass[heroClass].economies.push(economyOf(payoutsFrom(log)))

    // A hash divergence means broken determinism, not broken balance. A separate failure class.
    if (log.snapshots.some(snap => !snap.hashValid)) {
      if (!failingSeeds.includes(seed)) failingSeeds.push(seed)
      if (archiveFailures) saveFailingRun(log)
    }

    onProgress?.(i + 1, runs)
  }

  return { runs, baseSeed, perClass, perMatchup, corrupted, failingSeeds }
}

export function winrateOf(s: { wins: number; losses: number }): number {
  const decided = s.wins + s.losses
  return decided > 0 ? s.wins / decided : NaN
}
