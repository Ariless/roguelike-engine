# Invariant Contract

Every invariant the system must hold, where it applies, how a violation looks, and which test catches it.

> This is the "table of contents for correctness." If a test fails unexpectedly, find the invariant here first.
> 
> **Rule Coverage Matrix** — which layer covers which rule: see `docs/RULE-COVERAGE.md`

---

## HP invariants

| Invariant | Applies at | Violation looks like | Caught by | BUGS.md |
|-----------|-----------|---------------------|-----------|---------|
| `hp >= 0` always | After every action | Negative HP; entity keeps acting | `property.test.ts: HP invariants` | — |
| `hp <= maxHp` always | After every action | Overhealed entity has extra HP | `property.test.ts: HP invariants` | — |
| `hp = 0` → `state = death_door` | After applyDamage / status tick | Entity at 0 HP but `state = alive` — never dead in one hit | `resolution.test.ts` | BUG-04 (enemy death_door acting) |
| `hp = 0 + death_door` → `dead` on next hit | ARP step 4 | Entity survives two killing blows | `resolution.test.ts` | — |

---

## State machine invariants

| Invariant | Applies at | Violation looks like | Caught by |
|-----------|-----------|---------------------|-----------|
| `dead → alive` is impossible | Always | Resurrected entity | `invariants.test.ts: DEAD_ENTITY_STATE` |
| `dead → death_door` is impossible | Always | Dead entity partially recovers | `invariants.test.ts` |
| `dead` entity cannot act | Turn Pipeline step 4/5 | Dead enemy executes intent | `invariants.test.ts: dead-cannot-act` |
| `death_door` clears only via explicit heal | Always | Stun / status tick / form change clears death_door | `resolution.test.ts: death_door только через applyHeal` |
| Werewolf: `human ↔ wolf` (never skips) | Turn Pipeline step 3 | Hero jumps to wolf without passing threshold | `heroes/werewolf.test.ts` |
| Werewolf: `dead` hero never transforms | Turn Pipeline step 3 | Dead hero gains wolf form | `heroes/werewolf.test.ts: dead hero → no transform` |

---

## Status effect invariants

| Invariant | Applies at | Violation looks like | Caught by | BUGS.md |
|-----------|-----------|---------------------|-----------|---------|
| `bleed.stacks <= 10` | After addStatus | More than 10 stacks | `property.test.ts: bleed stacks <= 10` | — |
| `bleed.stacks >= 0` | After tick | Negative bleed damage | `property.test.ts: bleed tick не уходит в минус` | — |
| `stun` does not stack | After addStatus | Duration > 1 from stacking | `statuses.test.ts` | — |
| `defend` never increases incoming damage | ARP step 4 | Attack with defend deals more damage | `property.test.ts: defend никогда не увеличивает урон` | — |
| Status effects survive transformation | Turn Pipeline step 3 | Bleed disappears after werewolf transform | `heroes/werewolf.test.ts: статусы выживают` | — |
| `hasStatus(e, X)` is false when X not applied | Always | Function returns true for arbitrary status | `statuses.test.ts: hasStatus negative cases` | MUTATION-01 |
| Status with `duration` expires; without `duration` persists | After tick | Bleed removed by tick; stun persists forever | `statuses.test.ts: tickStatuses duration filter` | MUTATION-01 |

---

## Charge / Rage / Wolf passive invariants

| Invariant | Applies at | Violation looks like | Caught by | BUGS.md |
|-----------|-----------|---------------------|-----------|---------|
| `chargeStacks <= 3` | After any charge gain | 4+ stacks, double-double damage | `property.test.ts: Paladin chargeStacks` | — |
| `chargeStacks >= 0` | Always | Negative charges | `heroes/paladin.test.ts` | — |
| `chargeStacks undefined = 0` | playRighteousStrike / playDivineCharge | First charge gives 0 instead of 1 | `heroes/paladin.test.ts: первый заряд из undefined` | MUTATION-01 |
| `rageStacks <= 5` | After Primal Fury | 6+ stacks | `heroes/berserker.test.ts: rage capped at 5` | — |
| `isInRage(dead hero)` = false | Always | Dead hero gets rage bonus | `heroes/berserker.test.ts: HP=0 dead → rage inactive` | — |
| `wolfDamage >= base` for any HP | ARP step 4 | Wolf form reduces damage | `property.test.ts: wolfDamage >= base` | — |
| `wolfDamage` monotonically decreasing with HP | ARP step 4 | Higher HP → more damage (backwards) | `property.test.ts: wolfDamage монотонно убывает` | — |

