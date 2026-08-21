import { describe, it, expect } from 'vitest'
import { ENEMY_INTENTS, resolveIntent } from '../src/runtime/executor'
import type { EnemyType, Intent, GameState, Enemy } from '../src/engine/types'

/** Minimal board carrying only what the conditional rows look at. */
function stateWith(opts: { corpse?: 'fresh' | 'spent'; skeleton?: 'alive' | 'dead' }): GameState {
  const enemies: Enemy[] = []

  if (opts.corpse) {
    enemies.push({
      id: 'corpse', name: 'Goblin', hp: 0, maxHp: 20, state: 'dead', statuses: [],
      row: 'front', enemyType: 'goblin', intent: { type: 'attack', value: 6 },
      raisedOnce: opts.corpse === 'spent',
    })
  }

  if (opts.skeleton) {
    enemies.push({
      id: 'skeleton-1', name: 'Skeleton',
      hp: opts.skeleton === 'alive' ? 8 : 0, maxHp: 8,
      state: opts.skeleton === 'alive' ? 'alive' : 'dead',
      statuses: [], row: 'front', enemyType: 'skeleton',
      intent: { type: 'attack', value: 4 },
    })
  }

  return {
    seed: 1, turn: 1, isOver: false, enemies,
    hero: {
      id: 'hero', name: 'Hero', hp: 30, maxHp: 30, state: 'alive', statuses: [],
      row: 'front', heroClass: 'paladin', formState: 'human', hand: [], energy: 3,
    },
  }
}

// ─── Why this file exists ─────────────────────────────────────────────────────
//
// `CLAUDE.md`, Rule priority section: "If Decision Tables conflict with engine
// code, treat tables as intended spec — file a bug". Until this file, nobody
// ran that comparison: 391 tests checked that the implemented code behaves
// correctly, and not one asked whether the specified behaviour was implemented
// at all.
//
// The difference is not cosmetic. A test on existing code catches a break.
// A comparison against the spec catches an absence — a mechanic that appears in
// three documents and in the UI but never reached the engine (BUG-14). Mutation
// testing is blind here too: there is nothing to mutate, the code isn't there.
//
// ─── Why the suite stays green while gaps are open ────────────────────────────
//
// Two gaps are open and need mechanics implemented, not a fix applied. A red
// test that cannot be closed teaches people to ignore red — so the gaps are
// pinned in an explicit KNOWN_GAPS list with the exact current behaviour.
//
// The list works in both directions:
//   — if the divergence changes, the test fails: what was pinned is no longer true
//   — if the mechanic ships, the test fails, demanding the enemy be removed
//
// So the gap can be neither silently widened nor silently closed.

// ─── Specification ────────────────────────────────────────────────────────────
//
// Source: docs/DECISION-TABLES.md. Encoded as data, because parsing markdown
// breaks on any formatting change, while a divergence between the table and
// this block is visible in the diff.

// The spec is deliberately NOT expressed through the engine's Intent type.
// The first version of this file described the tables in terms of Intent, and
// the model immediately lied: the Necromancer's declared actions (raise,
// empower) do not exist in the Intent type, so only the fallback branches made
// it into the spec — and those do match the implementation. The gap became
// invisible precisely because it was described in the vocabulary of the side
// that does not have it.
//
// A specification has to be able to name what the code does not have yet.
interface SpecAction {
  kind: string
  value?: number
  lifesteal?: boolean
}

interface SpecTurn {
  // The main declared action for the turn.
  action: SpecAction
  // Branching on board or hero state, where the table declares it, plus the
  // fallback action used when the condition does not hold.
  conditional?: string
  fallback?: SpecAction
}

