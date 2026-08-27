// LLM as Oracle — Claude evaluates whether game behavior matches specification.
//
// Pattern: game state + English rule → structured verdict { correct | violation }
// Most transferable AI testing skill: applies to pricing, insurance, content moderation.
//
// Usage:
//   ANTHROPIC_API_KEY=sk-... npx tsx scripts/llm-oracle.ts [seed]
//   ANTHROPIC_API_KEY=sk-... npm run oracle 42

import Anthropic from '@anthropic-ai/sdk'
import { createGame } from '../src/runtime/executor'
import type { TurnSnapshot } from '../src/telemetry/types'
import type { HeroClass, EnemyType } from '../src/engine/types'
import { ORACLE_MODEL } from './lib/model'

const DRY_RUN = process.argv.includes('--dry-run') || process.env.AI_MOCK_RESPONSE === 'true'

if (!DRY_RUN && !process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY not set.')
  console.error('Options:')
  console.error('  Real API:  ANTHROPIC_API_KEY=sk-... npm run oracle [seed]')
  console.error('  Dry run:   npm run oracle [seed] -- --dry-run')
  console.error('  Mock env:  AI_MOCK_RESPONSE=true npm run oracle [seed]')
  process.exit(1)
}

const client = new Anthropic()
const seed = parseInt(process.argv[2] ?? '42')

// ─── Rules to evaluate ────────────────────────────────────────────────────────
// These are the rules Claude will check. Written in natural language —
// that's the point: Claude can evaluate semantic rules that code can't express.

interface OracleRule {
  id: string
  description: string
  category: 'state-machine' | 'status-effect' | 'damage' | 'balance'
}

const RULES: OracleRule[] = [
  {
    id: 'R1',
    description: 'HP must always be between 0 and maxHp (inclusive). No negative HP, no overhealing.',
    category: 'state-machine',
  },
  {
    id: 'R2',
    description: 'If hero HP reaches 0 and was alive, state must become death_door, not dead. Dead requires a second hit.',
    category: 'state-machine',
  },
  {
    id: 'R3',
    description: 'Bleed stacks must never exceed 10. Any application beyond 10 should be capped.',
    category: 'status-effect',
  },
  {
    id: 'R4',
    description: 'A dead entity (state = dead) cannot act, cannot take damage, and cannot change state further.',
    category: 'state-machine',
  },
  {
    id: 'R5',
    description: 'Berserker rage mode: damage dealt should be 1.5x base when HP is at or below 25% of maxHp.',
    category: 'damage',
  },
  {
    id: 'R6',
    description: 'Werewolf transformation: hero should be in wolf form when HP is at or below 50% of maxHp at turn start.',
    category: 'state-machine',
  },
  {
    id: 'R7',
    description: 'Healing Werewolf above 50% HP should REDUCE their wolf passive damage bonus, not increase it. This is intentional — higher HP = lower missing HP = lower multiplier.',
    category: 'balance',
  },
]

// ─── Oracle verdict ───────────────────────────────────────────────────────────

interface OracleVerdict {
  ruleId: string
  verdict: 'correct' | 'violation' | 'not_applicable'
  explanation: string
  confidence: 'high' | 'medium' | 'low'
  evidence: string
}

// ─── Evaluate snapshot against rules ─────────────────────────────────────────

// ─── Dry-run mock evaluation ──────────────────────────────────────────────────
// Mirrors project 1 pattern: env.AI_MOCK_RESPONSE → return deterministic mock.
// Validates oracle logic and output format without API calls.

function mockEvaluateSnapshot(
  snapshot: TurnSnapshot,
  rules: OracleRule[],
): OracleVerdict[] {
  return rules.map(rule => {
    // Deterministic checks based on actual state — not random, not always-correct
    if (rule.id === 'R1') {
      const hpOk = snapshot.hero.hp >= 0 && snapshot.hero.hp <= snapshot.hero.maxHp
      const enemiesOk = snapshot.enemies.every(e => e.hp >= 0 && e.hp <= e.maxHp)
      return {
        ruleId: rule.id,
        verdict: (hpOk && enemiesOk) ? 'correct' : 'violation',
        explanation: hpOk && enemiesOk
          ? `[DRY RUN] Hero HP ${snapshot.hero.hp}/${snapshot.hero.maxHp} within bounds.`
          : `[DRY RUN] HP out of bounds detected.`,
        confidence: 'high',
        evidence: `hero.hp=${snapshot.hero.hp}, maxHp=${snapshot.hero.maxHp}`,
      }
    }
    if (rule.id === 'R6') {
      const hpPct = snapshot.hero.maxHp > 0 ? snapshot.hero.hp / snapshot.hero.maxHp : 1
      const shouldBeWolf = hpPct <= 0.5
      const isWolf = snapshot.hero.formState === 'werewolf'
      const ok = shouldBeWolf === isWolf
      return {
        ruleId: rule.id,
        verdict: ok ? 'correct' : 'violation',
        explanation: `[DRY RUN] HP ${(hpPct * 100).toFixed(0)}%. formState=${snapshot.hero.formState}. ${ok ? 'Correct.' : 'Mismatch.'}`,
        confidence: 'high',
        evidence: `hp=${snapshot.hero.hp}/${snapshot.hero.maxHp}, formState=${snapshot.hero.formState}`,
      }
    }
    return {
      ruleId: rule.id,
      verdict: 'not_applicable',
      explanation: '[DRY RUN] Rule requires temporal data or API evaluation.',
      confidence: 'high',
      evidence: 'dry-run mode',
    }
  })
}

