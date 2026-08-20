import { describe, it, expect } from 'vitest'
import { createRng, nextInt, pick, shuffle } from '../src/runtime/rng'

// ─── Зачем этот файл ──────────────────────────────────────────────────────────
//
// rng.test.ts проверяет КОНТРАКТ генератора: тот же seed → та же
// последовательность, значения в границах, shuffle не мутирует вход. Всё это
// свойства отдельного вызова.
//
// Здесь проверяется РАСПРЕДЕЛЕНИЕ: генератор, проходящий каждый тест из
// rng.test.ts, может при этом выдавать 1 вдвое чаще, чем 6. Контракт держится,
// баланс уезжает, и ни один существующий тест этого не увидит.
//
// Про флейки: статистический тест на случайных seed'ах падает раз в N прогонов
// по построению — это нормально для лаборатории и неприемлемо в CI. Все seed'ы
// здесь фиксированы, поэтому каждая метрика воспроизводима до последней цифры.
// Тест либо зелёный всегда, либо красный всегда. Красный означает, что кто-то
// изменил генератор, а не что сегодня не повезло.

// ─── Статистический аппарат ───────────────────────────────────────────────────

function chiSquare(observed: number[], expected: number): number {
  return observed.reduce((acc, o) => acc + (o - expected) ** 2 / expected, 0)
}

// Критические значения χ² при α = 0.001. Порог намеренно строгий: seed'ы
// фиксированы, запас нужен не от невезения, а от малых сдвигов распределения.
const CHI2_CRITICAL: Record<number, number> = {
  4:  18.467,
  5:  20.515,
  9:  27.877,
  23: 49.728,
  99: 148.230,
}

// Двусторонний нормальный порог при α = 0.001
const Z_CRITICAL = 3.291

