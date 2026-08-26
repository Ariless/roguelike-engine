# roguelike-engine — agent conventions

## What this is

Deterministic roguelike simulation engine in TypeScript. Engine is the SUT.
4 heroes, 4 enemies, 6 encounter configs, 4 status effects, position system.
Goal: demonstrate property-based, seeded-RNG, state-machine, fault injection, replay, BDD, mutation testing, Monte Carlo, and chaos agent techniques.

## Running tests

```bash
npm test                          # 400 vitest tests — 6 seconds
npm run test:bdd                  # 12 Cucumber BDD scenarios — 0.1 seconds
npm run test:ui                   # 25 Playwright tests (debugger + game + visual)
npm run test:mutation             # Stryker 77.4% across 13 files — 25 minutes
npm run simulate 16000            # Monte Carlo — corridors, intervals, matchup matrix
npm run stability 8000 8          # cross-batch spread + convergence
npm run chaos 200                 # Adversarial agent — find interesting timelines
npm run trace 500                 # Trace analysis + suggested invariants
npm run replay 42                 # Generate replay.json for debugger
npm run ci-report                 # Generate reports/ci-report.html
npx vitest run tests/statuses.test.ts   # single file
npx tsc --noEmit                  # type-check — run after any TS change
```

No SUT to start — engine is pure functions, tests run in-process.

## Architecture — strict layer rules

```
engine/      pure deterministic logic — no I/O, no RNG, no randomness
runtime/     wires engine + RNG + fault injection; ONLY layer that calls RNG
telemetry/   replay log; every action recorded with pre/post state hashes
debugger/    reads telemetry only; never imports engine/ directly
game/        UI; reads telemetry, sends actions to runtime; never imports engine/ directly
scripts/     simulate.ts, stability.ts, chaos-agent.ts, trace-analysis.ts, ci-report.ts, generate-replay.ts
scripts/lib/ harness.ts (shared auto-player + batch runner), stats.ts, corridors.ts
docs/        TEST-PYRAMID.md, DECISION-TABLES.md
tests/bdd/   Cucumber feature files + step definitions
tests/ui/    Playwright tests on debugger.html
```

`engine/` must never import from `runtime/`, `testing/`, `debugger/`, or `game/`.
`runtime/` is the ONLY caller of RNG — engine receives random values as arguments.

## File layout

