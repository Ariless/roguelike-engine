# Rule Coverage Matrix

Which rules are covered by which testing layer.

> **How to read this:** ✓ = a test exists, — = not covered by this layer, ⚠ = indirect only  
> A gap (—) is not automatically a problem. A property ✓ is stronger than a replay ✓. BDD is documentation.

---

## Core engine rules

| Rule | Unit | Property | Replay | BDD | Mutation |
|------|------|----------|--------|-----|----------|
| `hp >= 0` | ✓ | ✓ | ✓ | — | ✓ |
| `hp <= maxHp` | ✓ | ✓ | ✓ | — | ✓ |
| `hp=0 → death_door` | ✓ | — | ✓ | ✓ | — |
| `death_door + hit → dead` | ✓ | — | ✓ | ✓ | — |
| `dead → alive` impossible | ✓ | ✓ | ✓ | — | — |
| Dead entity cannot act | ✓ | — | ✓ | — | — |
| `death_door` clears only via heal | ✓ | — | ✓ | ✓ | — |

---

## Status effect rules

| Rule | Unit | Property | Replay | BDD | Mutation |
|------|------|----------|--------|-----|----------|
| `bleed.stacks <= 10` | ✓ | ✓ | ✓ | — | ✓ |
| Bleed tick damage never negative | ✓ | ✓ | ✓ | — | ✓ |
| Stun skips exactly 1 turn | ✓ | — | ✓ | ✓ | — |
| Stun does not stack | ✓ | — | ✓ | — | — |
| Defend absorbs before HP | ✓ | ✓ | ✓ | — | ✓ |
| Defend never increases damage | ✓ | ✓ | ✓ | — | ✓ |
| Status survives form change | ✓ | ✓ | ✓ | — | — |

---

## Hero-specific rules

| Rule | Unit | Property | Replay | BDD | Mutation |
|------|------|----------|--------|-----|----------|
| `chargeStacks <= 3` | ✓ | ✓ | ✓ | ✓ | ✓ |
| Double damage at 3 stacks | ✓ | — | ✓ | ✓ | — |
| `undefined chargeStacks = 0` | ✓ | — | ✓ | — | ✓ |
| Bloodrite self-damage bypasses defend | ✓ | — | ✓ | ✓ | ✓ |
| Open the Wound: vulnerable only with pre-existing bleed | ✓ | ✓ | ✓ | — | — |
| Berserker rage active at HP ≤ 25% | ✓ | ✓ | ✓ | ✓ | ✓ |
| Rage damage ×1.5 (boundary: exactly 25%) | ✓ | ✓ | ✓ | ✓ | ✓ |
| `rageStacks <= 5` | ✓ | — | ✓ | — | — |
| Werewolf transforms at HP ≤ 50% | ✓ | ✓ | ✓ | ✓ | ✓ |
| Wolf form lasts exactly 3 turns | ✓ | — | ✓ | — | — |
| Wolf damage monotonically decreasing with HP | ✓ | ✓ | ✓ | — | ✓ |
| Heal above 50% removes wolf form (false invariant) | ✓ | ✓ | ✓ | ✓ | — |

---

## Enemy AI rules

| Rule | Unit | Property | Replay | BDD | Mutation | Note |
|------|------|----------|--------|-----|----------|------|
| Guardian: shield→stun→attack cycle | ✓ | — | ✓ | ✓ | — | |
| Guardian cycle repeats (turn 4 = turn 1) | ✓ | — | ✓ | ✓ | — | executor.test.ts |
| Vampire lifesteal = min(dmg_dealt, missing_hp) | ✓ | ✓ | ✓ | — | — | executor.test.ts (3 tests) |
| Vampire lifesteal at full HP = 0 | ✓ | — | ✓ | — | — | executor.test.ts |
| Vampire lifesteal never exceeds maxHp | ✓ | ✓ | ✓ | — | — | executor.test.ts (10 seeds) |
| Vampire HP floor after attacks | ✓ | ✓ | ✓ | — | — | executor.test.ts (20 seeds) |
| Vampire no lifesteal on dead target | — | — | — | — | — | **⚠ GAP** |
| Necromancer raise dead (game UI) | ✓ | — | — | ✓ | — | game.test.ts (Playwright) |
| Necromancer raise = no-op (executor) | ✓ | — | ✓ | ✓ | — | executor.test.ts |
| Same corpse cannot be raised twice (`raisedOnce`) | ✓ | — | — | — | — | game UI implemented |
| Necromancer bleed accumulates/caps | ✓ | — | ✓ | — | — | executor.test.ts |
| Skeleton spawns after raise | ✓ | — | — | — | — | game.test.ts (Playwright) |
| Enemy intent is pure / side-effect free | — | ✓ | ✓ | — | — | executor-property |

---

## Replay / determinism rules

| Rule | Unit | Property | Replay | BDD | Mutation |
|------|------|----------|--------|-----|----------|
| Same seed → same replay hashes | ✓ | ✓ | ✓ | — | — |
| Replay doesn't consume additional RNG | — | — | ✓ | — | — |
| Tampered hash → divergedAt reported | — | — | ✓ | — | — |
| `snapshots.length === turn_end events` | ✓ | ✓ | — | — | — |
| Fault injection is deterministic | ✓ | ✓ | ✓ | — | — |

---

## Identified gaps

| Gap | Risk | Status |
|-----|------|--------|
| Guardian cycle boundary (turn 4 = turn 1) | Low | ✅ Closed — executor.test.ts |
| Vampire lifesteal = min(dmg, missing_hp) | Medium | ⚠ Lifesteal in game UI only — not in TypeScript executor |
| Vampire HP floor after Vampire attacks | Medium | ✅ Closed — property test, 20 seeds |
| Necromancer raise — only BDD | Medium | ✅ Closed — executor.test.ts (no-op documented) |
| Same corpse raised twice | Medium | ⚠ Requires corpse system implementation first |
| Wolf form exactly 3 turns | Low | ✅ Already in werewolf.test.ts |

---

## Coverage summary

| Layer | Rules covered | Primary strength |
|-------|--------------|-----------------|
| Unit | 30+ | Fast feedback, precise failures |
| Property | 18+ | Finds boundary edge cases automatically |
| Replay | 20+ | Proves determinism, any seed reproducible |
| BDD | 11 scenarios | Rules as natural language specification |
| Mutation | ~79% | Measures test quality, finds implicit gaps |
| Monte Carlo | All rules indirectly | Statistical confidence across 10k seeds |
