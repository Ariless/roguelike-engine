// Evidence pack — the artefact a reviewer asks for, not the one a run leaves behind.
//
// Why this exists. A test suite proves something to the person who ran it. An
// evidence pack has to prove the same thing to someone who was not there, later,
// without access to the machine: what was checked, against what, on which build,
// with which seeds, and how to reproduce it. Those are different jobs, and the
// second one is what turns "the tests pass" into something a third party can act
// on.
//
// Two rules govern what goes in here.
//
// Nothing is asserted that was not measured in this run. Every figure below is
// produced by the run that writes the file — no numbers carried over from a
// README, no scores quoted from memory. A pack that copies a stale figure is
// worse than no pack, because it looks authoritative.
//
// Open defects are listed, not omitted. A pack that shows only green is a
// marketing document. The two open items here materially affect the numbers
// above them, and saying so is the difference between evidence and a brochure.
//
// Usage:
//   npm run cert-evidence            # default volume
//   npm run cert-evidence 100000     # explicit simulation volume

import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { runBatch, winrateOf, HERO_CLASSES, ENEMY_TYPES } from './lib/harness'
import { combineEconomies } from './lib/economy'
import { wilsonInterval, verdictFor, mean, stdDev, pct } from './lib/stats'
import { CLASS_WINRATE, MATCHUP_WINRATE, BATTLE_DURATION } from './lib/corridors'
import { createRng, nextInt, shuffle } from '../src/runtime/rng'
import { chiSquarePValue, normalTwoSidedPValue, pValueUniformity } from '../src/stats/distributions'

const RUNS = parseInt(process.argv[2] ?? '50000')
const OUT_DIR = resolve('artifacts')
const OUT_FILE = resolve(OUT_DIR, 'CERT-EVIDENCE.md')
// The same run, machine-readable. The Markdown is for a person; this is what
// `npm run delta` diffs against a later build. Two formats of one measurement,
// never two measurements.
const OUT_JSON = resolve(OUT_DIR, 'cert-evidence.json')

// ─── Build identity ───────────────────────────────────────────────────────────
// Which artefact these numbers describe. Without this the pack cannot be tied to
// anything: results that cannot be traced to a build are not evidence.

function shell(command: string): string {
  try {
    return execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return 'unavailable'
  }
}

function hashOf(...paths: string[]): string {
  const hash = createHash('sha256')
  for (const path of paths) {
    try {
      hash.update(readFileSync(resolve(path)))
    } catch {
      hash.update(`missing:${path}`)
    }
  }
  return hash.digest('hex').slice(0, 16)
}

const build = {
  commit: shell('git rev-parse HEAD'),
  shortCommit: shell('git rev-parse --short HEAD'),
  branch: shell('git rev-parse --abbrev-ref HEAD'),
  dirty: shell('git status --porcelain') !== '' ? 'yes — uncommitted changes present' : 'no',
  // The rules and the generator, hashed together: if either changes, every
  // number in this pack has to be regenerated.
  engineHash: hashOf(
    'src/engine/resolution.ts', 'src/engine/statuses.ts', 'src/engine/turnPipeline.ts',
    'src/engine/actionResolution.ts', 'src/runtime/rng.ts', 'src/runtime/executor.ts',
  ),
  corridorHash: hashOf('scripts/lib/corridors.ts'),
  generatedAt: new Date().toISOString(),
}

// ─── RNG battery ──────────────────────────────────────────────────────────────
// Recomputed here rather than read from the test suite. The suite asserts
// thresholds; the pack has to report the actual p-values, and reporting a number
// the run did not produce is exactly what this file must never do.

interface RngResult {
  test: string
  reference: string
  seeds: string
  samples: number
  pValue: number
}

function bitsOf(seed: number, n: number): Uint8Array {
  const rng = createRng(seed)
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) out[i] = rng() >= 0.5 ? 1 : 0
  return out
}

function chiSquare(observed: readonly number[], expected: number): number {
  return observed.reduce((acc, o) => acc + (o - expected) ** 2 / expected, 0)
}

