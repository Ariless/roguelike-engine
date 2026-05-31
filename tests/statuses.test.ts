import { describe, it, expect } from 'vitest'
import { addStatus, tickStatuses, hasStatus, canAct } from '../src/engine/statuses'
import type { GameState } from '../src/engine/types'

function makeState(options: {
  heroHp?: number
  heroStatuses?: GameState['hero']['statuses']
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
      state: 'alive',
      statuses: options.heroStatuses ?? [],
      row: 'front',
      heroClass: 'paladin',
      formState: 'human',
      hand: [],
      energy: 3,
    },
    enemies: [],
  }
}

// ─── addStatus — bleed ────────────────────────────────────────────────────────

describe('addStatus — bleed', () => {
  it('добавляет bleed если его не было', () => {
    const state = makeState()
    const next = addStatus(state, 'hero', { name: 'bleed', stacks: 3 })
    const bleed = next.hero.statuses.find(s => s.name === 'bleed')
    expect(bleed?.stacks).toBe(3)
  })

  it('стакает bleed к существующему', () => {
    const state = makeState({ heroStatuses: [{ name: 'bleed', stacks: 4 }] })
    const next = addStatus(state, 'hero', { name: 'bleed', stacks: 3 })
    const bleed = next.hero.statuses.find(s => s.name === 'bleed')
    expect(bleed?.stacks).toBe(7)
  })

  it('bleed не превышает 10 стаков при стакинге', () => {
    const state = makeState({ heroStatuses: [{ name: 'bleed', stacks: 8 }] })
    const next = addStatus(state, 'hero', { name: 'bleed', stacks: 5 })
    const bleed = next.hero.statuses.find(s => s.name === 'bleed')
    expect(bleed?.stacks).toBe(10)
  })

  it('bleed не превышает 10 стаков при первом добавлении', () => {
    const state = makeState()
    const next = addStatus(state, 'hero', { name: 'bleed', stacks: 15 })
    const bleed = next.hero.statuses.find(s => s.name === 'bleed')
    expect(bleed?.stacks).toBe(10)
  })
})

// ─── addStatus — stun ─────────────────────────────────────────────────────────

describe('addStatus — stun', () => {
  it('добавляет stun с duration 1', () => {
    const state = makeState()
    const next = addStatus(state, 'hero', { name: 'stun', stacks: 1 })
    const stun = next.hero.statuses.find(s => s.name === 'stun')
    expect(stun?.duration).toBe(1)
  })

  it('stun не стакается — повторный stun сбрасывает duration на 1', () => {
    const state = makeState({ heroStatuses: [{ name: 'stun', stacks: 1, duration: 1 }] })
    const next = addStatus(state, 'hero', { name: 'stun', stacks: 1 })
    const stunStatuses = next.hero.statuses.filter(s => s.name === 'stun')
    expect(stunStatuses).toHaveLength(1)
    expect(stunStatuses[0].duration).toBe(1)
  })
})

// ─── addStatus — defend ───────────────────────────────────────────────────────

describe('addStatus — defend', () => {
  it('добавляет defend если его не было', () => {
    const state = makeState()
    const next = addStatus(state, 'hero', { name: 'defend', stacks: 5 })
    const defend = next.hero.statuses.find(s => s.name === 'defend')
    expect(defend?.stacks).toBe(5)
  })

  it('стакает defend к существующему', () => {
    const state = makeState({ heroStatuses: [{ name: 'defend', stacks: 4 }] })
    const next = addStatus(state, 'hero', { name: 'defend', stacks: 3 })
    const defend = next.hero.statuses.find(s => s.name === 'defend')
    expect(defend?.stacks).toBe(7)
  })
})

// ─── addStatus — vulnerable ───────────────────────────────────────────────────

