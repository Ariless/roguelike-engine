# Bug Cemetery

Every real bug found during implementation. Seed · root cause · how found · fix.

---

## BUG-01 — Charge order: stun на героя не снимался

**Date:** 2026-05-30  
**Found by:** manual playtesting (game UI)  
**Symptom:** После того как Guardian применяет Stun к герою, герой навсегда остаётся stunned — карты недоступны, из этого состояния невозможно выйти.

**Root cause:** `tickStatuses()` обрабатывает только `bleed`. Stun на герое никогда не снимался — не было кода для его удаления по истечении хода.

**Fix:** В начале `endTurn()`, до status ticks, добавлена явная проверка:
```js
if (hasStatus(gs.hero, 'stun')) {
  removeStatus(gs.hero, 'stun')
  addLog(gs, '⚡ Stun cleared')
}
```
Stun снимается когда герой заканчивает ход в stunned состоянии (они пропустили свои действия — это и есть эффект stun).

**Invariant, который мог бы поймать это раньше:**  
`forAll(seeds, s => stunSkipsExactlyOneTurn(simulate(s)))` — добавить в property tests.

**Testing value:** Показывает разницу между "stun = не можешь действовать" и "stun = флаг который автоматически не сбрасывается". Типичный bug класса "state never cleared" — встречается в payment processing, workflow engines, anywhere с explicit state flags.

---

## BUG-02 — Charge + vulnerable: неправильный порядок side effects

**Date:** 2026-05-24 (найден при написании тестов Paladin)  
**Found by:** unit test `при 3 зарядах + vulnerable: заряды → 1`  
**Symptom:** При зарядах=3 и цели с vulnerable: ожидали что после атаки заряды = 1 (сброс до 0, потом +1 от vulnerable). Получали 0.

**Root cause:** Порядок операций в `playRighteousStrike`:
1. Сброс зарядов (step 4) — заряды = 0
2. +1 заряд от vulnerable (step 5) — должно быть 1

Но step 5 читал `s.hero.chargeStacks` который уже был 0 после сброса. Код не использовал результат step 4 корректно — читал из неправильного объекта стейта.

**Fix:** Step 5 читает из уже обновлённого `s` (после сброса), а не из исходного стейта.

**Testing value:** Иллюстрирует почему порядок pipeline шагов критичен. Mutation testing цель: изменить порядок step 4/5 → тест падает.

---

## BUG-03 — TypeScript narrowing: `'dead'` не присваивался `newState`

**Date:** 2026-05-30  
**Found by:** `npx tsc --noEmit` при добавлении Blood Mage  
**Symptom:** Compile error: `Type '"dead"' is not assignable to type '"alive" | "death_door"'` на строке присваивания `newState = 'dead'` в `applyDamage`.

**Root cause:** TypeScript control-flow narrowing. В начале `applyDamage` есть guard:
```ts
if (!target || target.state === 'dead') return state
```
После этой проверки TS знает что `target.state` — это `'alive' | 'death_door'` (не `'dead'`).
Строка `let newState = target.state` инициализирована из уже суженного типа — TS выводит тип переменной как `'alive' | 'death_door'`, не как `EntityState`. Последующее присваивание `'dead'` не компилируется.

**Fix:** Явная аннотация расширяет тип обратно до полного union:
```ts
let newState: EntityState = target.state
```

**Invariant, который мог бы поймать это раньше:**  
CI с `tsc --noEmit` на каждый push — если бы был git-репо. Сейчас тип-чек запускается вручную.

**Testing value:** Классический TypeScript gotcha — «слишком умный» вывод типа. Когда guard сужает тип аргумента, инициализированные из него переменные наследуют суженный тип. Решение: всегда явно аннотировать state-машинные переменные, не полагаться на inference.

---

## BUG-04 — Enemy в death_door действовал перед смертью

**Date:** 2026-05-30  
**Found by:** playtesting (game UI) — скриншот: оба hero и enemy на 0 HP, герой stunned, enemy атаковал героя и победил