```
src/engine/
  types.ts              GameState, Hero, Enemy, Card, Status, EntityState, HeroClass
  statuses.ts           addStatus, tickStatuses, hasStatus, canAct
  resolution.ts         applyDamage, applyHeal
  turnPipeline.ts       runTurn, step1–step9; TurnHandlers (onStartOfTurnPassives)
  actionResolution.ts   resolveAction, arp1–arp5; ActionHandlers
  invariants.ts         assertValidGameState, InvariantRegistry, TimelineCorruptedError
  heroes/
    paladin.ts          PALADIN_CARDS, playRighteousStrike, playStubbornRecovery, playDivineCharge
    bloodmage.ts        BLOODMAGE_CARDS, playOpenTheWound, playBloodrite, playChaosBolt
    berserker.ts        BERSERKER_CARDS, isInRage, rageDamage, playSavageLunge, playPrimalFury, playPrimalDodge
    werewolf.ts         WEREWOLF_CARDS, wolfDamage, checkWerewolfTransform, playLunarStrike…playRealityCrack

src/runtime/
  rng.ts                mulberry32 seeded RNG, nextInt, pick, shuffle
  faults.ts             FaultConfig, tickWithFaults (bleedOffByOne)
  executor.ts           createGame(config) → GameHandle; records ReplayLog with snapshots

src/telemetry/
  types.ts              ReplayEvent, TurnSnapshot, ReplayLog
  replayer.ts           replayGame(log) → ReplayResult (byte-perfect verification)
  artifacts.ts          saveFailingRun(log) → /artifacts/failing-seed-N.json

tests/
  resolution.test.ts    / statuses.test.ts / pipeline.test.ts / action-resolution.test.ts
  invariants.test.ts    / rng.test.ts / property.test.ts (fast-check, 4× it.fails())
  heroes/               paladin / bloodmage / berserker / werewolf
  runtime/              executor.test.ts / executor-property.test.ts (fast-check)
  replay/               replay.test.ts
  bdd/
    features/combat.feature     12 Cucumber scenarios — BDD on rule engine without UI
    steps/combat.steps.ts       Step definitions via executor + engine functions directly
  ui/
    debugger.test.ts    13 Playwright tests; uses window.loadJSON() testability hook

game/
  index.html            Playable combat UI — 4 heroes, seed-based random encounters
  assets/               Card and portrait art (AI-generated, background-image only)

debugger/
  index.html            Forensic timeline viewer — window.loadJSON(data) for Playwright

scripts/
  simulate.ts           Monte Carlo — corridors + Wilson intervals + matchup matrix
  stability.ts          Cross-batch spread + convergence; archiving off by design
  lib/harness.ts        Auto-player, configFor(seed), runBatch() — shared by both
  lib/stats.ts          mean/sd/percentile, Wilson interval, corridor verdict
  lib/corridors.ts      Target corridors — design intent, fixed before the run
  chaos-agent.ts        Adversarial agent — finds interesting timelines; Claude API optional
  trace-analysis.ts     Trace analysis — top status combos + suggested invariants
  ci-report.ts          CI Stability Report HTML in Archivist style
  generate-replay.ts    Generates sample replay.json for debugger

docs/
  TEST-PYRAMID.md       Rule engine pyramid vs web pyramid; numbers from this project
  DECISION-TABLES.md    Enemy AI as decision tables; each row = one test

INVARIANTS.md           Full invariant contract + trace-derived invariants
cucumber.json           Cucumber config (tsx runner)
playwright.config.ts    Playwright config (file:// URLs)
```

## Key conventions

**Immutability** — all engine functions return new state. Never mutate `state` in place.

**Pure functions** — `engine/` functions take state as argument, return new state, no side effects.

**Handler injection** — `TurnHandlers.onStartOfTurnPassives` for Werewolf transform. `ActionHandlers` for future Vampire lifesteal. Omitting a handler → step is pass-through.

**State machine** — entity state is `alive → death_door → dead`. `dead → alive` is always invalid.
Enemies: `death_door → dead` happens immediately on next hit (in executor: immediately on card play).
Heroes: `death_door` persists — can be healed back to `alive`.

**turn_end event** — always recorded in ReplayLog, even on early returns from endTurn. Replayer uses this marker to know when to call endTurn(). One turn_end = one snapshot. Invariant: `log.snapshots.length === log.events.filter(e => e.type === 'turn_end').length`.

**Card images** — `game/assets/` filenames: `hero-*`, `enemy-*`, `card-*`.
CSS renders rules text. Images are background-image only.

## Hero classes

| Hero | Key mechanic | Notes |
|------|-------------|-------|
| paladin | `chargeStacks?: number` (0–3); double damage at 3 | `undefined` = 0 |
| bloodmage | bleed conditional; self-damage bypasses defend | Bloodrite self-damage: direct HP mutation, not via resolveAction |
| berserker | Rage: `isInRage(hero)` = HP ≤ 25%; `rageDamage(hero, base)` = ×1.5 | Computed, not stored — no flag in state |
| werewolf | `formState: 'human' | 'werewolf'`; `werewolfTurnsLeft?: number`; `checkWerewolfTransform` via `onStartOfTurnPassives` | Transform fires even while stunned (passive, not action) |

## Pipeline naming

Turn Pipeline steps are numbered 1–9. Action Resolution Pipeline steps are `arp1`–`arp5`.
Always specify which pipeline: "Turn Pipeline step 3" or "ARP step 4".

## Test conventions

**State factories** — every test file has a local `makeState()`. Keep factories in the test file, not shared helpers.

