# Architecture Decisions

Interesting choices made during implementation — what was built, why, and what was rejected.

---

## ENGINE

### D-01 — Two pipelines instead of one

**Problem:** A single 12-step pipeline could not describe the order of operations unambiguously. Vampire lifesteal was simultaneously "step 5 of the action sequence" and "step 8 of the turn structure" — two correct descriptions of one event, about different things.

**Decision:** An explicit split into two pipelines with a call hierarchy:
- **Turn Pipeline (9 steps)** — the structure of one full turn (when passives fire, when the player acts, when enemies act, when statuses tick)
- **Action Resolution Pipeline (5 steps)** — the semantics of one action (state transitions → status application → positional effects → damage calculation → post-effects)

Turn Pipeline steps 4 and 5 invoke the Action Resolution Pipeline for each individual action.

**Why it matters:** Every rule now belongs to exactly one pipeline and one step. There is no "step N" without naming which pipeline. The invariant registry can point at a specific step.

---

### D-02 — Statuses as hooks, not as hardcoded combinations

**Problem:** The naive approach: `if (hasBleed && hasVulnerable) { damage *= 1.3 }`. Four statuses give 16 combinations, six give 64. Tests cannot cover them all, and every new status breaks the existing combos.

**Decision:** Each status is a collection of hooks on shared event points:
```ts
Bleed      = { onTurnStart: (e) => e.hp -= stacks }
Vulnerable = { incomingDamage: (v) => v * 1.5 }
Stun       = { canAct: () => false }
Defend     = { incomingDamage: (v) => Math.max(0, v - stacks) }
```
Combinations arise automatically through the shared hook points.

**Why it matters:** Adding a status means zero changes to existing tests. `applyEvent()` is the single mutation target for the whole modifier system. It opens the way to property-based tests without O(n²) scenarios.

---

### D-03 — Handler injection for unbuilt components

**Problem:** Berserker, Vampire and the RNG-dependent steps were not implemented, yet the pipeline steps that call them needed testing.

**Decision:** Optional handler interfaces (`TurnHandlers`, `ActionHandlers`). Every step that needs an unbuilt component takes an optional handler; with no handler passed, the step is a pass-through.

**Why it matters:** The pipeline structure can be tested before every component exists — 135+ tests ran without Blood Mage or Berserker. The pattern shows up in middleware, auth layers and request validation chains.

---

### D-04 — Contextual invariants, not global ones

**Problem:** It looks obvious that `hp = 0 → the entity must be dead`. It is not true.

**Decision:** `alive + hp=0` is a valid state BETWEEN applyDamage and step9 (Death Resolution), and invalid AFTER step9. The invariant is not true "always" — only at a specific point in the pipeline.

**InvariantRegistry** stores each invariant with `appliesAt: PipelineStep`.

**Why it matters:** Without that distinction runtime assertions fire falsely mid-pipeline. Contextual invariants are a rare concept but appear everywhere: payment processing (a partially applied transaction), distributed systems (eventual consistency windows).

---

### D-10 — Blood Mage: "already bleeding" is checked BEFORE bleed is applied

**Problem:** The card `Open the Wound` reads: "Apply 3 bleed. If target already bleeding → also apply vulnerable." The naive implementation applies bleed, checks for bleeding, then applies vulnerable — at which point the card always sees a bleeding target, because it just applied it, and always grants vulnerable.

**Decision:** `playOpenTheWound` records `targetWasBleeding` **before** calling `resolveAction` with bleed. Vulnerable is applied only if the target was bleeding before the card acted.

```ts
const targetWasBleeding = target ? hasStatus(target, 'bleed') : false
let s = resolveAction(state, { type: 'applyStatus', ..., status: { name: 'bleed', stacks: 3 } })
if (targetWasBleeding) { s = resolveAction(s, { ..., status: { name: 'vulnerable', stacks: 1 } }) }
```

**Why it matters:** One snapshot of state taken before the action is the pattern for any conditional trigger. Mutation testing target: swap the snapshot and the application, and the condition becomes permanently true.

---

### D-11 — Bloodrite: self-damage bypasses defend directly

**Problem:** Bloodrite deals 8 damage to the enemy and costs the hero 3 HP. Routing that cost through `resolveAction` lets defend absorb part of it, so the hero pays less than the ritual demands.