function runRngBattery(): RngResult[] {
  const results: RngResult[] = []

  // NIST §2.1 Frequency (Monobit)
  {
    const N = 500_000
    const b = bitsOf(31337, N)
    let ones = 0
    for (const bit of b) ones += bit
    results.push({
      test: 'Frequency (Monobit)',
      reference: 'NIST SP 800-22 §2.1',
      seeds: '31337',
      samples: N,
      pValue: normalTwoSidedPValue((2 * ones - N) / Math.sqrt(N)),
    })
  }

  // NIST §2.2 Frequency within a Block
  {
    const M = 1000, N = 500
    const b = bitsOf(24680, M * N)
    let statistic = 0
    for (let i = 0; i < N; i++) {
      let ones = 0
      for (let j = 0; j < M; j++) ones += b[i * M + j]
      statistic += (ones / M - 0.5) ** 2
    }
    results.push({
      test: 'Frequency within a Block',
      reference: 'NIST SP 800-22 §2.2',
      seeds: '24680',
      samples: M * N,
      pValue: chiSquarePValue(statistic * 4 * M, N),
    })
  }

  // NIST §2.3 Runs
  {
    const N = 200_000
    const b = bitsOf(4242, N)
    let ones = 0
    for (const bit of b) ones += bit
    const zeros = N - ones
    let runs = 1
    for (let i = 1; i < N; i++) if (b[i] !== b[i - 1]) runs++
    const expected = (2 * ones * zeros) / N + 1
    const variance = (2 * ones * zeros * (2 * ones * zeros - N)) / (N * N * (N - 1))
    results.push({
      test: 'Runs',
      reference: 'NIST SP 800-22 §2.3',
      seeds: '4242',
      samples: N,
      pValue: normalTwoSidedPValue((runs - expected) / Math.sqrt(variance)),
    })
  }

  // NIST §2.4 Longest Run of Ones in a Block
  {
    const M = 128, N = 49
    const PROBS = [0.1174, 0.2430, 0.2493, 0.1752, 0.1027, 0.1124]
    const b = bitsOf(13579, M * N)
    const counts = new Array(PROBS.length).fill(0)
    for (let i = 0; i < N; i++) {
      let longest = 0, current = 0
      for (let j = 0; j < M; j++) {
        if (b[i * M + j] === 1) { current++; if (current > longest) longest = current }
        else current = 0
      }
      counts[Math.min(Math.max(longest, 4), 9) - 4]++
    }
    const statistic = counts.reduce((acc, observed, index) => {
      const expected = N * PROBS[index]
      return acc + (observed - expected) ** 2 / expected
    }, 0)
    results.push({
      test: 'Longest Run of Ones',
      reference: 'NIST SP 800-22 §2.4',
      seeds: '13579',
      samples: M * N,
      pValue: chiSquarePValue(statistic, PROBS.length - 1),
    })
  }

  // Classical χ² uniformity over 100 bins
  {
    const N = 200_000, BINS = 100
    const bins = new Array(BINS).fill(0)
    const rng = createRng(12345)
    for (let i = 0; i < N; i++) bins[Math.floor(rng() * BINS)]++
    results.push({
      test: 'Uniformity, 100 bins',
      reference: 'classical χ² goodness-of-fit',
      seeds: '12345',
      samples: N,
      pValue: chiSquarePValue(chiSquare(bins, N / BINS), BINS - 1),
    })
  }

  // Diehard serial — adjacent pairs on a 10×10 lattice
  {
    const N = 200_000, SIDE = 10
    const cells = new Array(SIDE * SIDE).fill(0)
    const rng = createRng(777)
    for (let i = 0; i < N; i++) {
      const x = Math.floor(rng() * SIDE)
      const y = Math.floor(rng() * SIDE)
      cells[x * SIDE + y]++
    }
    results.push({
      test: 'Serial, adjacent pairs',
      reference: 'Diehard overlapping pairs',
      seeds: '777',
      samples: N,
      pValue: chiSquarePValue(chiSquare(cells, N / (SIDE * SIDE)), SIDE * SIDE - 1),
    })
  }

  // Integer reduction bias on a range that is not a power of two
  {
    const N = 500_000
    const bins = new Array(10).fill(0)
    const rng = createRng(555)
    for (let i = 0; i < N; i++) bins[nextInt(rng, 1, 10) - 1]++
    results.push({
      test: 'Integer reduction, range 1–10',
      reference: 'classical χ² on the wrapper',
      seeds: '555',
      samples: N,
      pValue: chiSquarePValue(chiSquare(bins, N / 10), 9),
    })
  }

  // Diehard permutation test, order 4
  {
    const N = 240_000
    const permutations = new Map<string, number>()
    const rng = createRng(1234)
    for (let i = 0; i < N; i++) {
      const key = shuffle(rng, [0, 1, 2, 3]).join('')
      permutations.set(key, (permutations.get(key) ?? 0) + 1)
    }
    results.push({
      test: 'Permutation fairness, order 4',
      reference: 'Diehard permutation test',
      seeds: '1234',
      samples: N,
      pValue: chiSquarePValue(chiSquare([...permutations.values()], N / 24), 23),
    })
  }

  // NIST §4.2.2 — uniformity of the p-values themselves
  {
    const SEEDS = 300, N = 20_000
    const pValues: number[] = []
    for (let seed = 1; seed <= SEEDS; seed++) {
      const b = bitsOf(seed * 7919, N)
      let ones = 0
      for (const bit of b) ones += bit
      pValues.push(normalTwoSidedPValue((2 * ones - N) / Math.sqrt(N)))
    }
    results.push({
      test: 'Uniformity of p-values',
      reference: 'NIST SP 800-22 §4.2.2',
      seeds: '7919·k, k = 1…300',
      samples: SEEDS * N,
      pValue: pValueUniformity(pValues),
    })
  }

  return results
}