**Describe + it blocks** — group by function name, not by scenario.

**Mutation killing tests** — labeled `// Kill: [mutant description]`. Each targeted test has a comment explaining which specific mutant it kills and why the naive test missed it.

**Assert invariants over exact values:**
```ts
// Prefer:
expect(next.hero.hp).toBeGreaterThanOrEqual(0)
// Over (unless testing a specific formula):
expect(next.hero.hp).toBe(17)
```

**Property tests** — use `fc.integer({ min: X, max: Y }).chain(...)` for dependent arbitraries. Generator boundaries must be strict: use `Math.floor(maxHp * 0.25) + 1` not `Math.floor(maxHp * 0.26)` to avoid off-by-one at threshold.

## BDD conventions

**Feature files** — scenarios describe business rules in domain language, not implementation. "Stun prevents acting" not "canAct() returns false".

**Step definitions** — two modes:
- Full game flow (stun, bleed): use `createGame()` + `game.endTurn()` via executor
- HP-precise scenarios (isInRage, wolfDamage, checkWerewolfTransform): use `makeTestHero()` directly, bypass executor

**False invariant scenarios** — use a documentation step `Then this is the intended behaviour` that always passes. Documents domain rules that intentionally violate intuition.

**Run:** `npm run test:bdd` (tsx node_modules/.bin/cucumber-js --config cucumber.json)

## Playwright conventions

**window.loadJSON(data)** — testability hook in debugger.html for bypassing file dialog. Playwright calls via `page.evaluate`. Don't remove it.

**Run:** `npm run test:ui`

## Rule priority (source of truth hierarchy)

When sources conflict, this order wins:

```
1. INVARIANTS.md            — formal correctness contract
2. TypeScript compiler      — npx tsc --noEmit must pass
3. Existing tests           — if tests pass, assume behaviour is correct
4. Agent conventions        — this document
5. Documentation examples   — illustrative, not normative
```

If documentation examples conflict with tests, **tests and invariants win**.  
If Decision Tables conflict with engine code, treat tables as **intended spec** — file a bug.

---

## Definition of Done

Before proposing or completing any change:

```
1. npm test passes (vitest — all 400 tests)
2. npx tsc --noEmit passes
3. No invariant in INVARIANTS.md is violated
4. Replay determinism preserved — same seed = same hashes
5. Any new mechanic has at least one unit test
6. Any new engine rule has an entry in INVARIANTS.md
```

Claude often makes changes and forgets the test. This checklist prevents that.

---

## Primary architectural invariant

```
Same seed + same inputs
must always produce
byte-identical replay logs.

Any change that breaks determinism is a defect.
```

Verify with: `npm run simulate 100` (no replay failures) and `npm run test` (executor-property tests).

---

## When changing core engine functions

Changes to any of these require invariant review + replay review + property test review:

| Function | Why it's high-risk |
|----------|-------------------|
| `applyDamage` | Death's Door state machine; HP floor/ceiling |
| `applyHeal` | Death's Door clearance; HP ceiling |
| `tickStatuses` | Bleed cap; status expiry; death_door via tick |
| `runTurn` | Pipeline ordering; all step invariants |
| `resolveAction` | ARP ordering; vulnerable multiplier; melee gate |
| `executor.endTurn` | turn_end + recordSnapshot must always pair |

After any change to these: run `npm test && npm run simulate 100`.

---

## What NOT to do

- Don't add side effects (console.log, Math.random) inside `engine/`
- Don't modify `types.ts` Status or Intent types without running `npx tsc --noEmit` immediately
- Don't create shared test helper files — factories stay local to each test file
- Don't add `if (bleed && vulnerable)` hardcoded combos — statuses modify damage via pipeline hooks
- Don't add `heroClass: 'berserker'` to a card that belongs to a different hero
- Don't record `turn_end` without also calling `recordSnapshot` in the same code path
- Don't remove `window.loadJSON` from debugger.html — Playwright tests need it
- Don't commit — show the commands, user runs them
