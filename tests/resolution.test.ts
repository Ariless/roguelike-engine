import { describe, it, expect } from 'vitest'
import { applyDamage, applyHeal } from '../src/engine/resolution'
import type { GameState } from '../src/engine/types'

// Вспомогательная функция — создаёт минимальный стейт для тестов
function makeState(options: {
  heroHp?: number
  heroDefend?: number
  enemyHp?: number
} = {}): GameState {
  return {
    seed: 1,
    turn: 1,
    isOver: false,
    hero: {
      id: 'hero',
      name: 'Hero',
      hp: options.heroHp ?? 50,
      maxHp: 90,
      state: 'alive',
      statuses: options.heroDefend
        ? [{ name: 'defend', stacks: options.heroDefend }]
        : [],
      row: 'front',
      heroClass: 'paladin',
      formState: 'human',
      hand: [],
      energy: 3,
    },
    enemies: [
      {
        id: 'goblin-0',
        name: 'Goblin',
        hp: options.enemyHp ?? 25,
        maxHp: 25,
        state: 'alive',
        statuses: [],
        row: 'front',
        enemyType: 'goblin',
        intent: { type: 'attack', value: 6 },
      },
    ],
  }
}

// ─── applyDamage ──────────────────────────────────────────────────────────────

describe('applyDamage', () => {
  it('уменьшает HP цели на величину урона', () => {
    const state = makeState({ enemyHp: 25 })
    const next = applyDamage(state, 'goblin-0', 10)
    expect(next.enemies[0].hp).toBe(15)
  })

  it('HP не уходит ниже 0', () => {
    const state = makeState({ enemyHp: 5 })
    const next = applyDamage(state, 'goblin-0', 100)
    expect(next.enemies[0].hp).toBe(0)
  })

  it('alive → death_door когда HP доходит до 0', () => {
    const state = makeState({ enemyHp: 10 })
    const next = applyDamage(state, 'goblin-0', 10)
    expect(next.enemies[0].state).toBe('death_door')
  })

  it('defend поглощает урон перед HP', () => {
    const state = makeState({ heroHp: 45, heroDefend: 4 })
    const next = applyDamage(state, 'hero', 10)
    // defend поглотил 4, реальный урон = 6
    expect(next.hero.hp).toBe(39)
  })

  it('defend удаляется после поглощения', () => {
    const state = makeState({ heroHp: 45, heroDefend: 4 })
    const next = applyDamage(state, 'hero', 10)
    const defend = next.hero.statuses.find(s => s.name === 'defend')
    expect(defend).toBeUndefined()
  })

  it('defend частично поглощает — остаток остаётся', () => {
    const state = makeState({ heroHp: 45, heroDefend: 8 })
    const next = applyDamage(state, 'hero', 5)
    // урон 5, defend 8 → поглотил 5, осталось 3
    const defend = next.hero.statuses.find(s => s.name === 'defend')
    expect(defend?.stacks).toBe(3)
    expect(next.hero.hp).toBe(45) // HP не изменился
  })

  it('не меняет других врагов', () => {
    const state = makeState({ enemyHp: 25 })
    const next = applyDamage(state, 'goblin-0', 10)
    expect(next.hero.hp).toBe(state.hero.hp)
  })

  it('death_door → dead при повторном ударе', () => {
    const state = makeState({ enemyHp: 0 })
    const atDoor = { ...state, enemies: [{ ...state.enemies[0], state: 'death_door' as const }] }
    const next = applyDamage(atDoor, 'goblin-0', 5)
    expect(next.enemies[0].state).toBe('dead')
  })

  it('мёртвая сущность не получает урон', () => {
    const state = makeState({ enemyHp: 5 })
    const dead = { ...state, enemies: [{ ...state.enemies[0], state: 'dead' as const }] }
    const next = applyDamage(dead, 'goblin-0', 10)
    expect(next.enemies[0].hp).toBe(5)
    expect(next.enemies[0].state).toBe('dead')
  })
})

// ─── applyHeal ────────────────────────────────────────────────────────────────

describe('applyHeal', () => {
  it('восстанавливает HP', () => {
    const state = makeState({ heroHp: 30 })
    const next = applyHeal(state, 'hero', 20)
    expect(next.hero.hp).toBe(50)
  })

  it('HP не превышает maxHp', () => {
    const state = makeState({ heroHp: 85 })
    const next = applyHeal(state, 'hero', 100)
    expect(next.hero.hp).toBe(90) // maxHp = 90
  })

  it('death_door → alive при лечении', () => {
    const state = makeState({ heroHp: 0 })
    const withDoor = { ...state, hero: { ...state.hero, state: 'death_door' as const } }
    const next = applyHeal(withDoor, 'hero', 10)
    expect(next.hero.state).toBe('alive')
  })
})
