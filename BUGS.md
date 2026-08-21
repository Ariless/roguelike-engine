# Bug Cemetery

Every real bug found during implementation. Seed · root cause · how found · fix.

---

## BUG-01 — Charge order: stun on the hero was never cleared

**Date:** 2026-05-30  
**Found by:** manual playtesting (game UI)  
**Symptom:** Once the Guardian stunned the hero, the hero stayed stunned forever — cards unavailable, no way out of that state.

**Root cause:** `tickStatuses()` only handled `bleed`. Stun on the hero was never removed: there was no code to clear it once the turn had passed.

**Fix:** An explicit check at the start of `endTurn()`, before the status ticks:
```js
if (hasStatus(gs.hero, 'stun')) {
  removeStatus(gs.hero, 'stun')
  addLog(gs, '⚡ Stun cleared')
}
```
Stun clears when the hero ends a turn while stunned — they skipped their actions, and that is what stun does.

**Invariant that would have caught this earlier:**  
`forAll(seeds, s => stunSkipsExactlyOneTurn(simulate(s)))` — to be added to the property tests.

**Testing value:** Shows the difference between "stun = you cannot act" and "stun = a flag that never resets itself". A textbook "state never cleared" bug — the same class shows up in payment processing, workflow engines, anywhere with explicit state flags.

---

## BUG-02 — Charge + vulnerable: side effects in the wrong order

**Date:** 2026-05-24 (found while writing the Paladin tests)  
**Found by:** unit test `with 3 charges + vulnerable: charges → 1`  
**Symptom:** With charges = 3 against a vulnerable target, the expectation after the attack was charges = 1 (reset to 0, then +1 from vulnerable). The result was 0.

**Root cause:** The order of operations in `playRighteousStrike`:
1. Reset charges (step 4) — charges = 0
2. +1 charge from vulnerable (step 5) — should be 1

But step 5 read `s.hero.chargeStacks`, which was already 0 after the reset. The code did not use the result of step 4 correctly — it read from the wrong state object.

**Fix:** Step 5 reads from the already-updated `s` (after the reset) rather than from the original state.

**Testing value:** Illustrates why the ordering of pipeline steps matters. Mutation testing target: swap the order of steps 4 and 5 → the test fails.

---

## BUG-03 — TypeScript narrowing: `'dead'` could not be assigned to `newState`

**Date:** 2026-05-30  
**Found by:** `npx tsc --noEmit` while adding the Blood Mage  
**Symptom:** Compile error: `Type '"dead"' is not assignable to type '"alive" | "death_door"'` on the line assigning `newState = 'dead'` inside `applyDamage`.

**Root cause:** TypeScript control-flow narrowing. `applyDamage` opens with a guard:
```ts
if (!target || target.state === 'dead') return state
```
After that check, TS knows `target.state` is `'alive' | 'death_door'` (not `'dead'`).
The line `let newState = target.state` is initialised from the already-narrowed type, so TS infers the variable as `'alive' | 'death_door'` rather than `EntityState`. The later assignment of `'dead'` does not compile.

**Fix:** An explicit annotation widens the type back to the full union:
```ts
let newState: EntityState = target.state
```

**Invariant that would have caught this earlier:**  
CI running `tsc --noEmit` on every push — had there been a git repo at the time. Type-checking is currently run by hand.

**Testing value:** A classic TypeScript gotcha — inference that is "too clever". When a guard narrows the type of an argument, variables initialised from it inherit the narrowed type. The rule: always annotate state-machine variables explicitly instead of relying on inference.

---

## BUG-04 — An enemy at death_door acted before dying

**Date:** 2026-05-30  
**Found by:** playtesting (game UI) — screenshot: both hero and enemy at 0 HP, hero stunned, the enemy attacked the hero and won

**Symptom:** The enemy went to death_door (HP = 0) after the hero's turn. On End Turn the enemy still managed to execute its intent (an attack) BEFORE death was resolved, killing the hero, who was also at Death's Door. It took an extra End Turn for the enemy to die.

**Root cause:** `endTurn()` did not check the enemy's state before calling `executeEnemyIntent`. An enemy in state `death_door` passed the condition `gs.enemy.state !== 'dead'` and was allowed to act. Death resolution for the enemy only happened through the bleed tick — with no bleed the enemy stayed "stuck" at death_door until the hero's next turn.

**Fix (attempt 1 — incomplete):** A check added at the start of `endTurn()`:
```js
if (gs.enemy.state === 'death_door') { gs.enemy.state = 'dead'; checkWin(gs); ... }
```
This closed the End Turn path but not the card-play path — the enemy still lingered at death_door in the middle of the hero's turn (0 HP, and hittable for nothing).

**Fix (attempt 2 — complete):** In `dealDamage()`, immediately after `applyDamageToEntity`:
```js
if (target === 'enemy' && entity.state === 'death_door') {
  entity.state = 'dead'
}
```
An enemy dies the moment it reaches 0 HP during card play. The hero still stays at death_door and can be healed. The `endTurn` check is kept as a safety net for death_door reached via a bleed tick.