**Decision:** Damage to the enemy goes through `resolveAction`, where vulnerable works as expected. The self-damage is a direct HP mutation outside the pipeline:

```ts
const newHp = Math.max(0, s.hero.hp - 3)
// the death_door / dead state machine is applied by hand
```

**Why it matters:** Bloodrite is a ritual, not an attack, and a ritual price is not reduced by armour. The pattern appears wherever "cost" is semantically distinct from "damage": audit penalties, resource depletion, fee-as-side-effect.

---

## GAME UI

### D-05 — Cards auto-fire instead of a two-step click

**Problem:** Originally: click a card, the card highlights, and a second click on the enemy portrait is required. Players did not understand why nothing happened.

**Decision:** With only one enemy, cards with `target: 'enemy'` call `playCard()` on the first click. Two steps only make sense when there is a choice of target.

**Why it matters:** A UX rule: do not demand an action without a reason. With one target, choosing a target is a wasted step.

---

### D-06 — A global tooltip div instead of an in-card one

**Problem:** A tooltip inside `.hand-card` was clipped: the parent has `overflow: hidden` so the card art renders correctly.

**Decision:** One global `#cardTooltip` div with `position: fixed`, positioned from JS on mouseenter:
```js
const rect = el.getBoundingClientRect()
tip.style.left = (rect.left + rect.width/2 - 105) + 'px'
tip.style.top  = rect.top + 'px'
tip.style.transform = 'translateY(-100%)'
```

**Why it matters:** The classic pattern for tooltips in a card game UI. The card needs its `overflow: hidden` and cannot give it up; a global div lives outside any stacking context.

---

### D-08 — Two different Death's Door effects

**Problem:** A single red pulse for every entity carries no narrative. The hero dies in pain; the enemy is archived by the system.

**Decision:** Two separate visual states:
- **Hero Death's Door** — a red pulse (`pulse-red`), a red screen vignette, a "DEATH'S DOOR" badge. Pain, blood, the threat of death.
- **Enemy Death's Door** — a golden scan-line, desaturation, a gold glow. The Archivist begins digitising the entity before storing it.

**Why it matters:** Narrative consistency — every visual element reflects the Archivist's world. An enemy's death is archival, not death. It also makes the project recognisable in a screenshot.

---

### D-09 — Global tooltip div vs CSS :hover

**Problem:** `.hand-card` carries `overflow: hidden` so the card art renders correctly, which clipped a CSS tooltip placed inside the card.

**Decision:** One global `#cardTooltip` div with `position: fixed`, positioned via `getBoundingClientRect()`:
```js
const rect = el.getBoundingClientRect()
tip.style.left = (rect.left + rect.width/2 - 105) + 'px'
tip.style.top  = rect.top + 'px'
tip.style.transform = 'translateY(-100%)'
```

**Why it matters:** The classic pattern for tooltips over `overflow: hidden` containers. It appears in any card game UI, in data tables with fixed columns, in dropdown menus.

---

### D-07 — Overlay narrative vs external text on entity panels

**Problem:** The first version laid all information — name, HP, statuses, resources — over the portrait with `position: absolute`. Elegant in theory; on a 13" MacBook Air the text merged with the art and elements spilled past the portrait boundary.

**Decision:** Reverted to external text — a separate `.entity-info` block under the portrait. Less game-like, but readable and predictable.

**Why it matters:** Recorded as tech debt — the proper fix needs exact height budgeting for a given viewport. A 13" MacBook Air leaves ≈856px after browser chrome; the budget is portrait ≤ 200px + entity-info ≤ 80px + hand ≤ 180px + log ≤ 60px + topbar ≤ 48px = 568px, leaving ~290px for the battle area.

---

### D-12 — A hero selector in the top bar, mirroring the enemy selector

**Problem:** The hero was hardcoded in `makeGameState`, with no way to switch class without editing code.

**Decision:** A `HERO_DEFS` object holding each hero's configuration (name, portrait, hp, hand), a `forcedHero` variable and a `selectHero(key)` function, mirroring `selectEnemy`. `makeGameState` spreads `{ ...HERO_DEFS[forcedHero], maxHp: …, state: 'alive', … }`, and log messages use `gs.hero.name` instead of a hardcoded "Paladin".

**Why it matters:** Hero configuration lives in exactly one place. Adding the Berserker is one entry in an object. The symmetry between the hero and enemy selectors makes the interface predictable.

