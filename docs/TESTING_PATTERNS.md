# Testing Patterns

Patterns actually used in the engine's tests. All of them are implemented — none is "planned".

---

## 1. AAA (Arrange / Act / Assert)

Every test splits into three parts, so what it checks is visible at a glance.

```ts
it('defend absorbs damage before HP', () => {
  // Arrange
  const state = makeState({ heroHp: 45 })
  const withDefend = addStatus(state, 'hero', { name: 'defend', stacks: 4 })
  // Act
  const next = applyDamage(withDefend, 'hero', 10)
  // Assert
  expect(next.hero.hp).toBe(39)   // 45 - (10 - 4 absorbed)
})
```

**Rule:** one test, one check. Two `expect`s about different things means two tests.

---

## 2. Test Builder / makeState()

Every test file has its own local `makeState()` with sensible defaults, so only what matters to the test is visible.

```ts
// ← noise; the point is lost
const state: GameState = {
  seed: 1, turn: 1, isOver: false,
  hero: { id: 'hero', hp: 45, maxHp: 90, ... 12 fields ... },
  enemies: [...]
}

// ← signal: the test cares about HP and nothing else
const state = makeState(45)  // heroHp = 45, everything else is a default
```

**Rule:** makeState() stays local to each test file. Shared helpers mean coupling.

---

## 3. Boundary values

Every numeric limit and every transition gets its own test on the exact boundary:

```ts
it('HP never goes below 0')
it('HP never exceeds maxHp')
it('bleed stacks up to 10 at most')
it('stun lasts exactly 1 turn')
it('alive → death_door at HP = 0')
it('HP = 50% (15/30) → transform (boundary inclusive)')
it('HP = 16/30 (>50%) → does NOT transform')
```

**Mutation testing note:** if the `≤` → `<` mutant survives, the boundary test is missing.

---

## 4. Property-based testing (fast-check)

Invariants that must hold for ANY input:

```ts
// Unit test — one case
it('HP never goes below 0 on 100 damage', () => { ... })

// Property test — for any damage
it('HP always >= 0', () => {
  fc.assert(fc.property(
    fc.integer({ min: 0, max: 99999 }),
    damage => {
      const next = applyDamage(makeState(), 'hero', damage)
      return next.hero.hp >= 0
    }
  ))
})
```

**When to use:** when you want to write `forAll` instead of a specific value.

**Shrinking:** fast-check reduces a failing case to the minimal counterexample automatically.

---

## 5. False invariant (it.fails())

Documents a deliberate violation of intuition as a domain rule rather than a bug:

```ts
describe('false invariant: healing Werewolf above 50% reduces damage', () => {
  it.fails('healing always improves combat output', () => {
    // Healing above 50% HP → removes wolf form → weaker attack
    // This assertion is FALSE — and that is CORRECT by design
    expect(wolfDamage(heroAfter, 8)).toBeGreaterThanOrEqual(wolfDamage(heroBefore, 8))
  })
})
```

**Rule:** the test passes only while the assertion is FALSE. If someone "fixes" healing, it fails.

---

## 6. Mutation killing test

Written explicitly to kill one surviving mutant. The comment records which one:

```ts
describe('hasStatus — negative cases (kill hasStatus always-true mutant)', () => {
  it('returns false for a different status', () => {
    const state = makeState({ heroStatuses: [{ name: 'bleed', stacks: 3 }] })
    expect(hasStatus(state.hero, 'stun')).toBe(false)   // ← kills always-true mutant
  })
})
```

**Rule:** when a mutant survives, write a test that checks the exact condition the mutation alters.

---

## 7. Replay / determinism test

Proves the system is deterministic: the same seed gives the same outcome:

```ts
it('two runs of the same seed produce identical post-state hashes', () => {
  const log1 = playRandom(42, 'paladin', 'goblin')
  const log2 = playRandom(42, 'paladin', 'goblin')
  expect(log1.events.every((e, i) =>
    e.postStateHash === log2.events[i].postStateHash
  )).toBe(true)
})
```

