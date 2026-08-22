# Decision Tables — Enemy AI Behaviour

Decision tables are a classic testing technique: enumerate all conditions and actions as a matrix.
Every row = one test case. Every combination = one invariant to verify.

> **Where this transfers:** This technique applies directly to enterprise systems — insurance rule engines,
> pricing algorithms, loan approval workflows. The enemy AI here is structurally identical to
> a business rules engine with scripted sequences.

---

## Guardian — "The Lockdown"

Pattern: setup → stun → punish. Each turn maps to a fixed intent.

| Turn | Condition | Intent | Effect | Test case |
|------|-----------|--------|--------|-----------|
| 1 | Always | Shield | Gain 8 defend | Hero attack partially/fully absorbed |
| 2 | Always | Stun | Hero canAct = false | Hero cannot play cards next turn |
| 3 | Always | Heavy Strike (10) | Hero takes 10 damage (post-defend) | Stunned hero takes unblocked damage |
| 4+ | Cycle repeats | Shield → Stun → Attack | — | Pattern repeats every 3 turns |

**Derived tests from this table:**

```ts
// Row 1: Shield absorbs hero attack
it('Guardian on turn 1 gains 8 defend', () => { ... })

// Row 2: Stun prevents hero from acting
it('Guardian stun on turn 2 → hero canAct = false on turn 3', () => { ... })

// Row 3: Stunned hero cannot defend
it('Hero stunned + 10 damage → takes full 10 (no defend played)', () => { ... })

// Cross-row: stun does not clear defend
it('Stun fires while defend is still active from turn 1', () => { ... })
```

**What this table reveals:**
- Turn 3 is the highest-risk turn: hero is stunned AND takes the heaviest attack
- If hero heals between turns 2 and 3 → they survive the attack but were still stunned
- Killing the Guardian on turn 1 or 2 avoids the heavy strike entirely

---

## Vampire — "The Opportunist"

Pattern: probe → exploit → execute. Responds to hero state.

| Turn | Condition | Intent | Effect | Test case |
|------|-----------|--------|--------|-----------|
| 1 | Always | Strike + Lifesteal (6) | Hero takes 6, Vampire heals equal to damage dealt | Lifesteal capped at (Vampire maxHp - currentHp) |
| 2 | Always | Bleed (2) | Hero gains 2 bleed stacks | Combined with future attacks |
| 3 | Always | Heavy Strike (12) | Hero takes 12 (no lifesteal) | Hero at low HP from bleed → high risk |

**Derived tests:**

```ts
// Row 1: Lifesteal fires on living target
it('Vampire turn 1 attack → heals self equal to damage dealt', () => { ... })

// Row 1 boundary: Lifesteal does not overheal
it('Vampire at full HP → lifesteals 0', () => { ... })

// Row 2 × Row 3 interaction: bleed tick + heavy strike in same turn
it('Hero with bleed 2 + Vampire turn 3 attack: total damage = bleed(2) + strike(12)', () => { ... })
```

---

## Necromancer — "The Accumulator"

Pattern: pressure → raise → empower.

| Turn | Condition | Intent | Effect | Test case |
|------|-----------|--------|--------|-----------|
| 1 | Always | Wither (bleed 3) | Hero gains 3 bleed | Bleed ticks for 3 turns 1 |
| 2 | Ally dead → Raise | Raise Dead | Spawn Skeleton | No corpse → no effect |
| 2 | No ally dead | Wither again | Hero gains more bleed (cap at 10) | Stacking check |
| 3 | Skeleton present → Empower | Empower (+3 next attack) | Skeleton next attack +3 | No skeleton → apply bleed |

**Derived tests:**

```ts
// Row 1: Initial bleed application
it('Necromancer turn 1 applies exactly 3 bleed stacks', () => { ... })

// Row 2 × cap: bleed stacks capped at 10 regardless of accumulation
it('Two Wither applications = min(3+3, 10) = 6 stacks', () => { ... })

// Row 2: Raise with no corpse = graceful no-op
it('Necromancer raise with no dead ally → no entity spawned', () => { ... })
```