// ─── Assembly ─────────────────────────────────────────────────────────────────

const ALPHA = 0.001

console.log(`Running RNG battery…`)
const rng = runRngBattery()

console.log(`Running simulation, ${RUNS.toLocaleString()} seeds…`)
const batch = runBatch(RUNS, 0, { archiveFailures: false })

const lines: string[] = []
const w = (s = '') => lines.push(s)

w('# RNG and Simulation Evidence Pack')
w()
w('Generated by `npm run cert-evidence`. Every figure below was produced by the run')
w('that wrote this file; nothing is quoted from documentation.')
w()
w('## Build under test')
w()
w('| Field | Value |')
w('|---|---|')
w(`| Commit | \`${build.shortCommit}\` (\`${build.commit}\`) |`)
w(`| Branch | ${build.branch} |`)
w(`| Uncommitted changes | ${build.dirty} |`)
w(`| Engine + RNG hash | \`${build.engineHash}\` |`)
w(`| Corridor definition hash | \`${build.corridorHash}\` |`)
w(`| Generated at | ${build.generatedAt} |`)
w()
w('The engine hash covers the rule resolution, the turn and action pipelines and the')
w('generator. The corridor hash covers the acceptance bounds. If either changes, the')
w('numbers below no longer describe the current build and have to be regenerated.')
w()

w('## RNG statistical battery')
w()
w(`Significance level α = ${ALPHA}. Seeds are fixed, so every p-value here is`)
w('reproducible exactly; a differing value means the generator changed, not that the')
w('sample was unlucky.')
w()
w('| Test | Reference | Seed(s) | Samples | p-value | Verdict |')
w('|---|---|---|---:|---:|---|')
for (const r of rng) {
  const p = r.pValue < 1e-4 ? r.pValue.toExponential(2) : r.pValue.toFixed(4)
  w(`| ${r.test} | ${r.reference} | ${r.seeds} | ${r.samples.toLocaleString()} | ${p} | ${r.pValue > ALPHA ? 'PASS' : 'FAIL'} |`)
}
w()
const rngFailures = rng.filter(r => r.pValue <= ALPHA).length
w(`**${rng.length - rngFailures} of ${rng.length} passed.**`)
w()
w('Not covered, stated rather than implied: the spectral (DFT) test, Maurer\'s')
w('universal statistical test, linear complexity, and the template-matching family.')
w('Those require sequence lengths in the millions of bits per run. For a 32-bit')
w('generator driving a game simulation they are out of scope; claiming full')
w('SP 800-22 coverage would be the more impressive and less true statement.')
w()
w('**Known limitation of the generator.** The seed is truncated to 32 bits')
w('(`rng.ts`, `seed >>> 0`), so there are exactly 2³² distinguishable streams, and')
w('mulberry32 advances by a fixed constant — meaning a seed selects an entry point')
w('into one shared stream rather than an independent stream. Safe for sequential')
w('seeds, unsafe if seeds are ever drawn from a clock or a counter with a stride.')
w('Recorded as BUG-15 and pinned by tests.')
w()