---

### D-13 — An enemy at death_door dies before its turn (no death rattle)

**Problem:** The enemy dropped to death_door (HP = 0) after the hero's turn. On End Turn it still executed its intent BEFORE dying, and could kill a hero who was also at Death's Door. It took an extra End Turn for the enemy to die.

**Decision:** Explicit death resolution for the enemy at the start of `endTurn()`, right after `deepClone`:
```js
if (gs.enemy.state === 'death_door') {
  gs.enemy.state = 'dead'
  checkWin(gs)
  if (gs.isOver) { render(); return }
}
```
An enemy at death_door dies BEFORE its intent executes — there is no death rattle.

**Why it matters:** A state machine race condition: `state !== 'dead'` and `state === 'death_door'` are different conditions and both read as "may act". What is needed is a single place that answers "is this enemy alive", not a scattering of `!== 'dead'` checks. The pattern appears in workflow engines and payment systems, where a "pending cancellation" entity must not be processed as active.

---

### D-14 — Berserker and Werewolf split into two separate heroes

**Problem:** One hero carried both rage scaling AND werewolf transformation — two incompatible archetypes in a single character, which confused both the narrative and the testing patterns.

**Decision:** Split into two independent heroes:
- **Berserker** (`berserker.ts`) — rage mode: HP ≤ 25% → ×1.5 damage for one turn, no transformation. Cards: Savage Lunge, Primal Fury, Primal Dodge.
- **Werewolf** (`werewolf.ts`) — transformation: HP ≤ 50% → wolf form for 3 turns, with passive scaling. Cards: 3 human (Lunar Strike, Pack Sense, Stalk) + 3 wolf (Rend, Rampage, Reality Crack).

**Why it matters:** Each hero now demonstrates one distinct testing pattern: the Berserker a binary threshold trigger, the Werewolf a nested state machine. Mixing both in one character blurred each of them.

---

### D-15 — Berserker rage: state is computed, not stored

**Problem:** The previous Berserker stored `werewolfTurnsLeft` as a state counter. For the new rage mode the choice was whether to store `rageActive: boolean` or compute it each time.

**Decision:** `isInRage(hero)` is computed purely from the HP ratio. No flag in state, nothing to synchronise, nothing that can drift out of sync:
```ts
export function isInRage(hero: Hero): boolean {
  return hero.state !== 'dead' && hero.hp <= Math.floor(hero.maxHp * 0.25)
}
```

`werewolfTurnsLeft` survives on the Werewolf, because a three-turn duration cannot be derived from the current state.

**Why it matters:** When state can be computed, do not store it — stored state is a chance to drift. The pattern is everywhere: `isAdmin` from roles, `isExpired` from a date, `isOverBudget` from a transaction total.

---

### D-16 — gs.enemy (singleton) → gs.enemies[] (array), a full migration

**Problem:** `gs.enemy` was a single object. A second enemy was impossible without rewriting all 47 call sites, and `card.effect(gs)` read `gs.enemy` directly instead of taking a target.

**Decision:**
- `gs.enemy` → `gs.enemies[]`; every function works by id: `dealDamage(gs, targetId, dmg)`
- `card.effect(gs)` → `card.effect(gs, targetId)` — the target is passed explicitly
- AoE cards (Rampage, Reality Crack) carry `target: 'aoe'` and iterate `gs.enemies`, ignoring targetId
- `tickStatuses(gs, 'enemy')` → `tickStatuses(gs, enemy.id)` — a real id instead of a sentinel string

**Why it matters:** 47 references to `gs.enemy` were implicit coupling — every function silently assumed a single enemy. In TypeScript a rename would have caught them all at once; in plain JS only at runtime. An explicit targetId makes the dependency visible.

---

### D-17 — The encounter comes from the seed; enemy selection buttons removed

**Problem:** Picking the enemy by hand put determinism in the player's control rather than the seed's. Two players on the same seed got different encounters, and the seed stopped being the single source of truth.

**Decision:** `pickEncounter(seed)` → `Object.keys(ENCOUNTER_DEFS)[seed % keys.length]`. The encounter is fully determined by the seed, the enemy buttons are gone, and the current encounter is shown in the top bar (`GOBLIN + NECROMANCER`).

