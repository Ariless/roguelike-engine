# Roguelike Engine — Deterministic Rule Engine SUT

> *A deterministic roguelike simulation engine built to explore advanced testing techniques through unstable timelines and reproducible state corruption.*

**This is not a game testing project.**

The roguelike is a rule engine — the same class of system as a payment processor, pricing calculator, or insurance rules engine. Every technique here applies directly to enterprise rule engines. The game is the SUT; the test suite is the point.

---

## What this demonstrates

| Technique | Concrete scenario | Why it matters |
|-----------|-----------------|----------------|
| **Property-based testing** | `forAll(seeds) → hp ∈ [0, maxHp]`; bleed cap ≤ 10; state machine | Generates thousands of inputs automatically; shrinks to minimal failing case |
| **Seeded deterministic RNG** | Same seed → same encounter; byte-perfect replay | Any failing run reproducible exactly by seed |
| **State machine coverage** | `alive → death_door → dead`; werewolf `human ↔ wolf` | Tests transitions, not just happy paths |
| **Fault injection** | `bleedOffByOne: true` → property test catches the bug | Controlled bug insertion; fast-check shrinks to minimal failing sequence |
| **Replay system** | `replayGame(log).success === true` for any random game | Byte-perfect verification via pre/post state hashes per event |
| **Metamorphic testing** | `damage(lowHp) ≥ damage(highHp)` — formula without expected value | Relations between inputs, not exact outputs |
| **`it.fails()` false invariant** | `healWerewolfIsAlwaysBeneficial` — intentionally failing test as domain spec | Documents rule violations; fails if someone "fixes" the wrong thing |
| **Mutation testing** | Stryker ~79%; targeted kills: `hasStatus always-true`, `&&→||` | Finds gaps that code review misses |
| **Monte Carlo simulation** | `npm run simulate 10000` → winrate by class; Blood Mage 94.5% | Statistical stability; reveals design signals |
| **BDD / Cucumber** | Natural language scenarios on the engine — no browser, no HTTP | Executable specification for rule engines |
| **Decision tables** | Guardian: shield→stun→attack; each row = one test | Classic technique on non-classic system |
| **AI chaos agent** | Adversarial play; 50/200 interesting timelines found automatically | LLM-guided stress testing |
| **Pairwise testing** | 4×4×3=48 → 16 tests (67% reduction); all 2-way pairs covered | Multi-parameter combinatorial reduction |
| **Visual regression** | Playwright screenshots vs baseline; catches rendering regressions | Orthogonal to replay — different bug class |
| **LLM oracle** | Claude evaluates semantic rule correctness; `npm run oracle` | Semantic vs computational correctness |
| **Meta-oracle** | Tests the AI judge with known-correct + known-incorrect states | "Testing the test infrastructure" |
| **Trace-driven discovery** | `npm run trace` → top status combos + suggested invariants | "What to test" from real data, not assumptions |
| **Forensic debugger** | `debugger/index.html` — load any replay.json, inspect segments | Visual proof of determinism |

---

## Quick start

```bash
npm install
npm test                          # 371 tests — 3 seconds
npm run test:bdd                  # 11 BDD scenarios
npm run test:ui                   # 22 Playwright tests (game + visual regression)
npm run simulate 10000            # Monte Carlo — 30 seconds
npm run chaos 200                 # Adversarial agent
npm run trace 500                 # Trace analysis + suggested invariants
npm run replay 42                 # Generate replay.json for debugger
npm run oracle 42                 # LLM oracle evaluation
npm run semantic-mutations src/engine/statuses.ts tickStatuses   # AI upstream Stryker
npm run spec-to-test "Bleed deals damage equal to stacks per turn"
npm run meta-oracle               # Test the AI judge quality
npm run ci-summary                # AI-generated CI narrative
npm run ci-report                 # HTML stability report
npm run test:mutation             # Stryker ~79% — 4 minutes
```

Open `game/index.html` in browser — playable combat UI.  
Open `debugger/index.html` → load any `artifacts/replay-seed-*.json`.

---

## Architecture

```
engine/      pure deterministic logic — no I/O, no RNG, no side effects
runtime/     wires engine + seeded RNG + fault injection; only layer that calls RNG
telemetry/   replay log — every action recorded with pre/post state hashes
debugger/    forensic timeline viewer — reads telemetry only
game/        playable combat UI — reads telemetry, sends actions to runtime
scripts/     simulate, chaos, trace, replay, ci-report
docs/        DECISION-TABLES.md, TEST-PYRAMID.md
```

**Key rule:** `engine/` imports nothing from `runtime/`, `debugger/`, or `game/`.  
**Key rule:** every engine function is pure: `(state, args) → newState`.

---

## Test suite (334 tests across 3 runners)

