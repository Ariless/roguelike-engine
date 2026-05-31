# Architecture Decisions

Interesting choices made during implementation — what was built, why, and what was rejected.

---

## ENGINE

### D-01 — Два pipeline вместо одного

**Проблема:** Один 12-шаговый pipeline не мог однозначно описать порядок операций. Vampire lifesteal одновременно был "step 5 в action sequence" и "step 8 в turn structure" — два правильных описания одного события, но про разные вещи.

**Решение:** Явное разделение на два pipeline с иерархией вызовов:
- **Turn Pipeline (9 шагов)** — структура одного полного хода (когда passives, когда player acts, когда enemies act, когда statuses tick)
- **Action Resolution Pipeline (5 шагов)** — семантика одного действия (state transitions → status application → positional effects → damage calculation → post-effects)

Turn Pipeline steps 4 и 5 вызывают Action Resolution Pipeline для каждого отдельного действия.

**Почему важно:** Каждое правило теперь однозначно принадлежит ровно одному pipeline и одному шагу. Нет "step N" без указания какого pipeline. Invariant registry может ссылаться на конкретный шаг.

---

### D-02 — Statuses как hooks, не как hardcoded комбинации

**Проблема:** Наивный подход: `if (hasBleed && hasVulnerable) { damage *= 1.3 }`. При 4 статусах — 16 комбинаций, при 6 — 64. Тесты не покрывают их все, и любой новый статус ломает существующие комбо.

**Решение:** Каждый статус — коллекция hooks на общие event points:
```ts
Bleed      = { onTurnStart: (e) => e.hp -= stacks }
Vulnerable = { incomingDamage: (v) => v * 1.5 }
Stun       = { canAct: () => false }
Defend     = { incomingDamage: (v) => Math.max(0, v - stacks) }
```
Комбинации возникают автоматически через shared hook points.

**Почему важно:** Добавление нового статуса = zero changes to existing tests. `applyEvent()` — единственная mutation target для всей modifier системы. Открывает возможность для property-based тестов без O(n²) сценариев.

---

### D-03 — Handler injection для unbuilt компонентов

**Проблема:** Berserker, Vampire, RNG-dependent steps не реализованы. Нужно тестировать pipeline steps которые их вызывают.

**Решение:** Optional handler interfaces (`TurnHandlers`, `ActionHandlers`). Каждый step который требует unbuilt компонента принимает optional handler. Если handler не передан — step это pass-through.

**Почему важно:** Позволяет писать тесты на pipeline structure до реализации всех компонентов. 135+ тестов работают без Blood Mage и Berserker. Паттерн встречается в middleware, auth layers, request validation chains.

---

### D-04 — Contextual invariants, не global

**Проблема:** Казалось бы, `hp = 0 → entity должен быть dead`. Но это неверно.

**Решение:** `alive + hp=0` — валидное состояние МЕЖДУ applyDamage и step9 (Death Resolution). Невалидное ПОСЛЕ step9. Инвариант true не "всегда" — только в конкретной точке pipeline.

**InvariantRegistry** хранит каждый инвариант с `appliesAt: PipelineStep`.

**Почему важно:** Без этого разделения runtime assertions будут ложно срабатывать в середине pipeline. Contextual invariants — редкий концепт, но встречается везде: payment processing (partially applied transaction), distributed systems (eventual consistency windows).

---

### D-10 — Blood Mage: "already bleeding" проверяется ДО применения bleed

**Проблема:** Карта `Open the Wound` гласит: "Apply 3 bleed. If target already bleeding → also apply vulnerable." Наивная реализация: применить bleed → проверить bleeding → применить vulnerable. Но тогда карта всегда бы видела цель как bleeding (только что применили) и всегда давала бы vulnerable.

**Решение:** `playOpenTheWound` сохраняет `targetWasBleeding` **до** вызова `resolveAction` с bleed. Vulnerable применяется только если цель кровоточила до начала действия карты.

