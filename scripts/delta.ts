// Delta between two evidence snapshots — did this build move the numbers, and
// is the movement real?
//
// Why this exists. A single evidence pack answers "what does this build do".
// The question that follows a shared-mechanic change is different: "what did
// this build do *differently*, and does any of it matter". Diffing the Markdown
// answers neither — it reports every digit that moved, and most digits move.
//
// The hard part is not subtraction, it is deciding what counts as a change.
// Two rules here:
//
//   Win rates are compared by confidence interval, not by point estimate. If
//   the intervals overlap, the run cannot distinguish the builds, and saying
//   "70.5% → 70.1%, down 0.4 points" would be reporting noise as a finding.
//   Non-overlapping intervals mean the difference survived the sampling.
//
//   RNG p-values are compared exactly. Every seed in the battery is fixed, so a
//   p-value that moves at all means the generator changed. There is no noise
//   band to allow for, and a "small" change is exactly as alarming as a large
//   one.
//
// Usage:
//   npm run delta artifacts/baseline.json artifacts/cert-evidence.json
//   npm run delta artifacts/baseline.json           # compares against the current pack

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pct, intervalsOverlap } from './lib/stats'

const BEFORE_PATH = process.argv[2]
const AFTER_PATH = process.argv[3] ?? 'artifacts/cert-evidence.json'

if (!BEFORE_PATH) {
  console.error('Usage: npm run delta <before.json> [after.json]')
  console.error('Snapshots are written by `npm run cert-evidence`.')
  process.exit(2)
}

interface ClassSnapshot {
  wins: number
  losses: number
  winrate: number
  ci: { low: number; high: number }
  verdict: string
  turnsMean: number | null
  rtp: number
  hitFrequency: number
  maxWin: number
  volatility: number
}

interface Snapshot {
  build: { shortCommit: string; branch: string; engineHash: string; corridorHash: string; generatedAt: string }
  runs: number
  baseSeed: number
  configurationsScanned: number
  configurationsTotal: number
  corrupted: number
  hashDivergences: number
  rng: Array<{ test: string; reference: string; seeds: string; samples: number; pValue: number }>
  classes: Record<string, ClassSnapshot>
  matchups: Record<string, { wins: number; losses: number; winrate: number }>
}

function load(path: string): Snapshot {
  try {
    return JSON.parse(readFileSync(resolve(path), 'utf8')) as Snapshot
  } catch (error) {
    console.error(`Cannot read snapshot ${path}: ${(error as Error).message}`)
    process.exit(2)
  }
}

const before = load(BEFORE_PATH)
const after = load(AFTER_PATH)

const WIDTH = 78
const line = (char = '═') => char.repeat(WIDTH)

console.log(line())
console.log('  EVIDENCE DELTA')
console.log(line())
console.log()

// ─── What was compared ────────────────────────────────────────────────────────

console.log(`  before  ${before.build.shortCommit}  ${before.build.generatedAt.slice(0, 16)}  ${before.runs.toLocaleString()} seeds`)
console.log(`  after   ${after.build.shortCommit}  ${after.build.generatedAt.slice(0, 16)}  ${after.runs.toLocaleString()} seeds`)
console.log()

if (before.runs !== after.runs || before.baseSeed !== after.baseSeed) {
  // Different sample, so every comparison below carries sampling noise that has
  // nothing to do with the build. Worth stating loudly rather than footnoting.
  console.log('  ⚠ Sample differs between the two runs. Differences below mix build')
  console.log('    changes with sampling noise; re-run both at the same volume to separate them.')
  console.log()
}

const engineChanged = before.build.engineHash !== after.build.engineHash
const corridorChanged = before.build.corridorHash !== after.build.corridorHash

console.log(`  engine hash     ${engineChanged ? `${before.build.engineHash} → ${after.build.engineHash}  CHANGED` : 'unchanged'}`)
console.log(`  corridor hash   ${corridorChanged ? `${before.build.corridorHash} → ${after.build.corridorHash}  CHANGED` : 'unchanged'}`)
console.log()

if (!engineChanged && !corridorChanged) {
  console.log('  Neither the rules nor the acceptance bounds moved. Any difference below')
  console.log('  therefore comes from the sample, not from the build.')
  console.log()
}

// ─── Determinism ──────────────────────────────────────────────────────────────

const determinismBroke =
  after.corrupted > before.corrupted || after.hashDivergences > before.hashDivergences

console.log('  DETERMINISM')
console.log(`    corrupted timelines   ${before.corrupted} → ${after.corrupted}`)
console.log(`    hash divergences      ${before.hashDivergences} → ${after.hashDivergences}`)
console.log(`    configurations        ${before.configurationsScanned}/${before.configurationsTotal} → ${after.configurationsScanned}/${after.configurationsTotal}`)
console.log()

// ─── RNG battery ──────────────────────────────────────────────────────────────
//
// Fixed seeds, so this is an equality check rather than a comparison.

const rngBefore = new Map(before.rng.map(r => [r.test, r]))
const rngMoved: string[] = []

