// Meta-testing the Oracle — "How reliable is our AI judge?"
//
// Tests the LLM oracle quality by feeding it:
//   - Known-correct states (oracle MUST say 'correct')
//   - Known-incorrect states (oracle MUST say 'violation')
//
// Measures: false positives (oracle wrong on correct state)
//           false negatives (oracle misses a real violation)
//
// Usage:
//   ANTHROPIC_API_KEY=sk-... npm run meta-oracle
//   AI_MOCK_RESPONSE=true npm run meta-oracle

import Anthropic from '@anthropic-ai/sdk'

const DRY_RUN = process.argv.includes('--dry-run') || process.env.AI_MOCK_RESPONSE === 'true'

if (!DRY_RUN && !process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY not set. Use AI_MOCK_RESPONSE=true for dry run.')
  process.exit(1)
}

const client = DRY_RUN ? null : new Anthropic()

// ─── Test cases ───────────────────────────────────────────────────────────────

interface OracleTestCase {
  id: string
  description: string
  state: object
  rule: string
  expectedVerdict: 'correct' | 'violation' | 'not_applicable'
  category: 'correct' | 'incorrect'  // ground truth
}

const TEST_CASES: OracleTestCase[] = [
  // ── Known-correct states ──────────────────────────────────────────────────
  {
    id: 'C1',
    description: 'Hero at 18/28 HP, alive state',
    state: { turn: 3, hero: { hp: 18, maxHp: 28, state: 'alive', statuses: [], formState: 'human' }, enemies: [] },
    rule: 'hp >= 0 and hp <= maxHp: HP must always be within [0, maxHp]',
    expectedVerdict: 'correct',
    category: 'correct',
  },
  {
    id: 'C2',
    description: 'Hero at 0 HP in death_door state (correct transition)',
    state: { turn: 4, hero: { hp: 0, maxHp: 28, state: 'death_door', statuses: [], formState: 'human' }, enemies: [] },
    rule: 'hp=0 must produce death_door state (not dead in one hit)',
    expectedVerdict: 'correct',
    category: 'correct',
  },
  {
    id: 'C3',
    description: 'Werewolf at 14/28 HP in wolf form (correct: 14/28 = 50% ≤ 50% threshold)',
    state: { turn: 3, hero: { hp: 14, maxHp: 28, state: 'alive', statuses: [], formState: 'werewolf' }, enemies: [] },
    rule: 'Werewolf transforms when HP ≤ 50% of maxHp at turn start',
    expectedVerdict: 'correct',
    category: 'correct',
  },
  {
    id: 'C4',
    description: 'Healing Werewolf above 50% reduces wolf damage — intentional rule',
    state: { turn: 5, hero: { hp: 16, maxHp: 28, state: 'alive', statuses: [], formState: 'human' }, enemies: [] },
    rule: 'Healing Werewolf above 50% HP should REDUCE their damage bonus. This is INTENTIONAL — higher HP = lower wolf passive multiplier.',
    expectedVerdict: 'correct',
    category: 'correct',
  },

  // ── Known-incorrect states ────────────────────────────────────────────────
  {
    id: 'I1',
    description: 'Hero has negative HP (-3) — clear violation',
    state: { turn: 2, hero: { hp: -3, maxHp: 28, state: 'alive', statuses: [], formState: 'human' }, enemies: [] },
    rule: 'hp >= 0: HP must never be negative',
    expectedVerdict: 'violation',
    category: 'incorrect',
  },
  {
    id: 'I2',
    description: 'Dead entity with non-zero HP — invariant breach',
    state: { turn: 6, hero: { hp: 0, maxHp: 28, state: 'alive', statuses: [], formState: 'human' },
             enemies: [{ name: 'Goblin', hp: 15, maxHp: 20, state: 'dead', statuses: [] }] },
    rule: 'dead → hp = 0: Dead entities must always have exactly 0 HP',
    expectedVerdict: 'violation',
    category: 'incorrect',
  },
  {
    id: 'I3',
    description: 'Werewolf at 20/28 HP (71%) in wolf form — should be human',
    state: { turn: 4, hero: { hp: 20, maxHp: 28, state: 'alive', statuses: [], formState: 'werewolf' }, enemies: [] },
    rule: 'Werewolf should be in human form when HP > 50% of maxHp (20/28 = 71% > 50%)',
    expectedVerdict: 'violation',
    category: 'incorrect',
  },
  {
    id: 'I4',
    description: 'Bleed stacks at 15 — exceeds cap of 10',
    state: { turn: 3, hero: { hp: 20, maxHp: 28, state: 'alive', statuses: [{ name: 'bleed', stacks: 15 }], formState: 'human' }, enemies: [] },
    rule: 'bleed.stacks <= 10: Bleed stacks must never exceed 10',
    expectedVerdict: 'violation',
    category: 'incorrect',
  },
]