describe('addStatus — vulnerable', () => {
  it('добавляет vulnerable если его не было', () => {
    const state = makeState()
    const next = addStatus(state, 'hero', { name: 'vulnerable', stacks: 1 })
    expect(hasStatus(next.hero, 'vulnerable')).toBe(true)
  })

  it('vulnerable идемпотентен — повторное добавление не дублирует', () => {
    const state = makeState({ heroStatuses: [{ name: 'vulnerable', stacks: 1 }] })
    const next = addStatus(state, 'hero', { name: 'vulnerable', stacks: 1 })
    const vulnerable = next.hero.statuses.filter(s => s.name === 'vulnerable')
    expect(vulnerable).toHaveLength(1)
  })
})

// ─── tickStatuses — bleed ─────────────────────────────────────────────────────

describe('tickStatuses — bleed', () => {
  it('bleed снимает HP равное количеству стаков', () => {
    const state = makeState({ heroHp: 30, heroStatuses: [{ name: 'bleed', stacks: 4 }] })
    const next = tickStatuses(state, 'hero')
    expect(next.hero.hp).toBe(26)
  })

  it('bleed не роняет HP ниже 0', () => {
    const state = makeState({ heroHp: 2, heroStatuses: [{ name: 'bleed', stacks: 10 }] })
    const next = tickStatuses(state, 'hero')
    expect(next.hero.hp).toBe(0)
  })

  it('bleed вызывает death_door когда HP достигает 0', () => {
    const state = makeState({ heroHp: 3, heroStatuses: [{ name: 'bleed', stacks: 5 }] })
    const next = tickStatuses(state, 'hero')
    expect(next.hero.state).toBe('death_door')
  })

  it('bleed не меняет стейт если HP не дошёл до 0', () => {
    const state = makeState({ heroHp: 20, heroStatuses: [{ name: 'bleed', stacks: 3 }] })
    const next = tickStatuses(state, 'hero')
    expect(next.hero.state).toBe('alive')
  })
})

// ─── tickStatuses — stun expire ───────────────────────────────────────────────

describe('tickStatuses — stun expire', () => {
  it('stun убирается после тика (duration 1 → 0)', () => {
    const state = makeState({ heroStatuses: [{ name: 'stun', stacks: 1, duration: 1 }] })
    const next = tickStatuses(state, 'hero')
    expect(hasStatus(next.hero, 'stun')).toBe(false)
  })
})

// ─── tickStatuses — defend expire ────────────────────────────────────────────

describe('tickStatuses — defend expire', () => {
  it('defend убирается после тика (duration 1 → 0)', () => {
    const state = makeState({ heroStatuses: [{ name: 'defend', stacks: 5, duration: 1 }] })
    const next = tickStatuses(state, 'hero')
    expect(hasStatus(next.hero, 'defend')).toBe(false)
  })

  it('defend без duration остаётся после тика', () => {
    const state = makeState({ heroStatuses: [{ name: 'defend', stacks: 5 }] })
    const next = tickStatuses(state, 'hero')
    expect(hasStatus(next.hero, 'defend')).toBe(true)
  })
})

// ─── canAct ───────────────────────────────────────────────────────────────────

describe('canAct', () => {
  it('возвращает true если нет stun', () => {
    const state = makeState()
    expect(canAct(state.hero)).toBe(true)
  })

  it('возвращает false если есть stun', () => {
    const state = makeState({ heroStatuses: [{ name: 'stun', stacks: 1, duration: 1 }] })
    expect(canAct(state.hero)).toBe(false)
  })

  it('возвращает true после того как stun истёк', () => {
    const state = makeState({ heroStatuses: [{ name: 'stun', stacks: 1, duration: 1 }] })
    const next = tickStatuses(state, 'hero')
    expect(canAct(next.hero)).toBe(true)
  })
})

// ─── Mutation killing tests ───────────────────────────────────────────────────
// Каждый тест написан чтобы убить конкретного выжившего мутанта.