**Invariant that would have caught this earlier:**  
`forAll(seeds, s => enemyNeverInDeathDoorAfterCardPlay(simulate(s)))` — after any action, no enemy should be in state `death_door`.

**Testing value:** A classic state-machine race condition plus an incomplete fix. The first fix closed one of the two paths to reproduction, the second closed it at the level of the rule. It shows that a fix "in one place" does not cover every path to the bug — the closure has to happen at the invariant ("an enemy cannot be at death_door"), not at one particular caller.

---

## BUG-05 — The Berserker never transformed: `heroClass` was missing from the game state

**Date:** 2026-05-30  
**Found by:** playtesting — the berserker did not change form at HP ≤ 50%

**Symptom:** Picking the Berserker in the UI and dropping HP to 14 or below did not trigger the transformation. The portrait did not change, the hand stayed on human cards, the WOLF badge never appeared.

**Root cause:** `HERO_DEFS.berserker` had no `heroClass` field. Building the game state via `{ ...HERO_DEFS[forcedHero], ... }` therefore never put it into `gs.hero`. `checkBerserkerTransformGame()` opens with `if (gs.hero.heroClass !== 'berserker') return` — the condition `undefined !== 'berserker'` is `true`, so the function returned immediately. The same problem meant the rage pips and the form badge were never rendered (`renderHero` also checks `h.heroClass`).

**Fix:** `heroClass` added to all three `HERO_DEFS` entries:
```js
bloodmage: { heroClass: 'bloodmage', ... }
paladin:   { heroClass: 'paladin',   ... }
berserker: { heroClass: 'berserker', ... }
```

**Invariant that would have caught this earlier:**  
`assert(gs.hero.heroClass !== undefined)` inside `assertValidGameState()` — required hero fields should be validated at initialisation.

**Testing value:** A classic silent failure — the function returns without an error, nothing simply happens. A missing config field throws no exception, it just changes the logic. It shows the value of schema validation at system boundaries (createGameState is the boundary between config and runtime).

---

## BUG-06 — Property test generator: the boundary value 25% landed in the "above 25%" zone

**Date:** 2026-05-30  
**Found by:** fast-check — shrunk to the counterexample `[{hp:0, maxHp:4}, base=2]`

**Symptom:** The test "HP > 25% → rage inactive, base damage" failed. Expected `rageDamage = 2`, got `3` (the ×1.5 bonus).

**Root cause:** The HP generator used `Math.max(Math.floor(maxHp * 0.26), 1)` to produce a value "guaranteed above 25%". At `maxHp=4`: `Math.floor(4 * 0.26) = Math.floor(1.04) = 1`. But the rage threshold is `Math.floor(4 * 0.25) = Math.floor(1.0) = 1`. Result: `hp=1, threshold=1` → rage active, while the test believed it was testing "HP above the threshold".

The problem was in the test itself, not in `isInRage` — that function worked correctly.

**Fix:** The generator was changed to `Math.floor(maxHp * 0.25) + 1` — guaranteed above the threshold regardless of rounding:
```ts
fc.integer({ min: Math.floor(maxHp * 0.25) + 1, max: maxHp }).map(hp => ({ hp, maxHp }))
```

**How it was found:** fast-check shrank it to a minimal counterexample in 10 steps: `maxHp=4, hp=1, base=2`. Without shrinking the bug would have stayed invisible across most values.

**Invariant that would have caught this earlier:**  
The comment "hp > 25%" in the test — but verified, i.e. checking that the generator really produces values ABOVE the threshold rather than EQUAL to it.

**Testing value:** A classic off-by-one in a boundary generator. Boundary values in property tests are their own failure point. It shows that fast-check shrinking finds bugs not only in the SUT but in the tests themselves.

---

## BUG-07 — The form badge showed for the Berserker instead of the Werewolf after the split

**Date:** 2026-05-30  
**Found by:** playtesting after splitting Berserker and Werewolf

**Symptom:** After the heroes were split, the form badge (HUMAN / 🐺 WOLF) stopped appearing for the Werewolf. Form switching worked correctly, but the badge on the portrait was invisible.

**Root cause:** `renderHero` checked `h.heroClass === 'berserker'` to show the form badge. After the split the Werewolf has `heroClass: 'werewolf'`, so the condition never fired.

**Fix:** The condition was changed:
```js
if (h.heroClass === 'berserker') → if (h.heroClass === 'werewolf')
```

**Invariant:** Schema validation on a split — renaming `heroClass` requires a grep across the whole codebase.

**Testing value:** After a refactor (rename or split), hardcoded strings stay behind and never get updated. It shows the value of searching every occurrence of a string when types are renamed.

---

## BUG-08 — HERO_DEFS.werewolf.hand still held the old berserker cards

**Date:** 2026-05-30  
**Found by:** code review while adding the Werewolf to the game UI

**Symptom:** Choosing the Werewolf at the start of a battle gave a hand of Savage Lunge / Primal Fury / Primal Dodge (Berserker cards) instead of Lunar Strike / Pack Sense / Stalk.

**Root cause:** When HERO_DEFS.werewolf was created, the `hand` field (the opening hand at game start) was copied from the old HERO_DEFS.berserker and never updated:
```js
hand: ['savage_lunge', 'primal_fury', 'primal_dodge'],  // ← the old cards
```
`humanHand` was correct (`['lunar_strike', 'pack_sense', 'stalk']`), but `hand` — the one used by `makeGameState` — was not.

