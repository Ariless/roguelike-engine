import { describe, it, expect } from 'vitest'
import { ENEMY_INTENTS } from '../src/runtime/executor'
import type { EnemyType, Intent } from '../src/engine/types'

// ─── Зачем этот файл ──────────────────────────────────────────────────────────
//
// `CLAUDE.md`, раздел Rule priority: «If Decision Tables conflict with engine
// code, treat tables as intended spec — file a bug». До этого файла такого
// сравнения не делал никто: 391 тест проверял, что реализованный код работает
// правильно, и ни один не спрашивал, реализовано ли то, что описано.
//
// Разница принципиальная. Тест на существующий код ловит поломку. Сверка со
// спецификацией ловит отсутствие — механику, которая есть в трёх документах и
// в UI, но никогда не доехала до движка (BUG-14). Мутационное тестирование
// здесь тоже слепо: мутировать нечего, кода нет.
//
// ─── Почему сьют остаётся зелёным при известных разрывах ─────────────────────
//
// Два разрыва открыты и требуют не правки, а реализации механик. Красный тест,
// который нельзя закрыть, приучает игнорировать красный цвет — поэтому разрывы
// зафиксированы явным списком KNOWN_GAPS с точным описанием текущего поведения.
//
// Список работает в обе стороны:
//   — если расхождение изменится, тест упадёт: зафиксированное больше не верно
//   — если механику реализуют, тест упадёт с требованием убрать врага из списка
//
// То есть разрыв нельзя ни тихо ухудшить, ни тихо починить.

// ─── Спецификация ─────────────────────────────────────────────────────────────
//
// Источник — docs/DECISION-TABLES.md. Записано как данные, потому что парсинг
// markdown ломается от любой правки форматирования, а расхождение таблицы с
// этим блоком видно в diff.

// Спецификация НЕ выражается через тип Intent движка — и это принципиально.
// Первая версия этого файла описывала таблицы в терминах Intent, и модель
// немедленно соврала: заявленные действия некроманта (raise, empower) в типе
// Intent не существуют, поэтому в спецификацию попали только запасные ветки,
// которые с реализацией совпадают. Разрыв стал невидим ровно потому, что
// описывался словарём той стороны, у которой его нет.
//
// Спецификация обязана уметь называть то, чего в коде ещё нет.
interface SpecAction {
  kind: string
  value?: number
  lifesteal?: boolean
}

interface SpecTurn {
  // Основное заявленное действие хода.
  action: SpecAction
  // Ветвление по состоянию поля или героя, если таблица его объявляет,
  // и запасное действие, когда условие не выполнено.
  conditional?: string
  fallback?: SpecAction
}

const SPEC: Record<EnemyType, SpecTurn[]> = {
  // DECISION-TABLES.md — "Goblin — The Pressure"
  // Каждая строка идентична: одно условие (always), одно действие.
  goblin: [
    { action: { kind: 'attack', value: 6 } },
    { action: { kind: 'attack', value: 6 } },
    { action: { kind: 'attack', value: 6 } },
  ],

  // DECISION-TABLES.md — "Guardian — The Lockdown"
  // Shield → stun → punish. Ветвлений нет, последовательность фиксированная.
  guardian: [
    { action: { kind: 'defend' } },
    { action: { kind: 'stun' } },
    { action: { kind: 'attack', value: 10 } },
  ],

  // DESIGN.md:319-326 — "Vampire — the opportunist"
  vampire: [
    { action: { kind: 'attack', value: 6, lifesteal: true } },
    {
      action: { kind: 'attack', value: 6, lifesteal: true },
      conditional: 'hero has bleed → Exploit Wound: extra attack + amplified lifesteal',
      fallback: { kind: 'attack', value: 6 },
    },
    {
      action: { kind: 'attack', value: 12 },
      conditional: "hero at Death's Door → Execute",
      fallback: { kind: 'attack', value: 8 },
    },
  ],

  // DECISION-TABLES.md:71-93 — "Necromancer — The Accumulator"
  necromancer: [
    { action: { kind: 'bleed', value: 3 } },
    {
      action: { kind: 'raise' },
      conditional: 'ally corpse on field → Raise Dead spawns a Skeleton',
      fallback: { kind: 'bleed', value: 3 },
    },
    {
      action: { kind: 'empower', value: 3 },
      conditional: 'skeleton on field → Empower its next attack',
      fallback: { kind: 'vulnerable' },
    },
  ],
}

// Сравнение спецификации с реализацией. Действие, которого нет в типе Intent,
// не может совпасть ни с чем — это и есть искомый разрыв, а не ошибка сверки.
function matchesSpec(intent: Intent, action: SpecAction): boolean {
  if (intent.type !== action.kind) return false
  const intentValue = 'value' in intent ? intent.value : undefined
  if (action.value !== undefined && intentValue !== action.value) return false
  if (action.lifesteal !== undefined) {
    const intentLifesteal = intent.type === 'attack' ? intent.lifesteal === true : false
    if (intentLifesteal !== action.lifesteal) return false
  }
  return true
}

// ─── Зафиксированные разрывы ──────────────────────────────────────────────────

interface KnownGap {
  bug: string
  reason: string
  // Что движок делает СЕЙЧАС. Обязано совпадать точно: это защита от тихого
  // изменения разрыва.
  actual: Intent[]
}