describe('hasStatus — negative cases (kill hasStatus always-true mutant)', () => {
  it('возвращает false когда статуса нет', () => {
    const state = makeState()
    expect(hasStatus(state.hero, 'bleed')).toBe(false)
    expect(hasStatus(state.hero, 'stun')).toBe(false)
    expect(hasStatus(state.hero, 'defend')).toBe(false)
    expect(hasStatus(state.hero, 'vulnerable')).toBe(false)
  })

  it('возвращает false для другого статуса когда есть только bleed', () => {
    const state = makeState({ heroStatuses: [{ name: 'bleed', stacks: 3 }] })
    expect(hasStatus(state.hero, 'bleed')).toBe(true)
    expect(hasStatus(state.hero, 'stun')).toBe(false)   // ← kills always-true mutant
    expect(hasStatus(state.hero, 'defend')).toBe(false)
  })

  it('hasStatus по конкретному имени — не по любому', () => {
    const state = makeState({ heroStatuses: [{ name: 'stun', stacks: 1, duration: 1 }] })
    expect(hasStatus(state.hero, 'stun')).toBe(true)
    expect(hasStatus(state.hero, 'bleed')).toBe(false)  // ← kills always-true mutant
  })
})

describe('tickStatuses — duration filter (kill filter condition mutant)', () => {
  it('статус БЕЗ duration поле не удаляется при тике', () => {
    // bleed не имеет duration — должен выжить после тика (стаки не убывают в engine)
    const state = makeState({ heroHp: 20, heroStatuses: [{ name: 'bleed', stacks: 3 }] })
    const next = tickStatuses(state, 'hero')
    expect(hasStatus(next.hero, 'bleed')).toBe(true)  // ← kills filter-to-false mutant
    expect(next.hero.statuses[0].stacks).toBe(3)      // стаки в engine не убывают, только HP
    expect(next.hero.hp).toBe(17)                     // HP снизился на 3
  })

  it('статус С duration:1 удаляется после тика', () => {
    const state = makeState({ heroStatuses: [{ name: 'stun', stacks: 1, duration: 1 }] })
    const next = tickStatuses(state, 'hero')
    expect(hasStatus(next.hero, 'stun')).toBe(false)
  })

  it('статус С duration:2 НЕ удаляется после одного тика', () => {
    const state = makeState({ heroStatuses: [{ name: 'stun', stacks: 1, duration: 2 }] })
    const next = tickStatuses(state, 'hero')
    expect(hasStatus(next.hero, 'stun')).toBe(true)   // ← kills filter-to-false mutant
    expect(next.hero.statuses[0].duration).toBe(1)    // duration decremented
  })

  it('duration decrements по 1 за каждый тик', () => {
    let state = makeState({ heroStatuses: [{ name: 'stun', stacks: 1, duration: 3 }] })
    state = tickStatuses(state, 'hero')
    expect(state.hero.statuses[0].duration).toBe(2)
    state = tickStatuses(state, 'hero')
    expect(state.hero.statuses[0].duration).toBe(1)
    state = tickStatuses(state, 'hero')
    expect(hasStatus(state.hero, 'stun')).toBe(false)  // удалён после 3 тиков
  })
})

describe('updateEntity — все враги обновляются независимо (kill always-true map mutant)', () => {
  it('addStatus на одного врага не затрагивает второго', () => {
    const baseEnemy = {
      id: 'e0', name: 'G1', hp: 20, maxHp: 20, state: 'alive' as const,
      statuses: [], row: 'front' as const, enemyType: 'goblin' as const,
      intent: { type: 'attack' as const, value: 6 },
    }
    const state: GameState = {
      seed: 1, turn: 1, isOver: false,
      hero: makeState().hero,
      enemies: [
        { ...baseEnemy, id: 'e0', name: 'G1' },
        { ...baseEnemy, id: 'e1', name: 'G2' },
      ],
    }
    const next = addStatus(state, 'e0', { name: 'bleed', stacks: 3 })
    expect(hasStatus(next.enemies[0], 'bleed')).toBe(true)
    expect(hasStatus(next.enemies[1], 'bleed')).toBe(false)  // ← kills always-true map mutant
  })
})