**Symptom:** Враг уходил в death_door (HP = 0) после хода героя. При нажатии End Turn враг успевал выполнить свой intent (атаку) ДО разрешения смерти — убивал героя, который тоже был на Death's Door. Требовался дополнительный End Turn чтобы враг умер.

**Root cause:** `endTurn()` не проверял состояние врага перед тем как вызвать `executeEnemyIntent`. Enemy в state `death_door` проходил условие `gs.enemy.state !== 'dead'` и получал право действовать. Death resolution для enemy происходил только через bleed tick — без bleed враг "застревал" в death_door до следующего хода героя.

**Fix (attempt 1 — неполный):** В начале `endTurn()` добавлена проверка:
```js
if (gs.enemy.state === 'death_door') { gs.enemy.state = 'dead'; checkWin(gs); ... }
```
Закрыл путь через End Turn, но не путь через card play — враг всё ещё оставался в death_door в середине хода героя (0 HP, можно было бить впустую).

**Fix (attempt 2 — полный):** В `dealDamage()`, сразу после `applyDamageToEntity`:
```js
if (target === 'enemy' && entity.state === 'death_door') {
  entity.state = 'dead'
}
```
Enemy умирает мгновенно при попадании в 0 HP во время card play. Герой по-прежнему остаётся в death_door — его можно вылечить. `endTurn` check оставлен как safety net для death_door через bleed tick.

**Invariant, который мог бы поймать это раньше:**  
`forAll(seeds, s => enemyNeverInDeathDoorAfterCardPlay(simulate(s)))` — после любого action enemy не должен быть в state `death_door`.

**Testing value:** Классический race condition в state machine + неполный фикс. Первый фикс закрыл один из двух путей воспроизведения, второй — системный. Показывает: фикс "в одном месте" не покрывает все пути к багу — нужно закрывать на уровне инварианта ("enemy не может быть в death_door"), а не на уровне конкретного вызывающего кода.

---

## BUG-05 — Berserker не трансформировался: `heroClass` отсутствовал в game state

**Date:** 2026-05-30  
**Found by:** playtesting — берсеркер не менял форму при HP ≤ 50%

**Symptom:** При выборе Berserker в UI и снижении HP до 14 и ниже трансформация не срабатывала. Портрет не менялся, рука оставалась human-картами, бейдж WOLF не появлялся.

**Root cause:** В `HERO_DEFS.berserker` отсутствовало поле `heroClass`. При создании game state через `{ ...HERO_DEFS[forcedHero], ... }` поле не попадало в `gs.hero`. `checkBerserkerTransformGame()` начинается с `if (gs.hero.heroClass !== 'berserker') return` — условие `undefined !== 'berserker'` = `true`, функция возвращалась немедленно. Та же проблема приводила к тому что rage pips и form badge не рендерились (`renderHero` тоже проверяет `h.heroClass`).

**Fix:** Добавлен `heroClass` во все три записи `HERO_DEFS`:
```js
bloodmage: { heroClass: 'bloodmage', ... }
paladin:   { heroClass: 'paladin',   ... }
berserker: { heroClass: 'berserker', ... }
```

**Invariant, который мог бы поймать это раньше:**  
`assert(gs.hero.heroClass !== undefined)` в `assertValidGameState()` — обязательные поля hero должны проверяться при инициализации.

**Testing value:** Классический "silent failure" — функция возвращается без ошибки, просто ничего не происходит. Отсутствующее поле в конфиге не бросает exception, просто меняет логику. Показывает ценность schema validation на системных границах (createGameState = граница между конфигом и runtime).

---

## BUG-06 — Property test generator: граничное значение 25% попало в "выше 25%" зону

**Date:** 2026-05-30  
**Found by:** fast-check — shrunk до контрпримера `[{hp:0, maxHp:4}, base=2]`

**Symptom:** Тест "HP > 25% → rage неактивна, базовый урон" упал. Ожидали `rageDamage = 2`, получили `3` (×1.5 бонус).

