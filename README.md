# Roguelike Engine — Deterministic Rule Engine SUT

[![CI](https://github.com/Ariless/roguelike-engine/actions/workflows/ci.yml/badge.svg)](https://github.com/Ariless/roguelike-engine/actions/workflows/ci.yml)

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
| **Mutation testing** | Stryker 86.1% across 13 files; `faults.ts` came back at 26% | The scope of a mutation run is itself unaudited — "79%" covered half the system |
| **Monte Carlo simulation** | `npm run simulate` → winrate per class and per matchup, Wilson intervals, verdict against a target corridor | Statistical stability; caught a whole enemy that never got implemented |
| **Sampling-bias detection** | Hero and enemy both derived from `seed % 4` → 4 of 16 configurations ever scanned | A biased sample returns a plausible number nobody rechecks |
| **Metric stability** | `npm run stability` → cross-batch spread + convergence as runs double | An interval narrowing toward a seed-dependent answer looks *more* trustworthy |
| **RNG statistical battery** | chi-square uniformity, runs test, autocorrelation, integer bias, permutation fairness, seed-space limits | Determinism tests pass on a generator that rolls 1 twice as often as 6 |
| **BDD / Cucumber** | Natural language scenarios on the engine — no browser, no HTTP | Executable specification for rule engines |
| **Decision tables** | Guardian: shield→stun→attack; each row = one test | Classic technique on non-classic system |
| **Spec-compliance testing** | `ENEMY_INTENTS` checked against the decision tables; two enemies diverge, and the gaps are pinned | Every other test verifies existing code is correct; none asks whether specified behaviour exists |
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
npm test                          # 400 tests — 6 seconds
npm run test:bdd                  # 12 BDD scenarios
npm run test:ui                   # 25 Playwright tests (debugger + game + visual regression)
npm run simulate 16000            # Monte Carlo + balance corridors — 5 seconds
npm run simulate 16000 -- --gate  # same, but exit 1 if balance leaves the corridor
npm run stability 8000 8          # cross-batch spread + convergence — 40 seconds
npm run chaos 200                 # Adversarial agent
npm run trace 500                 # Trace analysis + suggested invariants
npm run replay 42                 # Generate replay.json for debugger

# The five below call the Claude API. Without ANTHROPIC_API_KEY they exit with
# instructions; append -- --dry-run to see the flow on a canned response.
npm run oracle 42                 # LLM oracle evaluation
npm run semantic-mutations src/engine/statuses.ts tickStatuses   # AI upstream Stryker
npm run spec-to-test "Bleed deals damage equal to stacks per turn"
npm run meta-oracle               # Test the AI judge quality
npm run ci-summary                # AI-generated CI narrative
npm run ci-report                 # HTML stability report
npm run test:mutation             # Stryker 86.1% across 13 files — 38 minutes
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
scripts/     simulate, stability, chaos, trace, replay, ci-report
scripts/lib/ harness (shared auto-player), stats, balance corridors
docs/        DECISION-TABLES.md, TEST-PYRAMID.md
```

**Key rule:** `engine/` imports nothing from `runtime/`, `debugger/`, or `game/`.  
**Key rule:** every engine function is pure: `(state, args) → newState`.

---

## Test suite (437 tests across 3 runners)

```
Vitest (400 tests):
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
  rng-statistical.test.ts   — distribution: chi-square uniformity, runs test,
                              autocorrelation, integer bias, permutation fairness,
                              seed space limits
  decision-tables.test.ts   — engine intents vs docs/DECISION-TABLES.md; known gaps
                              pinned so they can be neither silently widened nor
                              silently closed

Cucumber (12 scenarios):
  tests/bdd/features/combat.feature — stun, bleed, Death's Door, Paladin charges,
                                      Berserker Rage, Werewolf transform, false invariant

Playwright (25 tests):
  tests/ui/debugger.test.ts          — load, segments, integrity bars, hash verification,
                                       navigation, corruption detection, export
  tests/ui/game.test.ts              — encounter panels, bleed kill regression, targeting
  tests/ui/visual-regression.test.ts — screenshots vs baseline
```

---

## CI

`.github/workflows/ci.yml` — four jobs, deliberately different in strictness.

| Job | Runs | Blocks merge on |
|-----|------|-----------------|
| `verify` | typecheck, 400 vitest tests, 12 BDD scenarios | any failure |
| `simulation` | Monte Carlo 16k + stability 4k×4 | broken determinism only |
| `ui` | 25 Playwright tests on Chromium | any failure |
| `mutation` | Stryker across engine, runtime and telemetry | score below the configured threshold |

The simulation job is the interesting one. `simulate` exits non-zero when a timeline is corrupted or a
state hash diverges, because "same seed produces the same log" is not negotiable. Balance leaving its
corridor is *reported* rather than blocking, because three of four classes are currently outside it
and half of that comes from BUG-14 — enemies that never got implemented. A gate that cannot go green
teaches people to ignore red. Once the enemy mechanics land, the step becomes
`npm run simulate 16000 -- --gate` and corridors block merges like any other test.

Both reports are written to the job summary, so a run's statistics are readable without downloading
artefacts.

---

## Mutation testing

```
npm run test:mutation        # 13 files, 1489 mutants, 38 minutes

File                | Score   | Note
--------------------|---------|--------------------------------------------
resolution.ts       | 100.00% |
turnPipeline.ts     | 100.00% |
actionResolution.ts |  97.56% |
statuses.ts         |  96.55% | hasStatus always-true, duration filter
berserker.ts        |  95.89% | rage 25% boundary
rng.ts              |  95.65% |
replayer.ts         |  92.00% |
bloodmage.ts        |  89.87% |
executor.ts         |  85.07% | largest file in the project
paladin.ts          |  84.85% | ?? 0 → && 0 boundary
invariants.ts       |  79.66% |
werewolf.ts         |  79.53% |
faults.ts           |  26.00% | ← 37 of 50 mutants survive
Overall             |  86.10% | thresholds.break = 85 — the run fails below it
```

**`faults.ts` at 26% is the finding, not the 86%.** That module exists to corrupt engine
behaviour on purpose (`bleedOffByOne` and friends) so the suite can demonstrate it notices planted
bugs. It is the instrument that audits the tests — and it turned out to be the least tested code in
the repository. Break it and the injector silently injects nothing: property tests still pass, and
"we verified the tests catch a planted bug" quietly becomes an unsupported claim. A broken injector
is indistinguishable from a working one on healthy code.

The previous figure, "~79%", was never wrong — it was incomplete. It covered 6 files and stayed
silent about 7 others, `executor.ts` and `rng.ts` among them. Scope is one line in a config that
nobody rereads, and a score sounds equally convincing whether it describes a whole system or half
of one.

---

## Monte Carlo + Chaos Agent

Every class metric carries a confidence interval and a verdict against a target
corridor. The corridor is design intent fixed *before* the run — a corridor fitted
to measured results always passes and therefore says nothing.

```
npm run simulate 16000

  class        winrate            95% CI          verdict   turns (mean ± sd)   p95
  paladin    ███████░░░  70.5%   [68.9%, 72.0%]   PASS      9.9 ± 9.7          39
  bloodmage  █████████░  94.1%   [93.3%, 94.8%]   FAIL      3.6 ± 1.4           7
  berserker  ██████████  95.3%   [94.7%, 96.0%]   FAIL      7.4 ± 5.6          19
  werewolf   ██████████  99.2%   [98.9%, 99.5%]   FAIL      4.6 ± 2.3           9

  MATCHUP MATRIX — winrate per pair, ~1,000 runs per cell
  hero \ enemy        goblin     guardian      vampire  necromancer
  paladin             99.8%!       20.9%        29.6%       100.0%!
  bloodmage          100.0%!       95.2%        81.1%       100.0%!
  berserker          100.0%!       88.1%        93.3%       100.0%!
  werewolf            99.9%!       99.7%!       97.3%!      100.0%!

  Configuration coverage: 16/16 pairs scanned
```

Three of four classes are outside the corridor, and the matrix says why: every
hero beats the Necromancer 100% of the time. That column is BUG-14 — the enemy's
Raise Dead and Empower exist in `DESIGN.md`, `DECISION-TABLES.md` and the UI, but
never reached the engine, so it can only apply bleed and cannot win.

The matrix used to be invisible: `simulate.ts` derived hero *and* enemy from the
same `seed % 4`, scanning 4 pairs out of 16 (BUG-13). The Necromancer only ever
met the Werewolf, who wins everything anyway.

```
npm run stability 8000 8      # 8 batches × 8,000 runs on far-apart base seeds

  class        min      max      spread   sd       CI half-width   verdict
  paladin      68.8%    70.3%    1.52%    0.51%       1.01%      PASS
  werewolf     99.1%    99.5%    0.35%    0.12%       0.19%      PASS

  CONVERGENCE — overall hero winrate vs number of runs
    1,000     90.2%   [88.21%, 91.96%]   ±1.876%
   32,000     90.6%   [90.23%, 90.88%]   ±0.327%   Δ -0.021%

  Cross-batch: stable. Estimates do not depend on the starting seed.
```

Two separate questions. The confidence interval measures noise *within* a batch;
cross-batch spread measures whether the estimate depends on where sampling
started. A metric can pass one and fail the other — an interval that narrows
toward a seed-dependent answer looks more trustworthy the more runs you add.

```
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

Tests:             437  (400 vitest + 25 Playwright + 12 BDD)
                   + 16,000 seeds via Monte Carlo, all 16 configurations
                   + 64,000 seeds across 8 batches via stability run
                   + 200 adversarial runs via chaos agent

Real defects:      16  (see BUGS.md — each with root cause and fix)
                   BUG-13…16 came from the simulation and the RNG battery,
                   not from the unit suite: a biased sample, an enemy that was
                   never implemented, a silently truncated seed, and a UI test
                   whose assert did not check what its name promised.

Mutation score:    86.1%  (13 files: engine, runtime, telemetry)

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
