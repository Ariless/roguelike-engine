// Metric stability — answers the question a single batch cannot ask.
//
// Usage: npx tsx scripts/stability.ts [runsPerBatch=8000] [batches=8]
//
// simulate.ts reports a win rate with a confidence interval, i.e. it estimates
// within-batch noise. But the interval assumes the batch is a
// random sample. If the outcome systematically depends on which seed sampling
// started from, the interval will be narrow and wrong at the same time: it converges to the wrong
// number, and it will look more convincing the more runs are added.
//
// Hence two independent measurements here:
//
//   1. SPREAD across batches on different base seeds at the same batch size.
//      Checks that the estimate does not depend on the entry point into the stream.
//   2. CONVERGENCE as the number of runs grows.
//      Checks that the estimate settles down rather than wandering.
//
// A metric can pass the first and fail the second, and vice versa. Comparing
// a confidence interval against cross-batch spread is the only thing that grants
// the right to present one batch's number as a property of the system.

import { runBatch, winrateOf, HERO_CLASSES } from './lib/harness'
import {
  mean, stdDev, wilsonInterval, marginOfError, pct,
} from './lib/stats'
import { CROSS_BATCH_SPREAD_MAX } from './lib/corridors'
import type { HeroClass } from '../src/engine/types'

const RUNS_PER_BATCH = parseInt(process.argv[2] ?? '8000')
const BATCHES        = parseInt(process.argv[3] ?? '8')

// Stride between base seeds.
//
// Neither a round number nor a multiple of 0x6D2B79F5 (1,831,565,813) — deliberately.
// tests/rng-statistical.test.ts shows that a seed does not choose an independent
// stream but an entry point into one stream of length 2³²: two seeds differing
// by exactly that constant produce the same sequence, offset by one
// step. Batches spaced at a multiple of it would overlap, and the "independent"
// repeats would measure the same thing, giving a falsely small spread.
const BATCH_STRIDE = 1_000_003

const WIDTH = 78
const line = (char = '═') => char.repeat(WIDTH)

// ─── Measurement 1: spread across batches ────────────────────────────────────

console.log(line())
console.log('  METRIC STABILITY REPORT')
console.log(line())
console.log()
console.log(`  ${BATCHES} batches × ${RUNS_PER_BATCH.toLocaleString()} runs ` +
            `= ${(BATCHES * RUNS_PER_BATCH).toLocaleString()} timelines`)
console.log(`  Base seeds: 0, ${BATCH_STRIDE.toLocaleString()}, ` +
            `${(2 * BATCH_STRIDE).toLocaleString()}, …  (stride ${BATCH_STRIDE.toLocaleString()})`)
console.log()

process.stdout.write('  Running batches: ')

const batchWinrates: Record<HeroClass, number[]> = {
  paladin: [], bloodmage: [], berserker: [], werewolf: [],
}
let totalCorrupted = 0
const allFailingSeeds: number[] = []

for (let b = 0; b < BATCHES; b++) {
  const baseSeed = b * BATCH_STRIDE
  const batch = runBatch(RUNS_PER_BATCH, baseSeed, { archiveFailures: false })

  for (const heroClass of HERO_CLASSES) {
    batchWinrates[heroClass].push(winrateOf(batch.perClass[heroClass]))
  }
  totalCorrupted += batch.corrupted
  allFailingSeeds.push(...batch.failingSeeds)

  process.stdout.write(`${b + 1} `)
}

console.log('\n')

// ─── Spread report ───────────────────────────────────────────────────────────

console.log(`  CROSS-BATCH SPREAD — limit ${pct(CROSS_BATCH_SPREAD_MAX)} peak-to-peak`)
console.log()
console.log('  class        min      max      spread   sd       CI half-width   verdict')
console.log(`  ${'─'.repeat(WIDTH - 4)}`)

let spreadFailures = 0
let widerThanInterval = 0

