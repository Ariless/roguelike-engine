# Project 3 — Roguelike Game Engine

**Status:** design complete, not yet built  
**Repo:** separate repo (not yet created)  
**Last updated:** 2026-05-16

---

## Project 3 — Roguelike game engine (separate repo)

### Goal
Build a deterministic roguelike simulation engine in TypeScript and write a professional test suite against it. The engine is the SUT. The point is **not** to demonstrate game testing skills — it is to demonstrate that advanced testing techniques (property-based, state machine, seeded randomness) apply universally across domains.

**Project tagline:** *A deterministic roguelike simulation engine built to explore advanced testing techniques through unstable timelines and reproducible state corruption.*

### Narrative — minimalist dark lore (decided 2026-05-15)
Atmosphere without worldbuilding. One concept, one character, a few phrases. Costs nothing to implement.

**World concept: broken simulation**
The dungeon is an unstable simulation. Every seed creates a separate timeline. Most timelines are stable. Some collapse into impossible states. The engine hunts them.

```
The dungeon is unstable.
Reality fractures differently under every seed.
Some timelines collapse.
Some heroes survive impossible states.
Some runs should never exist.
```

**Identity hook: The Archivist**
Not a hero with a biography — a system persona. The Archivist remembers every failed seed. Sees broken timelines. Detects impossible states. The replay system IS the Archive.

> *"The Archivist remembers every failed seed."*
> *"Some deaths repeat across timelines."*

Seeds as alternate realities:
```
Seed 44112: The knight survived.
Seed 44113: The same battle collapsed instantly.
```

**Narrative reframing of technical features:**
| Technical | Narrative |
|-----------|----------|
| Failed test / invariant violation | Corrupted timeline |
| Replay file | Archived timeline |
| `debugger.html` | Timeline Archive viewer |
| `npm run simulate` | Scanning timelines for corruption |
| Failing seed saved to `/artifacts` | Corrupted timeline archived by The Archivist |
| CI run | Automated timeline stability scan |
| State divergence / non-determinism | Timeline drift |
| Mutation survived | Hidden corruption |
| Flaky test | Unstable observation |
| Invariant holds / test passes | Containment successful |
| Shrinking to minimal failing case | Corruption isolated to step N |
| All CI tests green | Simulation stable. No invariant drift detected. |

**"TIMELINE CORRUPTED" screen** (replaces "INVARIANT VIOLATION"):
```
TIMELINE CORRUPTED

dead entity acted

Seed: 882911  Turn: 17

The Archivist has archived this run.
```
Same technical content (seed + turn + violated invariant), wrapped in narrative.

**Tonal inspiration:** Darkest Dungeon (narration tone, fragility of victory) + SCP Foundation (anomaly language for impossible states). Visual combat UX from Slay the Spire.

**"TIMELINE CORRUPTED" screen — final format:**
```
TIMELINE CORRUPTION DETECTED

Seed: 882911  ·  Turn: 17

LOGIC [Challenging: Failure]
Dead entities attempted to act.

The Archivist has preserved this replay for analysis.
```

**Stability vocabulary (decided 2026-05-15):**
The system has a measurable stability — shown in CI output, debugger header, and replay metadata. Counterbalances the corruption/collapse vocabulary; gives language for when things GO RIGHT.

```
Timeline Stability: 98.2%
Residual instability detected.

Simulation stable.
No invariant drift detected.

Containment successful. Invariant preserved.
Corruption isolated to Timeline Segment 17.
```

Used in:
- CI output footer — "Simulation stable." or "Instability detected in N timelines."
  - debugger.html header — current seed's stability score
  - Replay metadata — `"stability": 0.982`
  - Shrinking output — "Corruption isolated to 3 actions."

**Archivist constraint (decided 2026-05-15):**
The Archivist works because it is almost a system process — not a character.
```
❌ No: dialogue, backstory, "who was he", emotional arc, motivations, lore explanations
✓ Yes: system outputs, anomaly reports, archived logs, process-like behavior
```
The moment it gets a personality, it becomes a game character. It must stay a forensic system persona.

**Mechanic = narrative (decided 2026-05-15):**
Status effects are not numbers — they are explanations of why this rule exists in this world:

| Status | Narrative framing |
|--------|-------------------|
| **Bleed** | *"A wound that won't close — the body keeps losing strength until it finally collapses"* |
| **Vulnerable** | *"Loss of stance and control — not a stat reduction, a breakdown"* |
| **Death's Door** | *"Already dead by the laws of this world — still acting on momentum alone"* |
| **Stun** | *"Reality around the entity fractured for one turn"* |
| **Defend** | *"A borrowed moment of order — it doesn't last"* |

**Card names as behaviour, not abilities (decided 2026-05-15):**

| Old name | New name | Why |
|----------|----------|-----|
| Sacrifice | **Bloodrite** | You pay in blood for power — a ritual, not a mistake |
| Mend | **Stubborn Recovery** | Not healing — refusing to die |
| Feral Roar | **Reality Crack** | In werewolf form, the world around you breaks |
| Defend | **Brace Through Pain** | Protection costs something |
| Hemorrhage | **Open the Wound** | Deliberate, not accidental damage |

**Hero conflict triangle — testing rationale:**
Three heroes in fundamental mechanical conflict — their interactions generate the combinatorial state space that makes property-based testing necessary.

| Hero | Mechanic | Testing value |
|------|----------|---------------|
| **Paladin** | Heal + charge stacks | HP ceiling invariant; charge boundary at exactly 3 stacks |
| **Blood Mage** | Self-damage as fuel; bleed spreading | Death's Door via own card; bleed stacking cap |
| **Berserker** | Bonus from low HP; human↔werewolf form | Nested state machine; form reversion trigger |

**Central conflict — "weaponized help" (false invariant):**
Paladin heals Berserker → removes their power source.

> *"Healing someone should always be beneficial"* — **false invariant** in this system.

`assertHealIsAlwaysBeneficial()` → FAILS → documented as intentional exception → bug cemetery entry.
This is the project's strongest demonstration: a test that intentionally fails as domain specification.

### Positioning — what this IS and what it is NOT

| IS | IS NOT |
|----|--------|
| How to approach a rule engine when there is no UI to click and no API to call | A guide to game testing |
| Property-based testing, state machine coverage, fault injection — techniques QA takes to any complex system | "How to architect a testable system" (that's the developer's job) |
| A visual, memorable SUT for patterns that appear in payment engines, pricing rules, insurance systems | A CRUD system with a game skin |
| Evidence that you can test pure logic, not just endpoints | Game QA / gamedev experience |