**Why it matters:** The seed is reproducibility. If seed 42 always produces the same encounter, any failing run can be reproduced exactly — the property the replay system and property testing both rest on. Manual enemy selection broke it.

---

### D-18 — Replay: turn_end as a marker in the log, not internal events

**Problem:** The ReplayLog records every internal event (enemy_action, status_tick, transform), and the replayer cannot reproduce them directly — the executor exposes only `playCard()` and `endTurn()`. Something has to tell the replayer "endTurn was called here".

**Decision:** A `'turn_end'` event type. The executor records it at the end of every `endTurn()`, early returns on death included. The replayer iterates events: `play_card` → `playCard()`, `turn_end` → `endTurn()`. Everything else is a side effect that arises on its own and serves only hash verification.

**Why it matters:** An explicit marker instead of inference. The alternative has the replayer guessing turn boundaries from the event sequence; an explicit `turn_end` makes the log self-documenting.

---

### D-20 — Procedural sound through the Web Audio API, no files

**Problem:** Sound assets need storage, licences and HTTP requests. File-based audio gets in the way of offline use and fills the repository with binaries.

**Decision:** An `snd` module — an IIFE with a lazy AudioContext, 13 functions, plain Web Audio API. Every sound is generated from oscillators and gain nodes at runtime. No files, no assets.

The AudioContext is created on first use, to work around the browser restriction on autoplay without a user gesture. The first card click is the first sound.

**What is sounded, and how:**

| Event | Technique | Description |
|---|---|---|
| Card played | sine 600→300 Hz | A light whistle |
| Hit on an enemy | sawtooth 280→70 Hz | A metallic strike |
| Enemy death | sawtooth 220→28 Hz | A heavy falling tone |
| Hit on the hero | square 130→45 Hz | A blunt impact |
| Death's Door | sine 65→42 Hz | An ominous hum |
| Healing | sine C→E→G arpeggio | A rising triad |
| Bleed on an enemy | filtered noise, highpass 3.5kHz | A hiss |
| Stun on an enemy | sine 1500→180 Hz | A metallic ring |
| Werewolf transformation | sawtooth rumble + sine howl sweep | A growl and a howl |
| Berserker rage (≤25% HP) | sawtooth 80→45 Hz + crunch 400→150 Hz | A low roar and a crunch |
| End Turn | square 700→350 Hz | A click |
| Victory | triangle C-E-G-C arpeggio | A fanfare |
| Defeat | sine A-F-A descending | A descending A minor |

**Hooks:** `playCard()` → cardPlay; `dealDamage()` → strike/enemyDead; `executeEnemyIntent()` → heroHit/deathDoor/bleedSfx/stunSfx/rageSfx; `healHero()` → heal; `checkWin()` → victory/defeat; `endTurn()` → endTurnSfx; `checkBerserkerTransformGame()` → transform.

Berserker rage is detected as a threshold crossing: `prevHpPct > 0.25 && newHpPct <= 0.25`. It fires exactly once per battle, the first time HP drops below 25%.

**Why it matters:** Zero dependencies, zero files, full reproducibility. The pattern carries to any browser project that needs sound without assets.

---

### D-19 — Replay hash verification: a per-state hash, not a full state compare

**Problem:** Byte-perfect replay requires checking that the reproduced run matches the original. Comparing the full GameState by JSON equality is heavy and brittle against structural change.

**Decision:** A 6-character hex hash of `JSON.stringify({hero, enemies})` is written into every event as `preStateHash` and `postStateHash`. After each `playCard` / `endTurn` the replayer hashes the current state and compares it against the recorded `postStateHash`. A mismatch is the exact divergence point, with its turn and event type.

**Why it matters:** The hash is compact, deterministic, and pinpoints WHEN the runs diverged. A full JSON compare would require storing every intermediate state. The pattern mirrors event sourcing checkpointing and distributed state verification.

---

### D-20 — BDD on a rule engine with no UI: Cucumber as executable specification

**Problem:** With no UI and no API, how do you show the rules are readable and checkable in human language?

**Decision:** Cucumber with steps that call `createGame()` and `game.endTurn()` directly. The feature file is an executable specification of the engine's rules. Step definitions run in two modes: through the executor for full game flows, and against engine functions directly for HP-precise boundary scenarios.