w('## Simulation')
w()
w('| Field | Value |')
w('|---|---|')
w(`| Seeds executed | ${batch.runs.toLocaleString()} |`)
w(`| Base seed | ${batch.baseSeed} |`)
w(`| Configurations scanned | ${batch.perMatchup.size} of ${HERO_CLASSES.length * ENEMY_TYPES.length} |`)
w(`| Corrupted timelines | ${batch.corrupted} |`)
w(`| Hash divergences | ${batch.failingSeeds.length} |`)
w()
w('Configuration coverage is reported explicitly because a partially scanned space')
w('is the failure this project has already had once: a class metric that was in fact')
w('the metric of a single pair (BUG-13). A number without its coverage is not')
w('evidence.')
w()

w('### Win rate by class')
w()
w(`Corridor ${pct(CLASS_WINRATE.min)}–${pct(CLASS_WINRATE.max)}, fixed before the run.`)
w('Verdicts are taken on the confidence interval, not the point estimate: a third')
w('outcome, INCONCLUSIVE, exists for the case where the interval straddles a bound.')
w()
w('| Class | Wins | Losses | Win rate | 95% CI | Verdict |')
w('|---|---:|---:|---:|---|---|')
for (const heroClass of HERO_CLASSES) {
  const s = batch.perClass[heroClass]
  const decided = s.wins + s.losses
  const interval = wilsonInterval(s.wins, decided)
  const verdict = verdictFor(interval, CLASS_WINRATE)
  w(`| ${heroClass} | ${s.wins.toLocaleString()} | ${s.losses.toLocaleString()} | ${pct(winrateOf(s))} | [${pct(interval.low)}, ${pct(interval.high)}] | ${verdict} |`)
}
w()

w('### Return metrics')
w()
w('Stake is one card played; return is damage dealt that turn. An analogy to slot')
w('math, drawn deliberately and not a claim to be a slot engine — there is no wager,')
w('paytable or house edge here. What transfers is the question and the arithmetic.')
w()
w('| Class | RTP | Hit frequency | Max win | × stake | Volatility | p95 |')
w('|---|---:|---:|---:|---:|---:|---:|')
for (const heroClass of HERO_CLASSES) {
  const e = combineEconomies(batch.perClass[heroClass].economies)
  w(`| ${heroClass} | ${e.rtp.toFixed(2)} | ${(e.hitFrequency * 100).toFixed(1)}% | ${e.maxWin} | ${e.maxWinMultiple.toFixed(1)} | ${e.volatility.toFixed(2)} | ${e.p95.toFixed(1)} |`)
}
w()

w('### Battle duration')
w()
w(`Corridor ${BATTLE_DURATION.min}–${BATTLE_DURATION.max} turns.`)
w()
w('| Class | Mean | SD | Runs measured |')
w('|---|---:|---:|---:|')
for (const heroClass of HERO_CLASSES) {
  const turns = batch.perClass[heroClass].turns
  if (turns.length === 0) { w(`| ${heroClass} | — | — | 0 |`); continue }
  w(`| ${heroClass} | ${mean(turns).toFixed(1)} | ${stdDev(turns).toFixed(1)} | ${turns.length.toLocaleString()} |`)
}
w()

w('### Matchup coverage')
w()
w(`Corridor ${pct(MATCHUP_WINRATE.min)}–${pct(MATCHUP_WINRATE.max)} per pair.`)
w()
w('| Hero | ' + ENEMY_TYPES.join(' | ') + ' |')
w('|---|' + ENEMY_TYPES.map(() => '---:').join('|') + '|')
for (const heroClass of HERO_CLASSES) {
  const cells = ENEMY_TYPES.map(enemyType => {
    const s = batch.perMatchup.get(`${heroClass} vs ${enemyType}`)
    if (!s) return '—'
    const rate = winrateOf(s)
    const outside = rate < MATCHUP_WINRATE.min || rate > MATCHUP_WINRATE.max
    return `${pct(rate)}${outside ? ' !' : ''}`
  })
  w(`| ${heroClass} | ${cells.join(' | ')} |`)
}
w()