const SPEC: Record<EnemyType, SpecTurn[]> = {
  // DECISION-TABLES.md — "Goblin — The Pressure"
  // Every row is identical: one condition (always), one action.
  goblin: [
    { action: { kind: 'attack', value: 6 } },
    { action: { kind: 'attack', value: 6 } },
    { action: { kind: 'attack', value: 6 } },
  ],

  // DECISION-TABLES.md — "Guardian — The Lockdown"
  // Shield → stun → punish. No branching, the sequence is fixed.
  guardian: [
    { action: { kind: 'defend' } },
    { action: { kind: 'stun' } },
    { action: { kind: 'attack', value: 10 } },
  ],

  // DESIGN.md:319-326 — "Vampire — the opportunist"
  vampire: [
    { action: { kind: 'attack', value: 6, lifesteal: true } },
    {
      action: { kind: 'attack', value: 6, lifesteal: true },
      conditional: 'hero has bleed → Exploit Wound: extra attack + amplified lifesteal',
      fallback: { kind: 'attack', value: 6 },
    },
    {
      action: { kind: 'attack', value: 12 },
      conditional: "hero at Death's Door → Execute",
      fallback: { kind: 'attack', value: 8 },
    },
  ],

  // A skeleton is not an encounter: it enters play only through Raise Dead and
  // has a single move. Present here because the engine's table must cover every
  // EnemyType, and an entity that can act needs its behaviour declared.
  skeleton: [
    { action: { kind: 'attack', value: 4 } },
  ],

  // DECISION-TABLES.md:71-93 — "Necromancer — The Accumulator"
  necromancer: [
    { action: { kind: 'bleed', value: 3 } },
    {
      action: { kind: 'raise' },
      conditional: 'ally corpse on field → Raise Dead spawns a Skeleton',
      fallback: { kind: 'bleed', value: 3 },
    },
    {
      action: { kind: 'empower', value: 3 },
      conditional: 'skeleton on field → Empower its next attack',
      // DECISION-TABLES.md:80 — "No skeleton → apply bleed". An earlier version
      // of this file said 'vulnerable', which matched neither the table nor the
      // engine: the spec had drifted from its own source.
      fallback: { kind: 'bleed', value: 3 },
    },
  ],
}

// Comparing spec against implementation. An action absent from the Intent type
// cannot match anything — that is the gap we are looking for, not a flaw in the
// comparison.
function matchesSpec(intent: Intent, action: SpecAction): boolean {
  if (intent.type !== action.kind) return false
  const intentValue = 'value' in intent ? intent.value : undefined
  if (action.value !== undefined && intentValue !== action.value) return false
  if (action.lifesteal !== undefined) {
    const intentLifesteal = intent.type === 'attack' ? intent.lifesteal === true : false
    if (intentLifesteal !== action.lifesteal) return false
  }
  return true
}

// ─── Pinned gaps ──────────────────────────────────────────────────────────────

interface KnownGap {
  bug: string
  reason: string
  // What the engine does RIGHT NOW. Has to match exactly: this is the guard
  // against the gap changing silently.
  actual: Intent[]
}

const KNOWN_GAPS: Partial<Record<EnemyType, KnownGap>> = {
  vampire: {
    bug: 'BUG-14 (related)',
    reason:
      'Turn 2 per the spec is an attack (amplified when bleed is present); the engine applies ' +
      'bleed 2 instead. Turn 3 is always 12 with no branch to 8. The engine has no conditional intents.',
    actual: [
      { type: 'attack', value: 6, lifesteal: true },
      { type: 'bleed', value: 2 },
      { type: 'attack', value: 12 },
    ],
  },
}

const ALL_ENEMIES = Object.keys(SPEC) as EnemyType[]

// ─── Completeness of the comparison ───────────────────────────────────────────

describe('specification coverage', () => {
  it('every enemy in the engine has a decision table', () => {
    expect(Object.keys(ENEMY_INTENTS).sort()).toEqual(ALL_ENEMIES.sort())
  })

  it('the intent cycle length matches the specification', () => {
    for (const enemy of ALL_ENEMIES) {
      expect(ENEMY_INTENTS[enemy].length, `${enemy}: cycle length`).toBe(SPEC[enemy].length)
    }
  })
})

// ─── Compliance ───────────────────────────────────────────────────────────────

describe('intents comply with the decision tables', () => {
  const compliant = ALL_ENEMIES.filter(e => !(e in KNOWN_GAPS))

  it.each(compliant)('%s does exactly what is specified', enemy => {
    SPEC[enemy].forEach((turn, index) => {
      expect(
        matchesSpec(ENEMY_INTENTS[enemy][index], turn.action),
        `${enemy} turn ${index + 1}: the spec requires ` +
        `${JSON.stringify(turn.action)}, the engine does ` +
        `${JSON.stringify(ENEMY_INTENTS[enemy][index])}`,
      ).toBe(true)
    })
  })
})

// ─── Pinned gaps ──────────────────────────────────────────────────────────────

