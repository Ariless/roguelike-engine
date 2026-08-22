# Practice Tasks

> These tasks are designed to build reasoning skills, not just coding skills.
> Each one comes from a real implementation decision or bug found during development.
> Do NOT read `BUGS.md` before attempting detective tasks. It contains the answers.

---

## Setup

```bash
npm install
npm test                    # 371 tests — all should pass
npm run simulate 1000       # Monte Carlo — verify engine stability
npm run replay 42           # Generate a replay for debugger
open game/index.html        # Playable UI (optional — helps understand the SUT)
open debugger/index.html    # Forensic timeline viewer
```

**Key files to read first:**
- `INVARIANTS.md` — correctness contract; find an invariant before writing a test
- `docs/RULE-COVERAGE.md` — which rules are covered by which test layer
- `docs/TESTING_PATTERNS.md` — 11 patterns used in this project

---

## Module A-1 — Foundations

*Rules before tests. Invariants before assertions.*

---

### T-01 — Type as invariant: when is a test a tautology?

**File:** `src/engine/types.ts`, `src/engine/heroes/paladin.ts`

**Context:** Every card in the engine has an `axes` field. Open `types.ts` and look at how it's typed.
Then look at this test in `tests/heroes/paladin.test.ts`:

```ts
it('all 3 paladin cards are present', () => {
  expect(PALADIN_CARDS).toHaveLength(3)
})
```

**Your task:**
1. Find the test that checks "every card has exactly 2 axes." Is it a tautology? Why or why not?
2. Change the type so this test becomes redundant documentation.
3. Find two more places in the project where a type could replace a test.

**Deliverable:** modified type + explanation + two examples from the codebase.

---

### T-02 — Contextual invariant: when is `alive + hp=0` valid?

**File:** `src/engine/invariants.ts`, `INVARIANTS.md`

**Context:** Look at `InvariantRegistry`. Find the `alive-hp` invariant and its `appliesAt` value.

**Your task:**
1. Explain why `alive + hp=0` is valid at some points in the pipeline but not others.
2. Find the pipeline step where this becomes invalid. What happens there?
3. Write a test that verifies this invariant holds after Turn Pipeline step 9.

**Deliverable:** written explanation + test.

---

## Module A-2 — Unit Testing

*One rule = one test. Tables make gaps visible.*

---

### T-03 — Trace-driven: find what to test from real game data

**Setup:** `npm run trace 500`

**Context:** The trace script runs 500 random games and surfaces patterns from real play. Read `docs/TESTING_PATTERNS.md` → Pattern #9 (Trace-driven).

**Your task:**
1. Run `npm run trace 500`. Record the top 3 status combos and the game length distribution.
2. For the #2 combo (`bleed+defend`) — does any existing test verify that defend is NOT consumed by a bleed tick? Check `docs/RULE-COVERAGE.md`.
3. If the gap exists: write the property test. If it doesn't: explain what test covers it.
4. What does "losing games are 2× longer" tell you about the system? Propose one CI metric based on this.

**Deliverable:** written findings + test (if gap found) + one CI metric proposal.

> **Why interesting:** "What to test" came from data, not assumptions. The trace found bleed+defend as the #2 combo — 352 out of 500 games. Nobody planned to test it specifically.

---

### T-04 — Pipeline ordering bug: find it before fast-check does

**File:** `src/engine/heroes/paladin.ts` → `playRighteousStrike`

**Context:** Read `BUGS.md` entry BUG-02. Then look at the current (fixed) implementation.

**Your task:**
1. Introduce the BUG-02 bug back into the code (swap steps 4 and 5).
2. Run `npm test` — which test catches it?
3. Write a property-based test with fast-check that would have caught this automatically.
4. Restore the fix.

**Deliverable:** property test + explanation of what `fc.property` checks that the unit test didn't.

---

## Module A-3 — Invariant Contract

*A bug cemetery is worth more than 100 test descriptions.*

---

### T-05 🐛 — Buggy branch: find 5 bugs

> See `docs/BUGGY-BRANCH.md` for setup instructions.
> **Do NOT read** the spoiler section until you've found all 5.

**Your task:**
1. Apply the buggy changes described in `docs/BUGGY-BRANCH.md`.
2. Use any combination of: `npm test`, `npm run simulate`, `npm run chaos`, writing new tests.
3. For each bug: file, root cause, technique used to find it.

**Deliverable:** `BUGS-FOUND.md` with 5 entries (format: same as `BUGS.md`).

---

## Module A-4 — Property-based Testing

*Examples prove nothing. Properties prove something.*

---

### T-06 — Model-based testing: reference model vs real engine

