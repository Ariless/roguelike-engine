// Return metrics — the economy of a run, not its outcome.
//
// Why this exists. Every metric in simulate.ts answers "who won". That is the
// right question for balance and the wrong one for a math-heavy system, where
// the number that matters is what comes back per unit staked. A build can hold
// its win rate exactly inside the corridor while the distribution underneath it
// changes shape: same average, different variance, different worst case. Win
// rate cannot see that. These metrics can.
//
// The mapping to slot math is deliberate and stated rather than implied:
//
//   stake        cards played in a turn      (what the player spends)
//   return       damage dealt in that turn   (what comes back)
//   RTP          total return / total stake
//   hit frequency  share of turns that returned anything at all
//   max win      largest single-turn return  (the win-cap question)
//   volatility   coefficient of variation of the per-turn return
//
// It is an analogy, not a claim to be a slot engine: there is no wager, no
// paytable and no house edge here. What transfers is the shape of the question
// and the arithmetic — an average that stays put while the tail moves is the
// failure mode both systems share.
//
// Everything is derived from the ReplayLog after the fact. The engine is not
// touched, so determinism is unaffected: the same seed produces the same log
// and therefore the same economy.

import type { ReplayLog } from '../../src/telemetry/types'
import { mean, stdDev, percentile, maxOf } from './stats'

/** One turn seen as a wager: what was spent, what came back. */
export interface Payout {
  turn: number
  stake: number
  return: number
}

export interface EconomyStats {
  /** Turns that carried a stake — the denominator for every rate below. */
  spins: number
  totalStake: number
  totalReturn: number
  /** Return per unit staked. The RTP analogue. */
  rtp: number
  /** Share of staked turns that returned anything at all. */
  hitFrequency: number
  /** Largest single-turn return, and the same as a multiple of the mean stake. */
  maxWin: number
  maxWinMultiple: number
  meanReturn: number
  /** Coefficient of variation: spread of the return relative to its own mean. */
  volatility: number
  p50: number
  p95: number
  /** Return distribution, bucketed. Keys are bucket lower bounds. */
  buckets: Map<number, number>
}

/**
 * Extracts per-turn stake and return from a replay log.
 *
 * Return is measured as HP removed from enemies between consecutive snapshots.
 * Only decreases count: an enemy healing itself (vampire lifesteal) is not a
 * negative payout, it belongs to the enemy's economy, not the hero's.
 */
export function payoutsFrom(log: ReplayLog): Payout[] {
  const payouts: Payout[] = []

  // Before the first snapshot every enemy stands at full HP.
  let previous = new Map<string, number>()
  for (const enemy of log.snapshots[0]?.enemies ?? []) {
    previous.set(enemy.id, enemy.maxHp)
  }

  for (const snapshot of log.snapshots) {
    const stake = snapshot.events.filter(e => e.type === 'play_card').length

    let dealt = 0
    const current = new Map<string, number>()
    for (const enemy of snapshot.enemies) {
      current.set(enemy.id, enemy.hp)
      const before = previous.get(enemy.id)
      // An enemy absent from the previous snapshot was spawned this turn;
      // it has taken no damage yet.
      if (before !== undefined && before > enemy.hp) dealt += before - enemy.hp
    }
    previous = current

    // A turn with no cards played is not a spin — counting it would deflate
    // every rate below with turns the player never paid for.
    if (stake > 0) payouts.push({ turn: snapshot.turn, stake, return: dealt })
  }

  return payouts
}

/** Bucket width for the return distribution, in HP. */
const BUCKET = 5

export function economyOf(payouts: readonly Payout[]): EconomyStats {
  if (payouts.length === 0) {
    return {
      spins: 0, totalStake: 0, totalReturn: 0, rtp: 0, hitFrequency: 0,
      maxWin: 0, maxWinMultiple: 0, meanReturn: 0, volatility: 0,
      p50: 0, p95: 0, buckets: new Map(),
    }
  }

  const returns = payouts.map(p => p.return)
  const totalStake = payouts.reduce((acc, p) => acc + p.stake, 0)
  const totalReturn = returns.reduce((acc, r) => acc + r, 0)
  const meanReturn = mean(returns)
  const meanStake = totalStake / payouts.length
  const maxWin = maxOf(returns)

  const buckets = new Map<number, number>()
  for (const r of returns) {
    const key = Math.floor(r / BUCKET) * BUCKET
    buckets.set(key, (buckets.get(key) ?? 0) + 1)
  }

  return {
    spins: payouts.length,
    totalStake,
    totalReturn,
    rtp: totalReturn / totalStake,
    hitFrequency: returns.filter(r => r > 0).length / returns.length,
    maxWin,
    maxWinMultiple: meanStake > 0 ? maxWin / meanStake : 0,
    meanReturn,
    // Coefficient of variation. Undefined at a mean of zero, reported as 0
    // rather than NaN so a broken build shows an empty column, not a crash.
    volatility: meanReturn > 0 ? stdDev(returns) / meanReturn : 0,
    p50: percentile(returns, 50),
    p95: percentile(returns, 95),
    buckets: new Map([...buckets.entries()].sort((a, b) => a[0] - b[0])),
  }
}

/** Merges economies of many runs without keeping every payout in memory. */
export function combineEconomies(all: readonly EconomyStats[]): EconomyStats {
  const nonEmpty = all.filter(e => e.spins > 0)
  if (nonEmpty.length === 0) return economyOf([])

  const buckets = new Map<number, number>()
  for (const e of nonEmpty) {
    for (const [key, count] of e.buckets) {
      buckets.set(key, (buckets.get(key) ?? 0) + count)
    }
  }

  const spins = nonEmpty.reduce((a, e) => a + e.spins, 0)
  const totalStake = nonEmpty.reduce((a, e) => a + e.totalStake, 0)
  const totalReturn = nonEmpty.reduce((a, e) => a + e.totalReturn, 0)
  const meanReturn = totalReturn / spins
  const maxWin = maxOf(nonEmpty.map(e => e.maxWin))
  const meanStake = totalStake / spins

  // Variance recovered from the buckets: exact enough at BUCKET = 5 and the
  // only option that does not require holding every payout.
  let sumSquares = 0
  for (const [key, count] of buckets) {
    const mid = key + BUCKET / 2
    sumSquares += count * (mid - meanReturn) ** 2
  }
  const sd = Math.sqrt(sumSquares / Math.max(1, spins - 1))

  const hits = [...buckets.entries()]
    .filter(([key]) => key > 0)
    .reduce((a, [, count]) => a + count, 0)

  return {
    spins,
    totalStake,
    totalReturn,
    rtp: totalReturn / totalStake,
    hitFrequency: hits / spins,
    maxWin,
    maxWinMultiple: meanStake > 0 ? maxWin / meanStake : 0,
    meanReturn,
    volatility: meanReturn > 0 ? sd / meanReturn : 0,
    p50: percentileFromBuckets(buckets, spins, 50),
    p95: percentileFromBuckets(buckets, spins, 95),
    buckets: new Map([...buckets.entries()].sort((a, b) => a[0] - b[0])),
  }
}

function percentileFromBuckets(
  buckets: ReadonlyMap<number, number>,
  total: number,
  p: number,
): number {
  const target = (p / 100) * total
  let seen = 0
  for (const [key, count] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
    seen += count
    if (seen >= target) return key + BUCKET / 2
  }
  return 0
}
