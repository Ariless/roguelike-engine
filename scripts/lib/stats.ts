// Статистика для симуляционных отчётов.
// Отдельно от harness.ts: это чистые функции над числами, они не знают ни про
// игру, ни про seed. Их можно проверять в отрыве от движка.

export interface Interval {
  low: number
  high: number
}

export function mean(xs: readonly number[]): number {
  if (xs.length === 0) return NaN
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

// Выборочная дисперсия (несмещённая, делитель n − 1).
export function variance(xs: readonly number[]): number {
  if (xs.length < 2) return NaN
  const m = mean(xs)
  return xs.reduce((acc, x) => acc + (x - m) ** 2, 0) / (xs.length - 1)
}

export function stdDev(xs: readonly number[]): number {
  return Math.sqrt(variance(xs))
}

export function percentile(xs: readonly number[], p: number): number {
  if (xs.length === 0) return NaN
  const sorted = [...xs].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[idx]
}

// ─── Доверительный интервал для доли ──────────────────────────────────────────
//
// Интервал Уилсона, а не обычный нормальный. Причина прикладная: винрейты в
// этом проекте прижаты к единице (класс выигрывает 99.8% боёв). Нормальный
// интервал в такой зоне даёт верхнюю границу больше 100% — то есть отчёт
// сообщает невозможное значение и выглядит сломанным ровно там, где на него
// смотрят внимательнее всего. Уилсон остаётся внутри [0, 1] при любой доле,
// включая 0 и 1, и не требует отдельной обработки крайних случаев.

export function wilsonInterval(successes: number, total: number, z = 1.96): Interval {
  if (total === 0) return { low: NaN, high: NaN }

  const p = successes / total
  const z2 = z * z
  const denominator = 1 + z2 / total
  const center = (p + z2 / (2 * total)) / denominator
  const spread =
    (z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) / denominator

  return {
    low: Math.max(0, center - spread),
    high: Math.min(1, center + spread),
  }
}

// Полуширина интервала — насколько ещё «плавает» оценка при данном числе прогонов.
export function marginOfError(successes: number, total: number, z = 1.96): number {
  const { low, high } = wilsonInterval(successes, total, z)
  return (high - low) / 2
}

// ─── Коридоры ─────────────────────────────────────────────────────────────────

export interface Corridor {
  min: number
  max: number
}

export type Verdict = 'PASS' | 'FAIL' | 'INCONCLUSIVE'

// Вердикт по доверительному интервалу, а не по точечной оценке.
//
// Точечная оценка на границе коридора ничего не значит: при 100 прогонах она
// шумит на десятки процентов. Поэтому:
//   PASS         — весь интервал внутри коридора
//   FAIL         — весь интервал снаружи, промах доказан
//   INCONCLUSIVE — интервал пересекает границу: прогонов не хватает, чтобы
//                  утверждать что-либо. Это не «почти PASS», это «не измерено».
export function verdictFor(value: Interval, corridor: Corridor): Verdict {
  if (value.low >= corridor.min && value.high <= corridor.max) return 'PASS'
  if (value.high < corridor.min || value.low > corridor.max) return 'FAIL'
  return 'INCONCLUSIVE'
}

// ─── Гистограмма ──────────────────────────────────────────────────────────────

export function histogram(xs: readonly number[]): Map<number, number> {
  const result = new Map<number, number>()
  for (const x of xs) result.set(x, (result.get(x) ?? 0) + 1)
  return new Map([...result.entries()].sort((a, b) => a[0] - b[0]))
}

// ─── Форматирование ───────────────────────────────────────────────────────────

export function pct(x: number, digits = 1): string {
  return `${(x * 100).toFixed(digits)}%`
}

export function bar(fraction: number, width = 10): string {
  const filled = Math.max(0, Math.min(width, Math.round(fraction * width)))
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}
