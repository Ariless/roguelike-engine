# Roguelike Engine — Backlog

Full design spec: `DESIGN.md` · Full invariant contract: `INVARIANTS.md`

---

## Статус проекта (2026-08-20)

**437 тестов** (400 vitest + 25 Playwright + 12 BDD) · **~79% mutation score** · **16 задокументированных багов**

Открыты: BUG-14 (механика некроманта не реализована в движке, живёт только в UI) и BUG-16 (UI-тест на скелета не проверяет скелета). Оба требуют переноса raise/empower в движок — отдельная задача, не правка.

Portfolio-ready: README ✅ · CLAUDE.md ✅ · BUGS.md ✅ · DECISIONS.md (21 решение) ✅ · INVARIANTS.md ✅

---

## Построено ✅

### Engine
| Файл | Что внутри |
|------|-----------|
| `src/engine/types.ts` | GameState, Hero, Enemy, Status, Intent, EntityState, HeroClass |
| `src/engine/statuses.ts` | addStatus, tickStatuses, hasStatus, canAct |
| `src/engine/resolution.ts` | applyDamage, applyHeal |
| `src/engine/turnPipeline.ts` | runTurn, step1–step9, TurnHandlers |
| `src/engine/actionResolution.ts` | resolveAction, arp1–arp5, ActionHandlers |
| `src/engine/invariants.ts` | assertValidGameState, InvariantRegistry, TimelineCorruptedError |
| `src/engine/heroes/paladin.ts` | 3 карты + charge mechanics |
| `src/engine/heroes/bloodmage.ts` | 3 карты: bleed conditional, self-damage |
| `src/engine/heroes/berserker.ts` | 3 карты: rage mode (≤25% HP → ×1.5) |
| `src/engine/heroes/werewolf.ts` | 6 карт: human↔wolf transform, wolf passive scaling |

### Runtime + Telemetry
| Файл | Что внутри |
|------|-----------|
| `src/runtime/rng.ts` | mulberry32 seeded RNG |
| `src/runtime/faults.ts` | FaultConfig: bleedOffByOne, ignoreStun, ignoreDeathDoor, allowDeadToAct |
| `src/runtime/executor.ts` | createGame(config) → GameHandle; records ReplayLog with snapshots |
| `src/telemetry/types.ts` | ReplayEvent, TurnSnapshot, ReplayLog |
| `src/telemetry/replayer.ts` | replayGame(log) → byte-perfect verification |
| `src/telemetry/artifacts.ts` | saveFailingRun(log) → /artifacts/ |

### Tests
| Файл | Тестов |
|------|--------|
| Engine unit tests (8 файлов) | 172 |
| Hero tests (4 файла) | 96 |
| runtime/executor.test.ts | 21 |
| runtime/executor-property.test.ts | 7 |
| replay/replay.test.ts | 13 |
| property.test.ts (fast-check, 4× it.fails()) | 27 |
| **Vitest итого** | **310** |
| tests/ui/debugger.test.ts (Playwright) | 13 |
| tests/bdd/features/combat.feature (Cucumber) | 11 сценариев |
| **Всего** | **334** |

### Game UI + Debugger + Scripts
| Файл | Что внутри |
|------|-----------|
| `game/index.html` | 4 героя, multi-enemy, seed-based encounters, all mechanics |
| `debugger/index.html` | Forensic timeline viewer: segments, hashes, stability % |
| `scripts/simulate.ts` | Monte Carlo: коридоры, интервалы Уилсона, матрица 16 пар, вердикт |
| `scripts/stability.ts` | Разброс между батчами на разнесённых базовых seed + сходимость |
| `scripts/lib/` | `harness.ts` (автоплеер, `configFor`, `runBatch`), `stats.ts`, `corridors.ts` |
| `scripts/chaos-agent.ts` | Adversarial agent: 50/200 interesting timelines; ANTHROPIC_API_KEY → Claude |
| `scripts/trace-analysis.ts` | 500 трасс → status combos + suggested invariants |
| `scripts/ci-report.ts` | CI Stability Report HTML в Archivist стиле |
| `scripts/generate-replay.ts` | Generates replay.json for debugger |

