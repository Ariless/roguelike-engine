# Buggy Branch — Course Exercise

This document describes how to create a buggy version of the engine for students.

## How to use

Students run the test suite against the buggy engine and find the bugs using the techniques learned in the course.

## Setup (instructor)

```bash
git checkout -b buggy-engine
# Apply the bugs below, commit, push to private repo
# Share only the buggy branch, not BUGS.md
```

## The bugs (DO NOT share with students)

### Bug 1 — bleed off-by-one (BUG-02 class)
**File:** `src/engine/statuses.ts`
**Change:** `entity.hp - bleed.stacks` → `entity.hp - (bleed.stacks - 1)`
**Symptom:** Bleed deals 1 less damage than expected. Hero survives longer than they should.
**Found by:** Property test `bleed tick damage never negative` OR unit test for specific stacks value.
**Technique:** Fast-check shrinks to minimal failing case.

### Bug 2 — charge stacks don't reset (BUG-02 class)
**File:** `src/engine/heroes/paladin.ts`
**Change:** Remove the `chargeStacks = 0` reset after double damage fires.
**Symptom:** Righteous Strike always deals double damage after first charge activation.
**Found by:** Unit test `при 3 зарядах + vulnerable: заряды → 1`. Or property test `chargeStacks <= 3`.
**Technique:** Specific unit test OR boundary value test.

### Bug 3 — death_door never clears (BUG-01 class)
**File:** `src/engine/turnPipeline.ts` or executor
**Change:** Remove stun clearance from endTurn. *(Variant: remove death_door → alive in applyHeal)*
**Symptom:** Hero stuck in stunned state forever OR stays at Death's Door after healing.
**Found by:** BDD scenario `Stun expires after the hero skips one turn` OR manual play.
**Technique:** BDD scenario, replay analysis.

### Bug 4 — wrong vulnerable multiplier (formula bug)
**File:** `src/engine/actionResolution.ts`
**Change:** `Math.floor(amount * 1.5)` → `Math.floor(amount * 1.3)`
**Symptom:** Vulnerable deals 30% more damage instead of 50%. Subtle — tests using exact values will catch it.
**Found by:** `arp4_calculate — damage vulnerable умножает урон на 1.5` unit test.
**Technique:** Exact-value assertion on specific damage calculation.

### Bug 5 — replay non-determinism (advanced)
**File:** `src/runtime/executor.ts`
**Change:** Add `Math.random()` somewhere in card dispatch (e.g. random energy bonus).
**Symptom:** `replayGame(log).success` fails intermittently.
**Found by:** `executor-property.test.ts` — `forAll(seeds) → replayGame(log).success`.
**Technique:** Property test + replay determinism.

## Student instructions (share this part)

The engine has 5 bugs introduced deliberately. Find all 5.

**Allowed techniques:**
- Run `npm test` — see what fails
- Run `npm run simulate 1000` — check if winrates look wrong
- Run `npm run chaos 200` — find interesting/broken timelines
- Write new tests to isolate the bug
- Use `npm run oracle -- --dry-run` to check rule violations

**Not allowed:**
- Reading `BUGS.md` (it contains the answers for the real project bugs)
- Reading this file

**Deliverable:** For each bug — file, line, root cause, which test found it, which technique.

## Grading rubric

| Points | Criterion |
|--------|-----------|
| 1 | Bug found (symptom described) |
| 2 | Root cause identified (not just symptom) |
| 3 | Specific test that catches it (written or existing) |
| 4 | Technique named and explained (why this technique for this bug) |
