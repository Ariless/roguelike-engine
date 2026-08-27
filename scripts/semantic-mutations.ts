// Semantic Mutation Generator — AI-powered, upstream from Stryker.
//
// Stryker generates random SYNTACTIC mutations (e.g. <= → <).
// This script asks Claude: "what are the most REALISTIC bugs a developer
// might introduce in this function?" — semantic mutations based on
// understanding of the code's intent.
//
// Usage:
//   ANTHROPIC_API_KEY=sk-... npx tsx scripts/semantic-mutations.ts [file] [function?]
//   ANTHROPIC_API_KEY=sk-... npm run semantic-mutations src/engine/statuses.ts tickStatuses
//   AI_MOCK_RESPONSE=true npm run semantic-mutations src/engine/statuses.ts tickStatuses

import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'fs'
import { join } from 'path'
import { ORACLE_MODEL } from './lib/model'

const DRY_RUN = process.argv.includes('--dry-run') || process.env.AI_MOCK_RESPONSE === 'true'

if (!DRY_RUN && !process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY not set.')
  console.error('Options:')
  console.error('  Real API:  ANTHROPIC_API_KEY=sk-... npm run semantic-mutations <file> [fn]')
  console.error('  Dry run:   npm run semantic-mutations <file> [fn] -- --dry-run')
  process.exit(1)
}

const targetFile = process.argv[2] ?? 'src/engine/statuses.ts'
const targetFn   = process.argv[3] ?? ''

// ─── Read source file ─────────────────────────────────────────────────────────

const filePath = join(process.cwd(), targetFile)
let source: string
try {
  source = readFileSync(filePath, 'utf-8')
} catch {
  console.error(`File not found: ${filePath}`)
  process.exit(1)
}

// If a function name is given, extract just that function (heuristic)
let codeToAnalyze = source
if (targetFn) {
  const fnStart = source.indexOf(`function ${targetFn}`)
  const exportFnStart = source.indexOf(`export function ${targetFn}`)
  const start = exportFnStart >= 0 ? exportFnStart : fnStart
  if (start >= 0) {
    // Find matching closing brace
    let depth = 0; let end = start
    for (let i = start; i < source.length; i++) {
      if (source[i] === '{') depth++
      if (source[i] === '}') { depth--; if (depth === 0) { end = i + 1; break } }
    }
    codeToAnalyze = source.slice(start, end)
  }
}

// ─── Semantic mutation structure ──────────────────────────────────────────────

interface SemanticMutation {
  id: string
  description: string          // what the bug is
  location: string             // which line/expression
  original: string             // original code fragment
  mutated: string              // what a developer might write instead
  bugClass: string             // "off-by-one" | "wrong-condition" | "missing-case" | etc.
  likelyCause: string          // why a developer would make this mistake
}

// ─── Dry-run mock ─────────────────────────────────────────────────────────────

function mockGenerateMutations(_code: string, _fn: string): SemanticMutation[] {
  return [
    {
      id: 'SM-1',
      description: '[DRY RUN] Bleed damage uses stacks - 1 instead of stacks',
      location: 'entity.hp = Math.max(0, entity.hp - bleed.stacks)',
      original: 'entity.hp - bleed.stacks',
      mutated: 'entity.hp - (bleed.stacks - 1)',
      bugClass: 'off-by-one',
      likelyCause: 'Developer thinks bleed should decay by 1 each tick',
    },
    {
      id: 'SM-2',
      description: '[DRY RUN] Duration filter uses > instead of >= 0',
      location: '.filter(s => s.duration === undefined || s.duration > 0)',
      original: 's.duration > 0',
      mutated: 's.duration >= 0',
      bugClass: 'wrong-condition',
      likelyCause: 'Off-by-one: duration=0 should be expired, but developer keeps it',
    },
    {
      id: 'SM-3',
      description: '[DRY RUN] Missing death_door check after bleed tick',
      location: 'if (entity.hp === 0 && entity.state === \'alive\')',
      original: 'entity.state === \'alive\'',
      mutated: '/* missing check */',
      bugClass: 'missing-case',
      likelyCause: 'Developer forgets that hp=0 requires state transition, not just hp reduction',
    },
  ]
}