**Root cause:** Генератор HP использовал `Math.max(Math.floor(maxHp * 0.26), 1)` для вычисления "гарантированно выше 25%". При `maxHp=4`: `Math.floor(4 * 0.26) = Math.floor(1.04) = 1`. Но порог rage: `Math.floor(4 * 0.25) = Math.floor(1.0) = 1`. Итог: `hp=1, threshold=1` → rage активна, хотя тест считал что тестирует "HP выше порога".

Проблема в самом тесте, а не в `isInRage` — функция работала корректно.

**Fix:** Генератор изменён на `Math.floor(maxHp * 0.25) + 1` — гарантированно выше threshold независимо от rounding:
```ts
fc.integer({ min: Math.floor(maxHp * 0.25) + 1, max: maxHp }).map(hp => ({ hp, maxHp }))
```

**Как нашли:** Fast-check сжал до минимального контрпримера за 10 шагов shrinking: `maxHp=4, hp=1, base=2`. Без shrinking баг был бы невидим на большинстве значений.

**Invariant, который мог бы поймать это раньше:**  
Комментарий "hp > 25%" в тесте — но проверить что generator действительно генерирует значения ВЫШЕ порога, не РАВНЫЕ ему.

**Testing value:** Классический off-by-one в boundary generator. Граничные значения в property tests — отдельная точка отказа. Показывает: fast-check shrinking находит не только баги в SUT, но и баги в самих тестах.

---

## BUG-07 — Form badge показывался для Berserker вместо Werewolf после split

**Date:** 2026-05-30  
**Found by:** playtesting после разделения Berserker/Werewolf

**Symptom:** После разделения героев форм-бейдж (HUMAN / 🐺 WOLF) не отображался для Werewolf. Переключение формы происходило корректно, но бейдж на портрете был невидим.

**Root cause:** `renderHero` проверял `h.heroClass === 'berserker'` для показа form badge. После split у Werewolf `heroClass: 'werewolf'` — условие никогда не срабатывало.

**Fix:** Изменено условие:
```js
if (h.heroClass === 'berserker') → if (h.heroClass === 'werewolf')
```

**Invariant:** Schema validation при split — при переименовании `heroClass` нужно grep по всему коду.

**Testing value:** После рефакторинга (rename/split) hardcoded строки остаются в коде и не обновляются. Показывает ценность поиска по всем вхождениям строки при переименовании типов.

---

## BUG-08 — HERO_DEFS.werewolf.hand содержал старые берсеркер-карты

**Date:** 2026-05-30  
**Found by:** code review при добавлении Werewolf в game UI

**Symptom:** При выборе Werewolf в начале боя рука содержала Savage Lunge / Primal Fury / Primal Dodge (карты Берсеркера) вместо Lunar Strike / Pack Sense / Stalk.

**Root cause:** При создании HERO_DEFS.werewolf поле `hand` (начальная рука при старте игры) было скопировано из старого HERO_DEFS.berserker и не обновлено:
```js
hand: ['savage_lunge', 'primal_fury', 'primal_dodge'],  // ← старые карты
```
`humanHand` был правильным (`['lunar_strike', 'pack_sense', 'stalk']`), но `hand` (используется в `makeGameState`) — нет.

**Fix:** `hand: ['lunar_strike', 'pack_sense', 'stalk']` — синхронизирован с `humanHand`.

**Invariant:** `hand === humanHand` для всех героев с трансформацией в начале игры.

**Testing value:** Два поля (`hand` и `humanHand`) дублируют информацию — точка рассинхронизации. Паттерн встречается везде где есть "initial value" + "current value" — они расходятся при копировании конфига.

---

## BUG-09 — Cancel hint в flex-контейнере сдвигал панели врагов при выборе карты

**Date:** 2026-05-30  
**Found by:** playtesting — при выборе карты панели двух врагов смещались вправо

**Symptom:** Когда игрок выбирал карту, появлялась надпись "ESC — CANCEL". Она находилась в `.battle-area` flex-контейнере как третий элемент после `#heroPanel` и `#enemiesArea`. При `display: block` она занимала место в flex-row и сдвигала врагов влево, освобождая пустое место справа.

