// Общий прогонный слой для симуляционных скриптов.
// simulate.ts и stability.ts гоняют один и тот же автоплеер — если он разъедется
// между скриптами, их отчёты начнут противоречить друг другу, и понять, какой
// прав, будет уже нельзя.

import { createGame } from '../../src/runtime/executor'
import { createRng, shuffle } from '../../src/runtime/rng'
import { saveFailingRun } from '../../src/telemetry/artifacts'
import type { HeroClass, EnemyType } from '../../src/engine/types'
import type { ReplayLog } from '../../src/telemetry/types'

export const HERO_CLASSES: readonly HeroClass[] =
  ['paladin', 'bloodmage', 'berserker', 'werewolf']

export const ENEMY_TYPES: readonly EnemyType[] =
  ['goblin', 'guardian', 'vampire', 'necromancer']

const HERO_CARDS: Record<HeroClass, string[]> = {
  paladin:   ['righteous_strike', 'divine_charge', 'stubborn_recovery'],
  bloodmage: ['chaos_bolt', 'open_the_wound', 'bloodrite'],
  berserker: ['savage_lunge', 'primal_fury', 'primal_dodge'],
  werewolf:  ['lunar_strike', 'pack_sense', 'stalk', 'rend', 'rampage', 'reality_crack'],
}

const SELF_ONLY = [
  'primal_dodge', 'stubborn_recovery', 'divine_charge', 'reality_crack', 'rampage',
]

// ─── Раскладка seed по конфигурациям ──────────────────────────────────────────
//
// Раньше обе координаты брались из одного остатка:
//     heroClass = HERO_CLASSES[seed % 4]
//     enemyType = ENEMY_TYPES[seed % 4]
// то есть seed выбирал не пару, а диагональ матрицы 4×4. Paladin встречал
// только Goblin, Werewolf — только Necromancer, и 12 из 16 сочетаний не
// проверялись ни на одном seed, сколько бы прогонов ни просили. Винрейты
// 99.8% и 100% — не свойство героев, а следствие того, что каждому из них
// доставался фиксированный противник.
//
// Теперь вторая координата берётся из старшей части seed: полный цикл по всем
// 16 парам, каждая получает ровно 1/16 прогонов.

export function configFor(seed: number): { heroClass: HeroClass; enemyType: EnemyType } {
  return {
    heroClass: HERO_CLASSES[seed % HERO_CLASSES.length],
    enemyType: ENEMY_TYPES[Math.floor(seed / HERO_CLASSES.length) % ENEMY_TYPES.length],
  }
}

export function matchupKey(heroClass: HeroClass, enemyType: EnemyType): string {
  return `${heroClass}|${enemyType}`
}

// ─── Автоплеер ────────────────────────────────────────────────────────────────
// Случайно-жадный: каждый ход разыгрывает 1–3 доступные карты в случайном
// порядке. Играет заведомо неоптимально — это осознанно. Винрейт неоптимальной
// игры показывает, есть ли в бою вызов вообще; винрейт идеальной игры показал
// бы только потолок.

export function autoPlay(seed: number, heroClass: HeroClass, enemyType: EnemyType): ReplayLog {
  const game = createGame({ seed, heroClass, enemyType })
  const rng = createRng(seed ^ 0xDEAD)  // отдельный поток на выбор карт

  for (let turn = 0; turn < 50; turn++) {
    if (game.getState().isOver) break

    const cards = shuffle(rng, HERO_CARDS[heroClass])
    const maxPlays = Math.floor(rng() * 3) + 1
    let played = 0

    for (const cardId of cards) {
      if (played >= maxPlays) break
      const s = game.getState()
      if (s.isOver) break

      const target = s.enemies.find(e => e.state !== 'dead')
      if (!target && !SELF_ONLY.includes(cardId)) continue

      game.playCard(cardId, target?.id ?? '')
      played++
    }

    if (game.getState().isOver) break
    game.endTurn()
  }

  return game.getLog()
}

// ─── Батч ─────────────────────────────────────────────────────────────────────

export interface ClassStats {
  wins: number
  losses: number
  turns: number[]
  corrupted: number
}

export interface MatchupStats {
  wins: number
  losses: number
  turns: number[]
}

export interface BatchResult {
  runs: number
  baseSeed: number
  perClass: Record<HeroClass, ClassStats>
  perMatchup: Map<string, MatchupStats>
  corrupted: number
  failingSeeds: number[]
}

function emptyClassStats(): ClassStats {
  return { wins: 0, losses: 0, turns: [], corrupted: 0 }
}

export interface BatchOptions {
  // Архивировать падающие прогоны в /artifacts/. Выключено в многобатчевом
  // режиме: сотня батчей засыпала бы каталог сотнями файлов про одно и то же.
  archiveFailures?: boolean
  onProgress?: (done: number, total: number) => void
}

export function runBatch(runs: number, baseSeed = 0, options: BatchOptions = {}): BatchResult {
  const { archiveFailures = true, onProgress } = options

  const perClass: Record<HeroClass, ClassStats> = {
    paladin:   emptyClassStats(),
    bloodmage: emptyClassStats(),
    berserker: emptyClassStats(),
    werewolf:  emptyClassStats(),
  }
  const perMatchup = new Map<string, MatchupStats>()
  const failingSeeds: number[] = []
  let corrupted = 0

  for (let i = 0; i < runs; i++) {
    const seed = baseSeed + i
    const { heroClass, enemyType } = configFor(seed)

    let log: ReplayLog
    try {
      log = autoPlay(seed, heroClass, enemyType)
    } catch {
      // Нарушен инвариант — таймлайн испорчен, исход не определён
      corrupted++
      failingSeeds.push(seed)
      perClass[heroClass].corrupted++
      onProgress?.(i + 1, runs)
      continue
    }

    const key = matchupKey(heroClass, enemyType)
    if (!perMatchup.has(key)) perMatchup.set(key, { wins: 0, losses: 0, turns: [] })
    const matchup = perMatchup.get(key)!

    const finalTurn = log.snapshots.length > 0
      ? log.snapshots[log.snapshots.length - 1].turn
      : 0

    if (log.outcome === 'hero_wins') {
      perClass[heroClass].wins++
      matchup.wins++
    } else if (log.outcome === 'hero_loses') {
      perClass[heroClass].losses++
      matchup.losses++
    }

    if (log.outcome !== 'in_progress') {
      perClass[heroClass].turns.push(finalTurn)
      matchup.turns.push(finalTurn)
    }

    // Расхождение хешей — сломан детерминизм, а не баланс. Отдельный класс отказа.
    if (log.snapshots.some(snap => !snap.hashValid)) {
      if (!failingSeeds.includes(seed)) failingSeeds.push(seed)
      if (archiveFailures) saveFailingRun(log)
    }

    onProgress?.(i + 1, runs)
  }

  return { runs, baseSeed, perClass, perMatchup, corrupted, failingSeeds }
}

export function winrateOf(s: { wins: number; losses: number }): number {
  const decided = s.wins + s.losses
  return decided > 0 ? s.wins / decided : NaN
}
