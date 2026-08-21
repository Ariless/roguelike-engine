// Monte Carlo simulation — scans N timelines and checks them against the corridors.
//
// Usage: npx tsx scripts/simulate.ts [runs=10000] [baseSeed=0] [--gate]
//
// For each class the report gives: win rate with a confidence interval, a verdict
// against the corridor, mean duration with spread, the hero/enemy matchup matrix and
// the distribution of battle lengths. Failing seeds are archived into /artifacts/.
//
// Exit code:
//   1 — corrupted timelines or a hash divergence (that is a defect)
//   1 — with --gate, also when balance leaves its corridor (that is a design signal)
//   0 — otherwise
//
// The split is deliberate: broken determinism cannot be left in a branch,
// while drifted balance is material for a decision, not a reason to fail the build.

import {
  runBatch, winrateOf, configFor, matchupKey,
  HERO_CLASSES, ENEMY_TYPES,
} from './lib/harness'
import {
  mean, stdDev, percentile, wilsonInterval, verdictFor, histogram, pct, bar, maxOf,
  type Verdict,
} from './lib/stats'
import { CLASS_WINRATE, MATCHUP_WINRATE, BATTLE_DURATION } from './lib/corridors'
import { combineEconomies } from './lib/economy'

const RUNS      = parseInt(process.argv[2] ?? '10000')
const BASE_SEED = parseInt(process.argv[3] ?? '0')
const GATE      = process.argv.includes('--gate')

const WIDTH = 78
const line = (char = '═') => char.repeat(WIDTH)

// ─── Run ─────────────────────────────────────────────────────────────────────

process.stdout.write('Scanning timelines')
const progressStep = Math.max(1, Math.floor(RUNS / 20))

const batch = runBatch(RUNS, BASE_SEED, {
  onProgress: done => {
    if (done % progressStep === 0) process.stdout.write('.')
  },
})

process.stdout.write('\n\n')

// ─── Timeline stability ──────────────────────────────────────────────────────

const stable = RUNS - batch.corrupted
const hashMismatches = batch.failingSeeds.length - batch.corrupted

console.log(line())
console.log('  TIMELINE STABILITY REPORT')
console.log(line())
console.log()
console.log(`  Seeds scanned      ${RUNS.toLocaleString()}  (base seed ${BASE_SEED.toLocaleString()})`)
console.log(`  Timelines stable   ${stable.toLocaleString()}  (${pct(stable / RUNS)})`)
console.log(`  Corrupted          ${batch.corrupted}`)
console.log(`  Hash mismatches    ${Math.max(0, hashMismatches)}`)
console.log()

// ─── Win rate by class ───────────────────────────────────────────────────────

const VERDICT_MARK: Record<Verdict, string> = {
  PASS:         'PASS',
  FAIL:         'FAIL',
  INCONCLUSIVE: '????',
}

console.log(`  WINRATE BY CLASS — corridor ${pct(CLASS_WINRATE.min)}–${pct(CLASS_WINRATE.max)}`)
console.log()
console.log('  class        winrate            95% CI          verdict   turns (mean ± sd)   p95')
console.log(`  ${'─'.repeat(WIDTH - 4)}`)

const classVerdicts: Verdict[] = []

for (const heroClass of HERO_CLASSES) {
  const s = batch.perClass[heroClass]
  const decided = s.wins + s.losses
  const wr = winrateOf(s)
  const ci = wilsonInterval(s.wins, decided)
  const verdict = verdictFor(ci, CLASS_WINRATE)
  classVerdicts.push(verdict)

  const turnsMean = mean(s.turns)
  const turnsSd   = stdDev(s.turns)

  console.log(
    `  ${heroClass.padEnd(11)}` +
    `${bar(wr)} ${pct(wr).padStart(6)}   ` +
    `[${pct(ci.low)}, ${pct(ci.high)}]`.padEnd(17) +
    `${VERDICT_MARK[verdict].padEnd(9)} ` +
    `${turnsMean.toFixed(1)} ± ${turnsSd.toFixed(1)}`.padEnd(19) +
    `${percentile(s.turns, 95)}` +
    (s.corrupted > 0 ? `   ⚠ ${s.corrupted} corrupted` : '')
  )
}

console.log()

// ─── Return metrics ──────────────────────────────────────────────────────────
//
// What the win rate cannot say. Win rate answers "did the hero win"; this
// answers "what came back per unit staked, and how evenly". A class can sit
// comfortably inside the win-rate corridor while returning a third of what
// another class returns for the same spend — same verdict, different game.
//
// stake = cards played in a turn, return = damage dealt that turn. See
// scripts/lib/economy.ts for why the mapping is drawn this way.

console.log('  RETURN METRICS — per unit staked (stake = one card played)')
console.log()
console.log(
  '  ' + 'class'.padEnd(11) +
  'RTP'.padStart(7) +
  'hit freq'.padStart(11) +
  'max win'.padStart(9) +
  '× stake'.padStart(9) +
  'volatility'.padStart(12) +
  'p95'.padStart(7),
)
console.log('  ' + '─'.repeat(66))