**Root cause:** `<div id="cancelHint">` был дочерним элементом `.battle-area` (flex container). `position: static` (default) → элемент участвует в flex layout. При появлении занимает ширину.

**Fix:** `position: absolute` + `bottom: 4px; left: 50%; transform: translateX(-50%)` — элемент вынут из flex-flow, отображается поверх контента. `.battle-area` получил `position: relative` как anchor.

**Invariant:** UI-элементы которые показываются/скрываются не должны влиять на layout соседних элементов. Используй `visibility: hidden` или `position: absolute` вместо `display: none/block` если элемент в flex/grid.

**Testing value:** Классический "layout shift" баг — элемент меняет layout при появлении. Встречается в toast notifications, tooltips, error messages. Решение одно: вынести из document flow через absolute/fixed positioning.

---

## BUG-10 — Flash анимация на портрете атакующего врага стиралась render()

**Date:** 2026-05-30  
**Found by:** playtesting — визуальный флэш при атаке врага не был виден

**Symptom:** `flashAttacker(enemyId)` добавлял CSS класс `attacking-now` к portrait frame во время `endTurn()`. Анимация не отображалась.

**Root cause:** `endTurn()` запускается синхронно: `flashAttacker()` → ... → `render()`. Внутри `renderEnemies()` строка `frame.className = 'portrait-frame enemy-frame'` сбрасывала все классы включая `attacking-now` — браузер не успевал отрисовать анимацию до сброса.

**Fix:** `setTimeout(() => flashAttacker(_eid), 50)` — флэш запускается через 50ms после завершения синхронного `render()`, когда браузер уже отрисовал новый кадр.

**Invariant:** CSS анимации добавленные до `render()` стираются следующим вызовом render. Анимации после render нужно планировать через setTimeout.

**Testing value:** Race condition между JavaScript-мутацией DOM и CSS animation pipeline. Браузер не гарантирует отрисовку между синхронными операциями — `setTimeout(fn, 0)` или `requestAnimationFrame` нужны для "следующий кадр". Паттерн встречается в toast, flash messages, transition triggers.

---

## BUG-11 — turn_end не записывался при досрочном выходе из endTurn

**Date:** 2026-05-30  
**Found by:** replay тест "replays a full game until hero loses" — `result.finalState.winner` = null вместо 'enemies'

**Symptom:** При проигрыше героя (enemy убивает во время endTurn) реплей не воспроизводил последний ход. `result.finalState.isOver` = false после replay, хотя оригинал заканчивался проигрышем.

**Root cause:** `record('turn_end', ...)` стоял в конце `endTurn()` после всех ранних выходов (`if (state.isOver) return state`). Когда герой умирал на шаге enemy_action, функция возвращалась досрочно — `turn_end` event не записывался. Replayer итерирует log и вызывает `endTurn()` только когда видит `turn_end` событие. Без него последний ход не воспроизводился.

**Fix:** `record('turn_end', ...)` добавлен во все ранние выходы из endTurn — перед каждым `return state` при `isOver`.

**Invariant:** Каждый вызов `endTurn()` должен порождать ровно один `turn_end` event в логе, независимо от пути выполнения.

**Testing value:** Классический "happy path only" — код корректно записывал события при нормальном завершении, но пропускал их при ранних выходах. Показывает ценность тестирования terminal states (game over, timeout, error paths) наравне с happy path.

---

## BUG-12 — recordSnapshot пропущен в одном из early returns endTurn

**Date:** 2026-05-30  
**Found by:** fast-check property test — counterexample `[12245, 'paladin', 'guardian']`

**Symptom:** Тест `snapshots.length === turn_end events` упал: 20 snapshots vs 21 turn_end events. Один ход был в логе (turn_end записан) но без snapshot в `log.snapshots`.

**Root cause:** В executor.ts было 4 пути выхода из `endTurn()` — три ранних return + нормальный конец. При добавлении `recordSnapshot` три пути обновились, один пропустили:

