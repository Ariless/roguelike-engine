import { describe, it, expect } from 'vitest'
import {
  arp2_statusApplication,
  arp3_isBlocked,
  arp4_calculate,
  resolveAction,
} from '../src/engine/actionResolution'
import type { GameState } from '../src/engine/types'

function makeHero(hp = 50, statuses: GameState['hero']['statuses'] = []) {
  return {
    id: 'hero',
    name: 'Hero',
    hp,
    maxHp: 50,
    state: 'alive' as const,
    statuses,
    row: 'front' as const,
    heroClass: 'paladin' as const,
    formState: 'human' as const,
    hand: [],
    energy: 3,
  }
}

function makeEnemy(id: string, row: 'front' | 'back' = 'front', hp = 20, statuses: GameState['enemies'][0]['statuses'] = []) {
  return {
    id,
    name: 'Goblin',
    hp,
    maxHp: 20,
    state: 'alive' as const,
    statuses,
    row,
    enemyType: 'goblin' as const,
    intent: { type: 'attack' as const, value: 6 },
  }
}

function makeState(options: {
  heroHp?: number
  heroStatuses?: GameState['hero']['statuses']
  enemies?: GameState['enemies']
} = {}): GameState {
  return {
    seed: 1,
    turn: 1,
    isOver: false,
    hero: makeHero(options.heroHp ?? 50, options.heroStatuses ?? []),
    enemies: options.enemies ?? [],
  }
}

// ─── arp2_statusApplication ───────────────────────────────────────────────────

describe('arp2_statusApplication', () => {
  it('применяет bleed к цели', () => {
    const state = makeState({ enemies: [makeEnemy('g1')] })
    const next = arp2_statusApplication(state, {
      type: 'applyStatus',
      sourceId: 'hero',
      targetId: 'g1',
      status: { name: 'bleed', stacks: 3 },
    })
    const bleed = next.enemies[0].statuses.find(s => s.name === 'bleed')
    expect(bleed?.stacks).toBe(3)
  })

  it('не трогает стейт для damage-действий', () => {
    const state = makeState({ enemies: [makeEnemy('g1')] })
    const next = arp2_statusApplication(state, {
      type: 'damage',
      sourceId: 'hero',
      targetId: 'g1',
      amount: 5,
    })
    expect(next).toBe(state)
  })

  it('применяет stun к герою', () => {
    const state = makeState()
    const next = arp2_statusApplication(state, {
      type: 'applyStatus',
      sourceId: 'g1',
      targetId: 'hero',
      status: { name: 'stun', stacks: 1, duration: 1 },
    })
    expect(next.hero.statuses.some(s => s.name === 'stun')).toBe(true)
  })
})

// ─── arp3_isBlocked ───────────────────────────────────────────────────────────

describe('arp3_isBlocked', () => {
  it('melee атака на front-row врага не блокируется', () => {
    const state = makeState({ enemies: [makeEnemy('g1', 'front')] })
    expect(arp3_isBlocked(state, {
      type: 'damage', sourceId: 'hero', targetId: 'g1', amount: 5, rangeType: 'melee',
    })).toBe(false)
  })

  it('melee атака на back-row врага блокируется если front-row жив', () => {
    const state = makeState({ enemies: [makeEnemy('g1', 'front'), makeEnemy('g2', 'back')] })
    expect(arp3_isBlocked(state, {
      type: 'damage', sourceId: 'hero', targetId: 'g2', amount: 5, rangeType: 'melee',
    })).toBe(true)
  })

  it('melee атака на back-row врага проходит если front-row мёртв', () => {
    const frontDead = { ...makeEnemy('g1', 'front'), state: 'dead' as const }
    const state = makeState({ enemies: [frontDead, makeEnemy('g2', 'back')] })
    expect(arp3_isBlocked(state, {
      type: 'damage', sourceId: 'hero', targetId: 'g2', amount: 5, rangeType: 'melee',
    })).toBe(false)
  })

  it('ranged атака на back-row врага не блокируется', () => {
    const state = makeState({ enemies: [makeEnemy('g1', 'front'), makeEnemy('g2', 'back')] })
    expect(arp3_isBlocked(state, {
      type: 'damage', sourceId: 'hero', targetId: 'g2', amount: 5, rangeType: 'ranged',
    })).toBe(false)
  })

  it('ataka без rangeType не блокируется', () => {
    const state = makeState({ enemies: [makeEnemy('g1', 'front'), makeEnemy('g2', 'back')] })
    expect(arp3_isBlocked(state, {
      type: 'damage', sourceId: 'hero', targetId: 'g2', amount: 5,
    })).toBe(false)
  })
})