```
Vitest (310 tests):
  resolution.test.ts        — applyDamage, applyHeal, death_door state machine
  statuses.test.ts          — bleed, stun, defend, vulnerable + mutation killers
  heroes/ (4 files)         — paladin, bloodmage, berserker, werewolf
  runtime/executor.test.ts  — card dispatch, energy, win/lose, fault injection
  runtime/executor-property.test.ts  — 7 property tests: byte-perfect replay for any seed
  replay/replay.test.ts     — divergence detection, tampered hash, RNG wiring
  property.test.ts          — HP invariants, state machine, metamorphic, 4× it.fails()
  invariants.test.ts        — assertValidGameState, TIMELINE CORRUPTED
  pipeline.test.ts          — 9-step Turn Pipeline
  action-resolution.test.ts — 5-step Action Resolution Pipeline
  rng.test.ts               — seeded RNG determinism

Cucumber (11 scenarios):
  tests/bdd/features/combat.feature — stun, bleed, Death's Door, Paladin charges,
                                      Berserker Rage, Werewolf transform, false invariant

Playwright (13 tests):
  tests/ui/debugger.test.ts — load, segments, integrity bars, hash verification,
                              navigation, corruption detection, export
```

---

## Mutation testing

```
npm run test:mutation

File           | Score  | Targeted kills
---------------|--------|------------------------------------------
resolution.ts  | 92.4%  | Core pipeline well-covered from day 1
statuses.ts    | ~94%   | hasStatus always-true, duration filter, updateEntity
paladin.ts     | 80.3%  | ?? 0 → && 0 boundary, undefined chargeStacks
berserker.ts   | 69.9%  | Multi-enemy row mutation, rage 25% boundary
Overall        | ~79%   | Above typical industry baseline (65–75%)
```

---

## Monte Carlo + Chaos Agent

```
npm run simulate 10000

  paladin    ██████████   99.8%  (avg 5.3 turns)
  bloodmage  █████████░   94.5%  (avg 5.4 turns)  ← self-damage risk
  berserker  ██████████   98.1%  (avg 4.8 turns)
  werewolf   ██████████  100.0%  (avg 3.6 turns)
  Simulation stable. No invariant drift detected.

npm run chaos 200

  Timelines probed: 200 | Stable: 200 (100%) | Interesting: 50
  Hotspot: Berserker vs Vampire turn 3 — peak status accumulation
```

---

## Trace analysis

```
npm run trace 500

  Top status combos on hero: bleed (359), bleed+defend (352), stun (205)
  Game length: wins avg 4.0 turns, losses avg 7.5 turns
  Suggested invariants:
    1. Game terminates ≤ 12 turns
    2. bleed+defend → defend not consumed by bleed tick
    3. Losses correlate with long games (>7 turns)
```

---

## BDD — rules as executable specification

```gherkin
Scenario: Stun expires after the hero skips one turn
  Given the hero is playing as Paladin against a Guardian
  And the Guardian stuns the hero
  When the hero ends their turn without playing any cards
  Then the hero is no longer stunned

Scenario: Healing the Werewolf above 50% HP weakens their attack
  Given the hero is playing as Werewolf with 13 HP out of 30
  When the hero is healed to 16 HP
  Then wolf passive damage bonus is lower than before the heal
  And this is the intended behaviour — healing is not always beneficial
```

No browser. No HTTP. Pure rule engine via `createGame()` + `game.endTurn()`.

---

## Bug Cemetery (`BUGS.md`)

12 real bugs found during implementation. Selected highlights:

| Bug | Found by | Class |
|-----|----------|-------|
| Stun never cleared on hero | Manual playtesting | "state never cleared" |
| TypeScript narrowing blocked `'dead'` | `tsc --noEmit` | Type inference gotcha |
| Enemy at death_door attacked before dying | Playtesting screenshot | Race condition in state machine |
| `recordSnapshot` missing in early return | fast-check counterexample | "missed path" — 3 of 4 correct |
| Property test generator off-by-one | fast-check shrinking | Bug in the test, not the code |

---

## Test Pyramid for rule engines

See `docs/TEST-PYRAMID.md` for the full comparison. Key insight:

> The pyramid shape depends on what the system IS, not what tools exist.
> A rule engine has no database, no HTTP, no UI.
> E2E → BDD. Coverage → mutation score. Manual testing → Monte Carlo.

---

## Decision tables

See `docs/DECISION-TABLES.md`. Each enemy AI is a decision table:

| Turn | Guardian intent | Effect |
|------|----------------|--------|
| 1 | Shield (defend 8) | Hero attacks absorbed |
| 2 | Stun | Hero canAct = false |
| 3 | Heavy Strike (10) | Unblocked damage on stunned hero |

Each row = one test. Cross-rows = integration tests.

---

## Why deterministic matters

Traditional testing often struggles with intermittent failures — a test fails once, passes on re-run, and the bug is never reproduced. In this project:

- Every random decision comes from a **seeded RNG** — same seed = same game
- Every action is **logged** with pre/post state hashes
- Every state transition is **hashed**
- Any failing run can be **reproduced from a single integer**

A bug found in simulation, property testing, chaos testing, or manual play can be opened in the debugger and replayed exactly. No "works on my machine". No "can't reproduce".