**Fix:** `hand: ['lunar_strike', 'pack_sense', 'stalk']`, brought in sync with `humanHand`.

**Invariant:** `hand === humanHand` at game start for every hero with a transformation.

**Testing value:** Two fields (`hand` and `humanHand`) duplicate the same information, which makes them a desynchronisation point. The pattern appears anywhere there is an "initial value" plus a "current value" — they drift apart the moment the config is copied.

---

## BUG-09 — The cancel hint inside a flex container shifted the enemy panels on card selection

**Date:** 2026-05-30  
**Found by:** playtesting — selecting a card shifted both enemy panels to the right

**Symptom:** When the player selected a card, the label "ESC — CANCEL" appeared. It sat inside the `.battle-area` flex container as the third element after `#heroPanel` and `#enemiesArea`. At `display: block` it took up space in the flex row and pushed the enemies left, leaving an empty gap on the right.

**Root cause:** `<div id="cancelHint">` was a child of `.battle-area` (a flex container). With `position: static` (the default) the element takes part in flex layout, so it claims width as soon as it appears.

**Fix:** `position: absolute` plus `bottom: 4px; left: 50%; transform: translateX(-50%)` — the element is taken out of the flex flow and drawn over the content. `.battle-area` was given `position: relative` as the anchor.

**Invariant:** UI elements that appear and disappear must not affect the layout of their neighbours. Use `visibility: hidden` or `position: absolute` rather than `display: none/block` when the element sits inside flex or grid.

**Testing value:** A classic layout-shift bug — an element that changes the layout by appearing. It shows up in toast notifications, tooltips and error messages. The remedy is always the same: take it out of the document flow with absolute or fixed positioning.

---

## BUG-10 — The flash animation on the attacking enemy's portrait was wiped by render()

**Date:** 2026-05-30  
**Found by:** playtesting — the visual flash on an enemy attack was never visible

**Symptom:** `flashAttacker(enemyId)` added the CSS class `attacking-now` to the portrait frame during `endTurn()`. The animation never played.

**Root cause:** `endTurn()` runs synchronously: `flashAttacker()` → … → `render()`. Inside `renderEnemies()` the line `frame.className = 'portrait-frame enemy-frame'` reset every class, `attacking-now` included, and the browser never got to paint the animation before the reset.

**Fix:** `setTimeout(() => flashAttacker(_eid), 50)` — the flash starts 50ms after the synchronous `render()` has finished, once the browser has painted the new frame.

**Invariant:** CSS animations added before `render()` are wiped by the next render call. Animations that follow a render have to be scheduled through setTimeout.

**Testing value:** A race between JavaScript DOM mutation and the CSS animation pipeline. The browser guarantees no paint between synchronous operations — `setTimeout(fn, 0)` or `requestAnimationFrame` is what "next frame" actually requires. The pattern shows up in toasts, flash messages and transition triggers.

---

## BUG-11 — turn_end was not recorded on an early return from endTurn

**Date:** 2026-05-30  
**Found by:** the replay test "replays a full game until hero loses" — `result.finalState.winner` was null instead of 'enemies'

**Symptom:** When the hero lost (the enemy killing them during endTurn), the replay did not reproduce the final turn. `result.finalState.isOver` was false after the replay, although the original run ended in a loss.

**Root cause:** `record('turn_end', ...)` sat at the end of `endTurn()`, after every early return (`if (state.isOver) return state`). When the hero died at the enemy_action step, the function returned early and no `turn_end` event was recorded. The replayer iterates the log and calls `endTurn()` only when it sees a `turn_end` event. Without one, the final turn was never replayed.

**Fix:** `record('turn_end', ...)` was added to every early return from endTurn — before each `return state` under `isOver`.

**Invariant:** Every call to `endTurn()` must produce exactly one `turn_end` event in the log, whichever path execution takes.

**Testing value:** A classic happy-path-only bug — the code recorded events correctly on a normal completion and skipped them on early returns. It shows the value of testing terminal states (game over, timeout, error paths) alongside the happy path.

---

## BUG-12 — recordSnapshot missing from one of endTurn's early returns

**Date:** 2026-05-30  
**Found by:** a fast-check property test — counterexample `[12245, 'paladin', 'guardian']`

**Symptom:** The test `snapshots.length === turn_end events` failed: 20 snapshots against 21 turn_end events. One turn was in the log (turn_end recorded) with no snapshot in `log.snapshots`.

**Root cause:** executor.ts had 4 exit paths from `endTurn()` — three early returns plus the normal end. When `recordSnapshot` was added, three paths were updated and one was missed:

```ts
// enemy action kills hero — early return
if (state.isOver) {
  log.outcome = 'hero_loses'
  record('turn_end', turnEndPre, state)
  // ← recordSnapshot(state) WAS MISSING
  record('game_over', state, state)
  return state
}
```

The other three paths had `recordSnapshot`; only this one did not.

**Fix:** `recordSnapshot(state)` added between `record('turn_end', ...)` and `record('game_over', ...)`.