**File:** `tests/model-based.test.ts`, `src/engine/resolution.ts`

**Context:** Model-based testing: write a simple "obviously correct" reference implementation, then use `forAll` to verify the real engine matches it on ALL inputs.

**Your task:**
1. Read `tests/model-based.test.ts`. Understand what `referenceApplyDamage` does differently from the real engine.
2. Add a reference model for the `stun` effect:
   ```ts
   function referenceStunEffect(entity: EntitySnapshot, stun: boolean): EntitySnapshot {
     // stun: entity cannot act (canAct = false), but doesn't change HP or state
     // Write the obvious implementation here
   }
   ```
3. Write a `forAll` test: for any entity state + stun flag, reference and real engine agree on `canAct`.
4. Run `npm test` — does it pass? What does it PROVE about the real engine?

**Deliverable:** reference model function + property test.

> **Why interesting:** reference model in ~10 lines, written "obviously correct." If real engine diverges from it on ANY input — there's a bug. Rare technique: standard in financial systems, absent from QA courses.

---

### T-07 — False invariant: heal is not always beneficial

**File:** `tests/property.test.ts` → false invariant section

**Context:** Look at the existing `it.fails()` tests. Understand what they document.

**Your task:**
1. Find a NEW false invariant in the system — something that seems true but isn't.
2. Write it as an `it.fails()` test.
3. Explain: what assumption does it document? When does it break?

**Hint:** Think about Berserker passive at full HP vs low HP. Or Chaos Bolt with 1 enemy vs 2.

**Deliverable:** new `it.fails()` test + written explanation.

---

### T-08 — Metamorphic: Berserker damage is monotonic

**File:** `src/engine/heroes/berserker.ts`, `tests/property.test.ts`

**Task:**
Write a metamorphic property test:

> For any two HP values `lowHp ≤ highHp`, `rageDamage(lowHp, base) ≥ rageDamage(highHp, base)`

This tests a structural property (monotonicity) without needing a known expected value.

**Deliverable:** property test using `fc.integer().chain(...)`.

---

## Module A-7 — Combinatorial Testing

*48 test cases. Pairwise reduces it to 16 without losing coverage.*

---

### T-10a — Pairwise: reduce a combinatorial explosion

**File:** `tests/pairwise.test.ts`

**Context:** The project has `4 heroes × 4 encounters × 3 fault configs = 48 combinations`. Read `tests/pairwise.test.ts` to see how pairwise reduces this.

**Your task:**
1. Run the pairwise tests: `npx vitest run tests/pairwise.test.ts`. Note how many tests vs exhaustive.
2. Add a 4th parameter: `seed_range: ['low', 'mid', 'high']` (seeds 0–10, 11–100, 101–999). Update `allpairs()` call.
3. How many pairwise tests now vs exhaustive?
4. Write a "coverage proof" test: every (hero, fault) pair appears at least once.

**Deliverable:** updated pairwise test + written ratio + coverage proof.

> **Why interesting:** 4 parameters = 192 exhaustive → ~16 pairwise (92% reduction). This scales: insurance systems with 8 parameters × 4 values = 65,536 → ~32 pairwise.

---

## Module A-8 — BDD & Visual

*Rules as specification. Screenshots as baseline.*

---

### T-10b — BDD: write a scenario for a new rule

**File:** `tests/bdd/features/combat.feature`, `tests/bdd/steps/combat.steps.ts`

**Context:** Look at the existing BDD scenarios. All of them test rules without a browser, without HTTP.

**Your task:**
1. Write a new Cucumber scenario for **one rule** from `INVARIANTS.md` that has no BDD scenario yet.
   Good candidates: "Bleed tick can trigger death_door", "Berserker rage at exactly 25% HP"
2. Implement the step definitions using the executor.
3. Run `npm run test:bdd` — scenario passes.

**Deliverable:** new `.feature` scenario + step definitions.

> **Why interesting:** BDD on a rule engine — no browser, no HTTP, no database. The step definitions call `createGame()` + `game.endTurn()`. This is BDD as executable specification, not BDD as UI automation.

---

## Module A-5 — Mutation Testing

*A green test suite that misses half the bugs is not a safety net.*

---

### T-09 — Kill a surviving mutant

**Setup:** `npm run test:mutation` (takes ~4 minutes)

**Task:**
1. Look at the mutation report. Find a surviving mutant in `src/engine/statuses.ts`.
2. Understand WHY it survived — what assumption in your tests allowed it to?
3. Write a targeted test that kills it.
4. Verify: `npm run test:mutation` — survivor count should decrease.

**Deliverable:** new test with comment `// Kill: [mutant description]`.