```ts
const targetWasBleeding = target ? hasStatus(target, 'bleed') : false
let s = resolveAction(state, { type: 'applyStatus', ..., status: { name: 'bleed', stacks: 3 } })
if (targetWasBleeding) { s = resolveAction(s, { ..., status: { name: 'vulnerable', stacks: 1 } }) }
```

**Почему важно:** Один снимок стейта до действия — паттерн для любой conditional trigger логики. Mutation testing цель: переставить снимок и применение местами → кондишн всегда true.

---

### D-11 — Bloodrite: самоурон обходит defend напрямую

**Проблема:** Bloodrite наносит 8 урона врагу и берёт 3 HP самоурона с героя. Если пропустить самоурон через `resolveAction`, defend поглощает часть — герой платит меньше чем должен.

**Решение:** Урон по врагу идёт через `resolveAction` (vulnerable работает, как ожидается). Самоурон — прямая мутация HP без pipeline:

```ts
const newHp = Math.max(0, s.hero.hp - 3)
// death_door / dead state machine применяется вручную
```

**Почему важно:** Bloodrite — ритуал, не атака. Defend — заимствованный момент порядка. Ритуальная цена не снижается защитой. Паттерн встречается везде где "cost" семантически отличается от "damage" — audit penalties, resource depletion, fee-as-side-effect.

---

## GAME UI

### D-05 — Auto-fire карты, не two-step click

**Проблема:** Изначально: клик на карту → карта выделяется → нужен второй клик на портрет врага. Игрок не понимал почему урон не наносится.

**Решение:** Поскольку враг всегда один, карты с `target: 'enemy'` сразу вызывают `playCard()` при клике. Два шага имеют смысл только когда нужно выбирать между несколькими целями.

**Почему важно:** UX rule: не требуй действий без причины. При одной цели выбор цели — лишний шаг.

---

### D-06 — Global tooltip div вместо in-card

**Проблема:** Tooltip внутри `.hand-card` обрезался — родительский элемент имеет `overflow: hidden` для правильного отображения card art.

**Решение:** Один глобальный `#cardTooltip` div с `position: fixed`, позиционируется через JS при mouseenter:
```js
const rect = el.getBoundingClientRect()
tip.style.left = (rect.left + rect.width/2 - 105) + 'px'
tip.style.top  = rect.top + 'px'
tip.style.transform = 'translateY(-100%)'
```

**Почему важно:** Классический паттерн для tooltips в card game UI. `overflow: hidden` на карте нужен — нельзя убрать. Глобальный div работает вне любого stacking context.

---

### D-08 — Два разных Death's Door эффекта

**Проблема:** Один red pulse эффект для всех сущностей не передаёт нарратив. Герой умирает от боли — враг архивируется системой.

**Решение:** Два отдельных visual state:
- **Hero Death's Door** — красный пульс (`pulse-red`), красный виньет экрана, бейдж "DEATH'S DOOR". Боль, кровь, угроза смерти.
- **Enemy Death's Door** — золотой scan-line (`scan-line` animation), десатурация, gold glow. Архивариус начинает "оцифровывать" сущность перед сохранением.

**Почему важно:** Narrative consistency — каждый визуальный элемент отражает мир Архивариуса. Enemy death = архивация, не смерть. Это делает проект узнаваемым на скриншоте.

---

### D-09 — Global tooltip div vs CSS :hover

**Проблема:** `.hand-card` имеет `overflow: hidden` для корректного отображения card art. CSS tooltip внутри карты обрезался.

**Решение:** Один глобальный `#cardTooltip` div с `position: fixed`, позиционируется через `getBoundingClientRect()`:
```js
const rect = el.getBoundingClientRect()
tip.style.left = (rect.left + rect.width/2 - 105) + 'px'
tip.style.top  = rect.top + 'px'
tip.style.transform = 'translateY(-100%)'
```

**Почему важно:** Классический паттерн для tooltips поверх overflow:hidden контейнеров. Встречается в любом card game UI, data table с fixed columns, dropdown меню.

---

### D-07 — Overlay narrative vs external text для entity panels

**Проблема:** Первая версия: вся информация (имя, HP, статусы, ресурсы) наложена поверх портрета через `position: absolute`. Красиво в теории, но на MacBook Air 13" текст сливался с артом, элементы вылезали за boundaries портрета.

