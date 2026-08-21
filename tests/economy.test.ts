import { describe, it, expect } from 'vitest'
import { payoutsFrom, economyOf, combineEconomies } from '../scripts/lib/economy'
import type { ReplayLog, TurnSnapshot, ReplayEvent } from '../src/telemetry/types'

// ─── Why this file exists ─────────────────────────────────────────────────────
//
// These metrics are read as a report, not as a pass/fail. Nobody re-derives an
// RTP by hand, which is exactly the property that let BUG-13 stand: a plausible
// number under the wrong label survives indefinitely. So every figure here is
// checked against a log built by hand, where the right answer is known before
// the function runs.

function card(turn: number): ReplayEvent {
  return { type: 'play_card', turn, preStateHash: 'aaaaaa', postStateHash: 'bbbbbb' }
}

function turnEnd(turn: number): ReplayEvent {
  return { type: 'turn_end', turn, preStateHash: 'aaaaaa', postStateHash: 'bbbbbb' }
}

/** Builds a snapshot with one enemy at a given HP and a given number of cards played. */
function snap(turn: number, enemyHp: number, cardsPlayed: number, maxHp = 20): TurnSnapshot {
  return {
    turn,
    hero: {
      id: 'hero', name: 'Hero', hp: 30, maxHp: 30, state: 'alive', statuses: [],
    },
    enemies: [
      { id: 'e0', name: 'Goblin', hp: enemyHp, maxHp, state: enemyHp > 0 ? 'alive' : 'dead', statuses: [] },
    ],
    events: [...Array.from({ length: cardsPlayed }, () => card(turn)), turnEnd(turn)],
    hashValid: true,
  }
}

function logOf(snapshots: TurnSnapshot[]): ReplayLog {
  return {
    seed: 1, heroClass: 'paladin', enemyType: 'goblin', faults: {},
    events: snapshots.flatMap(s => s.events), snapshots, outcome: 'hero_wins',
  }
}

// ─── Extraction ───────────────────────────────────────────────────────────────

describe('payoutsFrom', () => {
  it('reads damage as the drop in enemy HP between snapshots', () => {
    // 20 → 14 → 6 → 0, so the returns are 6, 8, 6
    const payouts = payoutsFrom(logOf([snap(1, 14, 2), snap(2, 6, 2), snap(3, 0, 1)]))
    expect(payouts.map(p => p.return)).toEqual([6, 8, 6])
  })

  it('counts cards played as the stake', () => {
    const payouts = payoutsFrom(logOf([snap(1, 14, 2), snap(2, 6, 3), snap(3, 0, 1)]))
    expect(payouts.map(p => p.stake)).toEqual([2, 3, 1])
  })

  it('measures the first turn against full HP, not against zero', () => {
    // Without the maxHp baseline the opening turn would report a return of 0
    // and quietly deflate the RTP of every run.
    const payouts = payoutsFrom(logOf([snap(1, 15, 1, 20)]))
    expect(payouts[0].return).toBe(5)
  })

  it('ignores turns where no card was played', () => {
    // A stunned turn costs nothing, so it is not a spin. Counting it would
    // depress the hit frequency with turns the player never paid for.
    const payouts = payoutsFrom(logOf([snap(1, 14, 2), snap(2, 14, 0), snap(3, 8, 1)]))
    expect(payouts).toHaveLength(2)
    expect(payouts.map(p => p.turn)).toEqual([1, 3])
  })

  it('treats enemy healing as zero, not as a negative payout', () => {
    // Lifesteal belongs to the enemy's economy. A negative return here would
    // subtract from the hero's RTP and make a build look worse than it is.
    const payouts = payoutsFrom(logOf([snap(1, 10, 1), snap(2, 16, 1)]))
    expect(payouts.map(p => p.return)).toEqual([10, 0])
  })

  it('a spawned enemy contributes no damage on the turn it appears', () => {
    const withSpawn: TurnSnapshot = {
      ...snap(2, 10, 1),
      enemies: [
        { id: 'e0', name: 'Goblin', hp: 10, maxHp: 20, state: 'alive', statuses: [] },
        { id: 'skeleton-1', name: 'Skeleton', hp: 8, maxHp: 8, state: 'alive', statuses: [] },
      ],
    }
    const payouts = payoutsFrom(logOf([snap(1, 14, 1), withSpawn]))
    expect(payouts[1].return).toBe(4) // only the goblin's 14 → 10
  })
})

// ─── Aggregation ──────────────────────────────────────────────────────────────