// ─── arp4_calculate ───────────────────────────────────────────────────────────

describe('arp4_calculate — damage', () => {
  it('наносит базовый урон', () => {
    const state = makeState({ enemies: [makeEnemy('g1')] })
    const { state: next } = arp4_calculate(state, {
      type: 'damage', sourceId: 'hero', targetId: 'g1', amount: 6,
    })
    expect(next.enemies[0].hp).toBe(14)
  })

  it('vulnerable умножает урон на 1.5 (floor)', () => {
    const vuln = makeEnemy('g1', 'front', 20, [{ name: 'vulnerable', stacks: 1 }])
    const state = makeState({ enemies: [vuln] })
    const { state: next, finalAmount } = arp4_calculate(state, {
      type: 'damage', sourceId: 'hero', targetId: 'g1', amount: 6,
    })
    // floor(6 * 1.5) = 9
    expect(finalAmount).toBe(9)
    expect(next.enemies[0].hp).toBe(11)
  })

  it('возвращает finalAmount без vulnerable', () => {
    const state = makeState({ enemies: [makeEnemy('g1')] })
    const { finalAmount } = arp4_calculate(state, {
      type: 'damage', sourceId: 'hero', targetId: 'g1', amount: 8,
    })
    expect(finalAmount).toBe(8)
  })
})

describe('arp4_calculate — heal', () => {
  it('восстанавливает HP герою', () => {
    const state = makeState({ heroHp: 30 })
    const { state: next } = arp4_calculate(state, {
      type: 'heal', sourceId: 'hero', targetId: 'hero', amount: 10,
    })
    expect(next.hero.hp).toBe(40)
  })

  it('HP не превышает maxHp', () => {
    const state = makeState({ heroHp: 45 })
    const { state: next } = arp4_calculate(state, {
      type: 'heal', sourceId: 'hero', targetId: 'hero', amount: 20,
    })
    expect(next.hero.hp).toBe(50)
  })
})

// ─── resolveAction (интеграция) ───────────────────────────────────────────────

describe('resolveAction', () => {
  it('damage action наносит урон', () => {
    const state = makeState({ enemies: [makeEnemy('g1')] })
    const next = resolveAction(state, {
      type: 'damage', sourceId: 'hero', targetId: 'g1', amount: 5,
    })
    expect(next.enemies[0].hp).toBe(15)
  })

  it('damage с vulnerable проходит через модификатор', () => {
    const vuln = makeEnemy('g1', 'front', 20, [{ name: 'vulnerable', stacks: 1 }])
    const state = makeState({ enemies: [vuln] })
    const next = resolveAction(state, {
      type: 'damage', sourceId: 'hero', targetId: 'g1', amount: 6,
    })
    expect(next.enemies[0].hp).toBe(11) // 20 - floor(6*1.5)=9
  })

  it('melee в back-row при живом front-row — стейт не меняется', () => {
    const state = makeState({ enemies: [makeEnemy('g1', 'front'), makeEnemy('g2', 'back')] })
    const next = resolveAction(state, {
      type: 'damage', sourceId: 'hero', targetId: 'g2', amount: 10, rangeType: 'melee',
    })
    expect(next.enemies[1].hp).toBe(20)
  })

  it('applyStatus action применяет статус', () => {
    const state = makeState({ enemies: [makeEnemy('g1')] })
    const next = resolveAction(state, {
      type: 'applyStatus', sourceId: 'hero', targetId: 'g1',
      status: { name: 'vulnerable', stacks: 1 },
    })
    expect(next.enemies[0].statuses.some(s => s.name === 'vulnerable')).toBe(true)
  })

  it('heal action восстанавливает HP', () => {
    const state = makeState({ heroHp: 20 })
    const next = resolveAction(state, {
      type: 'heal', sourceId: 'hero', targetId: 'hero', amount: 15,
    })
    expect(next.hero.hp).toBe(35)
  })

  it('onPostEffects handler вызывается после урона', () => {
    const state = makeState({ enemies: [makeEnemy('g1')] })
    let capturedDamage: number | undefined
    resolveAction(
      state,
      { type: 'damage', sourceId: 'hero', targetId: 'g1', amount: 7 },
      { onPostEffects: (s, _a, finalAmount) => { capturedDamage = finalAmount; return s } },
    )
    expect(capturedDamage).toBe(7)
  })
})