---

## Pipeline ordering invariants

| Invariant | Applies at | Violation looks like | Caught by | BUGS.md |
|-----------|-----------|---------------------|-----------|---------|
| Bleed in Rend applied AFTER damage | ARP step 5 | Bleed damage counted in same hit | `heroes/werewolf.test.ts: bleed AFTER damage` | — |
| `openTheWound` checks bleed BEFORE applying | ARP step 2 | Vulnerable always applied (self-trigger) | `heroes/bloodmage.test.ts: pre-existing bleed only` | D-10 |
| Bloodrite self-damage bypasses defend | Direct HP | Defend absorbs ritual cost | `heroes/bloodmage.test.ts: self-damage bypasses` | D-11 |
| Berserker damage computed before resolveAction | ARP step 4 | Vulnerable applied before berserker scaling | `heroes/berserker.test.ts` | — |

---

## Replay / telemetry invariants

| Invariant | Applies at | Violation looks like | Caught by | BUGS.md |
|-----------|-----------|---------------------|-----------|---------|
| Same seed → same replay (byte-perfect) | ReplayLog | `replayGame(log).success = false` | `runtime/executor-property.test.ts: детерминизм` | — |
| `snapshots.length === turn_end events` | After any endTurn | Segment missing in debugger | `runtime/executor-property.test.ts` | BUG-12 |
| Every play_card event has pre/post hash | ReplayLog | Hash = `undefined` in log | `replay/replay.test.ts` | — |
| Diverged hash → `result.divergedAt` points to event | Replayer | Silent divergence, no report | `replay/replay.test.ts: tampered hash` | — |

---

## False invariants (intentionally violated — documented as domain rules)

These tests use `it.fails()` — they pass only when the assertion FAILS.

| False invariant | Why it's false | `it.fails()` test location |
|----------------|---------------|---------------------------|
| "Heal always benefits the target" | Healing Berserker above 50% HP removes wolf form → lower damage output | `property.test.ts: false invariant: healing Werewolf` |
| "Higher HP = safer Berserker" | Higher HP → smaller rage multiplier → weaker attacks | `property.test.ts: false invariant: higher HP weakens Berserker` |
| "Chaos Bolt randomness always matters" | With 1 enemy, RNG is consumed but result is always the same | `property.test.ts: false invariant: chaos bolt is meaningfully random` |
| "Open the Wound always threatens vulnerable" | Without pre-existing bleed, vulnerable is never applied | `property.test.ts: false invariant: open the wound always threatens` |

---

## Target validity invariants

| Invariant | Applies at | Violation looks like | Caught by |
|-----------|-----------|---------------------|-----------|
| Action target must exist at resolution time | ARP step 1 | Card fires against non-existent entity | `action-resolution.test.ts` (resolveAction returns early if target not found) |
| Action targeting `dead` entity is a no-op | ARP step 4 | Dead enemy takes damage, HP goes negative | `resolution.test.ts: dead immunity` |
| AoE cards skip dead entities | ARP step 3 | Rampage damages archived enemies | `heroes/werewolf.test.ts: пропускает мёртвых` |

---

## Status data integrity invariants

| Invariant | Applies at | Violation looks like | Caught by |
|-----------|-----------|---------------------|-----------|
| `status.stacks` must be integer ≥ 0 | After addStatus / tick | `bleed.stacks = 1.5` or `bleed.stacks = -1` | `statuses.test.ts: bleed never negative` |
| `status.duration` must be integer > 0 when present | After addStatus | `stun.duration = 0` means already expired; `duration = -2` corrupts tick | `statuses.test.ts: duration filter` |
| Stun does not stack (idempotent) | After addStatus | Two stuns = 2 skipped turns | `statuses.test.ts` |

---

## Turn-order safety invariants

| Invariant | Applies at | Violation looks like | Caught by |
|-----------|-----------|---------------------|-----------|
| Each living entity acts at most once per turn | Turn Pipeline step 4/5 | Entity re-inserted into action queue via transform or spawn | `pipeline.test.ts` (linear loop in executor) |
| Dead entity cannot be stun-cleared | Turn Pipeline step 3 | `removeStatus(dead_enemy, 'stun')` changes state of dead entity | `invariants.test.ts` |