---

## Goblin — "The Pressure"

| Turn | Condition | Intent | Effect | Test case |
|------|-----------|--------|--------|-----------|
| 1 | Always | Melee Strike (6) | Hero takes 6 | Baseline damage |
| 2 | Always | Melee Strike (6) | Hero takes 6 | Same |
| 3+ | Cycle | Melee Strike (6) | Hero takes 6 | Pattern never changes |

**Note:** Goblin has no conditional logic — every row is identical. This is the simplest possible
decision table: one condition (always), one action (attack 6). Tests: verify goblin always attacks,
never applies status effects, cycles correctly.

---

## Cross-enemy invariants (derived from all tables)

| Invariant | Table source |
|-----------|-------------|
| Enemy intent cycles deterministically (same seed = same sequence) | All tables |
| Stun prevents enemy from acting that turn | Guardian row 2 |
| Lifesteal does not fire on dead entities | Vampire row 1 |
| Bleed cap at 10 regardless of source | Necromancer row 2 |
| Raise with no corpse = silent no-op, no error | Necromancer row 2 |
| Heavy strike on stunned hero = unblocked damage | Guardian rows 2+3 |

---

## Additional cross-row tests (from external review)

These tests are not visible from any single row — they emerge from interactions between rows or boundary conditions in the cycle.

```ts
// Guardian: cycle boundary — turn 4 repeats turn 1
it('Guardian turn 4 repeats Shield intent (cycle boundary)', () => {
  expect(intentAtTurn(guardian, 4)).toEqual(intentAtTurn(guardian, 1))
})
// Catches: modulo/cycle off-by-one bugs

// Vampire: lifesteal uses actual damage dealt, not overkill
it('Vampire lifesteal heals min(dmg_dealt, missing_hp), not raw attack value', () => {
  // Hero HP = 2, Vampire attacks 6 → deals 2 actual damage → heals 2, not 6
})
// Catches: lifesteal applied to "virtual" overkill damage

// Necromancer: same corpse cannot be raised twice
it('Goblin corpse cannot be raised after already being raised once', () => {
  // corpse.raisedOnce = true → Raise Dead = no-op
})
// Catches: corpse state remains "reusable" after raise

// Bleed + Death's Door: bleed tick can trigger the transition
it('Bleed tick places hero into Death\'s Door when HP reaches 0', () => {
  // Hero at 3 HP + bleed 3 → tick → hp = 0 → death_door
})
// Catches: bleed tick bypassing state machine transition
```

---

## Enterprise testing parallel

The mapping is almost one-to-one:

| Game AI | Enterprise system |
|---------|------------------|
| Turn | Workflow step |
| Intent | Business action |
| Enemy state | Account / Application state |
| Status effect | Business flag |
| Stun | Temporary restriction |
| Bleed | Recurring charge / penalty |
| Raise Dead | Entity creation event |
| Lifesteal | Derived financial adjustment |

The Necromancer table is structurally identical to a loan-processing decision table:

| Step | Condition | Action |
|------|-----------|--------|
| 2 | Existing collateral present | Reuse collateral |
| 2 | No collateral | Request new collateral |

The testing methodology is exactly the same. Decision tables are not a "game testing technique" — they are a rule verification technique.

---

## How to use this table for testing

1. **Each row = one test case** — if you have 4 rows in a table, write 4 tests minimum
2. **Cross-row interactions = additional tests** — turn 2 stun + turn 3 attack = combined scenario
3. **Boundary rows** — row 1 → row N transition (what happens when cycle repeats?)
4. **Conditional rows** — test both branches (ally dead / no ally dead for Necromancer)

> **Enterprise equivalent:** Replace "turn" with "workflow step", "intent" with "business action",
> "condition" with "business rule condition". The table structure is identical.
