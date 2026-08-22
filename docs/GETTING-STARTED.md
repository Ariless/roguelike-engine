# Getting Started

This is a rule engine SUT for learning advanced testing techniques.
No API to call, no UI to click — only complex rules and state transitions.

> "Some runs should never exist."

---

## Setup

```bash
git clone <repo-url>
cd roguelike-engine
npm install
```

---

## First run — verify everything works

```bash
npm test                    # 319 unit tests — should all pass (~3 seconds)
npm run test:bdd            # 11 BDD scenarios — natural language rules
npm run simulate 1000       # Monte Carlo — winrate by class (~5 seconds)
```

If all pass: you're ready.

---

## Explore the project

### 1. Play the game

```
open game/index.html
```

Select a hero, press NEW for a random encounter. Try to understand what each card does before reading the code.

### 2. Read BUGS.md first

`BUGS.md` contains 21 real bugs found during implementation. Each has:
- What failed
- Root cause
- What test would have caught it earlier

**This is the most important file in the repository.** Read all 21 entries.

### 3. Run the debugger

```bash
npm run replay 42
open debugger/index.html   # then load artifacts/replay-seed-42.json
```

Navigate through timeline segments. See state after each turn. Notice what changes.

### 4. Understand the invariants

Open `INVARIANTS.md`. This is the system's correctness contract. Every test exists to prove one of these invariants.

### 5. See test layers in action

```bash
npm run simulate 10000     # ~30 seconds — Blood Mage 94.5% shows self-damage risk
npm run chaos 200          # adversarial agent — find interesting timelines
npm run trace 500          # what status combos appear most in real play
```

---

## Practice tasks — recommended order

### Level 1 — Understand the system

| Task | File | What you learn |
|-----------|------|---------------|
| T-01 | `PRACTICE.md` | Type as invariant — when is a test a tautology? |
| T-02 | `PRACTICE.md` | Contextual invariants — when is `alive + hp=0` valid? |
| T-04 | `PRACTICE.md` | Pipeline ordering — find the bug fast-check catches |

### Level 2 — Apply the techniques

| Task | File | What you learn |
|-----------|------|---------------|
| T-03 | `PRACTICE.md` | Trace-driven test discovery — what to test from real game data |
| T-06 | `PRACTICE.md` | Model-based testing — reference model vs real engine |
| T-08 | `PRACTICE.md` | Metamorphic relations — Berserker damage is monotonic |

### Level 3 — Meta-testing

Run Stryker on your new tests: `npm run test:mutation`

If a mutant survives → you found a gap → write the killing test → run again.

---

## Key files

| File | What it is |
|------|-----------|
| `BUGS.md` | 21 real bugs — testing ROI in action |
| `INVARIANTS.md` | Correctness contract — find an invariant before writing a test |
| `docs/RULE-COVERAGE.md` | Which rules are covered by which test layer |
| `docs/DECISION-TABLES.md` | Enemy AI as decision tables — each row = one test |
| `docs/TESTING_PATTERNS.md` | 11 testing patterns used in this project |
| `docs/TEST-PYRAMID.md` | Why this pyramid looks different from a web project |

---

## Common questions

**"Where do I start writing tests?"**  
Open `INVARIANTS.md`. Pick an invariant with no property test (`—` in RULE-COVERAGE.md). Write one.

**"How do I know if my test is good?"**  
Run `npm run test:mutation`. If a mutant survives after your test — the test didn't kill it. Find out why.

**"What's the most important thing to understand?"**  
The difference between `correct` (works) and `good` (catches bugs). The mutation score tells you which one you have.
