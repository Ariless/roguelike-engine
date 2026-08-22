// Spec → Property Test Generator
//
// Give a rule in English → Claude generates a fast-check property test.
// Demonstrates: AI accelerates QA, doesn't replace it.
// Shows: natural language specification → automated test.
//
// Usage:
//   ANTHROPIC_API_KEY=sk-... npm run spec-to-test "Bleed deals damage equal to stacks per turn"
//   AI_MOCK_RESPONSE=true npm run spec-to-test "HP never goes below zero"

import Anthropic from '@anthropic-ai/sdk'

const DRY_RUN = process.argv.includes('--dry-run') || process.env.AI_MOCK_RESPONSE === 'true'

if (!DRY_RUN && !process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY not set.')
  console.error('Options:')
  console.error('  Real API:  ANTHROPIC_API_KEY=sk-... npm run spec-to-test "rule text"')
  console.error('  Dry run:   AI_MOCK_RESPONSE=true npm run spec-to-test "rule text"')
  process.exit(1)
}

const rule = process.argv.slice(2).filter(a => a !== '--dry-run').join(' ')
if (!rule) {
  console.error('Usage: npm run spec-to-test "rule in English"')
  console.error('Example: npm run spec-to-test "Bleed deals damage equal to stacks per turn, capped at 10"')
  process.exit(1)
}

// ─── Context about the project for Claude ─────────────────────────────────────

const PROJECT_CONTEXT = `
TypeScript rule engine. Key types:
- GameState: { hero: Hero, enemies: Enemy[], ... }
- Hero/Enemy: { hp: number, maxHp: number, state: EntityState, statuses: Status[], ... }
- Status: { name: 'bleed'|'stun'|'defend'|'vulnerable', stacks: number, duration?: number }
- EntityState: 'alive' | 'death_door' | 'dead'

Key functions:
- addStatus(state, entityId, status) → GameState
- tickStatuses(state, entityId) → GameState
- applyDamage(state, entityId, amount) → GameState
- applyHeal(state, entityId, amount) → GameState
- hasStatus(entity, name) → boolean

Test framework: Vitest + fast-check (fc).
Test factory: makeState(heroHp?, enemyHp?) → GameState (local to each test file).

Hero id = 'hero', enemy id = 'enemy'.
`.trim()

// ─── Dry-run mock ─────────────────────────────────────────────────────────────

function mockGenerate(ruleText: string): string {
  return `// [DRY RUN] Generated for: "${ruleText}"
// Replace with real output from: npm run spec-to-test "${ruleText}"

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { addStatus, tickStatuses } from '../src/engine/statuses'

describe('property: ${ruleText}', () => {
  it('[DRY RUN] invariant holds for any valid input', () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 50 }),   // ← tune arbitraries to the rule
      fc.integer({ min: 1, max: 10 }),
      (heroHp, stacks) => {
        // TODO: implement based on rule
        // hint: rule = "${ruleText}"
        return true  // placeholder
      }
    ))
  })
})`
}

// ─── Real Claude generation ───────────────────────────────────────────────────

async function generateTest(ruleText: string): Promise<string> {
  if (DRY_RUN) return mockGenerate(ruleText)

  const client = new Anthropic()

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1500,
    messages: [{
      role: 'user',
      content: `You are a QA engineer writing fast-check property tests for a game rule engine.

PROJECT CONTEXT:
${PROJECT_CONTEXT}

RULE TO TEST:
"${ruleText}"

Write ONE property test for this rule. Requirements:
- Use fast-check (fc.assert + fc.property)
- Use appropriate arbitraries (fc.integer, fc.array, etc.) for the rule
- The test should fail if the rule is violated
- Include the rule text as the test description
- Import only what you need from the project files
- Use makeState() factory (assume it exists locally with: makeState(heroHp?: number, enemyHp?: number))

Respond with ONLY the test code, no explanation, no markdown fences.
Start with: import { describe, it, expect } from 'vitest'`,
    }],
  })

  return (response.content[0] as { text: string }).text
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  const modeLabel = DRY_RUN ? 'DRY RUN' : 'claude-haiku-4-5'

  console.log('\n╔══════════════════════════════════════════════════════╗')
  console.log('  SPEC → PROPERTY TEST GENERATOR')
  console.log(`  Rule: "${rule}"`)
  console.log(`  Mode: ${modeLabel}`)
  console.log('╚══════════════════════════════════════════════════════╝\n')

  const testCode = await generateTest(rule)

  console.log('Generated test:\n')
  console.log('─'.repeat(54))
  console.log(testCode)
  console.log('─'.repeat(54))
  console.log()
  console.log('Next steps:')
  console.log('  1. Review the generated test — verify it tests the right thing')
  console.log('  2. Add to tests/property.test.ts or a new file')
  console.log('  3. Run: npm test')
  console.log('  4. Run: npm run test:mutation — does it kill any new mutants?')
  console.log()
  console.log('Note: AI generates the structure. You validate the logic.')
  console.log('      "AI accelerates QA. It does not replace it."\n')
}

run().catch(console.error)