**How it was found:** fast-check generated 200 random (seed, heroClass, enemyType) combinations. At seed=12245 / paladin / guardian the invariant broke. Shrinking produced the minimal counterexample.

**Invariant:** Every call to `endTurn()` produces exactly one `turn_end` event AND exactly one snapshot, whichever path execution takes.

**Testing value:** A classic missed-path bug — the code was updated in 3 places out of 4. The fourth threw no error, it simply produced no snapshot. The property test found it within 200 runs where code review could have walked past it.

---

## BUG-13 — Monte Carlo scanned 4 configurations out of 16

**Date:** 2026-08-20  
**Found by:** reading `scripts/simulate.ts` before adding the balance corridors

**Symptom:** The per-class win rates looked implausibly smooth: paladin 99.8%, werewolf 100.0%. No run over 10,000 seeds showed a weak spot for any hero.

**Root cause:** Both coordinates of the configuration were derived from the same remainder:

```ts
const heroClass = HERO_CLASSES[seed % HERO_CLASSES.length]
const enemyType = ENEMY_TYPES[seed % ENEMY_TYPES.length]
```

The arrays are the same length (4), so `seed` was selecting not a pair but the diagonal of a 4×4 matrix. Paladin only ever met the Goblin, Bloodmage only the Guardian, Berserker only the Vampire, Werewolf only the Necromancer. The other 12 combinations were never exercised on any seed, however many runs were requested.

The report was not lying in the narrow sense: the paladin really does beat the goblin 99.8% of the time. The label was lying — the number was presented as a class win rate while it was the win rate of a single pair.

**Fix:** The second coordinate now comes from the high part of the seed — `scripts/lib/harness.ts`, `configFor()`:

```ts
heroClass: HERO_CLASSES[seed % HERO_CLASSES.length],
enemyType: ENEMY_TYPES[Math.floor(seed / HERO_CLASSES.length) % ENEMY_TYPES.length],
```

A full cycle over all 16 pairs, each getting 1/16 of the runs. The report gained a matchup matrix and the line `Configuration coverage: N/16 pairs scanned` — an unscanned pair now shows up as a dash rather than as a missing row.

**What the very first run after the fix showed:** paladin 70.5% instead of 99.8%, with a spread inside the class from 20.9% (against the Guardian) to 100.0% (against the Necromancer). The balance picture changed completely and three classes out of four fell outside the target corridor.

**The same mistake was found in two more places (2026-08-20).** `scripts/trace-analysis.ts:113-114` and `scripts/chaos-agent.ts:218-219` each held their own copy of the same two lines — every script kept its own auto-player, its own deck and its own generator. Which means every trace-derived invariant in `INVARIANTS.md` was derived from a sample of 4 configurations, and the chaos agent was hunting for "interesting timelines" in the same quarter of the space. After both scripts were moved onto `scripts/lib/harness.ts`, the very first `npm run trace 200` reported "terminates within 32 turns (observed max: 30)" instead of the previous 12 — direct confirmation.

**Invariant:** The number of configurations scanned equals the number that exist, or the report names the uncovered ones explicitly. The mapping from seed to configuration exists in exactly one place — `configFor()` in `lib/harness.ts`.

**Testing value:** The most expensive class of error in a simulation is not a wrong formula but a systematically biased sample. A wrong formula fails and asks to be investigated. A biased sample returns a plausible number that nobody re-checks, because it does not look suspicious. Here the bias also masked BUG-14: the necromancer only ever faced the werewolf, who wins everything anyway, so the necromancer being harmless read as the hero being strong.

---

## BUG-14 — Necromancer: Raise Dead and Empower do not exist in the engine ✅ CLOSED

**Date:** 2026-08-20  
**Found by:** the matchup matrix in `npm run simulate` after BUG-13 was fixed

**Symptom:** All four classes beat the necromancer in exactly 100.0% of battles. 4,000 runs, not a single win for the enemy.

**Root cause:** The necromancer's mechanic is not implemented in the engine. `src/runtime/executor.ts:41`:

```ts
necromancer: [{ type: 'bleed', value: 3 }, { type: 'bleed', value: 3 }, { type: 'bleed', value: 3 }],
```

Three identical bleeds. The necromancer deals no direct damage at all, and bleed is capped, so it cannot kill the hero under any draw.

The specification says something else, and it says it in three places:

| Source | What is declared |
|---|---|
| `DESIGN.md:301-308` | Turn 1 Wither → Turn 2 Raise Dead (spawn Skeleton) → Turn 3 Empower |
| `docs/DECISION-TABLES.md:71-93` | 4 decision-table rows plus three derived tests, including "raise with no dead ally → no entity spawned" |
| `DECISIONS.md:335` | "Necromancer won't raise if no corpse on field → graceful no-op" |

The engine has neither: `Intent` in `src/engine/types.ts:13-17` contains only `attack`, `bleed`, `defend`, `stun`. The words `skeleton`, `raise` and `empower` appear in `src/` exclusively inside comments (`actionResolution.ts:22,78`) that describe the mechanic as if it existed.

