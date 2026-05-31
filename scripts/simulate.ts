// Monte Carlo simulation — scans N timelines, collects stability metrics.
// Usage: npx tsx scripts/simulate.ts [runs=10000]
//
// Output: Archivist-style stability report + winrate by hero class.
// Failing seeds (invariant violations) are archived to /artifacts/.

import { createGame } from '../src/runtime/executor'
import { saveFailingRun } from '../src/telemetry/artifacts'
import type { HeroClass, EnemyType } from '../src/engine/types'
import type { ReplayLog } from '../src/telemetry/types'

const RUNS = parseInt(process.argv[2] ?? '10000')

const HERO_CLASSES: HeroClass[]  = ['paladin', 'bloodmage', 'berserker', 'werewolf']
const ENEMY_TYPES:  EnemyType[]  = ['goblin', 'guardian', 'vampire', 'necromancer']

// Cards per hero class — executor needs to know what to play
const HERO_CARDS: Record<HeroClass, string[]> = {
  paladin:   ['righteous_strike', 'divine_charge', 'stubborn_recovery'],
  bloodmage: ['chaos_bolt', 'open_the_wound', 'bloodrite'],
  berserker: ['savage_lunge', 'primal_fury', 'primal_dodge'],
  werewolf:  ['lunar_strike', 'pack_sense', 'stalk', 'rend', 'rampage', 'reality_crack'],
}

// ─── Auto-player ──────────────────────────────────────────────────────────────
// Random greedy: each turn, try cards in shuffled order, play if affordable.
// Target = first living enemy. Max 50 turns to prevent infinite loops.

function autoPlay(seed: number, heroClass: HeroClass, enemyType: EnemyType): ReplayLog {
  const game = createGame({ seed, heroClass, enemyType })
  const rng = mulberry32(seed ^ 0xDEAD)  // separate RNG for card shuffle

  for (let turn = 0; turn < 50; turn++) {
    const state = game.getState()
    if (state.isOver) break

    // Play 1-2 random affordable cards per turn (not always optimal)
    const cards = shuffle([...HERO_CARDS[heroClass]], rng)
    const maxPlays = Math.floor(rng() * 3) + 1  // 1–3 cards per turn
    let played = 0

    for (const cardId of cards) {
      if (played >= maxPlays) break
      const s = game.getState()
      if (s.isOver) break

      const card = s.hero.hand?.includes(cardId) || HERO_CARDS[heroClass].includes(cardId)
      const target = s.enemies.find(e => e.state !== 'dead')
      const selfOnly = ['primal_dodge', 'stubborn_recovery', 'divine_charge', 'reality_crack', 'rampage']
      if (!target && !selfOnly.includes(cardId)) continue

      game.playCard(cardId, target?.id ?? '')
      played++
    }

    if (game.getState().isOver) break
    game.endTurn()
  }

  return game.getLog()
}

// ─── Stats ────────────────────────────────────────────────────────────────────

interface ClassStats {
  wins: number
  losses: number
  turns: number[]
  corrupted: number
}

const stats: Record<HeroClass, ClassStats> = {
  paladin:   { wins: 0, losses: 0, turns: [], corrupted: 0 },
  bloodmage: { wins: 0, losses: 0, turns: [], corrupted: 0 },
  berserker: { wins: 0, losses: 0, turns: [], corrupted: 0 },
  werewolf:  { wins: 0, losses: 0, turns: [], corrupted: 0 },
}

let totalCorrupted = 0
let failingSeeds: number[] = []

// ─── Run simulation ───────────────────────────────────────────────────────────

process.stdout.write('Scanning timelines')

for (let seed = 0; seed < RUNS; seed++) {
  if (seed % (RUNS / 20) === 0) process.stdout.write('.')

  const heroClass = HERO_CLASSES[seed % HERO_CLASSES.length]
  const enemyType = ENEMY_TYPES[seed % ENEMY_TYPES.length]

  let log: ReplayLog
  let corrupted = false

  try {
    log = autoPlay(seed, heroClass, enemyType)
  } catch (e) {
    // TIMELINE CORRUPTED — invariant violation
    corrupted = true
    totalCorrupted++
    failingSeeds.push(seed)
    stats[heroClass].corrupted++
    continue
  }

  const s = stats[heroClass]
  const finalTurn = log.snapshots.length > 0
    ? log.snapshots[log.snapshots.length - 1].turn
    : 0

  if (log.outcome === 'hero_wins')  { s.wins++;   s.turns.push(finalTurn) }
  if (log.outcome === 'hero_loses') { s.losses++;  s.turns.push(finalTurn) }

  // Save corrupted seeds from hash mismatches
  const hashFailed = log.snapshots.some(snap => !snap.hashValid)
  if (hashFailed && !failingSeeds.includes(seed)) {
    failingSeeds.push(seed)
    saveFailingRun(log)
  }
}

process.stdout.write('\n\n')

// ─── Save failing seeds ───────────────────────────────────────────────────────

if (failingSeeds.length > 0) {
  console.log(`${failingSeeds.length} failing seed(s) archived to /artifacts/\n`)
}

// ─── Report ───────────────────────────────────────────────────────────────────

const totalStable = RUNS - totalCorrupted
const stabilityPct = ((totalStable / RUNS) * 100).toFixed(1)

const bar = (pct: number, width = 10) => {
  const filled = Math.round(pct / 100 * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

const avg = (arr: number[]) =>
  arr.length > 0 ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : '—'

console.log('═'.repeat(52))
console.log('  TIMELINE STABILITY REPORT')
console.log('═'.repeat(52))
console.log()
console.log(`  Seeds scanned    ${RUNS.toLocaleString()}`)
console.log(`  Timelines stable ${totalStable.toLocaleString()}  (${stabilityPct}%)`)
console.log(`  Corrupted        ${totalCorrupted}`)
console.log()
console.log('  WINRATE BY CLASS:')
console.log()

for (const heroClass of HERO_CLASSES) {
  const s = stats[heroClass]
  const total = s.wins + s.losses
  const winPct = total > 0 ? (s.wins / total * 100) : 0
  const avgTurns = avg(s.turns)
  const corruption = s.corrupted > 0 ? `  ⚠ ${s.corrupted} corrupted` : ''

  console.log(
    `  ${heroClass.padEnd(10)} ${bar(winPct)}  ${winPct.toFixed(1).padStart(5)}%` +
    `  (avg ${avgTurns} turns)${corruption}`
  )
}

console.log()

// Deadliest outcome analysis
const allWins   = HERO_CLASSES.reduce((n, c) => n + stats[c].wins,   0)
const totalRuns = HERO_CLASSES.reduce((n, c) => n + stats[c].wins + stats[c].losses, 0)
const overallWinPct = totalRuns > 0 ? (allWins / totalRuns * 100).toFixed(1) : '0'

console.log(`  Overall hero win rate:  ${overallWinPct}%`)
console.log(`  Failing seeds archived: ${failingSeeds.length}`)
console.log()

if (totalCorrupted === 0 && failingSeeds.length === 0) {
  console.log('  Simulation stable. No invariant drift detected.')
} else {
  console.log(`  ⚠ Instability detected in ${failingSeeds.length} timeline(s).`)
  console.log(`    Seeds: ${failingSeeds.slice(0, 10).join(', ')}${failingSeeds.length > 10 ? '...' : ''}`)
}

console.log()
console.log('═'.repeat(52))

// ─── RNG + shuffle utils ──────────────────────────────────────────────────────

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
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}
