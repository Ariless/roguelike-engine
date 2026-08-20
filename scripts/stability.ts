// Стабильность метрик — отвечает на вопрос, который один батч задать не может.
//
// Usage: npx tsx scripts/stability.ts [runsPerBatch=8000] [batches=8]
//
// simulate.ts даёт винрейт с доверительным интервалом, то есть оценивает
// внутрибатчевый шум. Но интервал считается в предположении, что батч —
// случайная выборка. Если исход систематически зависит от того, с какого seed
// начали, интервал будет узким и при этом неверным: он сойдётся к неправильному
// числу и будет выглядеть тем убедительнее, чем больше прогонов.
//
// Поэтому здесь два независимых измерения:
//
//   1. РАЗБРОС между батчами на разных базовых seed при одинаковом размере.
//      Проверяет, что оценка не зависит от точки входа в поток.
//   2. СХОДИМОСТЬ при росте числа прогонов.
//      Проверяет, что оценка успокаивается, а не гуляет.
//
// Метрика может пройти первое и провалить второе, и наоборот. Совпадение
// доверительного интервала с межбатчевым разбросом — единственное, что даёт
// право предъявлять число одного батча как характеристику системы.

import { runBatch, winrateOf, HERO_CLASSES } from './lib/harness'
import {
  mean, stdDev, wilsonInterval, marginOfError, pct,
} from './lib/stats'
import { CROSS_BATCH_SPREAD_MAX } from './lib/corridors'
import type { HeroClass } from '../src/engine/types'

const RUNS_PER_BATCH = parseInt(process.argv[2] ?? '8000')
const BATCHES        = parseInt(process.argv[3] ?? '8')

// Шаг между базовыми seed.
//
// Не круглое число и не кратное 0x6D2B79F5 (1 831 565 813) — умышленно.
// tests/rng-statistical.test.ts показывает, что seed не выбирает независимый
// поток, а выбирает точку входа в один поток длины 2³²: два seed, отличающиеся
// ровно на эту константу, дают одну и ту же последовательность со сдвигом на
// шаг. Батчи, разнесённые кратно ей, перекрывались бы — и «независимые»
// повторы измеряли бы одно и то же, давая ложно малый разброс.
const BATCH_STRIDE = 1_000_003

const WIDTH = 78
const line = (char = '═') => char.repeat(WIDTH)

// ─── Измерение 1: разброс между батчами ───────────────────────────────────────

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

// ─── Отчёт по разбросу ────────────────────────────────────────────────────────

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

  // Ожидаемая полуширина интервала для одного батча — с чем сравнивать разброс.
  // Берём среднюю долю по батчам как оценку p.
  const avgRate = mean(rates)
  const halfWidth = marginOfError(Math.round(avgRate * RUNS_PER_BATCH), RUNS_PER_BATCH)

  const overLimit = spread > CROSS_BATCH_SPREAD_MAX
  // Разброс между батчами должен укладываться примерно в интервал одного батча.
  // Систематически шире — значит источник разброса не выборочный шум, а seed.
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

// ─── Измерение 2: сходимость ──────────────────────────────────────────────────
//
// Удваиваем число прогонов и смотрим на две вещи одновременно: как двигается
// точечная оценка и как сужается интервал. Правильная картина — оценка стоит
// на месте, интервал сужается примерно как 1/√n. Если оценка ползёт в одну
// сторону при каждом удвоении, значит она ещё не сошлась, а узкий интервал
// на последнем шаге создаёт ложную уверенность.

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

// Сошлось, если последние два удвоения двигают оценку меньше, чем на
// полуширину интервала последнего шага.
const lastDeltas = deltas.slice(-2)
const converged = lastDeltas.every(d => d < 0.005)

console.log(`  Last two doublings moved the estimate by ` +
            `${lastDeltas.map(d => pct(d, 3)).join(' and ')} — ` +
            `${converged ? 'converged' : 'NOT converged'}`)
console.log()

// ─── Итог ─────────────────────────────────────────────────────────────────────

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