// ─── Oracle evaluation ────────────────────────────────────────────────────────

async function evaluateWithOracle(tc: OracleTestCase): Promise<'correct' | 'violation' | 'not_applicable'> {
  if (DRY_RUN) {
    // Deterministic mock: check obvious violations
    const h = (tc.state as any).hero
    if (h?.hp < 0) return 'violation'
    if (h?.hp > h?.maxHp) return 'violation'
    const enemies = (tc.state as any).enemies ?? []
    if (enemies.some((e: any) => e.state === 'dead' && e.hp > 0)) return 'violation'
    if (tc.id === 'I3' || tc.id === 'I4') return 'violation'  // known violations
    return 'correct'
  }

  const response = await client!.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 200,
    messages: [{
      role: 'user',
      content: `You are a game engine correctness oracle. Evaluate this state against the rule.

STATE: ${JSON.stringify(tc.state, null, 2)}
RULE: ${tc.rule}

Respond with JSON only: {"verdict": "correct"|"violation"|"not_applicable", "confidence": "high"|"medium"|"low", "reason": "one sentence"}`,
    }],
  })

  const text = (response.content[0] as { text: string }).text
  const match = text.match(/"verdict"\s*:\s*"([^"]+)"/)
  const verdict = match?.[1] as 'correct' | 'violation' | 'not_applicable'
  return verdict ?? 'not_applicable'
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  const modeLabel = DRY_RUN ? 'DRY RUN' : 'claude-haiku-4-5'
  console.log('\n╔══════════════════════════════════════════════════════╗')
  console.log('  META-ORACLE — TESTING THE AI JUDGE')
  console.log(`  ${TEST_CASES.length} test cases: ${TEST_CASES.filter(t=>t.category==='correct').length} correct, ${TEST_CASES.filter(t=>t.category==='incorrect').length} incorrect`)
  console.log(`  Mode: ${modeLabel}`)
  console.log('╚══════════════════════════════════════════════════════╝\n')

  let falsePositives = 0  // oracle says violation on correct state
  let falseNegatives = 0  // oracle says correct on incorrect state
  let correct = 0

  for (const tc of TEST_CASES) {
    const verdict = await evaluateWithOracle(tc)
    const isCorrect = verdict === tc.expectedVerdict
    if (isCorrect) correct++

    const status = isCorrect ? '✓' : '✗'
    const tag = tc.category === 'correct' ? '[VALID STATE]  ' : '[INVALID STATE]'
    console.log(`${status} ${tc.id} ${tag} ${tc.description}`)
    if (!isCorrect) {
      console.log(`    Expected: ${tc.expectedVerdict} → Got: ${verdict}`)
      if (tc.category === 'correct' && verdict === 'violation') {
        falsePositives++
        console.log(`    ⚠ FALSE POSITIVE — oracle flagged a valid state`)
      }
      if (tc.category === 'incorrect' && verdict !== 'violation') {
        falseNegatives++
        console.log(`    ⚠ FALSE NEGATIVE — oracle missed a real violation`)
      }
    }
  }

  const accuracy = Math.round(correct / TEST_CASES.length * 100)
  console.log()
  console.log('══════════════════════════════════════════════════════')
  console.log('  ORACLE QUALITY REPORT')
  console.log('══════════════════════════════════════════════════════')
  console.log(`  Test cases:      ${TEST_CASES.length}`)
  console.log(`  Correct:         ${correct} (${accuracy}%)`)
  console.log(`  False positives: ${falsePositives}  ← oracle flagged valid state`)
  console.log(`  False negatives: ${falseNegatives}  ← oracle missed real violation`)
  console.log()

  if (falsePositives === 0 && falseNegatives === 0) {
    console.log('  Oracle quality: RELIABLE on these test cases.')
    console.log('  No false positives or false negatives detected.')
  } else {
    console.log('  ⚠ Oracle has quality gaps:')
    if (falsePositives > 0) console.log(`    ${falsePositives} false positive(s) — improve rule descriptions`)
    if (falseNegatives > 0) console.log(`    ${falseNegatives} false negative(s) — oracle missed violations`)
  }

  console.log()
  console.log('  Note: "Testing the test" — oracle is infrastructure,')
  console.log('  not ground truth. Validate it like any other component.')
  console.log('══════════════════════════════════════════════════════\n')
}

run().catch(console.error)