describe('economyOf', () => {
  const payouts = [
    { turn: 1, stake: 2, return: 6 },
    { turn: 2, stake: 2, return: 0 },
    { turn: 3, stake: 1, return: 9 },
    { turn: 4, stake: 1, return: 5 },
  ]

  it('RTP is total return over total stake', () => {
    // 20 damage for 6 cards
    expect(economyOf(payouts).rtp).toBeCloseTo(20 / 6, 10)
  })

  it('hit frequency counts turns that returned anything', () => {
    expect(economyOf(payouts).hitFrequency).toBe(0.75)
  })

  it('max win is the largest single-turn return', () => {
    expect(economyOf(payouts).maxWin).toBe(9)
  })

  it('max win multiple is measured against the mean stake', () => {
    const e = economyOf(payouts)
    expect(e.maxWinMultiple).toBeCloseTo(9 / (6 / 4), 10)
  })

  it('volatility is the coefficient of variation, not the raw spread', () => {
    // Two distributions with the same mean and different spread must differ
    // here — that is the whole point of tracking it separately from the mean.
    const flat = economyOf([
      { turn: 1, stake: 1, return: 5 },
      { turn: 2, stake: 1, return: 5 },
      { turn: 3, stake: 1, return: 5 },
    ])
    const spiky = economyOf([
      { turn: 1, stake: 1, return: 0 },
      { turn: 2, stake: 1, return: 0 },
      { turn: 3, stake: 1, return: 15 },
    ])
    expect(flat.meanReturn).toBeCloseTo(spiky.meanReturn, 10)
    expect(flat.volatility).toBe(0)
    expect(spiky.volatility).toBeGreaterThan(1)
  })

  it('buckets the distribution in ascending order', () => {
    const e = economyOf(payouts)
    expect([...e.buckets.keys()]).toEqual([0, 5])
    expect(e.buckets.get(0)).toBe(1)  // the 0
    expect(e.buckets.get(5)).toBe(3)  // 6, 9, 5
  })

  it('an empty run returns zeros rather than NaN', () => {
    const e = economyOf([])
    expect(e.rtp).toBe(0)
    expect(e.volatility).toBe(0)
    expect(Number.isNaN(e.rtp)).toBe(false)
  })

  it('a run that deals no damage reports RTP 0, not a crash', () => {
    // This is what BUG-14's necromancer looks like from the economy side.
    const e = economyOf([
      { turn: 1, stake: 2, return: 0 },
      { turn: 2, stake: 2, return: 0 },
    ])
    expect(e.rtp).toBe(0)
    expect(e.hitFrequency).toBe(0)
    expect(e.volatility).toBe(0)
  })
})

// ─── Combining runs ───────────────────────────────────────────────────────────

describe('combineEconomies', () => {
  it('RTP over many runs is pooled, not averaged', () => {
    // Averaging per-run RTPs would weight a two-turn run the same as a
    // twenty-turn one. Pooling the totals is the only correct aggregation.
    const short = economyOf([{ turn: 1, stake: 1, return: 10 }])
    const long = economyOf(
      Array.from({ length: 9 }, (_, i) => ({ turn: i + 1, stake: 1, return: 2 })),
    )
    const combined = combineEconomies([short, long])
    expect(combined.rtp).toBeCloseTo((10 + 18) / 10, 10)
    // The naive average of 10 and 2 would be 6 — nowhere near the truth
    expect(combined.rtp).toBeLessThan(3)
  })

  it('keeps the total spin count and the largest max win', () => {
    const a = economyOf([{ turn: 1, stake: 1, return: 4 }])
    const b = economyOf([{ turn: 1, stake: 1, return: 21 }])
    const combined = combineEconomies([a, b])
    expect(combined.spins).toBe(2)
    expect(combined.maxWin).toBe(21)
  })

  it('ignores empty runs instead of dragging the mean to zero', () => {
    const real = economyOf([{ turn: 1, stake: 1, return: 8 }])
    const empty = economyOf([])
    expect(combineEconomies([real, empty]).rtp).toBeCloseTo(8, 10)
  })

  it('combining nothing returns zeros', () => {
    expect(combineEconomies([]).spins).toBe(0)
  })

  it('survives a batch large enough to blow the call stack (BUG-17)', () => {
    // The first million-seed run died here: Math.max(...xs) passes every element
    // as a separate argument and throws RangeError past roughly 10⁵ of them.
    // It worked at 16,000 runs and failed at 1,000,000 — invisible until the
    // scale that actually matters. This test pins the size the aggregation has
    // to survive so the regression cannot come back quietly.
    const many = Array.from({ length: 300_000 }, (_, i) =>
      economyOf([{ turn: 1, stake: 1, return: i % 30 }]),
    )
    const combined = combineEconomies(many)
    expect(combined.spins).toBe(300_000)
    expect(combined.maxWin).toBe(29)
  })

  it('economyOf survives a single very long run', () => {
    const payouts = Array.from({ length: 200_000 }, (_, i) => ({
      turn: i, stake: 1, return: i % 17,
    }))
    expect(economyOf(payouts).maxWin).toBe(16)
  })
})
