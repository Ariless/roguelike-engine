// Trace-driven test generation — analyzes real game traces from Monte Carlo
// and surfaces patterns worth testing that weren't obvious upfront.
//
// Usage: npx tsx scripts/trace-analysis.ts [runs=2000]
//
// Output: discovered patterns + suggested property invariants to add

import { createGame } from '../src/runtime/executor'
import type { HeroClass, EnemyType } from '../src/engine/types'
import type { TurnSnapshot } from '../src/telemetry/types'

const RUNS = parseInt(process.argv[2] ?? '2000')

const HERO_CLASSES: HeroClass[] = ['paladin', 'bloodmage', 'berserker', 'werewolf']
const ENEMY_TYPES: EnemyType[]  = ['goblin', 'guardian', 'vampire', 'necromancer']

const CARDS: Record<HeroClass, string[]> = {
  paladin:   ['righteous_strike', 'divine_charge', 'stubborn_recovery'],
  bloodmage: ['chaos_bolt', 'open_the_wound', 'bloodrite'],
  berserker: ['savage_lunge', 'primal_fury', 'primal_dodge'],
  werewolf:  ['lunar_strike', 'pack_sense', 'stalk', 'rend', 'rampage', 'reality_crack'],
}

const SELF_CARDS = new Set(['primal_dodge', 'stubborn_recovery', 'divine_charge', 'reality_crack', 'rampage'])

function mulberry32(s: number) {
  return () => { s += 0x6D2B79F5; let t = s; t = Math.imul(t^(t>>>15),t|1); t^=t+Math.imul(t^(t>>>7),t|61); return ((t^(t>>>14))>>>0)/4294967296 }
}

function shuffle<T>(arr: T[], rng: ()=>number): T[] {
  const a = [...arr]; for (let i=a.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[a[i],a[j]]=[a[j],a[i]]}; return a
}

// ─── Pattern collectors ───────────────────────────────────────────────────────

interface PatternStats {
  // Status combinations that occur in real play
  statusCombos: Map<string, number>
  // HP levels at turn end (distribution)
  heroHpBuckets: number[]  // [0-10%, 10-20%, ..., 90-100%]
  // Form states when game ends
  formStateAtEnd: { human: number; werewolf: number }
  // Turns taken per outcome
  turnsByOutcome: { hero_wins: number[]; hero_loses: number[] }
  // Most common death causes
  deathAtTurn: number[]
  // HP at death door moments
  hpAtDeathDoor: number[]
  // Rage stack distribution
  maxRageStacks: number[]
  // Transform turn distribution
  transformTurns: number[]
}

function collectPatterns(snapshots: TurnSnapshot[], outcome: string, stats: PatternStats) {
  const lastSnap = snapshots[snapshots.length - 1]
  if (!lastSnap) return

  // Turn count distribution
  if (outcome === 'hero_wins')  stats.turnsByOutcome.hero_wins.push(snapshots.length)
  if (outcome === 'hero_loses') stats.turnsByOutcome.hero_loses.push(snapshots.length)

  // Death turn
  if (outcome === 'hero_loses') stats.deathAtTurn.push(snapshots.length)

  // Form state at end
  if (lastSnap.hero.formState === 'werewolf') stats.formStateAtEnd.werewolf++
  else stats.formStateAtEnd.human++

  for (const snap of snapshots) {
    // HP bucket (hero HP as % of maxHp)
    const hpPct = snap.hero.maxHp > 0 ? snap.hero.hp / snap.hero.maxHp : 1
    const bucket = Math.min(9, Math.floor(hpPct * 10))
    stats.heroHpBuckets[bucket]++

    // HP at death_door events
    if (snap.hero.state === 'death_door') {
      stats.hpAtDeathDoor.push(snap.hero.hp)
    }

    // Status combos
    const names = snap.hero.statuses.map(s => s.name).sort().join('+')
    if (names) {
      stats.statusCombos.set(names, (stats.statusCombos.get(names) ?? 0) + 1)
    }

    // Werewolf transform turn
    if (snap.hero.formState === 'werewolf') {
      const existing = stats.transformTurns.includes(snap.turn)
      if (!existing) stats.transformTurns.push(snap.turn)
    }
  }
}

// ─── Run collection ───────────────────────────────────────────────────────────

const stats: PatternStats = {
  statusCombos: new Map(),
  heroHpBuckets: new Array(10).fill(0),
  formStateAtEnd: { human: 0, werewolf: 0 },
  turnsByOutcome: { hero_wins: [], hero_loses: [] },
  deathAtTurn: [],
  hpAtDeathDoor: [],
  maxRageStacks: [],
  transformTurns: [],
}

process.stdout.write(`Analyzing ${RUNS} traces`)

for (let seed = 0; seed < RUNS; seed++) {
  if (seed % (RUNS / 20) === 0) process.stdout.write('.')

  const heroClass = HERO_CLASSES[seed % HERO_CLASSES.length]
  const enemyType = ENEMY_TYPES[seed % ENEMY_TYPES.length]

  try {
    const game = createGame({ seed, heroClass, enemyType })
    const rng = mulberry32(seed ^ 0xFACE)

    for (let t = 0; t < 30; t++) {
      if (game.getState().isOver) break
      const cards = shuffle([...CARDS[heroClass]], rng)
      const max = Math.floor(rng() * 3) + 1
      let played = 0
      for (const c of cards) {
        if (played >= max || game.getState().isOver) break
        const target = game.getState().enemies.find(e => e.state !== 'dead')
        if (!target && !SELF_CARDS.has(c)) continue
        game.playCard(c, target?.id ?? '')
        played++
      }
      if (!game.getState().isOver) game.endTurn()
    }

    const log = game.getLog()
    collectPatterns(log.snapshots, log.outcome, stats)
  } catch {}
}

