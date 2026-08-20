// AI Chaos Agent — adversarial player that tries to break the engine.
// Two modes:
//   Default: rule-based adversary (no API key needed)
//   With ANTHROPIC_API_KEY: Claude guides strategy via tool use
//
// Usage:
//   npx tsx scripts/chaos-agent.ts [runs=500]
//   ANTHROPIC_API_KEY=sk-... npx tsx scripts/chaos-agent.ts 100

import { createGame, GameConfig } from '../src/runtime/executor'
import { replayGame } from '../src/telemetry/replayer'
import { saveFailingRun } from '../src/telemetry/artifacts'
import { HERO_CARDS, SELF_ONLY, configFor } from './lib/harness'
import type { HeroClass, EnemyType } from '../src/engine/types'
import type { ReplayLog } from '../src/telemetry/types'

const RUNS = parseInt(process.argv[2] ?? '500')
const USE_CLAUDE = !!process.env.ANTHROPIC_API_KEY

// Колода и раскладка seed общие с simulate.ts, стратегия игры — своя, и это
// разделение принципиально. Общее обязано совпадать: агент, играющий другой
// колодой или сканирующий другое подмножество конфигураций, находил бы
// «интересные таймлайны» в игре, которую больше никто не проверяет.
// Различаться должен только способ выбирать ход — в нём весь смысл агента.

// Card priority: higher score = prefer to play this card
// Adversarial: maximize pressure, ignore healing, deplete hero HP
const CARD_THREAT_SCORE: Record<string, number> = {
  // High threat — maximises damage to enemy (exhausts hero faster via self-damage or risky plays)
  bloodrite:       10,  // self-damage = threatens hero too
  rend:            9,
  chaos_bolt:      8,
  savage_lunge:    8,
  primal_fury:     7,
  lunar_strike:    7,
  open_the_wound:  6,
  rampage:         6,
  reality_crack:   5,
  // Low threat — defensive cards (skip in adversarial mode)
  stubborn_recovery: 1,
  primal_dodge:      2,
  pack_sense:        3,
  stalk:             3,
  divine_charge:     4,
}

const SELF_CARDS = new Set(SELF_ONLY)

// ─── Adversarial strategy ─────────────────────────────────────────────────────
// Prioritises high-threat cards; avoids healing; targets most dangerous enemy.
// The "adversary" tries to create game states where invariants might break:
// — hero at death_door playing self-damage cards
// — multiple statuses stacked on same entity
// — rapid state transitions (alive→death_door→alive via heal→hit)

function adversarialPlay(seed: number, heroClass: HeroClass, enemyType: EnemyType): ReplayLog {
  const game = createGame({ seed, heroClass, enemyType })

  for (let turn = 0; turn < 40; turn++) {
    if (game.getState().isOver) break

    const state = game.getState()
    const cards = [...HERO_CARDS[heroClass]]
      .sort((a, b) => (CARD_THREAT_SCORE[b] ?? 5) - (CARD_THREAT_SCORE[a] ?? 5))

    // Play up to 3 cards, highest threat first
    let played = 0
    for (const cardId of cards) {
      if (played >= 3 || game.getState().isOver) break
      const target = game.getState().enemies.find(e => e.state !== 'dead')
      if (!target && !SELF_CARDS.has(cardId)) continue
      game.playCard(cardId, target?.id ?? '')
      played++
    }

    if (game.getState().isOver) break
    game.endTurn()
  }

  return game.getLog()
}

// ─── Claude-guided strategy ───────────────────────────────────────────────────
// When ANTHROPIC_API_KEY is set, Claude analyzes the current game state
// and suggests which card to play to maximize invariant stress.

async function claudeGuidedPlay(
  seed: number, heroClass: HeroClass, enemyType: EnemyType
): Promise<ReplayLog> {
  // Lazy import — only loads when API key is present
  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const client = new Anthropic()

  const game = createGame({ seed, heroClass, enemyType })
  const cards = HERO_CARDS[heroClass]

  for (let turn = 0; turn < 20; turn++) {
    if (game.getState().isOver) break

    const state = game.getState()
    const stateDesc = {
      turn: state.turn,
      hero: { hp: state.hero.hp, maxHp: state.hero.maxHp, state: state.hero.state, statuses: state.hero.statuses },
      enemies: state.enemies.map(e => ({ id: e.id, hp: e.hp, maxHp: e.maxHp, state: e.state, statuses: e.statuses })),
      availableCards: cards,
    }

    // Ask Claude which card to play to stress-test the engine
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `You are an adversarial player trying to stress-test a game engine by creating unusual state combinations.

Game state: ${JSON.stringify(stateDesc, null, 2)}

Choose ONE card to play from available cards: ${cards.join(', ')}
Prefer cards that: create Death's Door states, stack multiple statuses, cause self-damage, or force rapid state transitions.
Respond with ONLY the card id, nothing else.`,
      }],
    })

    const cardChoice = (response.content[0] as { text: string }).text.trim().toLowerCase()
    const validCard = cards.find(c => cardChoice.includes(c))
    const cardToPlay = validCard ?? cards[0]

    const target = state.enemies.find(e => e.state !== 'dead')
    if (target || SELF_CARDS.has(cardToPlay)) {
      game.playCard(cardToPlay, target?.id ?? '')
    }

    if (!game.getState().isOver) game.endTurn()
  }

  return game.getLog()
}

// ─── Invariant stress checks ──────────────────────────────────────────────────
// Beyond assertValidGameState — checks for "interesting" states worth archiving.