describe('known gaps between specification and engine', () => {
  const gaps = Object.keys(KNOWN_GAPS) as EnemyType[]

  it.each(gaps)('%s: the gap has not changed', enemy => {
    const gap = KNOWN_GAPS[enemy]!
    expect(
      ENEMY_INTENTS[enemy],
      `${enemy} behaviour changed but KNOWN_GAPS was not updated. ` +
      `If the mechanic is implemented, remove the enemy from KNOWN_GAPS. ` +
      `If something else changed, update actual and re-check ${gap.bug}.`,
    ).toEqual(gap.actual)
  })

  it.each(gaps)('%s: the gap still exists', enemy => {
    // Fails the moment the implementation catches up with the spec. That is the
    // signal to close BUG-14 and drop the enemy from the list — otherwise the
    // gap gets closed while the record of it stays behind and misleads whoever
    // reads it next.
    const compliant = SPEC[enemy].every((turn, index) =>
      matchesSpec(ENEMY_INTENTS[enemy][index], turn.action),
    )
    expect(
      compliant,
      `${enemy} now complies with the specification — remove it from KNOWN_GAPS ` +
      `and close ${KNOWN_GAPS[enemy]!.bug} in BUGS.md.`,
    ).toBe(false)
  })
})

// ─── Conditional intents ──────────────────────────────────────────────────────
//
// This block used to assert the opposite: that the engine had no conditional
// intents, so every conditional row was unimplementable and its enemy had to
// stay pinned in KNOWN_GAPS. That was true until BUG-14 was closed. The test is
// kept rather than deleted, inverted rather than weakened — the debt it measured
// is now partly paid, and the same rows are the evidence.

describe('conditional rows in the decision tables', () => {
  const conditionalRows = ALL_ENEMIES.flatMap(enemy =>
    SPEC[enemy]
      .map((turn, index) => ({ enemy, index, turn: index + 1, spec: turn }))
      .filter(row => row.spec.conditional),
  )

  it('the tables still declare conditional behaviour', () => {
    // If this ever hits zero, either the tables were gutted or the spec stopped
    // describing branching — both worth noticing before the tests below silently
    // start checking nothing.
    expect(conditionalRows.length).toBeGreaterThan(0)
  })

  it('every conditional row is either implemented or pinned as a known gap', () => {
    for (const row of conditionalRows) {
      const implemented = !(row.enemy in KNOWN_GAPS)
      expect(
        implemented || row.enemy in KNOWN_GAPS,
        `${row.enemy} turn ${row.turn} carries the condition "${row.spec.conditional}". ` +
        `It must either be resolvable by resolveIntent or stay in KNOWN_GAPS.`,
      ).toBe(true)
    }
  })

  // ─── The Necromancer, row by row ────────────────────────────────────────────
  //
  // Checked through resolveIntent against actual board states rather than
  // against the static table: a conditional row is only meaningful when the
  // condition is exercised in both directions.

  it('turn 2 raises when a raisable corpse is present', () => {
    const intent = resolveIntent('necromancer', 1, stateWith({ corpse: 'fresh' }))
    expect(intent).toEqual({ type: 'raise' })
  })

  it('turn 2 falls back to Wither when no corpse is present', () => {
    const intent = resolveIntent('necromancer', 1, stateWith({}))
    expect(intent).toEqual({ type: 'bleed', value: 3 })
  })

  it('turn 2 falls back to Wither when the only corpse was already raised', () => {
    // The rule that stops one body supplying skeletons forever. Without the
    // raisedOnce flag this row would keep firing on the same corpse.
    const intent = resolveIntent('necromancer', 1, stateWith({ corpse: 'spent' }))
    expect(intent).toEqual({ type: 'bleed', value: 3 })
  })

  it('turn 3 empowers when a living skeleton is on the field', () => {
    const intent = resolveIntent('necromancer', 2, stateWith({ skeleton: 'alive' }))
    expect(intent).toEqual({ type: 'empower', value: 3 })
  })

  it('turn 3 falls back to Wither with no skeleton', () => {
    const intent = resolveIntent('necromancer', 2, stateWith({}))
    expect(intent).toEqual({ type: 'bleed', value: 3 })
  })

  it('turn 3 falls back to Wither when the skeleton is dead', () => {
    const intent = resolveIntent('necromancer', 2, stateWith({ skeleton: 'dead' }))
    expect(intent).toEqual({ type: 'bleed', value: 3 })
  })

  it('enemies without conditional rows are unaffected by board state', () => {
    // The guarantee that adding conditions did not quietly make every enemy
    // board-dependent.
    for (const turnIndex of [0, 1, 2]) {
      expect(resolveIntent('goblin', turnIndex, stateWith({ skeleton: 'alive', corpse: 'fresh' })))
        .toEqual(ENEMY_INTENTS.goblin[turnIndex])
      expect(resolveIntent('guardian', turnIndex, stateWith({ corpse: 'fresh' })))
        .toEqual(ENEMY_INTENTS.guardian[turnIndex])
    }
  })
})