### Документация
| Файл | Что внутри |
|------|-----------|
| `README.md` | Portfolio-ready: 20 секций; ROI, shrinking example, enterprise mapping |
| `BUGS.md` | 12 багов с root cause, fix, testing value |
| `DECISIONS.md` | 21 архитектурное решение |
| `INVARIANTS.md` | Полный контракт инвариантов + trace-derived |
| `docs/TEST-PYRAMID.md` | Rule engine пирамида vs web пирамида |
| `docs/DECISION-TABLES.md` | Enemy AI как decision tables |
| `CLAUDE.md` | Agent conventions: всё актуально |

### Курс
- `tests/bdd/` — BDD на rule engine без UI (11 сценариев)
- `docs/DECISION-TABLES.md` — классическая техника на нетривиальном примере
- `course/course3_assignments.md` — 6 заданий включая A-33C (trace-driven discovery)
- `INVARIANTS.md` — Invariant Contract таблица

---

## Не построено / В работе

### Boss — финальный capstone (приоритет когда будет время)

> "The Archivist should be the final consumer of the mutation system, not the thing that forces you to invent it." — внешнее review проекта

Mutation system ✅ · Replay ✅ · InvariantRegistry ✅ · Fault injection ✅
Все компоненты готовы. Boss — их финальный потребитель.

- [x] **Boss — The Archivist** — `src/engine/boss/archivist.ts` + 15 тестов + game UI (seed 6/13)
  - Phase 1: Memory Suppression — убирает incomingHealing hooks на 2 хода
  - Phase 2: Timeline Inversion — reverses resolution order на 1 ход
  - Phase 3: State Reset — сбрасывает все статусы; charge stacks НЕ сбрасываются (тест)
  - Phase 4: Invariant Breach — пытается поставить `dead.canAct = true`; `assertValidGameState()` ДОЛЖЕН поймать → TIMELINE CORRUPTED
  - `CorruptionEvent` schema: type / scope / appliedAt / constraintViolation: boolean
  - Property тест Phase 4: `expect(() => { applyBreach(); engine.run() }).toThrow('TIMELINE CORRUPTED')`
  - **Интервью-фраза:** "Boss and test suite are the same adversary."

### Engine (низкий приоритет)
- [ ] **Enemies TS-код** — Goblin, Guardian, Vampire, Necromancer в TypeScript. Сейчас только game UI (JS).
- [ ] **EventSpec** — preconditions + postconditions per event; как курсовое задание, не обязательно реализовывать.

### Курс (платные модули)
- [x] **Table-driven tests** — `tests/heroes/paladin.test.ts`: 8-row table для Righteous Strike × charges × vulnerable; каждая строка = одно правило + cross-row
- [x] **Model-based testing** — `tests/model-based.test.ts`: reference model (~30 строк) vs real engine; forAll(inputs) → оба дают одинаковый результат; 7 тестов на applyDamage/applyHeal/bleedTick
- [x] **Buggy branch** — `docs/BUGGY-BRANCH.md`; 5 багов расписаны с file/change/symptom/technique/rubric; instructor guide отдельно от student instructions

### Дополнительные техники (добавлено 2026-05-31)
- [x] **Pairwise testing** — `tests/pairwise.test.ts`; 4×4×3=48 → 16 (67% reduction); собственный allpairs алгоритм; 3 параметра: hero × encounter × fault
- [x] **Visual regression testing** — `tests/ui/visual-regression.test.ts`; 4 baseline screenshots; `npx playwright test tests/ui/visual-regression.test.ts --update-snapshots` для обновления
- [x] **Meta-testing oracle** — `scripts/meta-oracle.ts`; 8 test cases (4 correct + 4 incorrect); false positive/negative measurement; `npm run meta-oracle`

### AI интеграция (горячие темы 2026, уникально для курса)

- [x] **LLM as oracle** 🔥 — `scripts/llm-oracle.ts`; 7 правил; structured verdict; `npm run oracle [seed]`. Dry-run: `npm run oracle 42 -- --dry-run` или `AI_MOCK_RESPONSE=true` (паттерн из проекта 1). Нашёл CC-14: verdict vs explanation inconsistency.