// ─── Real Claude generation ───────────────────────────────────────────────────

async function generateMutations(code: string, fnName: string): Promise<SemanticMutation[]> {
  if (DRY_RUN) return mockGenerateMutations(code, fnName)

  const client = new Anthropic()

  const response = await client.messages.create({
    model: ORACLE_MODEL,
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: `You are a senior engineer reviewing code for a deterministic game engine.
Your task: identify the most REALISTIC bugs a developer might accidentally introduce in this code.

NOT random syntax mutations — SEMANTIC mutations that reflect:
- Common misunderstandings of the domain
- Edge cases a developer might forget
- Off-by-one errors at meaningful boundaries
- Wrong conditions that almost-but-not-quite capture the intent
- Missing state transitions

FILE: ${targetFile}${fnName ? ` · FUNCTION: ${fnName}` : ''}

CODE:
\`\`\`typescript
${code}
\`\`\`

Generate exactly 5 semantic mutations. For each:
- id: "SM-1" through "SM-5"
- description: one sentence describing the bug
- location: the specific expression or line affected
- original: the correct code fragment
- mutated: what the buggy version looks like
- bugClass: one of "off-by-one", "wrong-condition", "missing-case", "wrong-operator", "inverted-logic", "missing-guard"
- likelyCause: why a developer would make this mistake

Respond with a JSON array only, no prose:
[{"id":"SM-1","description":"...","location":"...","original":"...","mutated":"...","bugClass":"...","likelyCause":"..."}]`,
    }],
  })

  const text = (response.content[0] as { text: string }).text
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) return []
  try { return JSON.parse(match[0]) } catch { return [] }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  const modeLabel = DRY_RUN ? 'DRY RUN' : 'claude-haiku-4-5'
  console.log('\n╔══════════════════════════════════════════════════════╗')
  console.log('  SEMANTIC MUTATION GENERATOR')
  console.log(`  File: ${targetFile}${targetFn ? ` · fn: ${targetFn}` : ''}`)
  console.log(`  Mode: ${modeLabel}`)
  console.log('╚══════════════════════════════════════════════════════╝\n')

  console.log('Generating semantic mutations...\n')
  const mutations = await generateMutations(codeToAnalyze, targetFn)

  if (!mutations.length) {
    console.log('No mutations generated.')
    return
  }

  const bugClassCounts: Record<string, number> = {}

  mutations.forEach(m => {
    bugClassCounts[m.bugClass] = (bugClassCounts[m.bugClass] ?? 0) + 1
    console.log(`[${m.id}] ${m.bugClass.toUpperCase()} — ${m.description}`)
    console.log(`  Location:    ${m.location}`)
    console.log(`  Original:    ${m.original}`)
    console.log(`  Mutated:     ${m.mutated}`)
    console.log(`  Likely why:  ${m.likelyCause}`)
    console.log()
  })

  console.log('══════════════════════════════════════════════════════')
  console.log('  SUMMARY')
  console.log('══════════════════════════════════════════════════════')
  console.log(`  Mutations generated: ${mutations.length}`)
  Object.entries(bugClassCounts).forEach(([cls, count]) => {
    console.log(`  ${cls.padEnd(20)} × ${count}`)
  })
  console.log()
  console.log('  NEXT STEPS:')
  console.log('  1. For each mutation — does an existing test catch it?')
  console.log('  2. If not → write a targeted test (mutation killing test)')
  console.log('  3. Run Stryker to verify the new test kills the mutant')
  console.log('  4. This is upstream Stryker: find gaps BEFORE running mutation testing')
  console.log('══════════════════════════════════════════════════════\n')
}

run().catch(console.error)