**And yet the mechanic is implemented — in the UI.** `game/index.html` carries its own `raise` and `empower` intents (lines 1604-1605), a skeleton definition (1608), corpse lookup with a `raisedOnce` flag and entity spawning (2141-2152), and the empower bonus applied to damage (2104-2107). So the combat rules exist in two independent implementations: the engine and a 2,863-line UI. Vitest checks the first, Playwright checks the second, and nothing compares them against each other.

Related: `game/index.html:2148` builds the skeleton id as `` `skeleton-${Date.now()}` ``. The same seed produces a different id, so determinism is already broken in the game layer, while the entire engine is built around the promise "same seed → byte-identical log".

**Status:** CLOSED 2026-08-21. See "Resolution" below.

**The project rule that makes this a bug:** `CLAUDE.md`, Rule priority — "If Decision Tables conflict with engine code, treat tables as **intended spec** — file a bug".

**Invariant (needed, currently absent):** An enemy's intent set in the engine matches its decision table in `docs/DECISION-TABLES.md`. A violation looks like an enemy that cannot perform a documented action.

**Testing value:** 386 tests, a mutation score around 79%, a full invariant contract — and not one of them caught that an entire enemy does not do what three documents say it does. Because all of them check that the implemented code behaves correctly, and none asks whether what was promised was implemented. A missing mechanic is invisible both to tests on existing code and to mutation testing: there is nothing to mutate, the code is not there.

**Closed by a check (2026-08-20):** `tests/decision-tables.test.ts` compares `ENEMY_INTENTS` against the decision tables. The gap is pinned in `KNOWN_GAPS` with the exact current behaviour, so the suite stays green while the gap can be neither silently widened (the check "the gap has not changed" fails) nor silently closed (the check "the gap still exists" fails, demanding the enemy be removed from the list).

**A side finding while writing that check.** The first version of the test described the specification in terms of the `Intent` type — and immediately lied: `raise` and `empower` do not exist in that type, so only the fallback branches (`bleed 3`) made it into the spec, and those do match the implementation. The test reported "compliance" in exactly the place where the gap was widest. A specification written in the vocabulary of the implementation cannot describe what the implementation lacks — the test now has its own `SpecAction` type, unrelated to `Intent`.

---

### Resolution (2026-08-21)

`Intent` gained `raise` and `empower`, `EnemyType` gained `skeleton`, and `Enemy` gained
`empowered` and `raisedOnce`. Skeleton ids are derived from the count of skeletons already
raised in the battle rather than from a clock, so determinism survives entity spawning —
the UI's `skeleton-${Date.now()}` was never an option here.

Two changes were needed beyond the mechanic itself.

**Intents became conditional.** The engine picked `intents[turn % length]`, a pure function
of the turn number that never saw the board. "Raise if an ally corpse is present" is not
expressible that way — which is why those rows were unimplementable rather than merely
unimplemented. `resolveIntent()` now resolves the conditional rows; enemies without them
fall straight through and behave exactly as before.

**Every living enemy acts, not only the first.** The turn loop ran `state.enemies[0]`, so a
raised skeleton would have stood still. It now iterates a snapshot of ids taken before the
loop starts, so a skeleton raised mid-step does not also attack on the turn it appeared.

**The finding that made the fix real.** The first regression run after implementing the
mechanic showed *no change whatsoever* — every number identical. The Necromancer raises the
corpses of allies, and `makeInitialState` had always built encounters of exactly one enemy.
With no ally there is never a corpse, so both conditional rows fell through to Wither
forever: the mechanic was correct, complete and unreachable. `game/index.html` had carried
a `goblin+necro` encounter since May (ENCOUNTER_DEFS:1676); the engine had no concept of an
escort at all. Adding it is what turned a correct implementation into a working one.

**Regression, 16,000 seeds before and after** (`artifacts/REGRESSION-BUG14.txt`):

| Class | Before | After | Verdict |
|---|---:|---:|---|
| paladin | 70.5% | 58.1% | PASS -> PASS |
| bloodmage | 94.1% | 72.8% | FAIL -> **PASS** |
| berserker | 95.3% | 81.1% | FAIL -> INCONCLUSIVE |
| werewolf | 99.2% | 97.8% | FAIL -> FAIL |

The Necromancer column went from `100% / 100% / 100% / 100%` to
`58.3% / 14.8% / 42.9% / 94.2%`. The Blood Mage now loses to him 85 times in 100 — from the
most harmless enemy in the game to the hardest matchup one class has. Pairs outside their
corridor fell from 10 to 6.

Two classes are back inside the corridor and a third is INCONCLUSIVE, which is the honest
verdict for an interval straddling a bound rather than a rounded-up pass. The balance gate
still cannot be switched on: the Werewolf remains outside at 97.8%, and that is a design
question, not a missing mechanic.

**Pinned by:** `tests/necromancer.test.ts` (12 tests — spawn, corpse consumption,
deterministic ids, empower consumed on the next attack whether or not it lands, replay
verification with entities spawning mid-battle) and `tests/decision-tables.test.ts`, where
the Necromancer left KNOWN_GAPS and the conditional rows are exercised in both directions.