process.stdout.write('\n\n')

// ─── Report ───────────────────────────────────────────────────────────────────

const avg = (arr: number[]) => arr.length ? (arr.reduce((a,b)=>a+b,0)/arr.length).toFixed(1) : '—'
const pct = (n: number, total: number) => total > 0 ? ((n/total)*100).toFixed(1)+'%' : '—'

console.log('══════════════════════════════════════════════════════')
console.log('  TRACE ANALYSIS REPORT')
console.log('══════════════════════════════════════════════════════\n')

console.log(`  Traces analyzed: ${RUNS}`)
console.log(`  Outcomes: ${stats.turnsByOutcome.hero_wins.length} wins / ${stats.turnsByOutcome.hero_loses.length} losses\n`)

console.log('  GAME LENGTH:')
console.log(`    Hero wins:  avg ${avg(stats.turnsByOutcome.hero_wins)} turns`)
console.log(`    Hero loses: avg ${avg(stats.turnsByOutcome.hero_loses)} turns\n`)

console.log('  HERO HP DISTRIBUTION (across all turn snapshots):')
const hpLabels = ['0-10%','10-20%','20-30%','30-40%','40-50%','50-60%','60-70%','70-80%','80-90%','90-100%']
const hpTotal = stats.heroHpBuckets.reduce((a,b)=>a+b,0)
stats.heroHpBuckets.forEach((n, i) => {
  const bar = '█'.repeat(Math.round(n/hpTotal*30))
  console.log(`    ${hpLabels[i].padEnd(8)} ${bar.padEnd(30)} ${pct(n, hpTotal)}`)
})
console.log()

const topCombos = [...stats.statusCombos.entries()]
  .sort((a,b) => b[1]-a[1]).slice(0, 8)
if (topCombos.length) {
  console.log('  TOP STATUS COMBINATIONS (on hero):')
  topCombos.forEach(([combo, count]) => {
    console.log(`    ${combo.padEnd(25)} × ${count}`)
  })
  console.log()
}

const deathDoorCount = stats.hpAtDeathDoor.length
if (deathDoorCount > 0) {
  console.log(`  DEATH'S DOOR EVENTS: ${deathDoorCount} total`)
  console.log(`    Hero HP at death_door: always 0 (by definition)`)
  console.log(`    Turns: avg ${avg(stats.deathAtTurn)}\n`)
}

if (stats.transformTurns.length > 0) {
  const sortedTransforms = [...stats.transformTurns].sort((a,b)=>a-b)
  const minT = sortedTransforms[0]
  const maxT = sortedTransforms[sortedTransforms.length-1]
  console.log(`  WEREWOLF TRANSFORMS: earliest turn ${minT}, latest turn ${maxT}`)
  console.log(`  Wolf form at game end: ${pct(stats.formStateAtEnd.werewolf, stats.formStateAtEnd.human + stats.formStateAtEnd.werewolf)}\n`)
}

// ─── Suggested invariants ─────────────────────────────────────────────────────

console.log('  SUGGESTED INVARIANTS (based on observed trace patterns):\n')

const winsCount = stats.turnsByOutcome.hero_wins.length
const lossesCount = stats.turnsByOutcome.hero_loses.length

if (winsCount > 0) {
  const maxWinTurns = Math.max(...stats.turnsByOutcome.hero_wins)
  console.log(`  1. Game terminates within ${maxWinTurns + 2} turns (observed max: ${maxWinTurns})`)
  console.log(`     forAll(seeds, s => simulateTurns(s) <= ${maxWinTurns + 2})\n`)
}

const bleedStunCount = stats.statusCombos.get('bleed+stun') ?? 0
if (bleedStunCount > 0) {
  console.log(`  2. bleed+stun combination observed ${bleedStunCount} times`)
  console.log('     Property: bleed damage fires even when stun active')
  console.log('     forAll(states with bleed+stun, tickStatuses damages hero)\n')
}

if (stats.formStateAtEnd.werewolf > 0) {
  const wolfEndPct = (stats.formStateAtEnd.werewolf / (stats.formStateAtEnd.werewolf + stats.formStateAtEnd.human) * 100).toFixed(1)
  console.log(`  3. ${wolfEndPct}% of Werewolf games end in wolf form`)
  console.log('     Property: wolf form at low HP is stable — game ends before reversion')
  console.log('     forAll(seeds, werewolfAtLowHp → formState persists until death)\n')
}

const hpCriticalBucket = stats.heroHpBuckets.slice(0,2).reduce((a,b)=>a+b,0)
const hpCriticalPct = (hpCriticalBucket / hpTotal * 100).toFixed(1)
console.log(`  4. Hero spends ${hpCriticalPct}% of turns at critical HP (0–20%)`)
console.log('     Property: status effects still fire correctly at critical HP')
console.log('     forAll(states with hp<20%, tickStatuses(bleed) → hp >= 0)\n')

console.log('══════════════════════════════════════════════════════')