---

### T-10 — Semantic mutations: predict before Stryker

**Setup:** `AI_MOCK_RESPONSE=true npm run semantic-mutations src/engine/statuses.ts tickStatuses`

**Task:**
1. Run the semantic mutations script. Read the 3 mutations.
2. For each: does an existing test catch it? If not — write one.
3. Run `npm run test:mutation` — did your new tests kill any Stryker survivors?

**Deliverable:** analysis + new tests + comparison with Stryker output.

---

## Module A-6 — Determinism & Replay

*Any failing run can be reproduced from a single number.*

---

### T-11 — Replay a failing seed

**Setup:** `npm run replay 42` → `open debugger/index.html`

**Task:**
1. Load `artifacts/replay-seed-42.json` in the debugger.
2. Navigate to segment 3. What happened to the hero's HP?
3. Find the event where the Werewolf transformed (if it happened). What turn?
4. Export the JSON and verify `snapshots[0].hashValid === true`.

**Deliverable:** written answers to the 3 questions above.

---

### T-12 — Tamper the log, catch the divergence

**File:** `tests/replay/replay.test.ts`

**Task:**
1. Take any replay log from `artifacts/`.
2. Tamper `events[1].postStateHash` with `'000000'`.
3. Verify `replayGame(tamperedLog).success === false` and `.divergedAt` points to event 1.
4. Write this as a test if it doesn't exist yet.

**Deliverable:** passing test that verifies divergence detection.

---

## Module A-9 — AI-Powered Testing

*AI accelerates QA. It does not replace it.*

---

### T-13 — LLM Oracle: add and break a rule

**Setup:** `AI_MOCK_RESPONSE=true npm run oracle 42`

**Task:**
1. Run the oracle dry-run. Understand the verdict format.
2. Add rule R8 to `scripts/llm-oracle.ts`:
   `"Berserker in Rage Mode (HP ≤ 25%) must deal more damage than out of Rage"`
3. Run on a seed where Berserker is in Rage. Does R8 evaluate correctly?
4. Intentionally write R8 ambiguously (remove "must deal MORE"). Does the oracle still work?

**Deliverable:** modified oracle script + written analysis of how rule quality affects verdict quality.

---

### T-14 — Spec to test: English → fast-check

**Setup:** `AI_MOCK_RESPONSE=true npm run spec-to-test "Dead entity cannot act or change state"`

**Task:**
1. Run spec-to-test on the rule above.
2. Review the generated test. What's correct? What needs fixing?
3. Fix the generated test so it actually tests the rule.
4. Run `npm test` — does it pass? Does it kill any Stryker mutants?

**Deliverable:** corrected test + list of what you changed and why.

---

### T-15 — Meta-oracle: test the AI judge

**Setup:** `AI_MOCK_RESPONSE=true npm run meta-oracle`

**Task:**
1. Run meta-oracle. Note the accuracy score.
2. Add 2 new test cases to `scripts/meta-oracle.ts`:
   - C5: Berserker hp=7/28 (rage active) — VALID
   - I5: Paladin chargeStacks=5 — INVALID (cap is 3)
3. Run with real API if available. Does the oracle get both right?

**Deliverable:** modified meta-oracle script + observation about when the oracle fails.

---

## Module A-10 — Capstone

*The boss fight IS the test suite.*

---

### T-16 — Phase 4: prove the system catches corruption

**File:** `tests/boss/archivist.test.ts`, `src/engine/boss/archivist.ts`

**Task:**
1. Read Phase 4 in the archivist code. What invariant does it violate?
2. Run the Phase 4 property test: `npx vitest run tests/boss/archivist.test.ts`
3. The test uses `forAll(seeds) → invariant_breach → TIMELINE CORRUPTED`. Explain in writing: why is this a property test and not a unit test?

**Deliverable:** written explanation (max 5 sentences).

---

### T-17 🏆 — Full run: find all 5 bugs in buggy branch

> Final capstone task. Use EVERYTHING you learned.
>
> Allowed: `npm test`, `npm run simulate`, `npm run chaos`, `npm run trace`, writing tests.
> NOT allowed: reading the spoiler section of `docs/BUGGY-BRANCH.md`.

**Setup:** Apply the 5 bugs listed in `docs/BUGGY-BRANCH.md`.

**Your task:**
Find all 5. For each: file + root cause + technique that found it + test that catches it.

**What counts as a full answer for one bug:** the symptom described, the root cause identified
(not just the symptom), a specific test that catches it, and the technique named with a reason
why it fits this class of bug.

**Deliverable:** `BUGS-FOUND.md` with 5 entries.