**Решение:** Откат к внешнему тексту — отдельный `.entity-info` блок под портретом. Менее "игровой" визуально, но читаемый и предсказуемый.

**Почему важно:** Записано в tech debt — правильное решение требует точного расчёта высот под конкретный viewport. Viewport MacBook Air 13" ≈ 856px после browser chrome. Нужно: portrait ≤ 200px + entity-info ≤ 80px + hand ≤ 180px + log ≤ 60px + topbar ≤ 48px = 568px, оставляя ~290px на battle area.

---

### D-12 — Hero selector в топбаре, аналогично enemy selector

**Проблема:** Hero захардкожен в `makeGameState`. Нет способа переключиться между классами без правки кода.

**Решение:** `HERO_DEFS` объект с конфигурацией каждого героя (name, portrait, hp, hand). `forcedHero` переменная, `selectHero(key)` функция — симметрично паттерну `selectEnemy`. `makeGameState` делает spread: `{ ...HERO_DEFS[forcedHero], maxHp: ..., state: 'alive', ... }`. Лог-сообщения обновлены до `gs.hero.name` вместо хардкода "Paladin".

**Почему важно:** Единственное место конфигурации героя — `HERO_DEFS`. Добавление Berserker = одна запись в объект. Симметрия hero/enemy selector делает интерфейс предсказуемым — пользователь сразу понимает паттерн.

---

### D-13 — Enemy в death_door умирает до своего хода (death rattle убран)

**Проблема:** Враг уходил в death_door (HP = 0) после хода героя. При нажатии End Turn враг успевал выполнить свой intent ДО смерти — мог убить героя, который тоже был на Death's Door. Игроку требовался дополнительный End Turn чтобы враг умер.

**Решение:** В начале `endTurn()`, сразу после `deepClone`, добавлена явная death resolution для врага:
```js
if (gs.enemy.state === 'death_door') {
  gs.enemy.state = 'dead'
  checkWin(gs)
  if (gs.isOver) { render(); return }
}
```
Enemy в death_door умирает ДО выполнения intent — death rattle отсутствует.

**Почему важно:** Race condition в state machine: `state !== 'dead'` и `state === 'death_door'` — разные условия, оба давали "может действовать". Нужна единственная точка проверки "живой ли враг", а не множество `!== 'dead'` по коду. Паттерн встречается в workflow engines и payment systems — "pending cancellation" entity не должна обрабатываться как active.

---

### D-14 — Берсеркер и Вервольф разделены на два отдельных героя

**Проблема:** Один герой "Berserker" одновременно имел механику rage-scaling И трансформацию в вервольфа — два несовместимых архетипа в одном персонаже. Это путало нарратив и тестовые паттерны.

**Решение:** Разделение на два независимых героя:
- **Berserker** (`berserker.ts`) — rage mode: HP ≤ 25% → ×1.5 урон на 1 ход, без трансформации. Карты: Savage Lunge, Primal Fury, Primal Dodge.
- **Werewolf** (`werewolf.ts`) — transformation: HP ≤ 50% → wolf form (3 хода), wolf passive scaling. Карты: 3 human (Lunar Strike, Pack Sense, Stalk) + 3 wolf (Rend, Rampage, Reality Crack).

**Почему важно:** Каждый герой теперь демонстрирует один отчётливый тестовый паттерн. Berserker = binary threshold trigger. Werewolf = nested state machine. Смешение двух паттернов в одном герое снижало учебную ценность.

---

### D-15 — Berserker rage: состояние вычисляется, не хранится

**Проблема:** Предыдущий "Berserker" хранил `werewolfTurnsLeft` как счётчик состояния. Для нового rage mode нужно было решить: хранить `rageActive: boolean` или вычислять каждый раз?

**Решение:** `isInRage(hero)` — чисто вычисляемая функция из HP ratio. Нет флага в стейте, нет синхронизации, нет возможности рассинхронизации:
```ts
export function isInRage(hero: Hero): boolean {
  return hero.state !== 'dead' && hero.hp <= Math.floor(hero.maxHp * 0.25)
}
```