- [x] **Semantic mutation testing (AI-powered)** 🔥 — `scripts/semantic-mutations.ts`; `npm run semantic-mutations <file> [fn]`; dry-run: `AI_MOCK_RESPONSE=true`
- [x] **Natural language spec → property test** 🔥 — `scripts/spec-to-test.ts`; `npm run spec-to-test "rule text"`; dry-run: `AI_MOCK_RESPONSE=true`

- [x] **Claude-guided chaos agent** — реализован в chaos-agent.ts; `ANTHROPIC_API_KEY=sk-... npm run chaos 100`
- [x] **AI-generated CI summary** — `scripts/ci-summary.ts`; `npm run ci-summary`; Archivist voice; dry-run: `AI_MOCK_RESPONSE=true`

### Missing content (арты и карты)
- [x] **Skeleton арт** — `enemy-skeleton.jpg` добавлен в assets (дисциплинированный скелет с щитом, чёрный фон)
- [x] **Goblin второй вариант** — `enemy-goblin2.jpg` добавлен; goblin×2 encounter: e0=enemy-goblin.jpg, e1=enemy-goblin2.jpg через portrait override в ENCOUNTER_DEFS
- [ ] **Berserker action card арты** — Savage Lunge / Primal Fury / Primal Dodge используют старые werewolf-era арты. Промты по STYLE LOCK с "Berserker, The Threshold archetype"

### Missing engine features
- [x] **Corpse system (game UI)** — `raisedOnce` флаг; raise dead работает в game/index.html; Skeleton спавнится, empowerment применяется; 5 Playwright тестов в tests/ui/game.test.ts
- [ ] **Corpse system (TypeScript executor)** — executor остаётся no-op; нужно для property tests на raise
- [x] **Vampire lifesteal в TypeScript executor** — реализовано; `lifesteal?: boolean` в Intent type; lifesteal = min(actual_dmg, missing_hp); 3 теста
- [ ] **Multi-enemy executor** — executor создаёт 1 врага; encounter configs с 2 врагами работают только в game UI

### Документация для курса
- [x] **Getting Started для студентов** — `docs/GETTING-STARTED.md`: setup, первый запуск, recommended order заданий, key files таблица
- [x] **Buggy branch guide** — `docs/BUGGY-BRANCH.md`: 5 намеренных багов с rubric; instructor/student разделены
- [x] **Курс 3 Part A — 10 модулей** — `course/course3_plan.md` обновлён: A-1 Foundations → A-10 Boss capstone; ~6-7 часов видеоконтента; все артефакты готовы
- [x] **Задания для AI scripts** — A-34C/A-35C/A-36C/A-37C в `course/course3_assignments.md`

### Осталось записать видео
- [ ] A-1: Rule engine foundations (~30 мин)
- [ ] A-2: Unit testing (~45 мин)
- [ ] A-3: Invariant Contract (~30 мин)
- [ ] A-4: Property-based testing (~60 мин)
- [ ] A-5: Mutation testing (~45 мин)
- [ ] A-6: Determinism & replay (~45 мин)
- [ ] A-7: Combinatorial testing (~30 мин)
- [ ] A-8: BDD & visual regression (~30 мин)
- [ ] A-9: AI-powered testing (~60 мин)
- [ ] A-10: Capstone boss fight (~30 мин)

### Tech debt
- [ ] **UI layout на MacBook Air** — entity panels при маленьком viewport не вмещаются идеально
- [ ] **State coverage heatmap** — какие state machine переходы покрыты; CI артефакт
- [ ] **vitest.config.ts exclude** — было: Playwright тест подбирался vitest; добавлен `tests/ui/**` в exclude

---

## Решено — не делать

| Что | Причина |
|-----|---------|
| Differential testing (два engine) | 2x maintenance, 10% extra signal |
| Chaos mode (corrupt save) | fault injection покрывает концепт |
| Сложный debugger UX (анимации, звук) | не цель проекта |
| Testing dashboard HTML отдельно | README + ci-report.html даёт 100% эффекта |
| Enemy selector кнопки в UI | убраны — encounter определяется seed (D-17) |
