# Roguelike Engine — Backlog

Full design spec: `DESIGN.md` · Full invariant contract: `INVARIANTS.md`

---

## Project status (2026-08-21)

**532 checks** (495 vitest + 25 Playwright + 12 BDD) · **86.1% mutation score** · **18 documented defects**

Open: BUG-18 — two of the four fault-injection flags inject nothing. `ignoreStun` guards a
condition that cannot arise (no hero card stuns an enemy), and `allowDeadToAct` is declared
but never read. Both pinned by tests that fail the moment either starts working.

Closed this week: BUG-14 (necromancer mechanics reached the engine), BUG-16 (UI assertion
that could not fail), BUG-17 (aggregation died at a million runs).

Portfolio-ready: README ✅ · CLAUDE.md ✅ · BUGS.md ✅ · DECISIONS.md ✅ · INVARIANTS.md ✅

---

## Built ✅

### Engine
| File | What is inside |
|------|---------------|
| `src/engine/types.ts` | GameState, Hero, Enemy, Status, Intent, EntityState, HeroClass |
| `src/engine/statuses.ts` | addStatus, tickStatuses, hasStatus, canAct |
| `src/engine/resolution.ts` | applyDamage, applyHeal |
| `src/engine/turnPipeline.ts` | runTurn, step1–step9, TurnHandlers |
| `src/engine/actionResolution.ts` | resolveAction, arp1–arp5, ActionHandlers |
| `src/engine/invariants.ts` | assertValidGameState, InvariantRegistry, TimelineCorruptedError |
| `src/engine/heroes/paladin.ts` | 3 cards + charge mechanics |
| `src/engine/heroes/bloodmage.ts` | 3 cards: conditional bleed, self-damage |
| `src/engine/heroes/berserker.ts` | 3 cards: rage mode (≤25% HP → ×1.5) |
| `src/engine/heroes/werewolf.ts` | 6 cards: human↔wolf transform, wolf passive scaling |
| `src/stats/distributions.ts` | lnGamma, gammaQ, erfc, chi-square and normal p-values |

### Runtime + Telemetry
| File | What is inside |
|------|---------------|
| `src/runtime/rng.ts` | mulberry32 seeded RNG |
| `src/runtime/faults.ts` | FaultConfig: bleedOffByOne, ignoreStun, ignoreDeathDoor, allowDeadToAct |
| `src/runtime/executor.ts` | createGame(config) → GameHandle; conditional intents; escort encounters; records ReplayLog with snapshots |
| `src/telemetry/types.ts` | ReplayEvent, TurnSnapshot, ReplayLog |
| `src/telemetry/replayer.ts` | replayGame(log) → byte-perfect verification |
| `src/telemetry/artifacts.ts` | saveFailingRun(log) → /artifacts/ |

### Tests
| Area | Tests |
|------|-------|
| Engine unit tests | 172 |
| Hero tests (4 files) | 96 |
| runtime/executor.test.ts | 35 |
| runtime/faults.test.ts | 22 |
| runtime/executor-property.test.ts | 7 |
| replay/replay.test.ts | 13 |
| property.test.ts (fast-check, 4× it.fails()) | 27 |
| rng-statistical.test.ts (NIST/Diehard as p-values) | 22 |
| stats/distributions.test.ts | 25 |
| economy.test.ts | 20 |
| necromancer.test.ts | 12 |
| decision-tables.test.ts | 17 |
| **Vitest total** | **495** |
| Playwright (debugger, game, visual regression) | 25 |
| Cucumber scenarios | 12 |
| **Total** | **532** |

### Game UI + Debugger + Scripts
| File | What is inside |
|------|---------------|
| `game/index.html` | 4 heroes, multi-enemy, seed-based encounters, all mechanics |
| `debugger/index.html` | Forensic timeline viewer: segments, hashes, stability % |
| `scripts/simulate.ts` | Monte Carlo: corridors, Wilson intervals, 16-pair matrix, return metrics, verdict |
| `scripts/stability.ts` | Cross-batch spread on far-apart base seeds + convergence |
| `scripts/cert-evidence.ts` | Evidence pack: build hashes, p-values, coverage, open defects + JSON snapshot |
| `scripts/delta.ts` | Diff of two snapshots; win rates by interval overlap, p-values exactly |
| `scripts/lib/` | `harness.ts` (auto-player, `configFor`, `runBatch`), `stats.ts`, `corridors.ts`, `economy.ts` |
| `scripts/chaos-agent.ts` | Adversarial agent: 50/200 interesting timelines; ANTHROPIC_API_KEY → Claude |
| `scripts/trace-analysis.ts` | 500 traces → status combos + suggested invariants |
| `scripts/ci-report.ts` | CI Stability Report HTML in Archivist style |
| `scripts/generate-replay.ts` | Generates replay.json for the debugger |

### Documentation
| File | What is inside |
|------|---------------|
| `README.md` | Portfolio-ready: ROI, shrinking example, NIST mapping, scale, delta, enterprise mapping |
| `BUGS.md` | 18 defects with root cause, fix and testing value |
| `DECISIONS.md` | Architectural decisions |
| `INVARIANTS.md` | Full invariant contract + trace-derived |
| `docs/TEST-PYRAMID.md` | Rule engine pyramid vs web pyramid |
| `docs/DECISION-TABLES.md` | Enemy AI as decision tables |
| `docs/TESTING_PATTERNS.md` | The patterns actually used, with the rule behind each |
| `CLAUDE.md` | Agent conventions |