**What QA learns here (not the developer's concern):**
- How to write assertions when there's no response body to check
  - How to find edge cases in complex rule combinations without manual exploration
  - How to detect that a rule is wrong when the system doesn't throw an error
  - How to test state transitions that are invisible to the outside world

**Framing in one paragraph:**
This is not game testing. The roguelike is a rule engine — the same class of system as a payment processor, a pricing calculator, or an insurance rules engine. It earns its place by being visual and interesting; every technique here transfers directly to a production system.

**Interview framing:** "The engine is a system under test, stood up with Claude Code so that I could work on a class of systems QA courses skip: complex rule engines with no API and no UI. The same patterns apply to payment processing, pricing logic, and workflow systems, and the testing is the part that is mine — property-based testing, state machine coverage and fault injection on a system rich enough to generate real bugs."

### Why this domain
- Position-based combat + card system + status effects = complex rule system with combinatorial state — same structure as a pricing engine or insurance calculator
  - No API, no UI, no database — forces you to test pure logic directly, which is the skill
  - Death's Door mechanic = multi-condition state transition rarely seen in CRUD apps, common in financial and insurance systems
  - Inspired by Slay the Spire + Darkest Dungeon mechanics — rich enough to generate real bugs, small enough to build in days

### Scope (minimal viable engine)
3 heroes, 4 enemies + 1 boss, 4 status effects, position system. Content is minimal — complexity comes from interactions, not volume.

**Not** content for players. **Yes** — edge cases, branching logic, interaction rules that generate state-machine complexity.

**⛔ CONTENT FREEZE (decided 2026-05-15):** No new heroes, enemies, statuses, or cards. The system is dense enough. Any addition now reduces signal — dilutes interaction density, increases maintenance, distracts from the actual portfolio value. Next steps are execution: execution model, invariant registry, EventSpec, replay architecture, debugger, CI narrative. Adding content is the wrong direction.

#### Heroes (3 heroes, decided 2026-05-15)

Zero overlap in testing patterns — each covers a unique test paradigm.

**Card design rule (decided 2026-05-15):** every card must touch minimum 2 of 4 system axes:
- **Tempo** — who controls the turn (stun, extra action, delay)
  - **Pressure** — unavoidable damage over time (bleed, mark, stacking debuff)
  - **Stability** — survival control (block, cleanse, reposition)
  - **Conversion** — turning one resource into another (HP→damage, block→damage, status→buff)

**Paladin** — HP ceiling, charge accumulation, threshold boundary
Charge stacks accumulate at Action Resolution Pipeline `step 5` (post-effects) when a qualifying attack lands. Charge-fuelled double damage fires at `step 4` (damage calculation) of the triggering attack. Stacks survive boss Phase 3 state reset (only status effects reset, not charge).


| Card | Axes | Effect | Testing value |
|------|------|--------|---------------|
| **Righteous Strike** | Tempo + Conversion | Deal 5 damage; if target is vulnerable → gain 1 charge stack | exploits enemy state; charge × vulnerable interaction |
| **Stubborn Recovery** | Stability + Conversion | Heal self for 6 HP | HP ceiling invariant: `hp <= maxHp`; heal × werewolf reversion |
| **Divine Charge** | Tempo + Conversion | Gain 1 charge stack (max 3); at 3 stacks next attack deals double damage | multi-turn accumulation; boundary at exactly 3 stacks; charge × Death's Door |

**Blood Mage** — bleed stacking, self-damage, RNG targeting
| Card | Axes | Effect | Testing value |
|------|------|--------|---------------|
| **Open the Wound** | Pressure + Stability disruption | Apply 3 bleed; if target already bleeding → also apply vulnerable | bleed stacking; off-by-one; bleed→vulnerable conversion; mutation target |
| **Bloodrite** | Conversion + Pressure | Deal 8 damage, take 3 self-damage | HP→damage conversion; Death's Door trigger via own card |
| **Chaos Bolt** | Tempo + Pressure | Deal 5 damage to **random** target | RNG call; seeded reproducibility; back-row targeting edge case |

**Berserker** — rage mode (binary threshold), attack-to-resource conversion
Rage Mode active when HP ≤ 25% — all damage ×1.5 for the current turn. Purely derived state, no stored flag. No transformation.

| Card | Axes | Effect | Testing value |
|------|------|--------|---------------|
| **Savage Lunge** | Tempo + Stability | Deal 6 damage (×1.5 in Rage) + push enemy to back row | rage binary threshold; position transition; melee range invalidation |
| **Primal Fury** | Conversion + Tempo | Deal 4 damage (×1.5 in Rage) + gain 1 rage stack (max 5) | rage accumulation; conversion: attack→resource |
| **Primal Dodge** | Stability + Conversion | Gain 4 defend; in Rage → +1 energy | defend in non-defensive class; rage-conditional energy |

**Werewolf** — nested state machine (human↔wolf form), wolf passive scaling
Transforms at HP ≤ 50% (Turn Pipeline step 3, fires even while stunned). Wolf form lasts 3 turns or until HP healed above 50%. Wolf passive: `damage * (1 + missingHp / maxHp)`.

| Card (human form) | Axes | Effect | Testing value |
|------|------|--------|---------------|
| **Lunar Strike** | Tempo + Pressure | Deal 5 damage; if HP ≤ 50% deal 8 instead | threshold awareness; same card, branching damage |
| **Pack Sense** | Pressure + Stability | Apply vulnerable to target + gain 2 defend | debuff + defence combo; dual-target action |
| **Stalk** | Stability + Conversion | Gain 5 defend + apply 1 bleed to target | patience mechanic; setup before transformation |

| Card (wolf form) | Axes | Effect | Testing value |
|------|------|--------|---------------|
| **Rend** | Pressure + Tempo | Deal 8 damage (wolf-scaled) + apply 2 bleed | damage + DoT combo; bleed applied AFTER damage (order matters) |
| **Rampage** | Tempo + Pressure | Deal 4 damage (wolf-scaled) to all enemies | AOE; wolf scaling computed once for all targets |
| **Reality Crack** | Pressure + Conversion | Apply vulnerable to all enemies | mass debuff; vulnerable × bleed interaction |

**Berserker passive:** damage dealt scales with missing HP — `damage * (1 + missingHp / maxHp)`. Applied at Action Resolution Pipeline `step 4` (damage calculation) as a flat multiplier before vulnerable. Mutation target: the formula itself.

**Property test — card axes invariant:**
```ts
// every card must affect at least 2 system axes
forAll(allCards, card => axesAffected(card).length >= 2)

// every card must leave combat state measurably changed
forAll(seeds, s => forAll(allCards, card =>
  combatStateAfter(card, s) !== combatStateBefore(card, s)
))
```

#### Overstack / idempotency rules (decided 2026-05-15)
Edge cases at system boundaries — exactly the cases mutation testing needs to catch:

| Rule | Invariant | Test case |
|------|-----------|-----------|
| Bleed stack **capped at 10** | `bleed.stacks <= 10` always | Apply bleed 8 + bleed 5 → stacks = 10, not 13 |
| Stun **does not extend** duration | Re-applying stun resets to 1, never stacks | Stun a stunned enemy → still 1 turn skipped |
| Multiple death triggers **idempotent** | `dead → dead` is a no-op | Bleed tick + attack both "kill" hero same turn → dies once, no double event |
| Death's Door is **sticky** — only explicit heal clears it | `death_door` not cleared by form change or turn end | Berserker transforms at Death's Door → still Death's Door in werewolf form |

#### Berserker / Werewolf rules (decided 2026-05-15)
Nested state machine — hero has own form SM inside game SM:
```
hero states:  alive → death_door → dead
form states:  human → werewolf → human
```

| Rule | Turn Pipeline step | Test case |
|------|-------------------|-----------|
| Transformation **automatic** at ≤50% HP — not a card action | Step 3 (start-of-turn passive check): if HP ≤ 50% → trigger transform | "Hidden" transition in property-based tests; triggers mid-sequence without player choice |
| Werewolf form lasts **3 turns**, then auto-reverts | Step 3 (start-of-turn): revert check on turn counter | Boundary: exactly 3 turns, not 2 not 4 |
| Werewolf form also reverts if HP healed **above 50%** (Paladin heal) | Step 3 (start-of-turn): HP threshold re-evaluated after heal; revert fires same mechanism | Heal × form reversion; healing weakens berserker |
| Status effects **carry across** transformation | Step 3 (start-of-turn): form changes, status list is unaffected | Bleed continues in werewolf form; stun continues; no reset |
| Stun does **not** block transformation — it's automatic, not an action | Step 3: stun sets `canAct = false` (blocks step 4/5 actions); passive transform check is separate | Stun × transformation timing invariant |
| Human-form cards **invalid** in werewolf form and vice versa | Step 4/5 (action execution): card validity checked at dispatch | Invalid action test; `assertValidGameState()` catches it |
| Death's Door rules apply in **both** forms | Step 9 (death resolution): form is irrelevant to death state | Death's Door in werewolf → next hit kills regardless of form |
| Revert while stunned on turn 3 → **revert happens**, stun continues | Step 3: revert check fires; step 4 skipped due to stun | Turn timing: revert is automatic, stun is a status — both apply |

#### Enemies

| Enemy | Mechanic | Testing value |
|-------|---------|---------------|
| **Goblin** | Simple melee, front-row only | baseline; cannon fodder for Necromancer to raise |
| **Necromancer** | Raises dead allies as Skeletons | entity lifecycle; spawn invariants; order of operations; stun × raise |
| **Guardian** | Shield (absorbs hits) + stun; if stunned while shield active → shield breaks | multi-status interaction; shield × stun edge case |
| **Vampire** | Lifesteal on living targets only; heals self equal to damage dealt (post-defend, post-vulnerable); no heal on Skeleton (undead) | HP ceiling invariant; lifesteal × defend; lifesteal × vulnerable; undead targeting logic |

**Cultist removed** — bleed already covered by Blood Mage's Open the Wound card.

#### Encounter dramaturgy — intent sequences (decided 2026-05-15)
Enemies are not random AI. Each enemy has a **telegraphed 3-turn pattern** — almost like scripted direction. This makes encounters predictable (testable) and dramatically structured.

Every intent is shown to the player before acting (Slay the Spire style):
`⚔ 6` = attack for 6 · `🩸 3` = apply bleed 3 · `🛡` = will defend · `💀` = raise dead · `✨` = empower

**Goblin — "the pressure"**
Simple loop. Exists to feed Necromancer and Vampire.
```
Turn 1: ⚔ 6  — Melee Strike (front hero)
Turn 2: ⚔ 6  — Melee Strike (front hero)
Turn 3: repeat
```
Testing value: baseline sequence; property test — Goblin always targets front row; seeded = always same target.

**Necromancer — "the orchestrator"**
Weakens → raises → amplifies. Sets up the board for others.
```
Turn 1: 🩸 3  — Wither (apply bleed 3 to front hero)
Turn 2: 💀    — Raise Dead (if ally dead → spawn Skeleton); else 🩸 3 again
Turn 3: ✨    — Empower Skeleton (next Skeleton attack +3); else apply vulnerable
```
Testing value: conditional branching on board state; Skeleton spawn on turn 2 = entity lifecycle test; empower timing = order-of-operations test.

**Guardian — "the lockdown"**
Defends → stuns → punishes. Classic setup/execute pattern.
```
Turn 1: 🛡    — Shield self (gain 8 defend)
Turn 2: ⚡    — Stun front hero (hero canAct = false next turn)
Turn 3: ⚔ 10 — Heavy Strike (hero is stunned, cannot defend)
```
Testing value: stun × defend sequence; hero stunned on turn 3 = canAct invariant; Heavy Strike while stunned = property test "stunned hero cannot play cards".

**Vampire — "the opportunist"**
Probes → exploits → finishes. Responds to existing statuses on hero.
```
Turn 1: ⚔ 6  — Strike (lifesteal if target living)
Turn 2: 🩸+⚔ — Exploit Wound (if hero has bleed: extra attack + amplified lifesteal); else ⚔ 6
Turn 3: ⚔ 12 — Execute (if hero at Death's Door: high damage attempt); else ⚔ 8
```
Testing value: conditional on hero state (bleed, Death's Door); lifesteal × bleed = two status interactions through pipeline; Execute at Death's Door = terminal state targeting test.

**Cross-enemy awareness rules (decided 2026-05-15, updated 2026-05-15):**
Cross-enemy effects are **event-scoped, not state-scoped** — they trigger on specific events and affect only the next actions, not global state permanently. This keeps enemies as agents, not rule triggers, and makes the system replay-safe.

| Rule | Event trigger | Scope | Test case |
|------|--------------|-------|-----------|
| Vampire acts **after** Necromancer in turn order | — (turn order rule) | permanent | Turn order determinism; Vampire sees bleed = true |
| `onEvent: stunApplied` → **next** enemy attack +2 damage | stunApplied | next action only, not all remaining turns | Stun on turn 2 → enemy attack on turn 3 is +2; turn 4 is normal |
| Necromancer won't raise if **no corpse on field** | raiseAttempted | graceful no-op | assertValidGameState() after no-raise turn |
| Skeleton **inherits Necromancer's empowerment** only if raised before empower | empowerApplied | targets existing Skeleton only | Order matters: raise turn 2 → empower turn 3 ✓; empower with no Skeleton = no-op |

**Why this matters for testing:**
Deterministic sequences = predictable multi-step scenarios:
```
Seed 42, turn 1: Guardian shields
Seed 42, turn 2: Guardian stuns → hero.canAct = false
Seed 42, turn 3: Guardian heavy strike → hero stunned, no defense
```
Property test: `forAll(seeds, s => guardianTurn3DamageIsUnblocked(simulate(s)))`

#### Encounter phase model (decided 2026-05-15)
Every combat is a scripted 4-phase scene — not random exchanges:

```
Phase 1 — Setup Pressure    enemies apply bleed / weak; background damage + dread
Phase 2 — Constraint        stun / position lock; player loses tempo
Phase 3 — Vulnerability     vulnerable + burst intent; peak damage window
Phase 4 — Resolution        burst lands / reset / new threat spawns
```

**Enemy roles in the scene** — our enemies already fill these:
| Role | Enemy | Job in scene |
|------|-------|-------------|
| Pressure Unit | Necromancer | Applies bleed; creates inevitability |
| Controller | Guardian | Stun + position lock; breaks player plans |
| Window Maker | Vampire | Exploits existing statuses; opens burst window |
| Finisher | Guardian (turn 3) / Vampire Execute | Closes the scene |

**Combat state machine** — enemies push the fight between states:
```
Stable → Pressured (bleed dominates) → Controlled (player loses actions)
       → Exposed (vulnerable window) → Collapsing (burst phase)
```

The encounter phase model and CombatStateMachine describe the same progression — phase model is the narrative view, CombatStateMachine is the technical implementation. Phase 1 = `Stable→Pressured`, Phase 2 = `Pressured→Controlled`, Phase 3 = `Controlled→Exposed`, Phase 4 = `Exposed→Collapsing`. Never treat them as separate parallel models.

**Property tests on dramaturgy** (not on damage — this is the key):
```ts
// state entropy increases over time until resolution (stronger than length >= 2)
forAll(seeds, s => stateEntropyIncreasesUntilResolution(simulate(s)))

// no regression to Stable after Exposed — temporal logic invariant
forAll(seeds, s => {
  const states = combatStates(simulate(s))
  const exposedIndex = states.indexOf('Exposed')
  return exposedIndex === -1 ||
    states.slice(exposedIndex).every(s => s !== 'Stable')
})

// every Stun must be followed by Exposed or Pressured phase
forAll(seeds, s => stunAlwaysLeadsToVulnerabilityOrPressure(simulate(s)))

// every encounter eventually reaches Resolution
forAll(seeds, s => combatEventuallyTerminates(simulate(s)))
```
These test **encounter design**, not damage numbers. Temporal logic invariants (`no regression after X`) are a stronger class than state counting.

#### Boss — "The Archivist" (decided 2026-05-15)
The entity that preserved corrupted timelines has itself become corrupted. The final encounter is the testing system vs an adversarial version of its own pipeline.

**Design rule:** The Archivist deals zero direct damage. It only modifies the rules. All damage in the fight comes from the broken rule system itself.

**Four phases — each breaks a different layer of the pipeline:**

```
Phase 1 — "Memory Suppression"    (turns 1–3)
  Removes all incomingHealing hooks for 2 turns.
  Paladin's Stubborn Recovery plays but heals 0.
  Testing value: applyEvent() with empty hook list for a modifier type;
                 Paladin charge stacks still accumulate (healing and charge are separate hooks).

Phase 2 — "Timeline Inversion"    (triggers when boss HP < 75%)
  Reverses resolution order for 1 turn:
  post-effects fire BEFORE damage calculation.
  Lifesteal (Vampire) calculated on pre-damage value → wrong amount.
  Testing value: resolution order pipeline under adversarial reorder;
                 assert lifesteal !== expected when phase active.

Phase 3 — "State Reset"           (triggers when boss HP < 50%)
  Forces ALL entities to alive (removes death_door, clears stun, clears bleed).
  Berserker's form also reset to human — forced transition at wrong time.
  Paladin's charge stacks: do they reset? Rule: NO — stacks survive (only statuses reset).
  Testing value: forced state reset; assertValidGameState() after reset;
                 charge stack preservation invariant.

Phase 4 — "Invariant Breach"      (triggers when boss HP < 25%)
  The Archivist attempts to set a dead entity's canAct = true.
  assertValidGameState() MUST catch this and throw TIMELINE CORRUPTED.
  Testing value: the ultimate invariant test — boss literally tries to corrupt state.
                 This is the test that proves the invariant system works.
```

**Property tests specific to the boss:**
```ts
// game state remains valid through every boss phase
forAll(seeds, s => allBossPhases(simulate(s)).every(state => isValidGameState(state)))

// pipeline inversion produces different results but always valid state
forAll(seeds, s => invertedPipelineState(simulate(s)).isValid === true)

// boss phase transitions are deterministic
forAll(seeds, s => {
  return JSON.stringify(bossPhaseSequence(simulate(s))) ===
         JSON.stringify(bossPhaseSequence(simulate(s)))
})

// Invariant Breach phase always triggers TIMELINE CORRUPTED, never a silent pass
forAll(seeds, s => phase4TriggersCorruptionDetected(simulate(s)))
```

**Narrative framing:**
```
FINAL ENCOUNTER

The Archivist no longer observes timelines.
It writes them.

Phase: Memory Suppression
"It is removing the ability to recover."

Phase: Timeline Inversion  
"Causality is reversed. Effects precede their causes."

Phase: State Reset
"It is erasing what happened."

Phase: Invariant Breach
"It is attempting the impossible."
→ TIMELINE CORRUPTED
   The invariant held.
   The Archivist has been archived.
```

**Boss decomposition — 3 separate concerns (decided 2026-05-15):**
```
Boss             → scripted phase controller; emits CorruptionEvents only
RuleMutationEngine → applies CorruptionEvents to engine; separate layer
Engine            → always validates AFTER mutation: applyMutation() → run() → assertValidState()
```
Boss does NOT directly break semantics. It submits inputs. The engine either holds or fails on its own terms.

**CorruptionEvent — boss actions are observable, not imperative:**
```ts
interface CorruptionEvent {
  type: "reorderResolution" | "removeHooks" | "forceStateReset" | "injectIllegalTransition"
  scope: "nextTurn" | "thisTurn" | "untilPhaseEnd"
  appliedAt: number        // turn number
  reversible: boolean
  constraintViolation: boolean  // true = assertValidGameState() must catch this
}
```
`constraintViolation: true` → bug cemetery entry. Every phase 4 event has `constraintViolation: true`.

**Shared mutation schema — boss and fast-check use the same formal model:**
```ts
// BossMutationSchema === ArbitraryMutationSchema (fc.arbitrary)
// game runtime and CI test suite are the same adversary

// fast-check version:
fc.assert(
  fc.property(fc.array(fc.constantFrom(...BossMutationSchema)), mutations => {
    mutations.forEach(m => RuleMutationEngine.apply(m))
    return isValidGameState(engine.state)
  })
)
```
Game and CI share the same formal model — "mirrored test oracle". Defeating The Archivist in-game and passing CI are equivalent proofs.

**Phase 4 — test expects violation, not absence:**
```ts
// Phase 4 "Invariant Breach" is asserting that detection works:
expect(() => {
  RuleMutationEngine.apply({ type: "injectIllegalTransition", constraintViolation: true })
  engine.run()
}).toThrow("TIMELINE CORRUPTED")
// test passes when the system correctly REJECTS the corruption
```

**Victory condition rewrite per phase:**
Win condition changes as The Archivist progresses — each shift creates a new invariant to assert:
```
Phase 1-2: "Kill The Archivist"          → assertBossDefeatable()
Phase 3:   "Survive 8 turns"             → assertCombatDoesNotSoftlock()
Phase 4:   "Restore system stability"    → assertAllInvariantsHold()
```
Test: `assertWinConditionIsValid(currentPhase)` — win condition itself must be a valid state.

**fast-check mirrors boss behavior outside the game (strongest testing idea):**
The Archivist inside the game = manual adversarial test.
fast-check test suite outside the game = automated version of the same adversary.
Both validate the same invariants. Two adversarial systems, one correctness proof.

```ts
// fast-check version of Phase 4 "Invariant Breach":
fc.assert(
  fc.property(fc.array(auditActions), actions => {
    const state = applyAuditActions(actions)
    return isValidGameState(state)  // must hold even under adversarial AuditActions
  })
)
```

Interview line: *"My final boss and my property-based test suite are the same adversary — one runs inside the game, one runs in CI. They validate identical invariants."*

**Why this is the strongest portfolio piece:**
The boss fight IS the test suite running against adversarial conditions. Defeating The Archivist = `assertValidGameState()` holding through 4 phases of pipeline corruption. This is not a game mechanic — it's a demonstration of defensive system design.

#### Vampire rules (decided 2026-05-15)
All rules mapped to resolution order pipeline phase. No temporal ambiguity.

| Rule | Pipeline phase | Test case |
|------|---------------|-----------|
| Heal = damage dealt **after** defend reduction | `5. post-effects` — runs after `4. damage calculation` | Target has defend 5, Vampire hits 8 → heals 3, not 8 |
| Heal = damage dealt **after** vulnerable amplification | `5. post-effects` — finalDamage includes vulnerable multiplier | Target vulnerable, Vampire hits 8 → damage 12 → heals 12 |
| HP **cannot exceed max** | `5. post-effects` — postcondition after heal applied | Vampire at 18/20 HP, hits for 6 → HP = 20, not 24 |
| Lifesteal does **not** trigger on Skeleton (undead) | `5. post-effects` — precondition: `target.type !== undead` | Vampire attacks Skeleton → healAmount = 0 |
| Lifesteal does **not** trigger from bleed ticks | `2. status application` — bleed is not Vampire's action; no post-effect hook | Bleed tick fires in phase 2; Vampire lifesteal hook only in phase 5 |
| Stun blocks attack → no heal | Turn Pipeline `step 3` (start-of-turn): `canAct = false` → no attack intent emitted at step 5 → no post-effect at step 8 → heal = 0 | Stunned Vampire emits no attack event → no post-effect → heal = 0 |

#### Necromancer rules (decided 2026-05-15)
All rules mapped to resolution order pipeline phase.

| Rule | Pipeline phase | Test case |
|------|---------------|-----------|
| Raise is a **conditional intent** on Necromancer's turn — if corpse present → spawn | Turn Pipeline `step 5` (enemy intent execution) of Necromancer's turn; EntitySpawn resolves via Action Resolution Pipeline `step 1` (state transitions) | Goblin dies turn 4 → Necromancer executes Raise Dead on turn 5 (step 5) → Skeleton spawns |
| Raised Skeleton gets **fresh state** — no inherited statuses | Action Resolution Pipeline `step 1` — spawn with clean state; no status copy | Goblin died with bleed 3 → Skeleton spawns with bleed 0 |
| Each corpse can be raised **once only** | Action Resolution Pipeline `step 1` — idempotency constraint: corpse flag `raisedOnce` | Kill Skeleton → corpse.raisedOnce = true → raise attempt = no-op |
| Stun **blocks raise** — stunned Necromancer skips raise action | Turn Pipeline `step 3`: `canAct = false` → intent cancelled at step 5; next eligible turn, raise fires if corpse still available | Stun turn 4 → Necromancer skips turn 5 entirely → raise fires turn 6 if corpse present |
| **Field capacity: 3 entities max** | Action Resolution Pipeline `step 1` — precondition: `fieldCount < 3` | Full field → raise attempt = graceful no-op, no error, no crash |

#### Status effect architecture — event modifier pipeline (decided 2026-05-15)
Statuses are NOT hardcoded effect combinations. They are temporary rewrites of world rules via shared hooks. Combos emerge automatically — no `if (bleed && vulnerable)` needed.

**Wrong approach (O(n²) conditions, combinatorial test hell):**
```ts
if (hasBleed && hasVulnerable) { damageTaken *= 1.3 } // never do this
```

**Correct approach: status → modifies rules → rules interact:**
```
ACTION → BASE VALUE → STATUS MODIFIERS → FINAL VALUE → RESULT
```

**Implementation:**
```ts
function applyEvent(event, entity) {
  let value = event.value
  for (const status of entity.statuses) {
    value = status.modify?.[event.type]?.(value, entity) ?? value
  }
  return value
}
```

**Statuses as hook collections (not effect descriptions):**
```ts
Bleed     = { onTurnStart: (e) => e.hp -= stacks,  incomingHealing: (v) => v * 0.5 }
Vulnerable= { incomingDamage: (v) => v * 1.5 }
Stun      = { canAct: () => false }
Defend    = { incomingDamage: (v) => Math.max(0, v - stacks),  onTurnEnd: clearDefend }
```

**Shared hook points (few hooks, many statuses — the design rule):**
```
onTurnStart       onTurnEnd
onDamageDealt     onDamageTaken
onHeal            canAct
modifyTargeting
```
Never add: `onBleedTick`, `onVulnerableHit`, `onStunBreak` — these are hardcoded interactions, not a pipeline.

**Three modifier layers (flat → multiplicative → rule-breaking):**
| Layer | Example | Drama level |
|-------|---------|-------------|
| Flat | `+2 damage` | Low |
| Multiplicative | `×1.5 incoming damage` | Medium |
| **Rule-breaking** | `canAct = false`, `ignoreBlock = true`, `damageBecomesTrueDamage = true` | **High — this is where drama lives** |

**Emergent combos (no manual wiring):**
| Situation | Emerges from |
|-----------|-------------|
| Bleed + Vulnerable | `onTurnStart` hp loss + `incomingDamage` amplification — death accelerates from both directions |
| Stun + Bleed | `canAct = false` + `onTurnStart` hp loss — entity watches its own disappearance |
| Stun + Vulnerable | `canAct = false` + `incomingDamage ×1.5` — object in an experiment, not a subject |

**Why this matters for testing:**
- Emergent combos = emergent test cases — property-based tests discover them automatically
  - Flat list of hooks = flat list of mutation targets
  - Adding a new status = zero changes to existing tests (open/closed principle)
  - `applyEvent()` is the single mutation target for the entire modifier system

#### Presentation layer types (decided 2026-05-15)
Renderer reads events and presentation structs — never game state directly.

**CardPresentation** — shared by game UI (card in hand) and debugger (card detail popup on event click):
```ts
interface CardPresentation {
  id: string
  title: string
  heroClass: "paladin" | "bloodmage" | "berserker" | "werewolf"
  axes: Axis[]
  rulesText: string
  imageUrl: string        // card art — AI-generated or curated; e.g. "/assets/cards/rend.jpg"
  narrativeLine?: string  // italic flavour text, optional
}
```
`heroClass` drives frame colour (paladin = gold, bloodmage = crimson, berserker = bone, werewolf = bone+red glow). No portraits, no images — everything from design tokens + unicode.

**Intent type union** — enemies and the debugger use one contract:
```ts
type Intent =
  | { type: "attack";    value: number }
  | { type: "bleed";     value: number }
  | { type: "defend" }
  | { type: "stun" }
  | { type: "raise" }
  | { type: "empower";   value: number }

// renderIntent(intent: Intent): string  — one function; all consumers
```

**Timeline event schema** — renderer reads events, not state:
```ts
interface TimelineEvent {
  turn: number
  type: "damage_applied" | "status_applied" | "entity_spawned" | "state_transition" | "invariant_violation"
  source: string        // entity id
  target: string        // entity id
  amount?: number
  modifiers?: string[]  // e.g. ["vulnerable", "lifesteal"]
  seed: number
  tensionMeter: number
}
// debugger is: events.map(renderEvent)
```

**TimelineState** — maps to both stability vocabulary and UI visual states:
```ts
type TimelineState = "stable" | "unstable" | "corrupted" | "collapsed"
// used in: CI output, debugger header, replay metadata, TIMELINE CORRUPTED screen
```

**Debug overlay format** — pipeline breakdown inside debugger (strongest portfolio signal):
```
[EVENT 441]
damage_pipeline:
  base:        8
  vulnerable:  +4
  defend:      -0
  final:       12

TRANSITION:
  alive → death_door
```
This looks like distributed tracing / audit tooling, not a game UI. That's the point.

#### Architecture principle — single source of truth (decided 2026-05-15)
`CombatStateMachine` is the primary model. Everything else is a derived view — not a parallel truth.

```
Execution layer (truth):
  intent sequences   → input schedule to state machine
  RNG                → seeded, deterministic
  state machine      → the one true model

Effects layer:
  statuses           → hooks on state transitions
  damage rules       → pipeline modifiers
  transformations    → form changes, entity lifecycle

Observability layer (derived, not authoritative):
  phase model        → derived from state distribution over time
  dramaturgy labels  → visualization of state transitions
  debug UI           → reads from telemetry only
```

**Risk to avoid:** phase model or intent sequences becoming a second source of truth. If Guardian stun appears in intent sequence AND phase model AND cross-enemy rules AND state machine — that's semantic drift. The test suite will start verifying different abstractions and diverge silently.

#### Action Resolution Pipeline (decided 2026-05-15)
Resolves **one specific action or effect** — called from within the Turn Pipeline at steps 4 and 5 (player actions, enemy actions). Not a turn structure — a per-action resolution order.

```
1. state transitions    — form change (werewolf), entity spawn (Necromancer raise)
2. status application   — bleed tick, stun decrement, defend expiry
3. positional effects   — melee range validation, back-row checks
4. damage calculation   — base × berserker scaling × vulnerable × battlefield condition
5. post-effects         — lifesteal (Vampire); death notification → marks corpse for raise
```

Vampire and Necromancer rule tables use **Action Resolution Pipeline** step numbers (1–5). Every test that involves two or more systems firing simultaneously relies on this order being stable. Mutation testing targets each step.

#### Turn Pipeline — per-turn contract (decided 2026-05-15)
Structures **one full turn** — what happens and in what order. References to "step X" in EffectType, BattlefieldCondition scope, and target validation use these step numbers (1–9).

**Steps 4 and 5 call the Action Resolution Pipeline** for each individual action taken.

```
Turn Pipeline (9 steps):
1. Apply battlefield conditions        ← BattlefieldCondition fires HERE ONLY
2. Determine turn order                ← seeded shuffle if Broken Order active
3. Start-of-turn passive checks        ← canAct (stun), HP threshold (werewolf), passive powers
4. Player actions          →  calls Action Resolution Pipeline per action
5. Enemy actions (intents) →  calls Action Resolution Pipeline per intent
6. Damage resolution                   ← resolves pending damage after all actions
7. Status tick                         ← automatic: bleed damage, stun decrement, defend expiry
8. End-of-turn effects                 ← Vampire lifesteal post-effect
9. Death resolution                    ← alive → death_door → dead; idempotent
```

**Effect categorisation — EffectType (decided 2026-05-15):**
```ts
type EffectType =
  | "DirectDamage"      // damage dealt via card or intent
  | "StatusApplication" // applying or ticking a status effect
  | "StateTransition"   // entity lifecycle: alive/death_door/dead, form change
  | "EntitySpawn"       // spawning a new entity (Necromancer raise, Turn Pipeline step 5)
  | "PipelineModifier"  // modifies turn structure (BattlefieldCondition, Turn Pipeline steps 1–2)
```
EffectType is a discriminant tag on each Effect — it says WHAT category, not WHEN it fires. Timing is defined per-event in `EventSpec.stage`. Every effect is tagged at creation: invariants, mutation tests, and replay diffs are grouped by EffectType.

**All rules execute through pipeline steps — never directly:**
No rule fires outside of its assigned pipeline step. Status hooks, battlefield conditions, positional checks, and boss mutations are all pipeline-mediated. This is a stronger statement of the "single source of truth" principle: no hidden side effects, no implicit ordering.

#### Tension meter (decided 2026-05-15)
Global combat state variable that accumulates based on play style and modifies enemy behaviour. New state = new invariant class.

```ts
tensionMeter: number  // 0–100; persists across turns within a combat
```

**How it accumulates:**
- Hero plays burst/direct damage cards → `+tension`
  - Hero prolongs fight via status effects (bleed stacking, bleed ticking) → `+tension`
  - Hero heals or defends → `-tension` (stabilising play reduces pressure)

**How it affects the system:**
- `tensionMeter < 30` → enemies use standard intent sequences
  - `tensionMeter 30–70` → enemies may accelerate intent (skip setup phase, go straight to Phase 3)
  - `tensionMeter > 70` → enemies switch to aggressive intents; Vampire skips probe → executes immediately

**Invariants:**
```ts
expect(tensionMeter).toBeGreaterThanOrEqual(0)
expect(tensionMeter).toBeLessThanOrEqual(100)
```

**Property tests:**
```ts
// high tension always leads to at least one intent escalation
forAll(seeds, s => highTensionLeadsToEscalation(simulate(s)))

// tension never causes an impossible state transition
forAll(seeds, s => assertValidGameState(simulateWithTension(s)))

// tension is deterministic — same seed = same tension curve
forAll(seeds, s => {
  return JSON.stringify(tensionCurve(simulate(s))) ===
         JSON.stringify(tensionCurve(simulate(s)))
})
```

**Mechanic → CombatState transition map (decided 2026-05-15):**
Each mechanic drives the CombatStateMachine forward. Unified semantic vocabulary — cards, statuses, and the state machine share one pressure model:

| Mechanic | CombatState transition |
|----------|----------------------|
| bleed applied | `Stable → Pressured` |
| stun applied | `Pressured → Controlled` |
| vulnerable applied | `Controlled → Exposed` |
| execute / kill | `Exposed → Collapsing` |

This means every card's Axes map directly to state machine pressure. Property test: `forAll(seeds, s => combatEventuallyReaches("Collapsing"))`.

**Testing value:** new class of global-state invariants; tension curve is a mutation target; ties hero conflict (Preserver stabilises → lowers tension, Catalyst prolongs → raises tension) to measurable system behaviour.

#### Battlefield Condition (decided 2026-05-15)
One active global modifier per combat. Adds cross-system interactions without adding content.

**"Broken Order"** — turn order reshuffled each round (seeded, so deterministic):
- Testing value: order-of-operations bugs; resolution pipeline stress test; "same seed = same shuffle" invariant
  - **Scope constraint:** `BattlefieldCondition` modifies ONLY pipeline step 2 (turn order). No other pipeline step. This gives predictability, test isolation, and no hidden side effects from conditions.
  - One condition only for v1 — room to expand but not required

#### Status effects

| Effect | Rule | Testing value |
|--------|------|---------------|
| **bleed** | Takes N damage per turn; stacks; cannot go below 0 | property test: bleed damage never negative; mutation: off-by-one in tick |
| **stun** | Skips exactly one turn | boundary: exactly 1 skip, not 0, not 2 |
| **defend** | Absorbs damage before HP; expires next turn | invariant: defend never increases incoming damage |
| **vulnerable** | Takes 50% more damage | interaction: vulnerable × bleed × stun combinatorial |

#### Position system
- Front / back row per side
  - Melee cards cannot reach back row if front is alive
  - Stunned entity cannot move between rows
  - **Target validation occurs at pipeline step 3 (start-of-turn), BEFORE intent execution at step 5.** This closes edge cases: Chaos Bolt with back-row-only targets; Necromancer raise into invalid position; Broken Order shuffle into unreachable target.
  - Generates combinatorial cases: position × skill type × target × stun state

#### Death's Door mechanic
```
HP reaches 0 → status: death_door (not dead)
Next hit     → dead
Heal         → back to alive (HP = 1)
```
State machine: `alive → death_door → dead` / `death_door → alive`
Invalid: `dead → alive`, `dead → death_door`
This is the richest state for property-based and boundary testing.

**Death's Door immunity invariant (decided 2026-05-15):**
```ts
// Death's Door cannot be removed by status effects — only damage or heal can transition it
expect(deathDoorCannotBeRemovedByStatusEffect).toBe(true)
// e.g. stun must NOT clear death_door; bleed ticks must NOT bypass the transition order
```
Without this: stun clears Death's Door (state corruption), bleed bypasses death_door → dead transition.

#### Run structure
4 rooms: `combat → elite → treasure → boss`
Seeded RNG — same seed = same room order, same enemy, same loot = deterministic tests.

#### What is NOT in scope
No map generation, no inventory (treasure room = HP restoration roll; `duplicateLootRoll` fault tests this roll), no talent trees, no crafting, no multiplayer, no graphics/canvas, no animations beyond CSS. Complexity from interactions, not content volume.

### Testing techniques showcased

| Technique | Concrete scenario | Invariant class |
|-----------|-----------------|-----------------|
| **State machine** | `alive → death_door → dead`; `game: exploring → in_combat → game_over`; invalid transitions caught by `assertValidGameState()` | temporal transitions |
| **Property-based (fast-check)** | Any random combat sequence → valid state; bleed damage never negative; stun skips exactly 1 turn; deck size conserved | numeric invariants |
| **Boundary** | Hero at exactly 0 HP (Death's Door trigger); bleed at stack 0 → no damage; Chaos Bolt with only back-row targets alive | boundary invariants |
| **Combinatorial** | `vulnerable` × `stun` × `bleed` stacked on same entity; position × skill type × target | interaction explosion |
| **Randomness / determinism** | Same seed → identical RNG stream; Chaos Bolt hits same target; different seeds diverge at first RNG call | determinism invariants |
| **Save / load** | Serialise full game state mid-combat; deserialise and continue; assert state identity | identity invariants |
| **Mutation testing** | Stryker on bleed tick formula; off-by-one in stack math must be caught by property invariants | numeric invariants |
| **Metamorphic** | Doubling bleed duration never reduces total damage; enemy order shuffled with fixed seed → total rewards invariant | relational invariants |
| **Fault injection** | `bleedOffByOne: true` → property test catches it; fast-check shrinks to minimal sequence; seed reproduces it | numeric + temporal |
| **MCP exploration → seeded replay** | Playwright MCP opens `debugger.html`; agent navigates timeline, finds a suspicious game state (e.g. hero survives at 0 HP with stun + bleed stacked); seed is already in telemetry JSON; replay reproduces the exact sequence byte-perfect; property test is written against that seed | discovery + determinism |

### Positioning (refined)
**Not** "roguelike game" — **"deterministic adversarial simulation framework with explicit interaction semantics"**

**Narrative framing:** *observability fiction* — the narrative explains diagnostics, romanticizes determinism, and turns replay/debugging into fiction. Not dark fantasy. Not roguelike lore. A genre that doesn't exist yet, and that's exactly why it works for an SDET project.

> The Archivist doesn't make the project feel like a game. It makes the testing infrastructure feel like a system with memory.

The strongest phrase in the project: **"Some runs should never exist."** — simultaneously lore, invariant theory, and property-based testing philosophy.

Interview line: *"I intentionally chose a roguelike combat engine because it creates far richer state transitions and non-deterministic behaviour than a standard CRUD API. The goal wasn't game development — it was to explore advanced testing strategies: deterministic seeded randomness, property-based testing, model/state-machine testing, replay-driven debugging, mutation testing, and invariant validation. The engine became a controlled environment for validating testing techniques that also apply to distributed systems, financial systems, and backend orchestration platforms."*

### Architecture — 5 layers (decided 2026-05-15)

```
engine/      — pure deterministic logic (no I/O, no RNG calls directly)
runtime/     — seed, RNG, executor; wires engine + randomness together
telemetry/   — replay log, event store; every action recorded as JSON
testing/     — fast-check, invariants, Stryker; reads from engine + telemetry
debugger/    — debugger.html; reads telemetry, visualises timeline
```

**Key architectural rule:** `engine/` has zero knowledge of `testing/` or `debugger/`. `debugger/` reads only from `telemetry/`. Loose coupling is the point.

**Rendering data flow (decided 2026-05-15) — this is the critical architectural decision:**
```
GAME RULES
    ↓
EVENTS          ← renderer reads events, never game state directly
    ↓
PRESENTATION    ← events translated to display structures (Intent, TimelineEvent)
    ↓
RENDERER        ← debugger.html, combat UI, CI screenshots
```
The renderer is `events.map(renderEvent)` — not `gameState → React components`. This makes the debugger replayable, testable, and deterministic. It's event sourcing + observability in one pattern.

### Priority — what to build (decided 2026-05-15)

**MUST HAVE** (makes the project strong):
- [ ] Seeded RNG — same seed = same dungeon = reproducible failing case
  - [ ] Replay system — every action logged as `{ seed, actions[] }`; `replayGame(log)` is byte-perfect
  - [ ] Fault injection toggles — `createGame({ faults: { bleedOffByOne, ignoreStun, duplicateLootRoll } })`; tests find the bug, fast-check shrinks it, seed makes it reproducible
  - [ ] Impossible State Detector — `assertValidGameState(state)` called after every action in tests
  - [ ] Invariant-based tests — no `expect(hp).toBe(17)`; only `hp >= 0`, `deadHeroCannotAct`, `deckSizeConserved`
  - [ ] fast-check property tests (= the "chaos monkey") — generates thousands of action sequences, shrinks failing case automatically
  - [ ] `debugger.html` — separate page, reads `replay.json`, shows timeline + HP bars + events + seed; Playwright-tested

**MUST HAVE** (added 2026-05-15):
- [ ] **Bug cemetery** (`BUGS.md`) — every bug actually found: seed, root cause, how it was found (invariant / property test / fault toggle), fix. Cheap to write and devastating in an interview: it shows testing ROI as it happened.
  - [ ] **Invariant Registry System** — one registry of invariants; fast-check, the boss, the runtime and the debugger all read the same source of truth:
    ```ts
    interface Invariant {
      id: string
      appliesAt: PipelineStep   // 1–9
      check(state: GameState): boolean
      severity: "hard" | "soft" // hard = throw; soft = warn + log
    }
    const InvariantRegistry: Invariant[] = [] // populated by each engine module
    ```
    `assertValidGameState()` iterates the registry. The boss CorruptionEvent is checked against the same one. The replay debugger highlights violations by `appliesAt`. Interview line: *"One invariant definition catches bugs in the engine, the boss, and the debugger simultaneously."*

    **EventSpec upgrade — event-level invariants (decided 2026-05-15):**
    Each event carries its own preconditions + postconditions. Replay debugger, fast-check, mutation tests, and the visualizer all work from one model:
    ```ts
    interface EventSpec {
      event: string             // e.g. "ApplyBleed"
      stage: PipelineStep       // e.g. "postDamage" (step 7)
      preconditions: string[]   // e.g. ["targetAlive"]
      postconditions: string[]  // e.g. ["bleed <= 10"]
    }
    ```
    `InvariantRegistry` entries reference `EventSpec` definitions — the registry becomes the single model for correctness across all consumers.
  - [ ] **Combat Execution Pipeline formalized** — the 9-step turn contract lives in `engine/resolution.ts`; each step is its own function; every test knows which step does what.

**NICE TO HAVE** (if time allows):
- [ ] Mutation testing (Stryker) + "survived mutant → added invariant → killed" PR narrative
  - [ ] Fault injection: expand to more scenarios
  - [ ] Shrinking visualizer — on a failing test, print `Original: 82 actions → Shrunk: 3 actions` plus the minimal sequence; fast-check already does the work, it only needs formatting
  - [ ] State coverage heatmap — which state machine transitions are covered (`✔ alive→death_door`, `✘ dead→alive`); a CI artefact or a README section
  - [ ] Monte-Carlo simulation mode — `npm run simulate --runs 100000` → win rate per class, average combat length, the deadliest enemy; cheap: run many seeds and collect the statistics
  - [ ] Metamorphic testing — relations between inputs and outputs instead of absolute values: "doubling bleed duration should never reduce total damage"; "enemy order shuffled but seed fixed → total rewards invariant"; a rare technique, and interviewers remember it
  - [ ] RNG inspector in telemetry — log every RNG call into the replay: `{ call: "crit_roll", value: 0.92, turn: 4 }`; same seed → identical RNG stream
  - [ ] diff view in debugger.html — when stepping between turns, show what changed: `- hp: 6 / + hp: 4 / + bleed: 2`
  - [ ] Failure artifacts — on a failing test, auto-save into `/artifacts`: `replay.json` + `state-before.json` + `state-after.json` + `rng-stream.json`

**SKIP for v1:**
- Differential testing (two engine implementations) — 2x maintenance, 10% extra signal
  - "AI chaos monkey" as separate module — fast-check already is the chaos monkey
  - Chaos mode (corrupt save / duplicate event) — fault injection already covers the concept
  - Testing dashboard HTML page — a README section with the stats gives 80% of the effect
  - Complex debugger UX (animations, sounds, polished game feel)
  - Testing notebook / research docs — write after implementation

### Fault injection design
Controlled scenarios only — not random runtime corruption:
```ts
engine = createGame({
  seed: 42,
  faults: {
    bleedOffByOne: true,      // bleed ticks for (stacks - 1) instead of stacks
    ignoreStun: false,        // stunned enemies act anyway
    duplicateLootRoll: true   // loot table rolled twice, second overwrites first
  }
})
```
Tests: find the bug → fast-check minimises failing sequence → seed makes it reproducible → story: "mutation survived → added property invariant → now caught."

### System failure story pack

Design-time failures discovered during spec iteration. Each entry: assumption → counter-case → fix → invariant added. Runtime failures will be added to `BUGS.md` as implementation proceeds.

---

#### F-01 — The pipeline conflation

**When:** spec iteration 1  
**Symptom:** step numbering contradicted itself

**Initial design:** one unified pipeline — turn structure and per-action resolution in a single 12-step sequence.

**Problem:** Vampire lifesteal had two conflicting step assignments:
- "fires after defend reduction" → step 5 in action sequence
  - "fires at end of turn" → step 8 in turn structure

Both were correct descriptions of different things. The pipeline said they were the same step.

**Root cause:** turn structure and per-action resolution were modelled as one sequence. A "step" simultaneously meant "when in the turn" and "when in action resolution" — two different scopes sharing one name.

**Fix:** split into two pipelines with explicit call hierarchy:
- **Turn Pipeline** (9 steps) — turn structure only: when passives check, when player acts, when enemies act, when statuses tick
  - **Action Resolution Pipeline** (5 steps) — per-action semantics: state transitions → status application → positional effects → damage calculation → post-effects

Turn Pipeline steps 4 and 5 call Action Resolution Pipeline per action.

**Invariant added:**
```ts
// every rule references exactly one pipeline — never both
assertNoAmbiguousPipelineAssignment(InvariantRegistry)
```

**Interview line:** *"I had one 12-step pipeline. Vampire lifesteal was simultaneously step 5 and step 8. The fix wasn't to move it — it was to realise I had two separate concerns modelled as one."*

---

#### F-02 — The false heal invariant

**When:** writing invariants for Paladin cross-hero interactions  
**Symptom:** `assertHealIsAlwaysBeneficial()` failed

**Initial assumption:** healing always improves the target. Written as:
```ts
expect(stateAfterHeal.targetHP).toBeGreaterThan(stateBeforeHeal.targetHP)
```

**Counter-case:** Paladin casts Stubborn Recovery on Berserker at 45% HP while werewolf form is active.

Sequence:
1. HP rises from 45% to 65%
   2. HP threshold re-evaluated at Turn Pipeline step 3 (start-of-turn passive check)
   3. HP > 50% → automatic reversion to human form
   4. Berserker passive deactivated — damage bonus lost
   5. Berserker is objectively weaker than before the heal

The invariant failed. The system was correct. The test was wrong.

**Fix:** split the universal assertion into two targeted invariants:
```ts
// HP always increases on heal (up to ceiling) — universally true
expect(hpAfterHeal).toBeGreaterThanOrEqual(hpBeforeHeal)
expect(hpAfterHeal).toBeLessThanOrEqual(maxHp)

// combat effectiveness after heal — intentionally NOT asserted universally
// see BUGS.md: design-time discovery, intentional exception, hero conflict triangle
```

**BUGS.md entry:** `assertHealIsAlwaysBeneficial()` — failed on Berserker × Paladin interaction at HP boundary. Root cause: conflated "HP increases" with "entity improves in combat." Closed as intentional. Documented in hero conflict triangle.

**Interview line:** *"The system behaved correctly. My invariant was wrong. That's a different kind of bug — and harder to catch."*

---

#### F-03 — The stun timing ambiguity

**When:** specifying Berserker transformation rules  
**Symptom:** "stun = skip your turn" was underspecified

**Initial definition:** stun → entity skips its turn. Intuitive reading: if stunned, nothing happens to or from this entity until stun clears.

**Counter-case:** Berserker is stunned. Bleed tick (step 7) fires and drops HP to 44% during the same turn. Transformation threshold is met.

**Conflicting answers from the initial spec:**
- "Stunned = turn skipped" → transformation blocked (entity is frozen)
  - "Transformation is automatic, not a chosen action" → transformation fires regardless

Both were defensible. The spec did not decide between them.

**Root cause:** "skip your turn" was never formally decomposed. It conflated:
- blocking action execution: Turn Pipeline steps 4 and 5 (player and enemy actions)
  - blocking passive checks: Turn Pipeline step 3 (start-of-turn automatic transitions)

These are not the same thing.

**Fix:** `canAct` is now a formally scoped flag:
```ts
// stun sets canAct = false
// canAct gates steps 4 and 5 ONLY
// step 3 (passive checks: werewolf threshold, charge accumulation) is never gated by canAct
```

Stunned Berserker transforms automatically if threshold is met. Stun blocks chosen actions, not automatic state transitions.

**Invariants added:**
```ts
forAll(seeds, s => stunNeverBlocksPassiveChecks(simulate(s)))

// berserker at HP threshold transforms even while stunned
forAll(seeds, s =>
  berserkerAtHpThreshold(simulate(s)) && simulate(s).berserkerIsStunned
    ? simulate(s).berserkerInWerewolfForm
    : true
)
```

**Interview line:** *"'Stun = skip your turn' was intuitive and wrong. I had to define what 'turn' means before I could say what 'skip' means."*

---

### Invariants (not expected values)
```ts
// Never:
expect(hp).toBe(17)

// Always:
expect(hp).toBeGreaterThanOrEqual(0)
expect(deadHeroCannotAct).toBe(true)
expect(totalCards).toBe(initialDeckSize)          // deck size conserved
expect(noDuplicateEntities).toBe(true)
expect(stunSkipsExactlyOneTurn).toBe(true)
expect(defendNeverIncreasesIncomingDamage).toBe(true)
expect(bleedDamageCannotHeal).toBe(true)
```

#### Invariant categories — three-way classification

Binary valid/invalid misses a real class of system behaviour. Three categories:

| Category | Definition | Detection | System response |
|----------|-----------|-----------|----------------|
| **Invalid** | Structurally broken — violates a hard rule | `assertValidGameState()` throws (severity: `"hard"`) | TIMELINE CORRUPTED; seed auto-archived |
| **Valid** | Correct state, expected transitions | — | — |
| **Emergent-valid (unstable)** | Correct by all rules, but exhibits oscillation or approaching terminal instability | Stability invariants (severity: `"soft"`) | `TimelineState = "unstable"` logged; stability score reduced |

Maps to `InvariantRegistry` severity levels:
```ts
const InvariantRegistry: Invariant[] = [
  { id: "dead-cannot-act",     severity: "hard", check: deadEntityCannotAct },
  { id: "hp-ceiling",          severity: "hard", check: hpNeverExceedsMax },
  { id: "bleed-cap",           severity: "hard", check: bleedStacksNeverExceed10 },
  // stability class — soft: log + warn, don't throw
  { id: "combat-terminates",   severity: "soft", check: s => turnCount(s) <= 50 },
  { id: "no-state-regression", severity: "soft", check: combatStateNeverRegressesFromExposed },
]
```

**Stability invariants** (the emergent-valid class):
```ts
// combat must terminate — catches livelock bugs
forAll(seeds, s => turnCount(simulate(s)) <= 50)

// CombatState does not regress — once Exposed, never returns to Stable
forAll(seeds, s => {
  const states = combatStates(simulate(s))
  const i = states.indexOf('Exposed')
  return i === -1 || states.slice(i).every(st => st !== 'Stable')
})

// tension meter converges — no perpetual oscillation
forAll(seeds, s => tensionCurveConverges(simulate(s)))
```

`TimelineState = "unstable"` is a soft warning, not a crash. These seeds appear in CI footer as `"Residual instability detected."` and in replay metadata as `"stability": 0.72`. The Archivist archives them alongside corrupted timelines — the stability score reflects how many of them appeared.

#### Implementation constraints (v1 bounds)

Not approximations — actual system limits that property tests treat as invariants:

| Constraint | Limit | Enforced by |
|-----------|-------|-------------|
| Entities on field | max 6 | field capacity rule + Necromancer raise cap; `assertFieldCount(state) <= 6` |
| Turns per combat | max 50 | stability invariant: `turnCount(simulate(s)) <= 50` |
| RNG calls per tick | bounded: 1 shuffle + 1 per Chaos Bolt + 1 for loot | executor calls RNG in fixed positions only — no hidden unbounded calls |
| fast-check runs | 1 000 default / 10 000 for mutation suite | tuned to CI time budget |
| Replay JSON | ~50 KB per run | 50 turns × ~5 events × avg payload; no compression needed |

Consequences:
- Field cap (6) means Necromancer can raise at most once on a full field — one of the constraints that makes raise logic deterministically testable
  - Turn cap (50) means property tests catch livelock bugs without running forever
  - Bounded RNG calls mean the RNG inspector can enumerate every call without unbounded log growth

### Replay system design
```json
{
  "seed": 1337,
  "actions": [
    {
      "type": "play_card",
      "card": "Strike",
      "target": 0,
      "turn": 1,
      "turnPipelineStep": 4,
      "actionResolutionStep": "damage_calculation",
      "tensionMeter": 42,
      "preStateHash": "a3f9c1",
      "postStateHash": "b7d2e4"
    },
    {
      "type": "end_turn",
      "turn": 1,
      "turnPipelineStep": 9,
      "actionResolutionStep": "state_transitions",
      "tensionMeter": 44,
      "preStateHash": "b7d2e4",
      "postStateHash": "c1a8f2"
    }
  ]
}
```
**Field naming:** `turnPipelineStep` = Turn Pipeline step (1–9). `actionResolutionStep` = Action Resolution Pipeline step name (`state_transitions` / `status_application` / `positional_effects` / `damage_calculation` / `post_effects`). `tensionMeter` recorded per-event — required for byte-perfect replay because tension affects enemy intent selection.

`preStateHash` + `postStateHash` per event enables: replay diff debugging, per-event invariant verification, mutation isolation (which event caused divergence). `replayGame(log)` reproduces combat byte-perfect. Failed property test → auto-saves `failing-seed-XXXX.json` as CI artifact.

### debugger.html — scope (decided 2026-05-15, updated 2026-05-15)
**Separate page** (not embedded in game UI) — lives in `debugger/` layer, reads from `telemetry/`. This is a QA tool, not a game feature.

**Frame: forensic analysis tool, not a game replay viewer.** The debugger looks like an investigation interface — it analyses an archived timeline for corruption. This ties directly to the Archivist persona without adding any code.

**URL routing:** `/replay/882911` opens that seed directly — shareable link to any failing case.

**UI vocabulary (UI layer only — NOT in code, variable names, or test IDs):**
| Code/technical | UI display text |
|---------------|----------------|
| Turn N | Timeline Segment N |
| Replay loaded | Archived timeline restored |
| Seed: 882911 | Timeline ID: 882911 |
| HP / health | Integrity |
| Invariant violation | Corruption event detected |
| No violations found | Containment successful |
| Stability score | Timeline Stability: 98.2% |

Includes:
- Timeline segments panel (left) — was "turn timeline"
  - Integrity bars — hero + enemies (current segment)
  - Cards played + target
  - Status effect stacks
  - Timeline ID + current RNG value
  - Buttons: prev segment / next segment / jump to segment N
  - **"Copy timeline URL"** button — copies `/replay/<seed>` to clipboard; one line of JS, production-quality vibe
  - Export archived timeline (JSON)
  - Diff view between segments: `- hp: 6 / + hp: 4 / + bleed: 2`
  - Header: `Timeline Stability: N%` — computed from invariant pass rate across all segments

Excludes: animations, illustration art, PWA, mobile, any game-feel polish beyond sound.

**Loading phrases** — shown while debugger initialises or scans timelines:
```
"Not every timeline is valid."
"The dead should not act."
"Invariants preserve reality."
"Some seeds should never be opened."
"The Archivist remembers."
"A fragile victory."
"The cycle repeats."
"Iteration 44112 terminated."
"Persistence outlives failure."
```

**Tested with Playwright** — "I test the test debugger with Playwright" is the interview line.

### game/index.html — playable UI scope (decided 2026-05-15)
Turn-based combat UI. You choose cards, the engine runs, telemetry records, UI re-renders. **No game logic in the UI** — `game.ts` sends actions to `runtime/executor`, reads `telemetry/` for state display.

**Core loop:**
```
Player clicks card → game.ts dispatches action → executor runs Turn Pipeline
→ telemetry records events → game.ts reads new telemetry → re-renders
```

**Seed input at top** — set any seed to reproduce a failing scenario from BUGS.md interactively. This is the key portfolio value: "I can reproduce any failing seed by hand."

**Includes (MUST HAVE):**
- Hero panel (left): HP bar, status chips (statusRenderPriority order), hand of 3 cards
  - Enemy panel (right): HP bar, status chips, **intent display** (`⚔ 8` / `🛡 defend` / `💀 raise`)
  - Card hand: 3 cards per turn; click to select, click enemy to target, card plays
  - End Turn button
  - Combat log (right panel): last 5 events, fadeIn animation
  - Seed display + seed input field (top bar)
  - Death's Door visual: HP = 0 → screen tint red + entity pulses
  - "TIMELINE CORRUPTED" overlay when `assertValidGameState()` throws

**Excludes:**
- Animations beyond CSS transitions and fadeIn
  - Particles, card draw animation
  - Victory/defeat screen beyond simple text overlay
  - Multiple rooms in one session (fight one encounter, then it's over)
  - Any game logic — UI is a pure consumer of telemetry events

**Tested with Playwright** (`tests/ui/game.test.ts`):
- Can play a card
  - Can end turn
  - Enemy intent updates after player acts
  - Death's Door tint appears at 0 HP
  - TIMELINE CORRUPTED overlay appears when invariant fires
  - Seed input changes the combat (different seed = different enemy)

**Portfolio value:**
`game/` and `debugger/` are two independent Playwright-tested consumers of the same engine. Interview line: *"The game UI and the forensic debugger both read from the same telemetry layer. I Playwright-test both. They can't diverge from the engine because neither one imports it directly."*

### Mobile — decision (2026-05-15)
**Skip entirely.** For backend QA / SDET narrative, mobile is noise. Time better spent on replay tooling, fuzzing, observability, and deterministic infra. Mobile only makes sense if the career target is mobile QA or frontend — it isn't.

### Repo structure (decided 2026-05-15)

```
roguelike-engine/
├── src/
│   ├── engine/                    # pure logic — no I/O, no RNG
│   │   ├── types.ts               # GameState, Entity, Card, Status interfaces
│   │   ├── game.ts                # createGame(config), GameConfig
│   │   ├── combat.ts              # CombatStateMachine
│   │   ├── resolution.ts          # 5-step resolution pipeline
│   │   ├── tension.ts             # TensionMeter 0-100
│   │   ├── invariants.ts          # assertValidGameState(); InvariantRegistry
│   │   ├── entities/
│   │   │   ├── hero.ts            # Hero base + Knight, Paladin, Berserker
│   │   │   └── enemy.ts           # Enemy base + Goblin, Vampire, Necromancer
│   │   ├── statuses/
│   │   │   ├── index.ts           # Status interface (hook collection)
│   │   │   ├── bleed.ts
│   │   │   ├── stun.ts
│   │   │   ├── defend.ts
│   │   │   └── vulnerable.ts
│   │   ├── cards/
│   │   │   ├── index.ts           # Card interface + Axis types
│   │   │   ├── knight.ts
│   │   │   ├── paladin.ts
│   │   │   └── berserker.ts
│   │   └── boss/
│   │       ├── archivist.ts       # Boss + CorruptionEvent interface
│   │       └── rule-mutation-engine.ts
│   ├── runtime/                   # wires engine + randomness
│   │   ├── rng.ts                 # seeded RNG (mulberry32); all RNG calls here
│   │   ├── executor.ts            # runs engine steps, calls RNG + recorder
│   │   └── faults.ts              # FaultConfig + injection hooks
│   └── telemetry/                 # every action recorded as JSON
│       ├── types.ts               # ReplayEvent, ReplayLog
│       ├── recorder.ts            # records events during run
│       ├── replayer.ts            # replayGame(log) — byte-perfect
│       ├── hasher.ts              # hashState() → pre/postStateHash
│       └── artifacts.ts           # saves failing seeds to /artifacts/
├── game/                          # playable UI — reads telemetry; sends actions to runtime
│   ├── index.html
│   ├── game.ts                    # compiled to game.js; no direct engine imports
│   └── styles.css                 # shares tokens with debugger/styles.css
├── debugger/                      # QA tool — reads telemetry only
│   ├── index.html
│   ├── debugger.ts
│   └── styles.css
├── tests/
│   ├── unit/                      # fast, no fast-check
│   │   ├── engine/
│   │   │   ├── combat.test.ts
│   │   │   ├── resolution.test.ts
│   │   │   ├── statuses.test.ts
│   │   │   └── tension.test.ts
│   │   └── runtime/
│   │       └── rng.test.ts
│   ├── property/                  # fast-check
│   │   ├── invariants.test.ts
│   │   ├── dramaturgy.test.ts
│   │   ├── metamorphic.test.ts
│   │   └── boss.test.ts
│   ├── replay/
│   │   └── replay.test.ts
│   ├── fault/
│   │   └── fault-injection.test.ts
│   └── ui/                        # Playwright — tests both game UI and debugger
│       ├── game.test.ts
│       └── debugger.test.ts
├── scripts/
│   └── simulate.ts                # npm run simulate — Monte-Carlo mode
├── artifacts/                     # failing seeds (gitignored except .gitkeep)
│   └── .gitkeep
├── .github/workflows/ci.yml
├── BUGS.md
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── playwright.config.ts
└── stryker.config.json
```

**package.json scripts:**
```json
{
  "typecheck":     "tsc --noEmit",
  "test":          "vitest run",
  "test:unit":     "vitest run tests/unit",
  "test:property": "vitest run tests/property",
  "test:replay":   "vitest run tests/replay",
  "test:fault":    "vitest run tests/fault",
  "test:ui":       "playwright test tests/ui",
  "test:mutation": "stryker run",
  "simulate":      "tsx scripts/simulate.ts"
}
```

**Layer coupling rules:**
- `engine/` has zero imports from `testing/`, `runtime/`, `debugger/`, or `game/`
  - `debugger/` reads only from `telemetry/` — never imports `engine/` directly
  - `game/` reads from `telemetry/` and sends actions to `runtime/` — never imports `engine/` directly
  - `runtime/` is the only caller of RNG; `engine/` receives values as arguments
  - `game/` and `debugger/` are independent consumers of the same telemetry — they share `tokens.ts` and presentation types, nothing else

### Stack
- TypeScript (strict), Vitest, fast-check, Stryker (mutation)
  - Separate GitHub repo — not merged into clinic-booking-api-tests
  - BDD/Cucumber optional layer on top (natural language combat scenarios)

### Visual style — Slay the Spire dark with colour accents
Pure HTML + CSS, no canvas, no framework. Card art will be real images (AI-generated or curated free assets — decided during implementation). Game logic is separate from rendering — tests cover logic only; Playwright covers UI layer.

**Rule:** every visual feature must help debugging OR observability OR show deterministic behaviour. Anything purely decorative = skip.

**Colour system — card type = card colour:**

| Type | Background | Glow | Symbol |
|------|-----------|------|--------|
| Attack | `#3d0000` dark red | `rgba(220,50,50,0.4)` | ⚔️ |
| Skill | `#001a3d` dark blue | `rgba(50,100,220,0.4)` | 🛡️ |
| Power | `#1a003d` dark purple | `rgba(120,50,220,0.4)` | ⚡ |
| Curse | `#1a1a1a` near black | none | 💀 |

**CSS techniques:** `box-shadow` for glow; `linear-gradient` for card face; gold `border` (`#c9a84c`); `transform: translateY(-8px) scale(1.03)` on hover; Google Font **Cinzel** for gothic typography.

**Card art:** real image per card (AI-generated or free dark fantasy assets) as `background-image` in card body. Unicode symbols remain for status chips and intent icons.

**Global palette:** `bg: #0d0d1a`, text: `#f0e6d3`, accent gold: `#c9a84c`, HP red: `#c0392b`, energy amber: `#e67e22`.

**Design tokens — exported as a single source (decided 2026-05-15):**
All colours, shadows, and radii as one exported constant — game UI, debugger, CI screenshots, and corruption screens all import from here:
```ts
export const tokens = {
  colors: {
    bg:          "#0d0d1a",
    panel:       "#17172a",
    text:        "#f0e6d3",
    gold:        "#c9a84c",
    bone:        "#cfcfcf",
    hp:          "#b83a3a",
    defend:      "#5c8df6",
    bleed:       "#7a1f1f",
    vulnerable:  "#8f5be8",
    corruption:  "#7b1010",
  }
}
```
Corruption screen uses `tokens.colors.corruption`. Debugger uses `tokens.colors.panel`. Visual consistency = visual invariant.

**Status rendering priority (decided 2026-05-15):**
Status chips render in this fixed order — ensures Death's Door is always visible; stun overrides bleed visually:
```ts
const statusRenderPriority = [
  "death_door",   // must always be visible; full-overlay trigger
  "stun",         // player loses action — critical info
  "bleed",        // ongoing damage
  "vulnerable",   // incoming amplifier
  "defend",       // temporary; fades next turn
]
```
This is a visual invariant: order never changes based on stacks or duration. Testable via Playwright snapshot test.

**Card layout rule (decided 2026-05-15):**
Every card renders in the same 3-zone structure — no exceptions:
```
┌─────────────────────┐
│ TITLE               │  ← name
│ [Axis] [Axis]       │  ← axis tags
├─────────────────────┤
│                     │
│  Main effect text   │  ← rulesText[]
│                     │
├─────────────────────┤
│ "Narrative flavour" │  ← optional; in italics
└─────────────────────┘
```
Consistent structure → snapshot testing catches regressions; debugger and combat UI share the same card component.

**Visual features — core stack (decided 2026-05-15):**

- **Animated combat log** — `⚔ Knight hits Goblin for 6 / 🩸 Goblin suffers bleed (2) / 💀 Goblin enters Death's Door`; CSS `animation: fadeIn 0.2s ease`; newest event glows; old entries fade. Cheap, makes replay feel alive.
  - **Death's Door visual** — when hero HP = 0: screen tint red + portrait pulse (`@keyframes pulse`). Signature mechanic, ~10 lines CSS. Memorable in README GIF.
  - **"Invariant violation" screen** — when `assertValidGameState()` catches impossible state: full-screen overlay styled as a crash report: `INVARIANT VIOLATION / dead entity acted / Seed: 882911 / Turn: 17`. One screenshot sells the entire testing narrative.
  - **Status effect chips** — `🩸 Bleed 3 / 🛡 Defend 5 / ⚡ Vulnerable` with glow; inline in combat view and debugger.
  - **Enemy intent display** — enemy shows next action before it happens: `⚔ 8` / `🛡 defend`; ties to "telegraphed intents" in engine scope; helps both game UI and replay debugging.

**debugger.html visual upgrades:**
- **Replay scrubber** — drag timeline `|----●---------|  Turn 12 / 28`; upgrade from prev/next buttons; looks like a professional debugging tool immediately.

**Skip:**
- Floating damage numbers — adds JS animation scope without QA narrative benefit
  - CSS particles — complexity without signal
  - Mutation kill animation — can't demo without Stryker running live
  - Auto-play simulation in UI — already covered by `npm run simulate` CLI

---

---
