# Buggy Branch — Fault Injection

A green suite proves nothing on its own: it may be catching real defects, or it may be asserting
things that cannot fail. This branch answers that question empirically. Five defects go into the
engine deliberately, each one chosen so that a *different* technique is the one that catches it —
if a technique in this project were decorative, its defect would survive.

The exercise doubles as practice: apply the defects, then try to find them without the spoiler
section below.

## Applying the defects

```bash
git checkout -b buggy-engine
# Apply the changes below, commit
```

## The defects (spoilers)

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
**Found by:** Unit test `with 3 charges + vulnerable: charges → 1`. Or property test `chargeStacks <= 3`.
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
**Found by:** `arp4_calculate — vulnerable multiplies damage by 1.5` unit test.
**Technique:** Exact-value assertion on specific damage calculation.

### Bug 5 — replay non-determinism (advanced)
**File:** `src/runtime/executor.ts`
**Change:** Add `Math.random()` somewhere in card dispatch (e.g. random energy bonus).
**Symptom:** `replayGame(log).success` fails intermittently.
**Found by:** `executor-property.test.ts` — `forAll(seeds) → replayGame(log).success`.
**Technique:** Property test + replay determinism.

## Finding them without the spoilers

The engine has 5 defects introduced deliberately. Find all 5.

**Allowed techniques:**
- Run `npm test` — see what fails
- Run `npm run simulate 1000` — check if winrates look wrong
- Run `npm run chaos 200` — find interesting/broken timelines
- Write new tests to isolate the bug
- Use `npm run oracle -- --dry-run` to check rule violations

**Off limits while hunting:**
- `BUGS.md` (it contains the answers for the real project bugs)
- The spoiler section above

**Deliverable:** For each bug — file, line, root cause, which test found it, which technique.

## What a complete answer looks like

Four things per defect, and the last two are where the value is:

- the symptom, described
- the root cause, not just the symptom
- a specific test that catches it, written or already in the suite
- the technique named, with a reason why it fits this class of bug