for (const heroClass of HERO_CLASSES) {
  const economy = combineEconomies(batch.perClass[heroClass].economies)
  if (economy.spins === 0) {
    console.log(`  ${heroClass.padEnd(11)}${'no spins recorded'.padStart(55)}`)
    continue
  }
  console.log(
    '  ' + heroClass.padEnd(11) +
    economy.rtp.toFixed(2).padStart(7) +
    `${(economy.hitFrequency * 100).toFixed(1)}%`.padStart(11) +
    String(economy.maxWin).padStart(9) +
    economy.maxWinMultiple.toFixed(1).padStart(9) +
    economy.volatility.toFixed(2).padStart(12) +
    economy.p95.toFixed(1).padStart(7),
  )
}

console.log()

// ─── Matchup matrix ──────────────────────────────────────────────────────────
//
// Always printed, not only on deviation: this table is what shows
// how much of the configuration space was scanned at all. An empty
// cell means the pair never came up on any seed.

const perCell = Math.floor(RUNS / (HERO_CLASSES.length * ENEMY_TYPES.length))

console.log(`  MATCHUP MATRIX — winrate per pair, ~${perCell.toLocaleString()} runs per cell`)
console.log(`  corridor ${pct(MATCHUP_WINRATE.min)}–${pct(MATCHUP_WINRATE.max)}, ! = outside`)
console.log()
console.log('  ' + 'hero \\ enemy'.padEnd(13) + ENEMY_TYPES.map(e => e.padStart(13)).join(''))

let matchupOutside = 0
let cellsCovered = 0

for (const heroClass of HERO_CLASSES) {
  const cells = ENEMY_TYPES.map(enemyType => {
    const m = batch.perMatchup.get(matchupKey(heroClass, enemyType))
    if (!m || m.wins + m.losses === 0) return '—'.padStart(13)

    cellsCovered++
    const wr = winrateOf(m)
    const ci = wilsonInterval(m.wins, m.wins + m.losses)
    const verdict = verdictFor(ci, MATCHUP_WINRATE)
    if (verdict === 'FAIL') matchupOutside++

    return `${pct(wr)}${verdict === 'FAIL' ? '!' : ' '}`.padStart(13)
  })

  console.log('  ' + heroClass.padEnd(13) + cells.join(''))
}

const totalCells = HERO_CLASSES.length * ENEMY_TYPES.length
console.log()
console.log(`  Configuration coverage: ${cellsCovered}/${totalCells} pairs scanned`)
if (matchupOutside > 0) {
  console.log(`  ${matchupOutside} pair(s) outside corridor — see ! marks`)
}
console.log()

// ─── Duration distribution ───────────────────────────────────────────────────

const allTurns = HERO_CLASSES.flatMap(c => batch.perClass[c].turns)
const durationMean = mean(allTurns)
const durationVerdict = durationMean >= BATTLE_DURATION.min && durationMean <= BATTLE_DURATION.max
  ? 'PASS' : 'FAIL'

console.log(`  BATTLE DURATION — corridor ${BATTLE_DURATION.min}–${BATTLE_DURATION.max} turns, mean ${durationMean.toFixed(1)}: ${durationVerdict}`)
console.log()

const dist = histogram(allTurns)
const maxCount = maxOf([...dist.values()])

for (const [turns, count] of dist) {
  if (count / maxCount < 0.005) continue  // a tail thinner than half a percent is not printed
  const width = Math.round((count / maxCount) * 40)
  const outside = turns < BATTLE_DURATION.min || turns > BATTLE_DURATION.max
  console.log(
    `  ${String(turns).padStart(3)} turns  ${'▇'.repeat(width).padEnd(40)} ` +
    `${count.toLocaleString().padStart(7)}${outside ? '  ·' : ''}`
  )
}

console.log()
console.log(`  p50 ${percentile(allTurns, 50)}   p95 ${percentile(allTurns, 95)}   ` +
            `max ${maxOf(allTurns)}   sd ${stdDev(allTurns).toFixed(2)}`)
console.log()

// ─── Summary ─────────────────────────────────────────────────────────────────

const passed = classVerdicts.filter(v => v === 'PASS').length
const failed = classVerdicts.filter(v => v === 'FAIL').length
const unclear = classVerdicts.filter(v => v === 'INCONCLUSIVE').length

console.log(line('─'))
console.log(`  CLASS VERDICTS: ${passed} PASS / ${failed} FAIL / ${unclear} INCONCLUSIVE`)

if (batch.corrupted === 0 && batch.failingSeeds.length === 0) {
  console.log('  Determinism: intact. No invariant drift, no hash divergence.')
} else {
  console.log(`  ⚠ Determinism: ${batch.failingSeeds.length} timeline(s) failed.`)
  console.log(`    Seeds: ${batch.failingSeeds.slice(0, 10).join(', ')}` +
              `${batch.failingSeeds.length > 10 ? '…' : ''}`)
  console.log('    Archived to /artifacts/ — load in debugger/index.html')
}

if (unclear > 0) {
  console.log(`  ${unclear} class(es) INCONCLUSIVE at ${RUNS.toLocaleString()} runs — ` +
              `interval crosses the corridor edge, needs more runs`)
}

console.log(line())

// ─── Exit code ────────────────────────────────────────────────────────────────

const determinismBroken = batch.corrupted > 0 || batch.failingSeeds.length > 0
const balanceBroken = failed > 0 || matchupOutside > 0 || durationVerdict === 'FAIL'

if (determinismBroken) process.exit(1)
if (GATE && balanceBroken) process.exit(1)
