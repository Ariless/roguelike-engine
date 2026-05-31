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
       ╱       Unit (310 tests — engine + heroes)  ╲  base — per-function assertions
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

**Monte Carlo** — statistical confidence. 10,000 seeds = 10,000 test cases generated automatically.
Blood Mage 94.5% winrate reveals a design property that 310 unit tests didn't explicitly check.

---

## Numbers from this project

```
Layer              | Tests    | Runtime  | Purpose
-------------------|----------|----------|--------------------------------
Unit               | 310      | 3s       | Per-rule correctness
Property           | 27       | 2s       | Invariant coverage
Replay             | 13       | 0.5s     | Determinism proof
Executor property  | 7        | 2s       | End-to-end byte-perfect
BDD (Cucumber)     | 11 scen  | 0.1s     | Rules as specification
Playwright UI      | 13       | 14s      | Debugger verification
Mutation           | 626 mut  | 4 min    | Test quality ~79%
Monte Carlo        | 10,000   | 30s      | Statistical stability
Chaos Agent        | 200      | 3s       | Adversarial probe
Trace Analysis     | 500      | 5s       | Pattern discovery
```

**Total automated verification:** 310 + 27 + 13 + 7 + 11 + 13 = 381 test files/scenarios.
**Total seeds probed:** 10,000+ across Monte Carlo, chaos, and property tests.

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
