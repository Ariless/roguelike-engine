# Testing Patterns

Паттерны которые используются в тестах движка. Все реализованы — не "планируется".

---

## 1. AAA (Arrange / Act / Assert)

Каждый тест разбит на три части. Суть теста видна с первого взгляда.

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

**Правило:** один тест — одна проверка. Два `expect` на разные вещи = два теста.

---

## 2. Test Builder / makeState()

Каждый тест-файл имеет локальную `makeState()` с разумными дефолтами. Видно только то что важно для теста.

```ts
// ← шум, суть теряется
const state: GameState = {
  seed: 1, turn: 1, isOver: false,
  hero: { id: 'hero', hp: 45, maxHp: 90, ... 12 полей ... },
  enemies: [...]
}

// ← сигнал: test cares about HP and no more
const state = makeState(45)  // heroHp = 45, всё остальное — дефолты
```

**Правило:** makeState() локальна в каждом тест-файле. Shared helpers = coupling.

---

## 3. Boundary values

Для каждого числового лимита и перехода — отдельный тест на точную границу:

```ts
it('HP не уходит ниже 0')
it('HP не превышает maxHp')
it('bleed стакается максимум до 10')
it('stun длится ровно 1 ход')
it('alive → death_door при HP = 0')
it('HP = 50% (15/30) → transform (граница включительно)')
it('HP = 16/30 (>50%) → НЕ transform')
```

**Mutation testing note:** если мутант `≤` → `<` выживает, граничного теста нет.

---

## 4. Property-based testing (fast-check)

Инварианты которые должны держаться для ЛЮБЫХ входных данных:

```ts
// Юнит тест — один случай
it('HP не уходит ниже 0 при 100 урона', () => { ... })

// Property тест — для любого урона
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

**Когда использовать:** когда хочется написать `forAll` вместо конкретного значения.

**Shrinking:** fast-check автоматически сжимает failing case до минимального контрпримера.

---

## 5. False invariant (it.fails())

Документирует намеренное нарушение интуиции как domain rule, не как баг:

```ts
describe('false invariant: healing Werewolf above 50% reduces damage', () => {
  it.fails('heal всегда увеличивает боевую эффективность', () => {
    // Healing above 50% HP → removes wolf form → weaker attack
    // Этот assert ЛОЖНЫЙ — и это ПРАВИЛЬНО по дизайну
    expect(wolfDamage(heroAfter, 8)).toBeGreaterThanOrEqual(wolfDamage(heroBefore, 8))
  })
})
```

**Правило:** тест проходит только когда assertion ЛОЖНЫЙ. Если кто-то "починит" healing — тест упадёт.

---

## 6. Mutation killing test

Написан явно чтобы убить конкретный выживший мутант. Комментарий документирует мутанта:

```ts
describe('hasStatus — negative cases (kill hasStatus always-true mutant)', () => {
  it('возвращает false для другого статуса', () => {
    const state = makeState({ heroStatuses: [{ name: 'bleed', stacks: 3 }] })
    expect(hasStatus(state.hero, 'stun')).toBe(false)   // ← kills always-true mutant
  })
})
```

**Правило:** если мутант выжил — написать тест который проверяет именно то условие которое мутация меняет.

---

## 7. Replay / determinism test

Доказывает что система детерминирована: одинаковый seed = одинаковый исход:

```ts
it('два прогона одного seed дают идентичные post-state хэши', () => {
  const log1 = playRandom(42, 'paladin', 'goblin')
  const log2 = playRandom(42, 'paladin', 'goblin')
  expect(log1.events.every((e, i) =>
    e.postStateHash === log2.events[i].postStateHash
  )).toBe(true)
})
```

**Сильнее:** `forAll(seeds) → replayGame(log).success === true`  
Любая случайная игра воспроизводится byte-perfect.

---

## 8. BDD / Cucumber (правила как спецификация)

Для документирования бизнес-правил на человеческом языке:

```gherkin
Scenario: Stun expires after the hero skips one turn
  Given the hero is playing as Paladin against a Guardian
  And the Guardian stuns the hero
  When the hero ends their turn without playing any cards
  Then the hero is no longer stunned
```

**Два режима step definitions:**
- Full game flow (stun, bleed) → `createGame()` + `game.endTurn()`
- HP-precise scenarios (isInRage, checkWerewolfTransform) → engine functions directly

**Когда использовать:** для правил которые нужно объяснить non-technical stakeholders или курсовым студентам.

---

## 9. Trace-driven test discovery

Запустить `npm run trace 500` → посмотреть реальные паттерны → написать тест под паттерн:

```
Top status combos: bleed (359), bleed+defend (352), stun (205)
→ Написать: forAll(states with bleed+defend, defend not consumed by bleed tick)
```

**Когда использовать:** когда нужно найти что тестировать следующим, не зная что важно.

---

## 10. Scenario test

Проверяет не функцию, а последовательность действий. Ловит ошибки взаимодействия механик, которые unit-тест не видит.

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

**Ключевое отличие от unit теста:** проверяется ПОРЯДОК шагов и их взаимодействие, не одна функция.

**Decision tables → scenario tests:** каждый cross-row тест из DECISION-TABLES.md — это сценарный тест.

**Когда использовать:** для scripted sequences (enemy AI, workflow, pricing pipeline).

---

## 11. Decision table test

Каждая строка decision table = один тест. Взаимодействие строк = отдельный integration тест:

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

**Когда использовать:** для scripted/deterministic behavior (enemy AI, pricing rules, workflow steps).

---

## Иерархия паттернов

```
AAA
│
├─ Unit tests (один вызов, одна проверка)
│   ├─ makeState()      — чистые входные данные
│   ├─ one test = one behavior
│   └─ boundary tests   — на каждую границу
│
├─ Scenario tests (последовательность действий)
│   ├─ Guardian cycle (shield → stun → heavy strike)
│   ├─ Vampire bleed + lifesteal
│   └─ BDD scenarios (Cucumber)
│
├─ Property tests (для ЛЮБЫХ входных данных)
│   ├─ hp >= 0 / hp <= maxHp
│   ├─ bleed <= 10
│   ├─ replay determinism forAll(seeds)
│   └─ false invariants (it.fails())
│
└─ Meta-tests
    ├─ Mutation killing — targeted тесты убивают выживших
    ├─ Mutation testing (Stryker) — измеряет качество suite
    └─ Chaos + Monte Carlo — statistical confidence
```

**Правило распределения:** unit ловит локальные ошибки, scenario — ошибки взаимодействия, property — нарушения фундаментальных законов, meta — дыры в самом тест-сьюте.