for (const test of after.rng) {
  const prior = rngBefore.get(test.test)
  if (!prior) {
    rngMoved.push(`${test.test}: new in this build (p = ${test.pValue.toExponential(2)})`)
    continue
  }
  if (prior.pValue !== test.pValue) {
    rngMoved.push(`${test.test}: p ${prior.pValue.toExponential(2)} → ${test.pValue.toExponential(2)}`)
  }
}

const rngDropped = before.rng.filter(r => !after.rng.some(a => a.test === r.test))

console.log('  RNG BATTERY')
if (rngMoved.length === 0 && rngDropped.length === 0) {
  console.log('    identical — every p-value reproduced exactly, the generator is untouched')
} else {
  for (const item of rngMoved) console.log(`    ⚠ ${item}`)
  for (const r of rngDropped) console.log(`    ⚠ ${r.test}: dropped from the battery`)
  console.log()
  console.log('    Seeds are fixed, so a p-value cannot move by chance. Something in the')
  console.log('    generator or in the battery changed.')
}
console.log()

// ─── Win rate by class ────────────────────────────────────────────────────────
//
// Compared by interval overlap. Two intervals that overlap are not evidence of
// a difference, however far apart their midpoints look.

console.log('  WIN RATE BY CLASS')
console.log()
console.log('    class        before    after     change   verdict                significance')
console.log(`    ${'─'.repeat(WIDTH - 8)}`)

let significantShifts = 0
let verdictChanges = 0

const classes = [...new Set([...Object.keys(before.classes), ...Object.keys(after.classes)])].sort()

for (const heroClass of classes) {
  const b = before.classes[heroClass]
  const a = after.classes[heroClass]

  if (!b || !a) {
    console.log(`    ${heroClass.padEnd(12)}${!b ? 'added in this build' : 'removed in this build'}`)
    continue
  }

  const change = a.winrate - b.winrate
  const significant = !intervalsOverlap(b.ci, a.ci)
  if (significant) significantShifts++

  const verdictShift = b.verdict !== a.verdict
  if (verdictShift) verdictChanges++

  console.log(
    `    ${heroClass.padEnd(12)}` +
    `${pct(b.winrate).padStart(7)}  ` +
    `${pct(a.winrate).padStart(7)}  ` +
    `${(change >= 0 ? '+' : '') + (change * 100).toFixed(1) + 'pp'}`.padStart(9) + '  ' +
    `${(verdictShift ? `${b.verdict} → ${a.verdict}` : a.verdict).padEnd(22)}` +
    (significant ? 'SIGNIFICANT' : 'within noise')
  )
}
console.log()

// ─── Return metrics ───────────────────────────────────────────────────────────

console.log('  RETURN METRICS')
console.log()
console.log('    class          RTP            hit freq        max win     volatility')
console.log(`    ${'─'.repeat(WIDTH - 8)}`)

for (const heroClass of classes) {
  const b = before.classes[heroClass]
  const a = after.classes[heroClass]
  if (!b || !a) continue

  const arrow = (x: number, y: number, digits = 2) =>
    `${x.toFixed(digits)} → ${y.toFixed(digits)}`.padEnd(15)

  console.log(
    `    ${heroClass.padEnd(12)}` +
    arrow(b.rtp, a.rtp) +
    `${pct(b.hitFrequency)} → ${pct(a.hitFrequency)}`.padEnd(16) +
    `${b.maxWin} → ${a.maxWin}`.padEnd(12) +
    arrow(b.volatility, a.volatility)
  )
}
console.log()

// ─── Matchups that crossed a corridor bound ───────────────────────────────────

const matchupShifts: string[] = []
for (const [key, a] of Object.entries(after.matchups)) {
  const b = before.matchups[key]
  if (!b) { matchupShifts.push(`${key}: new pair (${pct(a.winrate)})`); continue }
  const change = Math.abs(a.winrate - b.winrate)
  // 5 percentage points on a per-cell sample is well outside its own noise at
  // the volumes this project runs, and small enough to catch a real drift.
  if (change >= 0.05) {
    matchupShifts.push(`${key}: ${pct(b.winrate)} → ${pct(a.winrate)}`)
  }
}

console.log('  MATCHUPS MOVED BY 5pp OR MORE')
if (matchupShifts.length === 0) {
  console.log('    none')
} else {
  for (const shift of matchupShifts.sort()) console.log(`    ${shift}`)
}
console.log()

// ─── Verdict ──────────────────────────────────────────────────────────────────

console.log(line())
const headline: string[] = []
if (determinismBroke) headline.push('DETERMINISM REGRESSED')
if (rngMoved.length > 0 || rngDropped.length > 0) headline.push('RNG BATTERY MOVED')
if (verdictChanges > 0) headline.push(`${verdictChanges} corridor verdict(s) changed`)
if (significantShifts > 0) headline.push(`${significantShifts} class win rate(s) shifted significantly`)

console.log(headline.length > 0 ? `  ${headline.join(' · ')}` : '  No significant change in any tracked metric.')
console.log(line())

// Determinism and the RNG battery are defects. A balance shift is a design
// signal — the same split the CI workflow applies.
process.exit(determinismBroke || rngMoved.length > 0 || rngDropped.length > 0 ? 1 : 0)