**Stronger:** `forAll(seeds) → replayGame(log).success === true`  
Any random game replays byte-perfect.

---

## 8. BDD / Cucumber (rules as specification)

For documenting business rules in human language:

```gherkin
Scenario: Stun expires after the hero skips one turn
  Given the hero is playing as Paladin against a Guardian
  And the Guardian stuns the hero
  When the hero ends their turn without playing any cards
  Then the hero is no longer stunned
```

**Two modes of step definitions:**
- Full game flow (stun, bleed) → `createGame()` + `game.endTurn()`
- HP-precise scenarios (isInRage, checkWerewolfTransform) → engine functions directly

**When to use:** for rules that have to be explained to non-technical stakeholders.

---

## 9. Trace-driven test discovery

Run `npm run trace 500`, look at the patterns that actually occur, then write a test for one:

```
Top status combos: bleed (359), bleed+defend (352), stun (205)
→ Write: forAll(states with bleed+defend, defend not consumed by bleed tick)
```

**When to use:** when you need to find what to test next without knowing what matters.

---

## 10. Scenario test

Checks a sequence of actions rather than a function. Catches interaction bugs between mechanics that a unit test cannot see.

```ts
it('Guardian: shield → stun → heavy strike sequence', () => {
  const game = createGame({ seed: 42, heroClass: 'paladin', enemyType: 'guardian' })

  game.endTurn()  // turn 1: Guardian shields
  expect(game.getState().enemies[0].statuses.some(s => s.name === 'defend')).toBe(true)

  game.endTurn()  // turn 2: Guardian stuns
  expect(game.getState().hero.statuses.some(s => s.name === 'stun')).toBe(true)

  const hpBefore = game.getState().hero.hp
  game.endTurn()  // turn 3: Guardian heavy strike (hero is stunned, no defend)
  expect(game.getState().hero.hp).toBe(hpBefore - 10)
})
```

**The difference from a unit test:** it checks the ORDER of the steps and how they interact, not one function.

**Decision tables → scenario tests:** every cross-row test from DECISION-TABLES.md is a scenario test.

**When to use:** for scripted sequences (enemy AI, workflow, pricing pipeline).

---

## 11. Decision table test

Each decision table row is one test. Interaction between rows is a separate integration test:

```ts
// Row 1: Guardian shields
it('Guardian turn 1 gains 8 defend', () => { ... })
// Row 2: Guardian stuns
it('Guardian turn 2 stuns hero', () => { ... })
// Cross-row: stun on hero + attack next turn
it('Stunned hero takes full 10 damage (no defend possible)', () => { ... })
// Boundary: cycle
it('Guardian turn 4 repeats turn 1 intent (cycle)', () => { ... })
```

**When to use:** for scripted, deterministic behaviour (enemy AI, pricing rules, workflow steps).

---

## Hierarchy of patterns

```
AAA
│
├─ Unit tests (one call, one check)
│   ├─ makeState()      — clean inputs
│   ├─ one test = one behavior
│   └─ boundary tests   — one per boundary
│
├─ Scenario tests (a sequence of actions)
│   ├─ Guardian cycle (shield → stun → heavy strike)
│   ├─ Vampire bleed + lifesteal
│   └─ BDD scenarios (Cucumber)
│
├─ Property tests (for ANY input)
│   ├─ hp >= 0 / hp <= maxHp
│   ├─ bleed <= 10
│   ├─ replay determinism forAll(seeds)
│   └─ false invariants (it.fails())
│
└─ Meta-tests
    ├─ Mutation killing — targeted tests kill the survivors
    ├─ Mutation testing (Stryker) — measures the quality of the suite
    └─ Chaos + Monte Carlo — statistical confidence
```

**How the layers divide:** unit catches local errors, scenario catches interaction errors, property catches violations of fundamental laws, meta catches holes in the suite itself.