**Why it matters:** BDD is a way to write down a business rule, not a UI testing tool. "Given the Guardian stuns the hero" is a domain rule specification. The same scenarios apply to a pricing engine, insurance rules or a loan approval workflow. It removes the false assumption that BDD means a browser.

---

### D-21 — window.loadJSON(): a testability hook for Playwright without refactoring

**Problem:** Playwright cannot drive the file dialog that loads replay.json into debugger.html, and `window.log = data; initDebugger()` does not work because `log` is a module-internal variable.

**Decision:** One method in debugger.html, there for the tests:
```js
window.loadJSON = function(data) { log = data; initDebugger() }
```
Playwright calls it through `page.evaluate`. The internal architecture is unchanged.

**Why it matters:** A testability hook is the minimal entry point for outside testing, not an architectural refactor. The pattern appears wherever there is no public API: legacy code, game engines, embedded systems.

---

## RUNTIME

### D-22 — Vampire lifesteal: tracking before and after in a pure functional pipeline

**Problem:** Lifesteal restores HP equal to the damage actually dealt, capped at missing HP. `intent.value` is the planned damage, not the actual one — defend may have absorbed part of it. The engine returns only a new state, never a delta.

**Decision:** Record HP before `applyDamage`, call it, compare afterwards:
```ts
const heroBefore = state.hero.hp
const s = applyDamage(state, heroId, intent.value)
const actualDmg = heroBefore - s.hero.hp  // real damage after defend
```

**Why it matters:** The track-before-and-after pattern for side effects in an immutable pipeline. The function returns no secondary result, only the final state, so the only way to get a delta is `snapshot_before − snapshot_after`. It appears wherever a middleware or guard can modify an input value: payment processing (`balance_before − balance_after` ≠ `planned_amount`), auth layers, rate limiters.

---

## TELEMETRY

### D-23 — TurnSnapshot vs hash: verification and visualisation are different artefacts

**Problem:** The first ReplayLog held only pre/post event hashes. The debugger could say "something broke here" but not "HP was 18, statuses bleed and stun". Integrity bars need real data, not hashes.

**Decision:** Two separate artefacts with different jobs:
- **Hash** (`preStateHash` / `postStateHash`) — six hex characters. Proves the state was exactly this one. Used by the replayer for byte-perfect verification.
- **TurnSnapshot** — the full entity state after each turn, used by the debugger for visualisation.

Atomicity: the snapshot and the turn_end event are written from the same `state` object — separating them in time would be a read-your-writes inconsistency.

**Why it matters:** A hash verifies; a snapshot visualises. Confusing them means either storing far too much (snapshots for replay) or being unable to show what happened (hashes only, for the debugger). The pattern mirrors event sourcing: an event log for verification plus a read model for visualisation.

---

## BOSS

### D-24 — `constraintViolation: true`: an event that declares it will break an invariant

**Problem:** The Archivist's Phase 4 deliberately injects an invalid state. Ordinary code tries to stay valid — so how does code declare that it will violate a contract on purpose and that a test must catch it?

**Decision:** A `CorruptionEvent` carrying `constraintViolation: true`. The contract is explicit: if `constraintViolation: true`, then `assertValidGameState()` MUST throw:
```ts
applyCorruptionEvent(state, { type: 'invariant_breach', constraintViolation: true })
// → assertValidGameState() must throw TimelineCorruptedError
```

**Why it matters:** Failure detection becomes first-class. The test does not guess whether something should have failed — the event states its own contract. The same pattern exists in distributed systems as a poison message: one deliberately marked as "must cause an error", for testing the dead letter queue.

---

### D-25 — Charge stacks survive Phase 3 state_reset: a design exception as executable specification

**Problem:** Phase 3 clears every status. The design decision in DESIGN.md is that charge stacks are NOT cleared — they are a hero resource, not a status. Without an explicit test, a refactor would add `chargeStacks: undefined` to state_reset and quietly break the Paladin.

**Decision:** The decision in the document became a test:
```ts
it('charge stacks SURVIVE state reset (not a status)', () => {
  const after = applyCorruptionEvent(s, { type: 'state_reset' })
  expect(after.hero.chargeStacks).toBe(2)  // survives Phase 3
})
```

**Why it matters:** Deliberate exceptions get broken during refactoring precisely because they are not obvious. A comment in DESIGN.md protects nothing; a test that fails does. `it.fails()` and targeted tests turn design decisions into executable specifications.