`werewolfTurnsLeft` на Werewolf сохранился — он нужен для 3-ходовой длительности, которую нельзя вычислить из текущего стейта.

**Почему важно:** Когда состояние вычисляемо — не храни его. Stored state = потенциальная рассинхронизация. Паттерн встречается везде: `isAdmin` вычисляется из ролей, `isExpired` вычисляется из даты, `isOverBudget` вычисляется из суммы транзакций.

---

### D-16 — gs.enemy (singleton) → gs.enemies[] (array) — полная миграция

**Проблема:** `gs.enemy` — единственный объект. Добавление второго врага невозможно без переписывания всех 47 мест в коде. `card.effect(gs)` напрямую читал `gs.enemy`, не принимая цель как параметр.

**Решение:**
- `gs.enemy` → `gs.enemies[]`; все функции работают через id: `dealDamage(gs, targetId, dmg)`
- `card.effect(gs)` → `card.effect(gs, targetId)` — цель передаётся явно
- AoE карты (Rampage, Reality Crack) имеют `target: 'aoe'` и итерируют `gs.enemies` игнорируя targetId
- `tickStatuses(gs, 'enemy')` → `tickStatuses(gs, enemy.id)` — настоящий id вместо sentinel-строки

**Почему важно:** 47 мест с `gs.enemy` — скрытая связность (implicit coupling). Каждая функция молчаливо предполагала одного врага. В TypeScript rename поймал бы все сразу; в plain JS — только runtime. Явный targetId делает зависимость видимой.

---

### D-17 — Encounter генерируется из seed, кнопки выбора врага убраны

**Проблема:** Ручной выбор врага через кнопки = детерминизм управляется игроком, не seed. Два игрока с одинаковым seed получали разные encounters. Seed переставал быть единственным источником истины.

**Решение:** `pickEncounter(seed)` → `Object.keys(ENCOUNTER_DEFS)[seed % keys.length]`. Encounter полностью детерминирован seed. Кнопки врагов убраны из UI. Текущий encounter отображается в топбаре (`GOBLIN + NECROMANCER`).

**Почему важно:** Seed = воспроизводимость. Если seed 42 всегда даёт один и тот же encounter — любой failing run можно воспроизвести точно. Это ключевое свойство для replay системы и property testing. Ручной выбор врага ломал это свойство.

---

### D-18 — Replay: turn_end как маркер в логе, а не внутренние события

**Проблема:** ReplayLog записывает все внутренние события (enemy_action, status_tick, transform). Replayer не может напрямую воспроизвести их — у executor только два публичных метода: `playCard()` и `endTurn()`. Нужен способ сказать replayer "здесь был вызван endTurn".

**Решение:** Добавлен `'turn_end'` event type. Executor записывает его в конце каждого `endTurn()` (включая ранние выходы при смерти). Replayer итерирует события: `play_card` → `playCard()`, `turn_end` → `endTurn()`. Все остальные события (`enemy_action`, `status_tick` и т.д.) — side effects, они возникают автоматически и используются только для hash-верификации.

**Почему важно:** Явный маркер вместо инференса. Альтернатива — replayer угадывает границы ходов по последовательности событий. Явный `turn_end` делает лог самодокументированным: "здесь произошёл переход хода" видно без разбора контекста.

---

### D-20 — Процедурные звуки через Web Audio API, без файлов

**Проблема:** Звуковые ассеты (mp3/wav) требуют хранения, лицензий, и HTTP-запросов. Файл-based sound мешает офлайн-использованию и раздувает репо ненужными бинарниками.

**Решение:** Модуль `snd` — IIFE с lazy AudioContext, 13 функций, чистый Web Audio API. Каждый звук генерируется из осцилляторов и gain-нодов в реальном времени. Никаких файлов, никаких ассетов.

AudioContext создаётся при первом вызове (lazy init), чтобы обойти браузерное ограничение на автоплей без пользовательского жеста. Первый клик карты = первый звук.

**Какие события озвучены и чем:**

