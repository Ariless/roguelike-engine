import { describe, it, expect } from 'vitest'
import {
  step7_statusTick,
  step9_deathResolution,
  runTurn,
} from '../src/engine/turnPipeline'
import type { GameState } from '../src/engine/types'

function makeState(options: {
  heroHp?: number
  heroState?: GameState['hero']['state']
  heroStatuses?: GameState['hero']['statuses']
  enemies?: GameState['enemies']
} = {}): GameState {
  return {
    seed: 1,
    turn: 1,
    isOver: false,
    hero: {
      id: 'hero',
      name: 'Hero',
      hp: options.heroHp ?? 50,
      maxHp: 50,
      state: options.heroState ?? 'alive',
      statuses: options.heroStatuses ?? [],
      row: 'front',
      heroClass: 'paladin',
      formState: 'human',
      hand: [],
      energy: 3,
    },
    enemies: options.enemies ?? [],
  }
}

function makeGoblin(id: string, hp = 25, statuses: GameState['enemies'][0]['statuses'] = []) {
  return {
    id,
    name: 'Goblin',
    hp,
    maxHp: 25,
    state: 'alive' as const,
    statuses,
    row: 'front' as const,
    enemyType: 'goblin' as const,
    intent: { type: 'attack' as const, value: 6 },
  }
}

// ─── step7_statusTick ─────────────────────────────────────────────────────────

describe('step7_statusTick', () => {
  it('применяет bleed к герою', () => {
    const state = makeState({ heroHp: 30, heroStatuses: [{ name: 'bleed', stacks: 4 }] })
    const next = step7_statusTick(state)
    expect(next.hero.hp).toBe(26)
  })

  it('применяет bleed к врагу', () => {
    const goblin = makeGoblin('g1', 20, [{ name: 'bleed', stacks: 3 }])
    const state = makeState({ enemies: [goblin] })
    const next = step7_statusTick(state)
    expect(next.enemies[0].hp).toBe(17)
  })

  it('тикает всех сущностей одновременно', () => {
    const goblin = makeGoblin('g1', 20, [{ name: 'bleed', stacks: 2 }])
    const state = makeState({
      heroHp: 30,
      heroStatuses: [{ name: 'bleed', stacks: 5 }],
      enemies: [goblin],
    })
    const next = step7_statusTick(state)
    expect(next.hero.hp).toBe(25)
    expect(next.enemies[0].hp).toBe(18)
  })

  it('stun истекает после тика', () => {
    const state = makeState({ heroStatuses: [{ name: 'stun', stacks: 1, duration: 1 }] })
    const next = step7_statusTick(state)
    expect(next.hero.statuses.find(s => s.name === 'stun')).toBeUndefined()
  })

  it('bleed вызывает death_door на враге когда HP достигает 0', () => {
    const goblin = makeGoblin('g1', 3, [{ name: 'bleed', stacks: 5 }])
    const state = makeState({ enemies: [goblin] })
    const next = step7_statusTick(state)
    expect(next.enemies[0].state).toBe('death_door')
  })
})

// ─── step9_deathResolution ────────────────────────────────────────────────────

describe('step9_deathResolution', () => {
  it('герой с HP=0 и state=alive → death_door', () => {
    // Defensive: state that shouldn't exist normally, but step 9 must catch it
    const state = makeState({ heroHp: 0, heroState: 'alive' })
    const next = step9_deathResolution(state)
    expect(next.hero.state).toBe('death_door')
  })

  it('враг с HP=0 и state=alive → death_door', () => {
    const goblin = { ...makeGoblin('g1', 0), state: 'alive' as const }
    const state = makeState({ enemies: [goblin] })
    const next = step9_deathResolution(state)
    expect(next.enemies[0].state).toBe('death_door')
  })

  it('death_door остаётся death_door', () => {
    const state = makeState({ heroHp: 0, heroState: 'death_door' })
    const next = step9_deathResolution(state)
    expect(next.hero.state).toBe('death_door')
  })

  it('dead остаётся dead', () => {
    const state = makeState({ heroHp: 0, heroState: 'dead' })
    const next = step9_deathResolution(state)
    expect(next.hero.state).toBe('dead')
  })

  it('alive с HP > 0 не меняется', () => {
    const state = makeState({ heroHp: 20 })
    const next = step9_deathResolution(state)
    expect(next.hero.state).toBe('alive')
  })

  it('идемпотентен — второй вызов не меняет стейт', () => {
    const state = makeState({ heroHp: 0, heroState: 'alive' })
    const once = step9_deathResolution(state)
    const twice = step9_deathResolution(once)
    expect(twice.hero.state).toBe(once.hero.state)
  })
})

// ─── runTurn ──────────────────────────────────────────────────────────────────

describe('runTurn', () => {
  it('увеличивает счётчик хода', () => {
    const state = makeState()
    const next = runTurn(state)
    expect(next.turn).toBe(2)
  })

  it('применяет status tick за ход', () => {
    const state = makeState({ heroHp: 30, heroStatuses: [{ name: 'bleed', stacks: 3 }] })
    const next = runTurn(state)
    expect(next.hero.hp).toBe(27)
  })

  it('вызывает playerActions handler', () => {
    const state = makeState()
    const next = runTurn(state, {
      playerActions: (s) => ({ ...s, hero: { ...s.hero, hp: 10 } }),
    })
    expect(next.hero.hp).toBe(10)
  })

  it('вызывает enemyActions handler', () => {
    const goblin = makeGoblin('g1', 25)
    const state = makeState({ enemies: [goblin] })
    const next = runTurn(state, {
      enemyActions: (s) => ({
        ...s,
        enemies: s.enemies.map(e => ({ ...e, hp: e.hp - 5 })),
      }),
    })
    expect(next.enemies[0].hp).toBe(20)
  })

  it('bleed убивает врага за несколько ходов — корректные переходы состояний', () => {
    const goblin = makeGoblin('g1', 6, [{ name: 'bleed', stacks: 4 }])
    const state = makeState({ enemies: [goblin] })

    const turn2 = runTurn(state)
    expect(turn2.enemies[0].hp).toBe(2)
    expect(turn2.enemies[0].state).toBe('alive')

    const turn3 = runTurn(turn2)
    expect(turn3.enemies[0].hp).toBe(0)
    expect(turn3.enemies[0].state).toBe('death_door')
  })
})