**A test that did its job.** `executor.test.ts` carried a row asserting raise was a
permanent no-op, with the note "will fail when corpse system is added". It failed exactly
then. Pinning current behaviour with an explicit expiry note is what made the change
visible instead of silent.

**A test that did not.** The first version of `necromancer.test.ts` checked the mechanic by
watching the hero's HP over 30 idle turns. It passed — and would have passed on the old
engine too, since bleed alone wears down a passive hero. A test that cannot fail for the
reason its name claims, written in the file closing BUG-14, is the BUG-16 pattern
reproduced by hand. Replaced with a direct check: a skeleton's attack removes exactly 4 HP,
7 when empowered, and the bonus is spent.

---

## BUG-15 — the seed is silently truncated to 32 bits, and the test never noticed

**Date:** 2026-08-20  
**Found by:** the statistical battery in `tests/rng-statistical.test.ts`

**Symptom:** `createRng(7)` and `createRng(7 + 2³²)` produce an identical sequence. `createRng(Number.MAX_SAFE_INTEGER)` is equivalent to `createRng(4294967295)`.

**Root cause:** `src/runtime/rng.ts:7` — `let s = seed >>> 0`. Everything above 2³² is discarded. That is unavoidable for a 32-bit generator in itself; the defect is that the discarding is silent, and nothing in the contract states that there are exactly 2³² distinguishable seeds.

**Why it was not caught earlier:** a test for this case existed and passed — `tests/rng.test.ts:30`:

```ts
it('seed MAX_SAFE_INTEGER works', () => {
  expect(() => createRng(Number.MAX_SAFE_INTEGER)()).not.toThrow()
})
```

It checks that no exception is thrown. Truncation throws no exception, so the test is green — and that is precisely why the seed boundary looked verified. The test is not false; it checks a weaker property than its name implies.

**Fix:** the behaviour is pinned by two tests in `tests/rng-statistical.test.ts`, section "seed space": the equivalence of `seed` and `seed + 2³²`, and the ceiling of 2³² distinguishable runs. Changing the generator now breaks a test explicitly.

**A related finding — a seed does not select an independent stream.** mulberry32 advances its state by adding the constant `0x6D2B79F5`, so a seed chooses an entry point into one shared stream of length 2³². Two seeds differing by exactly that constant produce the same sequence offset by one step — verified, the match is exact. For `simulate.ts` with `seed = 0…N` this is safe: the distance between entry points is enormous. It becomes dangerous the moment seeds start coming from a clock, a hash, or a counter with a stride: two "independent" runs turn out to be one, the statistics count a single result twice, and the confidence interval gets narrower the more the streams overlap. Pinned as `it.fails('different seeds give independent streams')` and taken into account in `scripts/stability.ts` when choosing the stride between base seeds.

**Invariant:** There are exactly 2³² distinguishable seeds; streams spaced at a multiple of `0x6D2B79F5` overlap.

**Testing value:** A test that checks "does not throw" where its name promises to check a value is worse than a missing test — a missing test is visible, while this one fills in a line in the coverage report and creates the impression of a verified boundary.

---

## BUG-16 — the UI test for the skeleton appearing does not check that a skeleton appears ✅ CLOSED

**Date:** 2026-08-20  
**Found by:** investigating BUG-14 — looking for why a mechanic with no engine implementation was covered by green tests

**Symptom:** `tests/ui/game.test.ts:25` is named "after goblin dies and necromancer raises, skeleton appears as 3rd panel". The assertion on line 51:

```ts
const panels = page.locator('[id^="enemy-panel-"]')
const count = await panels.count()
// If goblin is dead and necromancer raised it, we should have 3 panels total
expect(count).toBeGreaterThanOrEqual(2)
```

The comment talks about three panels, the assertion demands "at least two". There are two panels to begin with, so the test passes even if the goblin never died, no skeleton appeared and raise never fired.

Next to it, line 64: `logText?.includes('Skeleton') || logText?.includes('attempts to raise')` — a disjunction covering both outcomes at once, so any log will do as well.

**Status:** CLOSED 2026-08-21, together with BUG-14.

**Resolution.** The assertion now names what the test name promises:
`expect(skeletonPanel).toHaveCount(1)` instead of `toBeGreaterThanOrEqual(2)`, and the log
check asserts the raise attempt instead of a disjunction that any log satisfied.

**What tightening it exposed.** The corrected assertion failed — and not because the UI was
broken. The old scenario played Blood Mage and spammed Chaos Bolt, which picks targets at
random; it finished both enemies before the necromancer ever reached the raise row of his
cycle. So the test had two independent defects layered on top of each other: an assertion
that could not fail, and a scenario that never produced the state the assertion was meant to
check. The weak assertion hid the broken scenario, because nothing ever went red.

The scenario now plays Paladin, strikes the goblin deliberately by clicking its panel, leaves
the necromancer alive, and then ends turns until raise comes around. On that board the
skeleton appears, and the UI mechanic — which has existed since May — is verified for the
first time.

**Invariant:** The assertion checks what the test name promises. "A third panel appears" is `toHaveCount(3)`, not `toBeGreaterThanOrEqual(2)`.