```
# Found during chaos agent run
Interesting timeline: seed=38, Berserker vs Vampire — hero has 2 statuses on turn 3

# Open in debugger:
npm run replay 38
# → debugger/index.html → load artifacts/replay-seed-38.json
```

---

## Property failure + fast-check shrinking

fast-check doesn't just find failures — it shrinks them to the minimal counterexample.

**Real example from this project (BUG-12):**

```
Property: snapshots.length === turn_end events

Original failing case:
  200 random seeds tested
  Failed at: seed=12245, heroClass='paladin', enemyType='guardian'

Shrunk by fast-check in 10 steps to:
  seed=12245, paladin vs guardian → 20 snapshots, 21 turn_end events

Root cause:
  recordSnapshot() was missing in one of four early-return paths in endTurn().
  Code compiled. Tests passed. One specific game flow silently skipped a snapshot.
```

The bug was in the **implementation**, not the test. fast-check found it, not code review.

---

## Testing ROI

```
Implementation:    ~2,500 LOC

Tests:             334  (310 vitest + 13 Playwright + 11 BDD)
                   + 10,000 seeds via Monte Carlo
                   + 200 adversarial runs via chaos agent

Real defects:      12  (see BUGS.md — each with root cause and fix)

Mutation score:    ~79%  (above typical 65–75%)

Bugs found by property tests specifically:
  BUG-06  fast-check found off-by-one in test generator  (test was wrong, not code)
  BUG-12  fast-check shrunk to seed=12245 — recordSnapshot missing in one code path
  ROG-05  test tested nonexistent scenario (playCard with no energy = silent no-op)

Bugs mutation testing revealed:
  hasStatus always-true survived 22 tests — no negative assertions existed
  &&→|| survived in bloodmage.ts — no test for "alive + 0 HP ≠ death_door"
```

---

## AI Chaos Agent — what counts as "interesting"

The chaos agent doesn't just run games randomly. It actively looks for **high-stress states**:

| Criterion | Why it matters |
|-----------|---------------|
| Hero at Death's Door | Tests state machine under pressure |
| 2+ statuses on same entity | Tests status interaction correctness |
| Werewolf transformation | Tests nested state machine trigger |
| bleed + vulnerable combo | Tests peak damage window |
| Game lasting 5+ turns | Engine survived extended adversarial pressure |

```
200 adversarial runs → 50 interesting timelines
Hotspot: Berserker vs Vampire, turn 3
→ Vampire applies bleed (turn 2) + Berserker gains second status (turn 3)
→ Peak status accumulation point in the system
```

This is exploratory testing guided by explicit criteria — not "LLM magic".

---

## What this project intentionally does NOT test

```
✗ Visual rendering correctness
✗ Browser compatibility
✗ Network failures or timeouts
✗ Database consistency or transactions
✗ Concurrent access or race conditions
✗ Authentication or authorisation
```

The focus is **deterministic rule verification**. If the rule engine produces correct state transitions under all inputs, the consuming systems (game UI, debugger) can be trusted by their own tests — which is exactly what the Playwright layer does.

---

## Enterprise mapping

| Roguelike | Enterprise equivalent |
|-----------|----------------------|
| Replay log | Audit trail |
| Timeline hash | Event integrity verification |
| Status effects | Rule composition |
| Action pipeline | Workflow engine step |
| Chaos agent | Exploratory / adversarial testing |
| Monte Carlo winrate | Balance / regression metric |
| Seeded replay | Reproducing a production incident |
| Trace-derived invariants | Test discovery from production data |
| `it.fails()` false invariant | Documenting intentional rule exceptions |

---

## Interview framing

> *"I built a roguelike engine as a SUT to practice testing a class of systems that QA courses skip: complex rule engines with no API and no UI. Every technique — property testing, mutation testing, BDD, Monte Carlo, adversarial chaos agent — transfers directly to payment processing, pricing logic, and workflow systems."*

**The strongest claim:** `forAll(seeds) → replayGame(log).success` — any random game sequence replays byte-perfect. Three systems (executor + replay + fast-check) form a closed verification loop.

**The most original idea:** The final boss and the property-based test suite are implementations of the same adversarial model. ✅ Implemented — `src/engine/boss/archivist.ts` + 15 tests.

- Boss Phase 4 → inject illegal state transition → `assertValidGameState()` must catch it
- Property tests → inject illegal transitions via `FaultConfig` → invariants must hold
- InvariantRegistry → validates both

Game mechanics that *are* tests. Not game mechanics *with* tests alongside.

---

## Narrative

*Some runs should never exist.*

| Code | Debugger / CI display |
|------|----------------------|
| Turn N | Timeline Segment N |
| HP | Integrity |
| Seed | Timeline ID |
| All tests pass | Simulation stable. No invariant drift detected. |

---

## Stack

TypeScript (strict) · Vitest · fast-check · Stryker · Cucumber · Playwright · Plain HTML/CSS