function meanOf(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

// ─── Равномерность одного потока ──────────────────────────────────────────────

describe('распределение createRng', () => {
  it('значения равномерны по 100 бинам на четырёх независимых seed', () => {
    const N = 200_000
    const BINS = 100

    for (const seed of [1, 12345, 99999, 2 ** 31 - 1]) {
      const bins = new Array(BINS).fill(0)
      const rng = createRng(seed)
      for (let i = 0; i < N; i++) bins[Math.floor(rng() * BINS)]++

      expect(chiSquare(bins, N / BINS)).toBeLessThan(CHI2_CRITICAL[99])
    }
  })

  it('пары соседних значений равномерны по решётке 10×10', () => {
    // Ловит решётчатую структуру: у слабых генераторов точки (x_i, x_i+1)
    // ложатся на небольшое число гиперплоскостей вместо заполнения квадрата.
    const N = 200_000
    const SIDE = 10
    const cells = new Array(SIDE * SIDE).fill(0)
    const rng = createRng(777)

    for (let i = 0; i < N; i++) {
      const x = Math.floor(rng() * SIDE)
      const y = Math.floor(rng() * SIDE)
      cells[x * SIDE + y]++
    }

    expect(chiSquare(cells, N / (SIDE * SIDE))).toBeLessThan(CHI2_CRITICAL[99])
  })

  it('старший бит выпадает в половине случаев (monobit)', () => {
    const N = 500_000
    const rng = createRng(31337)
    let ones = 0
    for (let i = 0; i < N; i++) if (rng() >= 0.5) ones++

    // Доля ~ N(0.5, 1/(4N)) → z = (2·ones − N) / √N
    const z = (2 * ones - N) / Math.sqrt(N)
    expect(Math.abs(z)).toBeLessThan(Z_CRITICAL)
  })

  it('серии выше и ниже медианы имеют ожидаемую длину (runs test)', () => {
    // Генератор может дать идеально равномерную гистограмму и при этом ходить
    // длинными сериями «всё выше медианы / всё ниже». Гистограмма это пропустит.
    const N = 200_000
    const rng = createRng(4242)

    const bits: boolean[] = new Array(N)
    let ones = 0
    for (let i = 0; i < N; i++) {
      const above = rng() >= 0.5
      bits[i] = above
      if (above) ones++
    }
    const zeros = N - ones

    let runs = 1
    for (let i = 1; i < N; i++) if (bits[i] !== bits[i - 1]) runs++

    const expectedRuns = (2 * ones * zeros) / N + 1
    const varianceRuns =
      (2 * ones * zeros * (2 * ones * zeros - N)) / (N * N * (N - 1))
    const z = (runs - expectedRuns) / Math.sqrt(varianceRuns)

    expect(Math.abs(z)).toBeLessThan(Z_CRITICAL)
  })

  it('соседние значения не коррелируют (lag-1)', () => {
    const N = 500_000
    const rng = createRng(999)

    let sx = 0, sy = 0, sxy = 0, sxx = 0, syy = 0
    let prev = rng()
    for (let i = 0; i < N; i++) {
      const cur = rng()
      sx += prev; sy += cur; sxy += prev * cur
      sxx += prev * prev; syy += cur * cur
      prev = cur
    }

    const r =
      (N * sxy - sx * sy) /
      Math.sqrt((N * sxx - sx * sx) * (N * syy - sy * sy))

    // При независимости r ≈ N(0, 1/N)
    expect(Math.abs(r) * Math.sqrt(N)).toBeLessThan(Z_CRITICAL)
  })
})

// ─── Равномерность производных функций ────────────────────────────────────────
// Генератор может быть безупречен, а обёртка над ним — смещена. Классика:
// целочисленное сведение через остаток даёт лишний вес младшим значениям.

describe('распределение nextInt', () => {
  it('шестигранник не смещён', () => {
    const N = 600_000
    const bins = new Array(6).fill(0)
    const rng = createRng(2024)
    for (let i = 0; i < N; i++) bins[nextInt(rng, 1, 6) - 1]++

    expect(chiSquare(bins, N / 6)).toBeLessThan(CHI2_CRITICAL[5])
  })

  it('диапазон, не кратный степени двойки, не смещён', () => {
    // 1..10 — 10 не делит 2³², то есть именно тот случай, где сведение
    // целочисленного генератора к диапазону обычно и уезжает.
    const N = 500_000
    const bins = new Array(10).fill(0)
    const rng = createRng(555)
    for (let i = 0; i < N; i++) bins[nextInt(rng, 1, 10) - 1]++

    expect(chiSquare(bins, N / 10)).toBeLessThan(CHI2_CRITICAL[9])
  })

  it('среднее по диапазону сходится к середине', () => {
    const N = 200_000
    const rng = createRng(8080)
    const values: number[] = new Array(N)
    for (let i = 0; i < N; i++) values[i] = nextInt(rng, 0, 100)

    expect(meanOf(values)).toBeCloseTo(50, 1)
  })
})

describe('распределение pick', () => {
  it('каждый элемент выбирается одинаково часто', () => {
    const N = 500_000
    const items = ['a', 'b', 'c', 'd', 'e']
    const counts: Record<string, number> = { a: 0, b: 0, c: 0, d: 0, e: 0 }
    const rng = createRng(60606)
    for (let i = 0; i < N; i++) counts[pick(rng, items)]++

    expect(chiSquare(Object.values(counts), N / items.length))
      .toBeLessThan(CHI2_CRITICAL[4])
  })
})

describe('распределение shuffle', () => {
  it('все 24 перестановки четырёх элементов равновероятны', () => {
    // Тест на корректность Fisher-Yates. Наивная реализация (случайный индекс
    // по всей длине вместо оставшегося хвоста) даёт все перестановки, но с
    // разными вероятностями — видно только по такой гистограмме.
    const N = 240_000
    const permutations = new Map<string, number>()
    const rng = createRng(1234)

    for (let i = 0; i < N; i++) {
      const key = shuffle(rng, [0, 1, 2, 3]).join('')
      permutations.set(key, (permutations.get(key) ?? 0) + 1)
    }

    expect(permutations.size).toBe(24)
    expect(chiSquare([...permutations.values()], N / 24))
      .toBeLessThan(CHI2_CRITICAL[23])
  })

  it('каждый элемент попадает в каждую позицию одинаково часто', () => {
    const N = 200_000
    const SIZE = 5
    const positions = Array.from({ length: SIZE }, () => new Array(SIZE).fill(0))
    const rng = createRng(4321)

    for (let i = 0; i < N; i++) {
      const result = shuffle(rng, [0, 1, 2, 3, 4])
      for (let pos = 0; pos < SIZE; pos++) positions[result[pos]][pos]++
    }

    for (const row of positions) {
      expect(chiSquare(row, N / SIZE)).toBeLessThan(CHI2_CRITICAL[4])
    }
  })
})

// ─── Пространство seed: где генератор перестаёт держать обещание ──────────────
//
// Всё выше — про качество одного потока. Ниже — про то, что потоков на самом
// деле меньше, чем кажется. Для симуляции это важнее равномерности: два прогона,
// которые считаются независимыми, могут оказаться одним и тем же прогоном.

describe('пространство seed', () => {
  it('seed усечён до 32 бит: seed и seed + 2³² дают один поток', () => {
    // rng.ts:7 — `let s = seed >>> 0`. Всё, что выше 2³², молча теряется.
    // rng.test.ts:30 проверяет, что createRng(MAX_SAFE_INTEGER) не бросает
    // исключение — и проходит, потому что усечение исключения не бросает.
    // Тест зелёный, а seed при этом не тот, который передали.
    const a = createRng(7)
    const b = createRng(7 + 2 ** 32)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])

    // Number.MAX_SAFE_INTEGER схлопывается в 2³² − 1
    expect(createRng(Number.MAX_SAFE_INTEGER)()).toBe(createRng(4294967295)())
  })

  it('различимых seed ровно 2³², и это потолок числа независимых прогонов', () => {
    // Прямое следствие усечения: сколько бы прогонов ни просили, начиная
    // с 2³² они начнут повторять уже посчитанные.
    const DISTINCT_SEEDS = 2 ** 32

    expect(createRng(0)()).toBe(createRng(DISTINCT_SEEDS)())
    expect(createRng(1)()).toBe(createRng(DISTINCT_SEEDS + 1)())
  })

  it('соседние seed дают непересекающиеся потоки', () => {
    // Рабочий случай: simulate.ts берёт seed = номер прогона. Проверяем, что
    // на используемом отрезке потоки действительно расходятся.
    for (let seed = 0; seed < 200; seed++) {
      const a = createRng(seed)
      const b = createRng(seed + 1)
      const headA = [a(), a(), a(), a(), a()]
      const headB = [b(), b(), b(), b(), b()]
      expect(headA).not.toEqual(headB)
      expect(headA.slice(1)).not.toEqual(headB.slice(0, 4))
    }
  })

  it.fails('разные seed дают независимые потоки', () => {
    // Ложный инвариант — документирует реальное устройство генератора.
    //
    // mulberry32 продвигает состояние прибавлением константы 0x6D2B79F5.
    // Значит seed не выбирает поток, а выбирает точку входа в один общий
    // поток длины 2³². Два seed, отличающиеся ровно на эту константу, дают
    // одну и ту же последовательность со сдвигом на один шаг.
    //
    // Для simulate.ts с seed = 0…N это безопасно: расстояние между соседними
    // точками входа огромно. Опасность появляется в момент, когда seed начнут
    // брать из времени, хеша или счётчика с шагом — тогда два «независимых»
    // прогона могут оказаться одним, и статистика по ним будет считать
    // один результат дважды.
    const DELTA = 0x6D2B79F5
    const a = createRng(1)
    const b = createRng((1 + DELTA) >>> 0)

    const headA = [a(), a(), a(), a(), a()]
    const headB = [b(), b(), b(), b(), b()]

    // Assert намеренно ложный: headB — это headA, сдвинутый на один шаг
    expect(headA.slice(1)).not.toEqual(headB.slice(0, 4))
  })
})