**Testing value:** The pair BUG-14 + BUG-16 shows how an unimplemented mechanic ends up with green coverage: the engine does not have it, the UI has its own copy, and the UI test is written loosely enough to pass on any outcome. Each layer taken separately looks verified.

---

## BUG-17 — the aggregation died at a million runs and worked at sixteen thousand

**Date:** 2026-08-20  
**Found by:** the first 1,000,000-seed run of `npm run simulate`

**Symptom:** The simulation completed its million timelines, printed the stability
report and the win rates, reached the return-metrics table and threw:

```
scripts/lib/economy.ts:156
  const maxWin = Math.max(...nonEmpty.map(e => e.maxWin))
                      ^
RangeError: Maximum call stack size exceeded
```

**Root cause:** `Math.max(...xs)` passes every array element as a separate function
argument. Past roughly 10⁵ arguments that exceeds the call-stack limit and throws.
At 16,000 runs each class holds about 4,000 economies and the spread is harmless;
at 1,000,000 it holds 250,000 and the call is impossible.

**Fix:** `maxOf` / `minOf` in `scripts/lib/stats.ts`, a plain loop over the array,
and every call site that scales with the number of runs moved onto them:
`economy.ts` (two), `simulate.ts` (two), `trace-analysis.ts`, `stability.ts`.

**Why it is worth recording.** The failure profile is the bad one: correct at every
scale anybody tests interactively, fatal at the scale the work is actually for. It
cannot be caught by a unit test written from the same intuition that wrote the code,
because the intuition is not about correctness — the arithmetic was right. It is
about a limit nobody thinks in.

Two properties made it survivable rather than embarrassing: the crash was loud, and
it happened after the determinism check rather than before it, so the million-seed
verdict on timeline stability was already printed and valid. Had `maxOf` silently
returned a wrong number instead of throwing, the report would have carried a plausible
max win and nobody would have re-derived it — the BUG-13 pattern again.

**Pinned by:** `tests/economy.test.ts` — aggregation over 300,000 runs and a single
run of 200,000 turns. The sizes are chosen above the stack limit, so the test fails
if anyone reintroduces a spread.

---

## BUG-18 — three of the four fault-injection flags injected nothing ⚠️ PARTIALLY OPEN

**Date:** 2026-08-21  
**Found by:** writing the first tests for `faults.ts` after MUTATION-02 put it at 26%

**Symptom:** `FaultConfig` declares four flags. Only one of them changed behaviour.

| Flag | State when found |
|---|---|
| `bleedOffByOne` | works |
| `ignoreDeathDoor` | read, but bypassed on every turn — **fixed** |
| `ignoreStun` | read, but the condition it guards is unreachable — open |
| `allowDeadToAct` | declared and documented, never read by any code — open |

**Root cause, `ignoreDeathDoor`.** `executor.ts` has four win checks. Three passed the
fault config through; the fourth, the status tick on the enemy, called `checkWin(state)`
with no faults at all. Since that check runs every turn, it converted `death_door → dead`
regardless of the flag, and the injection was undone as fast as it was applied. Fixed by
passing `faults` through. Exactly the shape of BUG-12: the code was updated in three of
four places, and the fourth threw no error — it just quietly did the default thing.

**Remaining limitation, `ignoreDeathDoor`.** Now that it works, it reaches only deaths
resolved in the executor — a status tick, for instance. A death from a second hit is
resolved by `applyDamage` inside `engine/`, which by design takes no `FaultConfig`. The
flag's own comment says "no kill on second hit", which is more than it can deliver at this
architecture. Pinned by a test rather than fixed: making `engine/` fault-aware would
trade a documentation defect for an architectural one.

**Root cause, `ignoreStun`.** The guard `!isStunned || faults.ignoreStun` is real code on
a real path, but no hero card applies stun to an enemy — the only source of stun in the
game is the Guardian, and it stuns the hero. So `isStunned` is never true for an enemy and
the flag cannot change anything. The mechanic is not missing; the situation it applies to
cannot arise.

**Root cause, `allowDeadToAct`.** No code reads it. It is declared in the interface and
documented as "dead entities can still execute intents (triggers TIMELINE CORRUPTED)".

**Why this is the worst place for it.** This module is the instrument that proves the test
suite notices a planted defect. A flag that injects nothing does not fail — it produces a
run identical to the clean one, and any test built on it passes for the wrong reason. The
project already has a name for that shape: BUG-16, an assertion that could not fail. Here
the same shape sat inside the tool used to validate other tests.

It is also the answer to why `faults.ts` scored 26%. Two of the four flags had no
behaviour to cover, so there was nothing for a test to assert and nothing for a mutant to
break.

**Pinned by:** `tests/runtime/faults.test.ts` — 22 tests. The working flags are checked
for exact effect and for byte-identical behaviour when disabled; the two broken ones are
pinned in tests that fail the moment either starts working, which is the signal to close
this entry.

---

## MUTATION-02 — Widening the scope: faults.ts turned out to be almost untested (2026-08-20)

**Date:** 2026-08-20  
**Tool:** Stryker v9.6, 13 files instead of 6, a 38-minute run  
**Result:** **86.10%** (971 killed, 311 timed out, 175 survived, 32 with no coverage)