for (const heroClass of HERO_CLASSES) {
  const rates = batchWinrates[heroClass]
  const lo = Math.min(...rates)
  const hi = Math.max(...rates)
  const spread = hi - lo
  const sd = stdDev(rates)

  // Expected interval half-width for a single batch — what the spread is compared against.
  // Take the mean proportion across batches as the estimate of p.
  const avgRate = mean(rates)
  const halfWidth = marginOfError(Math.round(avgRate * RUNS_PER_BATCH), RUNS_PER_BATCH)

  const overLimit = spread > CROSS_BATCH_SPREAD_MAX
  // Cross-batch spread should sit roughly within the interval of a single batch.
  // Systematically wider means the source of the spread is the seed, not sampling noise.
  const overInterval = spread > 2.5 * 2 * halfWidth

  if (overLimit) spreadFailures++
  if (overInterval) widerThanInterval++

  const verdict = overLimit ? 'FAIL' : overInterval ? 'SEED-DEPENDENT' : 'PASS'

  console.log(
    `  ${heroClass.padEnd(11)}` +
    `${pct(lo).padStart(7)}  ${pct(hi).padStart(7)}  ` +
    `${pct(spread, 2).padStart(7)}  ${pct(sd, 2).padStart(7)}  ` +
    `${pct(halfWidth, 2).padStart(10)}      ${verdict}`
  )
}

console.log()

// ─── Measurement 2: convergence ──────────────────────────────────────────────
//
// Double the number of runs and watch two things at once: how the point estimate
// moves and how the interval narrows. The healthy picture is an estimate that
// stays put while the interval narrows roughly as 1/√n. If the estimate creeps in one
// direction at every doubling, it has not converged yet, and a narrow interval
// at the final step creates false confidence.

const CONVERGENCE_STEPS = [1_000, 2_000, 4_000, 8_000, 16_000, 32_000]

console.log('  CONVERGENCE — overall hero winrate vs number of runs')
console.log()
console.log('  runs      winrate   95% CI              half-width   Δ from previous')
console.log(`  ${'─'.repeat(WIDTH - 4)}`)

let previous: number | null = null
const deltas: number[] = []

for (const runs of CONVERGENCE_STEPS) {
  const batch = runBatch(runs, 0, { archiveFailures: false })

  let wins = 0
  let decided = 0
  for (const heroClass of HERO_CLASSES) {
    const s = batch.perClass[heroClass]
    wins += s.wins
    decided += s.wins + s.losses
  }

  const rate = wins / decided
  const ci = wilsonInterval(wins, decided)
  const half = (ci.high - ci.low) / 2
  const delta = previous === null ? null : rate - previous
  if (delta !== null) deltas.push(Math.abs(delta))

  console.log(
    `  ${runs.toLocaleString().padStart(7)}   ${pct(rate).padStart(7)}   ` +
    `[${pct(ci.low, 2)}, ${pct(ci.high, 2)}]`.padEnd(20) +
    `${pct(half, 3).padStart(10)}   ` +
    `${delta === null ? '—' : (delta > 0 ? '+' : '') + pct(delta, 3)}`
  )

  previous = rate
}

console.log()

// Converged if the last two doublings move the estimate by less than
// the interval half-width of the final step.
const lastDeltas = deltas.slice(-2)
const converged = lastDeltas.every(d => d < 0.005)

console.log(`  Last two doublings moved the estimate by ` +
            `${lastDeltas.map(d => pct(d, 3)).join(' and ')} — ` +
            `${converged ? 'converged' : 'NOT converged'}`)
console.log()

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(line('─'))

if (spreadFailures === 0 && widerThanInterval === 0) {
  console.log('  Cross-batch: stable. Estimates do not depend on the starting seed.')
} else {
  if (spreadFailures > 0) {
    console.log(`  ⚠ ${spreadFailures} class(es) exceed the ${pct(CROSS_BATCH_SPREAD_MAX)} spread limit.`)
  }
  if (widerThanInterval > 0) {
    console.log(`  ⚠ ${widerThanInterval} class(es): spread wider than the single-batch interval.`)
    console.log('    The interval understates the real uncertainty — seed drives the outcome.')
  }
}

console.log(`  Convergence: ${converged ? 'reached' : 'not reached'} at ` +
            `${CONVERGENCE_STEPS[CONVERGENCE_STEPS.length - 1].toLocaleString()} runs.`)

if (totalCorrupted > 0 || allFailingSeeds.length > 0) {
  console.log(`  ⚠ Determinism: ${allFailingSeeds.length} timeline(s) failed across all batches.`)
  console.log(`    Seeds: ${allFailingSeeds.slice(0, 10).join(', ')}` +
              `${allFailingSeeds.length > 10 ? '…' : ''}`)
} else {
  console.log('  Determinism: intact across every batch.')
}

console.log(line())

if (totalCorrupted > 0 || allFailingSeeds.length > 0) process.exit(1)