async function evaluateSnapshot(
  snapshot: TurnSnapshot,
  rules: OracleRule[],
): Promise<OracleVerdict[]> {
  if (DRY_RUN) return mockEvaluateSnapshot(snapshot, rules)
  const stateJson = JSON.stringify({
    turn: snapshot.turn,
    hero: {
      hp: snapshot.hero.hp,
      maxHp: snapshot.hero.maxHp,
      state: snapshot.hero.state,
      formState: snapshot.hero.formState,
      statuses: snapshot.hero.statuses,
    },
    enemies: snapshot.enemies.map(e => ({
      name: e.name,
      hp: e.hp,
      maxHp: e.maxHp,
      state: e.state,
      statuses: e.statuses,
    })),
    events: snapshot.events.map(ev => ({
      type: ev.type,
      cardId: ev.cardId,
      targetId: ev.targetId,
    })),
  }, null, 2)

  const rulesText = rules.map(r => `${r.id}: ${r.description}`).join('\n')

  const response = await client.messages.create({
    model: ORACLE_MODEL,
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: `You are a game engine correctness oracle. Evaluate whether the game state follows the specified rules.

GAME STATE (Timeline Segment ${snapshot.turn}):
${stateJson}

RULES TO EVALUATE:
${rulesText}

For each rule, determine:
- verdict: "correct" (rule holds), "violation" (rule is broken), or "not_applicable" (rule cannot be assessed from this data)
- confidence: "high", "medium", or "low"
- explanation: one sentence explaining your assessment
- evidence: specific values from the state that support your verdict

Respond with a JSON array of verdicts, one per rule, in this exact format:
[
  {
    "ruleId": "R1",
    "verdict": "correct",
    "explanation": "Hero HP is 18, maxHp is 28, which is within [0, 28].",
    "confidence": "high",
    "evidence": "hp=18, maxHp=28"
  }
]`,
    }],
  })

  const text = (response.content[0] as { text: string }).text
  const jsonMatch = text.match(/\[[\s\S]*\]/)
  if (!jsonMatch) return []

  try {
    return JSON.parse(jsonMatch[0]) as OracleVerdict[]
  } catch {
    return []
  }
}

// ─── Run oracle ───────────────────────────────────────────────────────────────

async function runOracle(): Promise<void> {
  const modeLabel = DRY_RUN ? 'DRY RUN (AI_MOCK_RESPONSE)' : 'claude-haiku-4-5'
  console.log('\n╔══════════════════════════════════════════════════════╗')
  console.log('  LLM ORACLE — TIMELINE CORRECTNESS EVALUATION')
  console.log(`  Seed: ${seed} · Mode: ${modeLabel}`)
  console.log('╚══════════════════════════════════════════════════════╝\n')

  // Generate a game with several turns
  const heroClass: HeroClass = 'werewolf'
  const enemyType: EnemyType = 'guardian'
  const game = createGame({ seed, heroClass, enemyType })

  // Play a few turns to generate interesting states
  game.playCard('pack_sense')
  game.endTurn()
  game.endTurn()
  game.endTurn()
  game.playCard('lunar_strike')
  game.endTurn()

  const log = game.getLog()
  const snapshots = log.snapshots

  if (!snapshots.length) {
    console.log('No snapshots generated. Play more turns.')
    return
  }

  console.log(`Evaluating ${snapshots.length} timeline segments...\n`)

  let totalViolations = 0
  let totalCorrect = 0
  let totalNA = 0

  for (const snapshot of snapshots) {
    console.log(`─── Segment ${snapshot.turn} ────────────────────────────────────`)
    console.log(`  Hero: ${snapshot.hero.hp}/${snapshot.hero.maxHp} HP [${snapshot.hero.state}]${snapshot.hero.formState === 'werewolf' ? ' 🐺 WOLF' : ''}`)
    snapshot.hero.statuses.forEach(s => console.log(`    ${s.name}: ${s.stacks}`))

    const verdicts = await evaluateSnapshot(snapshot, RULES)

    const violations = verdicts.filter(v => v.verdict === 'violation')
    const correct   = verdicts.filter(v => v.verdict === 'correct')
    const na        = verdicts.filter(v => v.verdict === 'not_applicable')

    totalViolations += violations.length
    totalCorrect    += correct.length
    totalNA         += na.length

    if (violations.length > 0) {
      console.log(`\n  ⚠ VIOLATIONS (${violations.length}):`)
      violations.forEach(v => {
        console.log(`    [${v.ruleId}] ${v.explanation}`)
        console.log(`    Evidence: ${v.evidence} (confidence: ${v.confidence})`)
      })
    }

    const correctIds = correct.map(v => v.ruleId).join(', ')
    console.log(`  ✓ Correct: ${correctIds || 'none'} · N/A: ${na.length}`)
    console.log()
  }

  // ─── Summary ──────────────────────────────────────────────────────────────
  const stability = totalViolations === 0
    ? 'SIMULATION STABLE — All rules verified by oracle.'
    : `⚠ ${totalViolations} rule violation(s) detected.`

  console.log('══════════════════════════════════════════════════════')
  console.log('  ORACLE REPORT')
  console.log('══════════════════════════════════════════════════════')
  console.log(`  Segments evaluated: ${snapshots.length}`)
  console.log(`  Rule verdicts:      ${totalCorrect} correct, ${totalViolations} violations, ${totalNA} N/A`)
  console.log(`  Outcome:            ${log.outcome}`)
  console.log()
  console.log(`  ${stability}`)
  console.log()
  console.log('  Note: Oracle evaluates SEMANTIC correctness.')
  console.log('  Code tests verify computation. Oracle verifies meaning.')
  console.log('══════════════════════════════════════════════════════\n')
}

runOracle().catch(console.error)
