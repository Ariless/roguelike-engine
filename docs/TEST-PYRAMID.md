# Test Pyramid for Rule Engines

A rule engine has a fundamentally different test pyramid from a web application.
No HTTP, no UI, no database — different layers, different tools, different purpose.

---

## Web application pyramid (reference)

```
         ╱────╲
        ╱  E2E ╲          Few — slow, brittle, expensive
       ╱──────────╲
      ╱ Integration ╲     Some — verify component wiring
     ╱────────────────╲
    ╱      Unit         ╲ Many — fast, isolated, cheap
   ╱────────────────────╲
```

**What it tests:** "Does the button work? Does the API return 200?"

---

## Rule engine pyramid (this project)

```
                    ╱──────────────╲
                   ╱  BDD/Cucumber  ╲   11 scenarios — rules as specification
                  ╱──────────────────╲
                 ╱  Playwright / UI   ╲  13 tests — debugger & game UI
                ╱──────────────────────╲
               ╱  Chaos / Monte Carlo   ╲  10k+ seeds — adversarial + statistical
              ╱────────────────────────╲
             ╱  Mutation (Stryker ~79%)  ╲  meta-layer — tests the tests
            ╱────────────────────────────╲
           ╱  Replay (byte-perfect)        ╲  13 tests — determinism proof
          ╱──────────────────────────────────╲
         ╱  Property (fast-check, 27 tests)   ╲  forAll — invariant coverage
        ╱────────────────────────────────────────╲
       ╱       Unit (329 tests — engine + heroes)  ╲  base — per-function assertions
      ╱────────────────────────────────────────────╲
```

---

## Layer-by-layer comparison

| Layer | Web | Rule Engine | Purpose |
|-------|-----|-------------|---------|
| **Unit** | Component tests | Per-function engine tests | Verify single rule in isolation |
| **Integration** | API + DB wiring | Executor (engine + RNG + faults) | Verify pipeline composition |
| **Property** | Rarely used | `forAll(seeds) → invariant` | Find edge cases automatically |
| **Replay** | Does not exist | `replayGame(log).success` | Prove determinism |
| **Mutation** | Optional | Stryker ~79% | Measure test quality |
| **Chaos/Monte Carlo** | Load tests | 10k adversarial seeds | Statistical stability |
| **BDD** | Cucumber E2E | Cucumber on engine | Rules as specification |
| **UI** | Selenium/Playwright | Playwright on debugger | Test the debugging tool |

---

## Why no E2E in the traditional sense?

Traditional E2E = browser → server → DB → browser. This requires all layers to be running.

Rule engine E2E = scenario → engine → state machine → invariant check. Everything runs in-process.
The "end" is not a pixel on screen — it's a verified state machine transition.

**BDD fills the E2E role:** natural language scenarios exercise the full engine from the outside,
without knowing internal implementation. If a Cucumber scenario passes, the rule works end-to-end.

---

## What replaces integration tests?

The **executor** (`src/runtime/executor.ts`) is the integration layer:
- Wires engine + seeded RNG
- Adds fault injection
- Records telemetry

`executor-property.test.ts` tests the executor integration: `forAll(seeds) → replayGame(log).success`.
This is stronger than traditional integration tests — it checks ALL possible seeds, not one.

---

## The unique layers: Replay + Mutation + Monte Carlo

These three don't exist in standard web pyramids:

**Replay** — byte-perfect reproduction. Any failing seed can be opened in debugger, reproduced exactly.
Web equivalent: would require recording and replaying every HTTP request, database state, and timer.
For a rule engine: built-in because RNG is seeded.

**Mutation testing** — measures test quality, not just coverage. If 79% of mutations are caught,
21% of bugs in those files could slip through unnoticed. This makes the pyramid self-auditing.

**Monte Carlo** — statistical confidence. 16,000 seeds = 16,000 test cases generated automatically,
covering all 16 hero × enemy configurations. Every class metric carries a Wilson interval and a
verdict against a corridor fixed before the run.

What it caught that 329 unit tests did not: the Necromancer wins 0 of 4,000 battles, because its
Raise Dead and Empower were never implemented in the engine (BUG-14). No unit test could see this —
they all verify that existing code behaves correctly, and none asks whether the specified behaviour
exists at all. Mutation testing is equally blind here: there is no code to mutate.

**Statistical battery** — a distinct layer, not part of unit. `rng.test.ts` checks the RNG *contract*
(same seed → same sequence, values in range). `rng-statistical.test.ts` checks its *distribution*: a
generator that rolls 1 twice as often as 6 passes every contract test. Seeds are fixed, so the
metrics are reproducible to the last digit — a statistical test that flakes once per N runs belongs
in a lab, not in CI.

---

## Numbers from this project

```
Layer              | Tests    | Runtime  | Purpose
-------------------|----------|----------|--------------------------------
Unit               | 329      | 2s       | Per-rule correctness
Property           | 27       | 0.2s     | Invariant coverage
Statistical (RNG)  | 15       | 0.6s     | Distribution + seed space
Replay             | 13       | 0.04s    | Determinism proof
Executor property  | 7        | 1s       | End-to-end byte-perfect
BDD (Cucumber)     | 12 scen  | 0.04s    | Rules as specification
Playwright UI      | 25       | 17s      | Debugger + game + visual
Mutation           | 626 mut  | 4 min    | Test quality ~79%
Monte Carlo        | 16,000   | 5s       | Corridors + matchup coverage
Stability          | 64,000   | 40s      | Cross-batch spread, convergence
Chaos Agent        | 200      | 3s       | Adversarial probe
Trace Analysis     | 500      | 5s       | Pattern discovery
```

**Total automated verification:** 329 + 27 + 15 + 13 + 7 + 12 + 25 = 428 tests/scenarios.
**Total seeds probed:** 80,000+ across Monte Carlo, stability batches, chaos, and property tests.

---

## Lesson for enterprise QA

> The shape of the pyramid depends on what the system IS, not what testing tools exist.
>
> A pricing engine has no UI. A rule engine has no database.
> A workflow system has no HTTP response to assert on.
>
> The pyramid adapts. Property tests replace integration tests.
> Replay replaces E2E. Mutation replaces coverage thresholds.
> The goal stays the same: confidence that the system does what it's supposed to do.