w('## Determinism')
w()
w('| Property | Result |')
w('|---|---|')
w(`| Corrupted timelines | ${batch.corrupted} of ${batch.runs.toLocaleString()} |`)
w(`| State-hash divergences | ${batch.failingSeeds.length} |`)
w('| Replay verification | pre/post state hash recorded per event; any run reproducible from its seed alone |')
w()
w('Determinism is the one property gated unconditionally in CI: a corrupted timeline')
w('or a hash divergence exits non-zero. Balance is reported rather than gated while')
w('the defects below remain open, because a gate that cannot go green teaches people')
w('to ignore red.')
w()

w('## Open defects affecting these figures')
w()
w('| ID | Effect on the numbers above |')
w('|---|---|')
w('| BUG-14 | Two of four enemies do not perform actions their specification declares. The necromancer deals no direct damage at all, so every class shows an inflated win rate against it, and the class-level corridors above are skewed by that column. |')
w('| BUG-16 | A UI test asserts a weaker condition than its name claims, so the mechanic missing in BUG-14 appears covered at the UI layer. |')
w('| BUG-15 | Seed space is 2³² and streams are not independent by construction. Not a defect in the results above (seeds here are sequential), but it bounds how many genuinely independent runs are obtainable. |')
w()
w('These are listed because they change how the figures should be read. A pack that')
w('showed only the green parts would be a brochure.')
w()

w('## Reproduction')
w()
w('```bash')
w(`git checkout ${build.shortCommit}`)
w('npm ci')
w('npm test                      # unit, property, statistical, replay')
w('npm run test:bdd              # executable specification')
w(`npm run cert-evidence ${RUNS}  # regenerates this file`)
w('```')
w()
w('Every p-value above is computed on a fixed seed and is reproducible exactly. The')
w('simulation figures are reproducible from the base seed for the same seed count.')

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(OUT_FILE, lines.join('\n') + '\n', 'utf8')

const snapshot = {
  build,
  runs: batch.runs,
  baseSeed: batch.baseSeed,
  configurationsScanned: batch.perMatchup.size,
  configurationsTotal: HERO_CLASSES.length * ENEMY_TYPES.length,
  corrupted: batch.corrupted,
  hashDivergences: batch.failingSeeds.length,
  rng: rng.map(r => ({ test: r.test, reference: r.reference, seeds: r.seeds, samples: r.samples, pValue: r.pValue })),
  classes: Object.fromEntries(HERO_CLASSES.map(heroClass => {
    const s = batch.perClass[heroClass]
    const decided = s.wins + s.losses
    const interval = wilsonInterval(s.wins, decided)
    const economy = combineEconomies(s.economies)
    return [heroClass, {
      wins: s.wins,
      losses: s.losses,
      winrate: winrateOf(s),
      ci: { low: interval.low, high: interval.high },
      verdict: verdictFor(interval, CLASS_WINRATE),
      turnsMean: s.turns.length > 0 ? mean(s.turns) : null,
      rtp: economy.rtp,
      hitFrequency: economy.hitFrequency,
      maxWin: economy.maxWin,
      volatility: economy.volatility,
    }]
  })),
  matchups: Object.fromEntries(
    [...batch.perMatchup.entries()].map(([key, m]) => [key, {
      wins: m.wins, losses: m.losses, winrate: winrateOf(m),
    }])
  ),
}

writeFileSync(OUT_JSON, JSON.stringify(snapshot, null, 2) + '\n', 'utf8')

console.log()
console.log(`Evidence pack written to ${OUT_FILE}`)
console.log(`Machine-readable snapshot: ${OUT_JSON}`)
console.log(`  RNG battery:     ${rng.length - rngFailures}/${rng.length} passed`)
console.log(`  Simulation:      ${batch.runs.toLocaleString()} seeds, ${batch.perMatchup.size}/${HERO_CLASSES.length * ENEMY_TYPES.length} configurations`)
console.log(`  Determinism:     ${batch.corrupted} corrupted, ${batch.failingSeeds.length} hash divergences`)

// A corrupted timeline or a hash divergence is a defect without discussion.
// Balance is not gated here — see the note in the pack.
if (batch.corrupted > 0 || batch.failingSeeds.length > 0 || rngFailures > 0) {
  console.error('\nEvidence pack records failures — see the file.')
  process.exit(1)
}