The previous "~79%" applied to six files: `resolution`, `statuses` and the four heroes. Neither pipeline file was mutated, nor `invariants.ts`, nor any of `runtime/` (including `rng.ts` and `executor.ts` — 34 tests whose quality nobody had measured), nor `telemetry/`. The figure was not inflated, it was incomplete: it described part of the system and said nothing about the rest.

| File | Score | Note |
|------|-------|------|
| `resolution.ts` | 100.00% | |
| `turnPipeline.ts` | 100.00% | added to the scope |
| `actionResolution.ts` | 97.56% | added |
| `statuses.ts` | 96.55% | |
| `berserker.ts` | 95.89% | |
| `rng.ts` | 95.65% | added |
| `replayer.ts` | 92.00% | added |
| `bloodmage.ts` | 89.87% | |
| `executor.ts` | 85.07% | added, the largest file |
| `paladin.ts` | 84.85% | |
| `invariants.ts` | 79.66% | added |
| `werewolf.ts` | 79.53% | |
| **`faults.ts`** | **26.00%** | added — 37 survivors out of 50 |

**The main finding — `faults.ts` at 26%.**

The module exists to deliberately corrupt the engine's behaviour (`bleedOffByOne` and similar) and check whether the tests notice. It is an instrument for controlling the quality of the tests. And it is the worst-covered code in the project: 37 mutants out of 50 survive.

In practice that means the defect-injection mechanism can break with no test noticing. Fault injection would then silently inject nothing, the property tests would keep passing, and "we verified that the tests catch a planted bug" would become a claim with nothing behind it. The failure is silent by its nature: a broken injector looks exactly like a working one running against healthy code.

**Status:** OPEN. What is needed are tests on the injector itself: with `bleedOffByOne: true` the behaviour must differ from a clean run by a specific amount, and with `false` it must match byte for byte.

**Threshold set:** `thresholds.break = 85` in `stryker.config.json`. It used to be `0` — the score was computed and printed but blocked nothing. The `mutation` job in CI now fails the build when it drops below.

**Testing value:** The scope of a mutation run is itself an unaudited place. A score of 79% sounds equally convincing whether it was computed across the whole system or across half of it, and in the config it is one line nobody re-reads. Widening the scope raised the figure to 86.10%, but the value is not in the figure — it is in the module the entire report had been silent about.

---

## MUTATION-01 — Results of the first Stryker run (2026-05-30)

**Date:** 2026-05-30  
**Tool:** Stryker v9.6 + vitest runner  
**Mutated files:** resolution.ts, statuses.ts, heroes/*.ts

### Final scores (after three rounds of targeted tests)

| File | Round 1 | Final | Killed deliberately |
|------|---------|-------|--------------------|
| resolution.ts | 92.4% | 92.4% | — (good from the start) |
| statuses.ts | 91.7% | ~94% | hasStatus always-true, duration filter, updateEntity |
| paladin.ts | 78.8% | **80.3%** | `?? 0` → `&& 0` boundary, undefined chargeStacks |
| berserker.ts | 68.5% | **69.9%** | Savage Lunge multi-enemy, rage 25% boundary |
| bloodmage.ts | 67.1% | 67.1% | StringLiteral survivors — not a priority |
| werewolf.ts | 67.3% | 67.3% | StringLiteral survivors — not a priority |
| **Overall** | **77.96%** | **~79%** | Above the typical range (65–75%) |

### What each result means

**resolution.ts 92%** — the applyDamage and applyHeal pipeline steps are protected. The 7 survivors are edge cases in boundary conditions (for example, damage exactly equal to HP at death_door). Not critical.

**statuses.ts 94%** — after negative tests were added. Three mutants killed explicitly: `hasStatus always-true`, `duration filter false`, `updateEntity always-update`. The remaining 9 are mutations in the stacking logic that need more precise numeric assertions.

**heroes/* 69%** — 117 survivors. The specific problem patterns:
- Conditional card effects (if X → then Y) are only tested positively
- Boundary values in the rage/charge/transform thresholds are not all covered
- AoE cards (rampage, reality_crack) — mutations in filter/iteration are not caught

**Overall 78%** — above the industry average (65–75%). Below 70% a test suite is unreliable as a safety net. At 78% core logic can be refactored with confidence, while hero-specific logic needs attention.

### Mutants killed deliberately

| Mutant | Location | How it was killed |
|--------|----------|-------------------|
| `hasStatus` always-true | statuses.ts:100 | Negative test: `expect(hasStatus(e, 'stun')).toBe(false)` when only bleed is present |
| Duration filter → false | statuses.ts:91 | Test: bleed without duration is not removed; duration:2 is not removed after 1 tick |
| updateEntity all enemies | statuses.ts:120 | Test: a status on e0 does not land on e1 when there are two enemies |

### Next targets (heroes 69% → 80%)

Killing the survivors in the hero files:
1. `berserker.ts` — rage threshold boundary (≤25% exact), isInRage(dead entity)
2. `bloodmage.ts` — open_the_wound pre/post bleed check, vulnerable not applied twice
3. `werewolf.ts` — wolfDamage formula (×2 at 0 HP exact), transform exactly at 50%