---

## State + HP consistency invariants

| Invariant | Applies at | Violation looks like | Caught by |
|-----------|-----------|---------------------|-----------|
| `dead → hp = 0` | Always | `state = dead, hp = 12` after replay reconstruction | `property.test.ts: dead entity stays dead` |
| `death_door → hp = 0` | Always | `state = death_door, hp = 5` — entity bypassed death transition | `resolution.test.ts` |
| HP cannot increase via damage | After applyDamage | `hp_after > hp_before` | `property.test.ts: applyDamage никогда не увеличивает hp` |

---

## Replay determinism — stronger contract

| Invariant | Applies at | Violation looks like | Caught by |
|-----------|-----------|---------------------|-----------|
| Same seed → same replay (basic) | ReplayLog | `replayGame(log).success = false` | `runtime/executor-property.test.ts` |
| Replay execution must not consume additional RNG | During replayGame() | Logging/debug code advances RNG state → divergence on re-run | Architecture: chaos_bolt targetId stored in event, replayer passes it directly — RNG not re-called |
| Tampered hash → `divergedAt` reports exact event | Replayer | Silent divergence, no report | `replay/replay.test.ts: tampered hash` |

---

## Enemy AI determinism invariants

| Invariant | Applies at | Violation looks like | Caught by |
|-----------|-----------|---------------------|-----------|
| `intent(enemy, turn)` is pure — same input = same output | Turn Pipeline step 5 | Intent changes on re-run with same seed | `runtime/executor-property.test.ts: детерминизм` |
| Intent selection has no side effects | Turn Pipeline step 5 | Logging / telemetry code accidentally advances RNG | Architecture: intent tables are pure arrays; no RNG consumed |
| Intent cycle is deterministic — turn N % len = same intent | Always | Turn 4 gives different intent than turn 1 for same enemy | `tests/bdd/features/combat.feature: Guardian cycle` |
| Lifesteal uses `min(dmg_dealt, enemy.maxHp - enemy.hp)` | ARP step 5 | Lifesteal heals for overkill damage (>actual damage dealt) | `runtime/executor.ts: lifesteal capped` |
| Corpse `raisedOnce` flag is idempotent | After Raise Dead | Same Goblin corpse raised multiple times | Not yet tested — open gap |

---

## Trace-derived invariants (found from real play data, not upfront design)

> These were discovered by running `npm run trace 2000` — 2000 actual game traces analyzed.
> "What to test" came from data, not from assumptions.

| Invariant | Source | Suggested test |
|-----------|--------|----------------|
| Games terminate within 12 turns | Max observed win = 10 turns | `forAll(seeds, simulateTurns(s) <= 12)` |
| bleed+defend co-occur in 70%+ of games | 352/500 traces | `forAll(bleed+defend states, defend not consumed by bleed tick)` |
| Losing games last 2× longer (7.5 vs 4.0 turns avg) | Turn distribution | CI metric: alert if avg_loss_turns drops below 6 |
| Hero spends ~5% of turns at critical HP (0–20%) | HP histogram bucket 0 | `forAll(critical-HP states, bleed tick → hp >= 0)` |
| Werewolf transforms earliest on turn 5 | Transform distribution | No game should transform before turn 3 without taking 50%+ damage |
| bleed is #1 single status (359/500 traces) | Status frequency | bleed must always tick correctly regardless of other statuses present |

**Key insight:** bleed+defend combination wasn't designed as a test case — real game behavior creates it naturally. This is the most common multi-status state. Without trace analysis, a QA engineer might never think to test it specifically.

---

## Invariant severity

| Severity | Response | Examples |
|----------|----------|---------|
| **Hard** (throws) | `assertValidGameState()` → TIMELINE CORRUPTED | `dead-cannot-act`, `hp-floor`, `hp-ceiling`, `charge-cap` |
| **Soft** (test only) | Property test fails; fast-check shrinks | `bleed-cap`, `wolfDamage monotonic`, `replay byte-perfect` |
| **Design** (`it.fails()`) | Test passes only when assertion fails | All false invariants above |
