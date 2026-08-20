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
  it('applies bleed to the target', () => {
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

  it('leaves the state alone for damage actions', () => {
    const state = makeState({ enemies: [makeEnemy('g1')] })
    const next = arp2_statusApplication(state, {
      type: 'damage',
      sourceId: 'hero',
      targetId: 'g1',
      amount: 5,
    })
    expect(next).toBe(state)
  })

  it('applies stun to the hero', () => {
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
  it('a melee attack on a front-row enemy is not blocked', () => {
    const state = makeState({ enemies: [makeEnemy('g1', 'front')] })
    expect(arp3_isBlocked(state, {
      type: 'damage', sourceId: 'hero', targetId: 'g1', amount: 5, rangeType: 'melee',
    })).toBe(false)
  })

  it('a melee attack on a back-row enemy is blocked while the front row is alive', () => {
    const state = makeState({ enemies: [makeEnemy('g1', 'front'), makeEnemy('g2', 'back')] })
    expect(arp3_isBlocked(state, {
      type: 'damage', sourceId: 'hero', targetId: 'g2', amount: 5, rangeType: 'melee',
    })).toBe(true)
  })

  it('a melee attack on a back-row enemy lands once the front row is dead', () => {
    const frontDead = { ...makeEnemy('g1', 'front'), state: 'dead' as const }
    const state = makeState({ enemies: [frontDead, makeEnemy('g2', 'back')] })
    expect(arp3_isBlocked(state, {
      type: 'damage', sourceId: 'hero', targetId: 'g2', amount: 5, rangeType: 'melee',
    })).toBe(false)
  })

  it('a ranged attack on a back-row enemy is not blocked', () => {
    const state = makeState({ enemies: [makeEnemy('g1', 'front'), makeEnemy('g2', 'back')] })
    expect(arp3_isBlocked(state, {
      type: 'damage', sourceId: 'hero', targetId: 'g2', amount: 5, rangeType: 'ranged',
    })).toBe(false)
  })

  it('an attack without rangeType is not blocked', () => {
    const state = makeState({ enemies: [makeEnemy('g1', 'front'), makeEnemy('g2', 'back')] })
    expect(arp3_isBlocked(state, {
      type: 'damage', sourceId: 'hero', targetId: 'g2', amount: 5,
    })).toBe(false)
  })
})

// ─── arp4_calculate ───────────────────────────────────────────────────────────

describe('arp4_calculate — damage', () => {
  it('deals base damage', () => {
    const state = makeState({ enemies: [makeEnemy('g1')] })
    const { state: next } = arp4_calculate(state, {
      type: 'damage', sourceId: 'hero', targetId: 'g1', amount: 6,
    })
    expect(next.enemies[0].hp).toBe(14)
  })

  it('vulnerable multiplies damage by 1.5 (floored)', () => {
    const vuln = makeEnemy('g1', 'front', 20, [{ name: 'vulnerable', stacks: 1 }])
    const state = makeState({ enemies: [vuln] })
    const { state: next, finalAmount } = arp4_calculate(state, {
      type: 'damage', sourceId: 'hero', targetId: 'g1', amount: 6,
    })
    // floor(6 * 1.5) = 9
    expect(finalAmount).toBe(9)
    expect(next.enemies[0].hp).toBe(11)
  })

  it('returns finalAmount when vulnerable is absent', () => {
    const state = makeState({ enemies: [makeEnemy('g1')] })
    const { finalAmount } = arp4_calculate(state, {
      type: 'damage', sourceId: 'hero', targetId: 'g1', amount: 8,
    })
    expect(finalAmount).toBe(8)
  })
})

describe('arp4_calculate — heal', () => {
  it('restores HP to the hero', () => {
    const state = makeState({ heroHp: 30 })
    const { state: next } = arp4_calculate(state, {
      type: 'heal', sourceId: 'hero', targetId: 'hero', amount: 10,
    })
    expect(next.hero.hp).toBe(40)
  })

  it('HP never exceeds maxHp', () => {
    const state = makeState({ heroHp: 45 })
    const { state: next } = arp4_calculate(state, {
      type: 'heal', sourceId: 'hero', targetId: 'hero', amount: 20,
    })
    expect(next.hero.hp).toBe(50)
  })
})

// ─── resolveAction (integration) ─────────────────────────────────────────────

describe('resolveAction', () => {
  it('a damage action deals damage', () => {
    const state = makeState({ enemies: [makeEnemy('g1')] })
    const next = resolveAction(state, {
      type: 'damage', sourceId: 'hero', targetId: 'g1', amount: 5,
    })
    expect(next.enemies[0].hp).toBe(15)
  })

  it('damage with vulnerable goes through the modifier', () => {
    const vuln = makeEnemy('g1', 'front', 20, [{ name: 'vulnerable', stacks: 1 }])
    const state = makeState({ enemies: [vuln] })
    const next = resolveAction(state, {
      type: 'damage', sourceId: 'hero', targetId: 'g1', amount: 6,
    })
    expect(next.enemies[0].hp).toBe(11) // 20 - floor(6*1.5)=9
  })

  it('melee into the back row with a living front row leaves the state unchanged', () => {
    const state = makeState({ enemies: [makeEnemy('g1', 'front'), makeEnemy('g2', 'back')] })
    const next = resolveAction(state, {
      type: 'damage', sourceId: 'hero', targetId: 'g2', amount: 10, rangeType: 'melee',
    })
    expect(next.enemies[1].hp).toBe(20)
  })

  it('an applyStatus action applies the status', () => {
    const state = makeState({ enemies: [makeEnemy('g1')] })
    const next = resolveAction(state, {
      type: 'applyStatus', sourceId: 'hero', targetId: 'g1',
      status: { name: 'vulnerable', stacks: 1 },
    })
    expect(next.enemies[0].statuses.some(s => s.name === 'vulnerable')).toBe(true)
  })

  it('a heal action restores HP', () => {
    const state = makeState({ heroHp: 20 })
    const next = resolveAction(state, {
      type: 'heal', sourceId: 'hero', targetId: 'hero', amount: 15,
    })
    expect(next.hero.hp).toBe(35)
  })

  it('the onPostEffects handler is called after the damage', () => {
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