```ts
// enemy action kills hero — ранний выход
if (state.isOver) {
  log.outcome = 'hero_loses'
  record('turn_end', turnEndPre, state)
  // ← recordSnapshot(state) ОТСУТСТВОВАЛ
  record('game_over', state, state)
  return state
}
```

Три других пути имели `recordSnapshot` — только этот пропустили.

**Fix:** `recordSnapshot(state)` добавлен между `record('turn_end', ...)` и `record('game_over', ...)`.

**Как нашли:** Fast-check сгенерировал 200 случайных (seed, heroClass, enemyType) комбинаций. На seed=12245 / paladin / guardian invariant сломался. Shrinking выдал минимальный контрпример.

**Invariant:** Каждый вызов `endTurn()` порождает ровно один `turn_end` event И ровно один snapshot — независимо от пути выполнения.

**Testing value:** Классический "пропущенный путь" баг — код обновлялся в 3 из 4 мест. Четвёртое место не бросало ошибку, просто не создавало snapshot. Property test нашёл это за 200 прогонов там, где code review мог пропустить.

---

## MUTATION-01 — Результаты первого прогона Stryker (2026-05-30)

**Date:** 2026-05-30  
**Tool:** Stryker v9.6 + vitest runner  
**Mutated files:** resolution.ts, statuses.ts, heroes/*.ts

### Итоговые оценки (после трёх раундов targeted тестов)

| Файл | Round 1 | Final | Что убито целенаправленно |
|------|---------|-------|--------------------------|
| resolution.ts | 92.4% | 92.4% | — (хорошо с первого раза) |
| statuses.ts | 91.7% | ~94% | hasStatus always-true, duration filter, updateEntity |
| paladin.ts | 78.8% | **80.3%** | `?? 0` → `&& 0` boundary, undefined chargeStacks |
| berserker.ts | 68.5% | **69.9%** | Savage Lunge multi-enemy, rage 25% boundary |
| bloodmage.ts | 67.1% | 67.1% | StringLiteral survivors — не приоритет |
| werewolf.ts | 67.3% | 67.3% | StringLiteral survivors — не приоритет |
| **Overall** | **77.96%** | **~79%** | Выше типичного (65–75%) |

### Что значит каждый результат

**resolution.ts 92%** — pipeline шаги applyDamage и applyHeal защищены. 7 выживших — edge cases в boundary conditions (например: урон ровно равный HP при death_door). Не критично.

**statuses.ts 94%** — после добавления negative тестов. Три мутанта убиты явно: `hasStatus always-true`, `duration filter false`, `updateEntity always-update`. Оставшиеся 9 — мутации в stacking logic которые требуют более точных числовых assertions.

**heroes/* 69%** — 117 выживших. Конкретные проблемные паттерны:
- Conditional card effects (если X → то Y) тестируются только позитивно
- Boundary values в rage/charge/transform threshold не все покрыты
- AoE карты (rampage, reality_crack) — мутации в filter/iteration не пойманы

**Overall 78%** — выше среднего по индустрии (65–75%). При score < 70% тест-сьют ненадёжен как сеть безопасности. При 78% можно рефакторить core logic уверенно, hero-specific логика требует внимания.

### Убитые мутанты (целенаправленно)

| Мутант | Место | Как убит |
|--------|-------|----------|
| `hasStatus` always-true | statuses.ts:100 | Negative test: `expect(hasStatus(e, 'stun')).toBe(false)` когда только bleed |
| Duration filter → false | statuses.ts:91 | Test: bleed без duration не удаляется; duration:2 не удаляется после 1 тика |
| updateEntity all enemies | statuses.ts:120 | Test: статус e0 не попадает на e1 при двух врагах |

### Следующие цели (heroes 69%→80%)

Убить оставшихся в hero файлах:
1. `berserker.ts` — rage threshold boundary (≤25% exact), isInRage(dead entity)
2. `bloodmage.ts` — open_the_wound pre/post bleed check, vulnerable not applied twice
3. `werewolf.ts` — wolfDamage formula (×2 at 0 HP exact), transform exactly at 50%