| Событие | Техника | Описание |
|---|---|---|
| Карта сыграна | sine 600→300 Hz | Лёгкий свист |
| Удар по врагу | sawtooth 280→70 Hz | Металлический удар |
| Смерть врага | sawtooth 220→28 Hz | Тяжёлый падающий тон |
| Удар по герою | square 130→45 Hz | Тупой удар |
| Death's Door | sine 65→42 Hz | Зловещий гул |
| Лечение | sine C→E→G arpegio | Восходящее трезвучие |
| Блид (враг) | filtered noise, highpass 3.5kHz | Шипение |
| Стан (враг) | sine 1500→180 Hz | Металлическое зиканье |
| Трансформация вервольфа | sawtooth rumble + sine howl sweep | Рычание + вой |
| Берсерк рэйдж (≤25% HP) | sawtooth 80→45 Hz + crunch 400→150 Hz | Низкий рёв + крантч |
| End Turn | square 700→350 Hz | Клик |
| Победа | triangle C-E-G-C arpeggio | Фанфара |
| Поражение | sine A-F-A descending | Нисходящий Am |

**Хуки:** `playCard()` → cardPlay; `dealDamage()` → strike/enemyDead; `executeEnemyIntent()` → heroHit/deathDoor/bleedSfx/stunSfx/rageSfx; `healHero()` → heal; `checkWin()` → victory/defeat; `endTurn()` → endTurnSfx; `checkBerserkerTransformGame()` → transform.

Берсерк рэйдж определяется пересечением порога: `prevHpPct > 0.25 && newHpPct <= 0.25`. Срабатывает ровно один раз за бой при первом падении HP ниже 25%.

**Почему важно:** Ноль зависимостей, ноль файлов, полная воспроизводимость. Паттерн переносится на любой браузерный проект где нужны звуки без ассетов.

---

### D-19 — Replay hash-верификация: prostate hash, не full state compare

**Проблема:** Для byte-perfect replay нужно проверить что воспроизведённый run совпадает с оригиналом. Сравнивать полный GameState (JSON equality) — тяжело и brittle к изменениям структуры.

**Решение:** 6-символьный hex hash от `JSON.stringify({hero, enemies})` записывается в каждый event как `preStateHash` и `postStateHash`. Replayer после каждого `playCard` / `endTurn` вычисляет хэш текущего стейта и сравнивает с recorded `postStateHash`. Мismatch = точка расхождения с указанием turn и event type.

**Почему важно:** Хэш компактный, детерминированный, и указывает точно КОГДА разошлись runs. Полный JSON compare требовал бы хранения всех промежуточных стейтов. Паттерн аналогичен event sourcing checkpointing и distributed system state verification.

---

### D-20 — BDD на rule engine без UI: Cucumber как executable specification

**Проблема:** Нет UI, нет API — как продемонстрировать что правила читаемы и проверяемы на человеческом языке?

**Решение:** Cucumber с шагами которые вызывают `createGame()` + `game.endTurn()` напрямую. Feature файл — executable specification правил движка. Step definitions используют два режима: executor (для full game flow сценариев) и engine functions напрямую (для HP-точных граничных сценариев).

**Почему важно:** BDD = способ записать бизнес-правило, не инструмент для UI тестирования. "Given the Guardian stuns the hero" — это спецификация правила предметной области. Те же сценарии применимы к pricing engine, insurance rules, loan approval workflow. Убирает ложное предположение "BDD = браузер".

---

### D-21 — window.loadJSON() — testability hook для Playwright без рефакторинга

**Проблема:** Playwright не может вызвать file dialog для загрузки replay.json в debugger.html. `window.log = data; initDebugger()` не работает — `log` внутренняя переменная модуля.

**Решение:** Один метод в debugger.html специально для тестов:
```js
window.loadJSON = function(data) { log = data; initDebugger() }
```
Playwright вызывает через `page.evaluate`. Внутренняя архитектура не изменилась.

**Почему важно:** "Testability hook" — минимальная точка входа для внешнего тестирования. Не рефакторинг архитектуры. Паттерн встречается везде где нет public API: legacy code, game engines, embedded systems.