const KNOWN_GAPS: Partial<Record<EnemyType, KnownGap>> = {
  vampire: {
    bug: 'BUG-14 (related)',
    reason:
      'Ход 2 по спецификации — атака (усиленная при bleed), в движке — наложение bleed 2. ' +
      'Ход 3 всегда 12 без ветки на 8. Условных интентов движок не поддерживает.',
    actual: [
      { type: 'attack', value: 6, lifesteal: true },
      { type: 'bleed', value: 2 },
      { type: 'attack', value: 12 },
    ],
  },
  necromancer: {
    bug: 'BUG-14',
    reason:
      'Raise Dead и Empower не существуют в движке: тип Intent содержит только ' +
      'attack/bleed/defend/stun. Механика реализована в game/index.html и в src/ ' +
      'встречается лишь в комментариях. Некромант не наносит прямого урона и ' +
      'проигрывает 4000 боёв из 4000.',
    actual: [
      { type: 'bleed', value: 3 },
      { type: 'bleed', value: 3 },
      { type: 'bleed', value: 3 },
    ],
  },
}

const ALL_ENEMIES = Object.keys(SPEC) as EnemyType[]

// ─── Полнота сверки ───────────────────────────────────────────────────────────

describe('покрытие спецификацией', () => {
  it('у каждого врага движка есть таблица решений', () => {
    expect(Object.keys(ENEMY_INTENTS).sort()).toEqual(ALL_ENEMIES.sort())
  })

  it('длина цикла интентов совпадает со спецификацией', () => {
    for (const enemy of ALL_ENEMIES) {
      expect(ENEMY_INTENTS[enemy].length, `${enemy}: длина цикла`).toBe(SPEC[enemy].length)
    }
  })
})

// ─── Соответствие ─────────────────────────────────────────────────────────────

describe('интенты соответствуют таблицам решений', () => {
  const compliant = ALL_ENEMIES.filter(e => !(e in KNOWN_GAPS))

  it.each(compliant)('%s выполняет ровно то, что описано', enemy => {
    SPEC[enemy].forEach((turn, index) => {
      expect(
        matchesSpec(ENEMY_INTENTS[enemy][index], turn.action),
        `${enemy} ход ${index + 1}: спецификация требует ` +
        `${JSON.stringify(turn.action)}, движок делает ` +
        `${JSON.stringify(ENEMY_INTENTS[enemy][index])}`,
      ).toBe(true)
    })
  })
})

// ─── Зафиксированные разрывы ──────────────────────────────────────────────────

describe('известные разрывы спецификации и движка', () => {
  const gaps = Object.keys(KNOWN_GAPS) as EnemyType[]

  it.each(gaps)('%s: разрыв не изменился', enemy => {
    const gap = KNOWN_GAPS[enemy]!
    expect(
      ENEMY_INTENTS[enemy],
      `Поведение ${enemy} изменилось, но KNOWN_GAPS не обновлён. ` +
      `Если механика реализована — убери врага из KNOWN_GAPS. ` +
      `Если изменилось что-то другое — обнови actual и проверь ${gap.bug}.`,
    ).toEqual(gap.actual)
  })

  it.each(gaps)('%s: разрыв всё ещё существует', enemy => {
    // Падает в тот момент, когда реализация догоняет спецификацию. Это и есть
    // сигнал закрыть BUG-14 и убрать врага из списка — иначе разрыв закроют,
    // а запись о нём останется висеть и введёт в заблуждение следующего.
    const compliant = SPEC[enemy].every((turn, index) =>
      matchesSpec(ENEMY_INTENTS[enemy][index], turn.action),
    )
    expect(
      compliant,
      `${enemy} теперь соответствует спецификации — убери его из KNOWN_GAPS ` +
      `и закрой ${KNOWN_GAPS[enemy]!.bug} в BUGS.md.`,
    ).toBe(false)
  })
})

// ─── Условные интенты ─────────────────────────────────────────────────────────

describe('условные строки таблиц решений', () => {
  it('движок не поддерживает условные интенты — все такие строки нереализуемы', () => {
    // Не придирка к отдельным врагам, а свойство модели: интент выбирается как
    // intents[turnIndex % length], состояние поля в выборе не участвует.
    // Пока это так, любая строка таблицы вида «если X → действие A, иначе B»
    // не может быть выполнена, каким бы ни было содержимое таблиц.
    const conditionalRows = ALL_ENEMIES.flatMap(enemy =>
      SPEC[enemy]
        .map((turn, index) => ({ enemy, turn: index + 1, condition: turn.conditional }))
        .filter(row => row.condition),
    )

    // Условные строки в таблицах есть — значит спецификация требует механизма,
    // которого нет. Тест фиксирует объём долга.
    expect(conditionalRows.length).toBeGreaterThan(0)

    // Ни один враг с условными строками не может им соответствовать.
    for (const row of conditionalRows) {
      expect(
        row.enemy in KNOWN_GAPS,
        `${row.enemy} ход ${row.turn} описан условием «${row.condition}», ` +
        `но условных интентов движок не поддерживает. Такой враг обязан быть ` +
        `в KNOWN_GAPS, пока механизм не появится.`,
      ).toBe(true)
    }
  })
})