### Artefacts
| File | What is inside |
|------|---------------|
| `artifacts/CERT-EVIDENCE.md` | Evidence pack for the current build |
| `artifacts/cert-evidence.json` | The same run, machine-readable |
| `artifacts/SIMULATION-1M.txt` | Million-seed run: 0 corrupted, 0 hash divergences |
| `artifacts/REGRESSION-BUG14.txt` | Before/after the necromancer mechanics landed |
| `artifacts/DELTA-BUG14.txt` | The same change through `npm run delta` |
| `artifacts/baseline-pre-bug14.json` | Snapshot to diff future builds against |

---

## Not built / in progress

### Boss — the final capstone

> "The Archivist should be the final consumer of the mutation system, not the thing that
> forces you to invent it." — external review of the project

Mutation system ✅ · Replay ✅ · InvariantRegistry ✅ · Fault injection ✅
Every component is ready. The boss is their final consumer.

- [x] **Boss — The Archivist** — `src/engine/boss/archivist.ts` + 15 tests + game UI (seed 6/13)
  - Phase 1: Memory Suppression — removes incomingHealing hooks for 2 turns
  - Phase 2: Timeline Inversion — reverses resolution order for 1 turn
  - Phase 3: State Reset — clears all statuses; charge stacks are NOT cleared (test)
  - Phase 4: Invariant Breach — attempts `dead.canAct = true`; `assertValidGameState()` MUST catch it → TIMELINE CORRUPTED
  - `CorruptionEvent` schema: type / scope / appliedAt / constraintViolation: boolean
  - Phase 4 property test: `expect(() => { applyBreach(); engine.run() }).toThrow('TIMELINE CORRUPTED')`

### Engine (low priority)
- [ ] **EventSpec** — preconditions + postconditions per event.
- [ ] **Balance gate** — the corridors cannot block merges while the werewolf sits at 97.8%.
      That is a design question, not a missing mechanic: the class needs re-tuning, or the
      corridor needs a rationale for being wider.

### Additional techniques
- [x] **Table-driven tests** — `tests/heroes/paladin.test.ts`: 8-row table for Righteous Strike × charges × vulnerable
- [x] **Model-based testing** — `tests/model-based.test.ts`: reference model vs real engine
- [x] **Pairwise testing** — `tests/pairwise.test.ts`; 4×4×3=48 → 16 (67% reduction)
- [x] **Visual regression testing** — `tests/ui/visual-regression.test.ts`; baselines for macOS and Linux
- [x] **Meta-testing oracle** — `scripts/meta-oracle.ts`; false positive/negative measurement
- [x] **RNG statistical battery** — NIST SP 800-22 §2.1/2.2/2.3/2.4/2.13, Diehard serial and permutation, §4.2.2 second-order check
- [x] **Return metrics** — RTP, hit frequency, max win, volatility, derived from the replay log
- [x] **Evidence pack and delta** — `npm run cert-evidence`, `npm run delta`

### AI integration
- [x] **LLM as oracle** — `scripts/llm-oracle.ts`; 7 rules; structured verdict; `npm run oracle [seed]`
- [x] **Semantic mutation testing** — `scripts/semantic-mutations.ts`
- [x] **Natural language spec → property test** — `scripts/spec-to-test.ts`
- [x] **Claude-guided chaos agent** — `ANTHROPIC_API_KEY=sk-… npm run chaos 100`
- [x] **AI-generated CI summary** — `scripts/ci-summary.ts`; Archivist voice

### Missing content (art and cards)
- [x] **Skeleton art** — `enemy-skeleton.jpg` in assets
- [x] **Second goblin variant** — `enemy-goblin2.jpg`; goblin×2 encounter uses a portrait override
- [ ] **Berserker action card art** — Savage Lunge / Primal Fury / Primal Dodge still use werewolf-era art

### Engine features
- [x] **Corpse system (game UI)** — `raisedOnce` flag; raise dead works in game/index.html
- [x] **Corpse system (TypeScript executor)** — landed with BUG-14: raise, empower, spent-corpse flag, deterministic skeleton ids
- [x] **Vampire lifesteal in the executor** — `lifesteal?: boolean` in Intent; lifesteal = min(actual_dmg, missing_hp)
- [x] **Multi-enemy executor** — encounters can hold more than one enemy; the necromancer arrives with an escort
- [ ] **Conditional intents for the vampire** — turn 2 should amplify against a bleeding hero and turn 3 should branch on Death's Door. Still pinned in KNOWN_GAPS; the mechanism now exists, only the rows are unwritten.

### Tech debt
- [ ] **UI layout on a MacBook Air** — entity panels do not fit perfectly at a small viewport
- [ ] **State coverage heatmap** — which state machine transitions are covered; a CI artefact
- [x] **vitest.config.ts exclude** — Playwright tests were being picked up by vitest; `tests/ui/**` excluded

---

## Decided against

| What | Why |
|------|-----|
| Differential testing (two engines) | 2× maintenance for 10% extra signal |
| Chaos mode (corrupt save) | fault injection covers the concept |
| Elaborate debugger UX (animation, sound) | not the point of the project |
| A separate testing dashboard page | README + ci-report.html give 100% of the effect |
| Enemy selector buttons in the UI | removed — the encounter is decided by the seed (D-17) |
| Making `engine/` fault-aware | would trade a documentation defect for an architectural one (BUG-18) |