---

## RUNTIME

### D-22 — Vampire lifesteal: track before/after в pure functional pipeline

**Проблема:** Vampire lifesteal = восстановить HP равное фактически нанесённому урону (не больше missing_hp). `intent.value` — запланированный урон, не фактический: defend мог поглотить часть. Engine возвращает только новый state, не дельту "сколько урона нанесено".

**Решение:** Запомнить HP до `applyDamage`, вызвать, сравнить после:
```ts
const heroBefore = state.hero.hp
const s = applyDamage(state, heroId, intent.value)
const actualDmg = heroBefore - s.hero.hp  // реальный урон после defend
```

**Почему важно:** Паттерн "track before/after" для side effects в иммутабельных pipeline. Функция не возвращает побочный результат — только финальный state. Единственный способ получить дельту: `snapshot_before - snapshot_after`. Возникает везде где есть middleware/guard который может модифицировать входное значение: payment processing (`balance_before - balance_after` ≠ `planned_amount`), auth layers, rate limiters.

---

## TELEMETRY

### D-23 — TurnSnapshot vs hash: верификация и визуализация — разные артефакты

**Проблема:** Первая версия ReplayLog содержала только pre/post хэши событий. Debugger мог сказать "здесь что-то сломалось" — но не мог показать "HP было 18, статусы bleed+stun". Для integrity bars нужны реальные данные, не хэши.

**Решение:** Два отдельных артефакта с разными задачами:
- **Hash** (`preStateHash` / `postStateHash`) — 6-символьный hex. Доказывает что state был конкретным. Используется replayer для byte-perfect верификации.
- **TurnSnapshot** (полный state сущностей после каждого хода) — используется debugger для визуализации.

Атомарность: snapshot и turn_end event записываются из одного и того же `state` объекта — разнести их по времени = read-your-writes inconsistency.

**Почему важно:** Hash = verification. Snapshot = visualization. Путать их — либо хранить слишком много (snapshots для replay), либо не иметь возможности показать что произошло (только hashes для debugger). Паттерн аналогичен event sourcing: event log (верификация) + read model (визуализация) — два артефакта, два назначения.

---

## BOSS

### D-24 — `constraintViolation: true`: событие которое само объявляет что сломает инвариант

**Проблема:** Phase 4 Archivist намеренно инжектирует невалидное состояние. Обычный код пытается быть валидным — как явно объявить что код намеренно нарушит контракт и тест должен это поймать?

**Решение:** `CorruptionEvent` с полем `constraintViolation: true`. Явный контракт: "если `constraintViolation: true` → `assertValidGameState()` ОБЯЗАН бросить исключение":
```ts
applyCorruptionEvent(state, { type: 'invariant_breach', constraintViolation: true })
// → assertValidGameState() должен бросить TimelineCorruptedError
```

**Почему важно:** Failure detection становится first-class. Тест не угадывает "должно ли было упасть" — событие само объявляет свой контракт. Паттерн в distributed systems: poison message = сообщение которое намеренно помечено как "должно вызвать ошибку для тестирования dead letter queue."

---

### D-25 — Charge stacks выживают Phase 3 state_reset: design exception как executable specification

**Проблема:** Phase 3 Archivist сбрасывает все статусы. Дизайн-решение из DESIGN.md: charge stacks НЕ сбрасываются — они не статус, а ресурс героя. Без явного теста кто-то при рефакторинге добавит `chargeStacks: undefined` в state_reset и тихо сломает Paladin.

**Решение:** Решение из документа стало тестом:
```ts
it('charge stacks SURVIVE state reset (not a status)', () => {
  const after = applyCorruptionEvent(s, { type: 'state_reset' })
  expect(after.hero.chargeStacks).toBe(2)  // выживает Phase 3
})
```

**Почему важно:** Намеренные исключения из правил нарушаются при рефакторинге именно потому что они неочевидны. Комментарий в DESIGN.md не защищает. Тест который упадёт — защищает. `it.fails()` и targeted tests превращают дизайн-решения в executable specifications.