function isInteresting(log: ReplayLog): { interesting: boolean; reason: string } {
  const snapshots = log.snapshots
  if (!snapshots.length) return { interesting: false, reason: '' }

  // Long game — engine survived extended adversarial pressure
  if (snapshots.length >= 5) {
    return { interesting: true, reason: `long game: survived ${snapshots.length} turns under adversarial play` }
  }

  for (const snap of snapshots) {
    // Hero at death_door
    if (snap.hero.state === 'death_door') {
      return { interesting: true, reason: `hero at Death's Door on turn ${snap.turn}` }
    }
    // Multiple statuses on hero
    if (snap.hero.statuses.length >= 2) {
      return { interesting: true, reason: `hero has ${snap.hero.statuses.length} statuses on turn ${snap.turn}` }
    }
    // Werewolf transformed
    if (snap.hero.formState === 'werewolf') {
      return { interesting: true, reason: `Werewolf transformed on turn ${snap.turn}` }
    }
    // Enemy with any bleed + vulnerable combo
    for (const enemy of snap.enemies) {
      const hasBleed = enemy.statuses.some(s => s.name === 'bleed')
      const hasVuln  = enemy.statuses.some(s => s.name === 'vulnerable')
      if (hasBleed && hasVuln) {
        return { interesting: true, reason: `${enemy.name} has bleed+vulnerable (peak damage window)` }
      }
    }
    // High bleed stack on enemy
    for (const enemy of snap.enemies) {
      const bleed = enemy.statuses.find(s => s.name === 'bleed')
      if (bleed && bleed.stacks >= 5) {
        return { interesting: true, reason: `${enemy.name} bleeding at ${bleed.stacks} stacks` }
      }
    }
  }
  return { interesting: false, reason: '' }
}

// ─── Run chaos agent ──────────────────────────────────────────────────────────

interface ChaosResult {
  corrupted: number
  replayFailed: number
  interesting: number
  failingSeeds: number[]
  interestingSeeds: Array<{ seed: number; reason: string; heroClass: HeroClass; enemyType: EnemyType }>
}

async function runChaosAgent(): Promise<void> {
  const mode = USE_CLAUDE ? 'CLAUDE-GUIDED' : 'ADVERSARIAL'
  console.log(`\n╔══════════════════════════════════════════════════════╗`)
  console.log(`  CHAOS AGENT — ${mode} MODE`)
  console.log(`  Scanning ${RUNS} timelines for corruption...`)
  console.log(`╚══════════════════════════════════════════════════════╝\n`)

  const results: ChaosResult = {
    corrupted: 0,
    replayFailed: 0,
    interesting: 0,
    failingSeeds: [],
    interestingSeeds: [],
  }

  process.stdout.write('Progress: ')

  for (let seed = 0; seed < RUNS; seed++) {
    if (seed % Math.max(1, Math.floor(RUNS / 40)) === 0) process.stdout.write('▓')

    const { heroClass, enemyType } = configFor(seed)

    let log: ReplayLog
    let corrupted = false

    try {
      if (USE_CLAUDE) {
        log = await claudeGuidedPlay(seed, heroClass, enemyType)
      } else {
        log = adversarialPlay(seed, heroClass, enemyType)
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('TIMELINE CORRUPTED')) {
        results.corrupted++
        results.failingSeeds.push(seed)
        corrupted = true
      }
      continue
    }

    // Verify replay is byte-perfect
    const replayResult = replayGame(log)
    if (!replayResult.success) {
      results.replayFailed++
      results.failingSeeds.push(seed)
      saveFailingRun(log, replayResult)
    }

    // Check for interesting states worth archiving
    const { interesting, reason } = isInteresting(log)
    if (interesting) {
      results.interesting++
      results.interestingSeeds.push({ seed, reason, heroClass, enemyType })
      if (results.interestingSeeds.length <= 5) {
        saveFailingRun(log)
      }
    }
  }

  process.stdout.write('\n\n')

  // ─── Report ──────────────────────────────────────────────────────────────
  const stable = RUNS - results.corrupted - results.replayFailed
  const stabilityPct = ((stable / RUNS) * 100).toFixed(1)

  console.log('══════════════════════════════════════════════════════')
  console.log('  CHAOS AGENT REPORT')
  console.log('══════════════════════════════════════════════════════')
  console.log()
  console.log(`  Mode:             ${mode}`)
  console.log(`  Timelines probed: ${RUNS}`)
  console.log(`  Stable:           ${stable}  (${stabilityPct}%)`)
  console.log(`  Corrupted:        ${results.corrupted}  ← TIMELINE CORRUPTED triggered`)
  console.log(`  Replay failures:  ${results.replayFailed}  ← hash mismatch on re-run`)
  console.log(`  Interesting:      ${results.interesting}  → archived to /artifacts/`)
  console.log()

  if (results.interestingSeeds.length > 0) {
    console.log('  INTERESTING TIMELINES:')
    results.interestingSeeds.slice(0, 10).forEach(({ seed, reason, heroClass, enemyType }) => {
      console.log(`    seed ${String(seed).padStart(5)} [${heroClass} vs ${enemyType}]: ${reason}`)
    })
    if (results.interestingSeeds.length > 10) {
      console.log(`    ... and ${results.interestingSeeds.length - 10} more in /artifacts/`)
    }
    console.log()
  }

  if (results.corrupted === 0 && results.replayFailed === 0) {
    console.log('  The Archivist found no corruption.')
    console.log('  All invariants held under adversarial conditions.')
  } else {
    console.log(`  ⚠ ${results.failingSeeds.length} failing seed(s) archived.`)
    console.log(`  Seeds: ${results.failingSeeds.slice(0, 5).join(', ')}`)
  }

  console.log()
  console.log('══════════════════════════════════════════════════════')
}

runChaosAgent().catch(console.error)
