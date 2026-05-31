import { describe, it, expect } from 'vitest'
import {
  WEREWOLF_CARDS, WEREWOLF_HUMAN_CARDS, WEREWOLF_WOLF_CARDS,
  wolfDamage, checkWerewolfTransform,
  playLunarStrike, playPackSense, playStalk,
  playRend, playRampage, playRealityCrack,
} from '../../src/engine/heroes/werewolf'
import { addStatus } from '../../src/engine/statuses'
import { runTurn } from '../../src/engine/turnPipeline'
import type { GameState } from '../../src/engine/types'

function makeState(heroHp = 30, enemyHp = 30): GameState {
  return {
    seed: 1, turn: 1,
    hero: {
      id: 'hero', name: 'Werewolf',
      hp: heroHp, maxHp: 30,
      state: 'alive', statuses: [], row: 'front',
      heroClass: 'werewolf', formState: 'human',
      hand: [], energy: 3,
    },
    enemies: [{
      id: 'enemy', name: 'Goblin',
      hp: enemyHp, maxHp: 30,
      state: 'alive', statuses: [], row: 'front',
      enemyType: 'goblin',
      intent: { type: 'attack', value: 6 },
    }],
    isOver: false,
  }
}

function makeWolfState(turnsLeft = 3, heroHp = 15): GameState {
  return {
    ...makeState(heroHp),
    hero: { ...makeState(heroHp).hero, formState: 'werewolf', werewolfTurnsLeft: turnsLeft },
  }
}

// ─── Card catalogue ──────────────────────────────────────────────────────────

describe('WEREWOLF_CARDS', () => {
  it('6 карт всего', () => expect(WEREWOLF_CARDS).toHaveLength(6))
  it('3 human карты', () => expect(WEREWOLF_HUMAN_CARDS).toHaveLength(3))
  it('3 wolf карты', () => expect(WEREWOLF_WOLF_CARDS).toHaveLength(3))
  it('все heroClass: werewolf', () => {
    WEREWOLF_CARDS.forEach(c => expect(c.heroClass).toBe('werewolf'))
  })
  it('у каждой карты 2 оси', () => {
    WEREWOLF_CARDS.forEach(c => expect(c.axes).toHaveLength(2))
  })
})

// ─── wolfDamage ───────────────────────────────────────────────────────────────

describe('wolfDamage', () => {
  const hero = makeState(30).hero

  it('полный HP → базовый урон без бонуса', () => {
    expect(wolfDamage(hero, 8)).toBe(8)
  })

  it('50% HP → ×1.5 урон', () => {
    expect(wolfDamage({ ...hero, hp: 15 }, 8)).toBe(12)
  })

  it('0 HP → ×2.0 урон', () => {
    expect(wolfDamage({ ...hero, hp: 0 }, 8)).toBe(16)
  })
})

// ─── checkWerewolfTransform ───────────────────────────────────────────────────

describe('checkWerewolfTransform', () => {
  it('HP > 50% → трансформации нет', () => {
    expect(checkWerewolfTransform(makeState(20)).hero.formState).toBe('human')
  })

  it('HP = 50% → трансформация', () => {
    const next = checkWerewolfTransform(makeState(15))
    expect(next.hero.formState).toBe('werewolf')
    expect(next.hero.werewolfTurnsLeft).toBe(3)
  })

  it('HP < 50% → трансформация', () => {
    expect(checkWerewolfTransform(makeState(10)).hero.formState).toBe('werewolf')
  })

  it('трансформация при stun (пассивная, не action)', () => {
    let s = makeState(10)
    s = { ...s, hero: { ...s.hero, statuses: [{ name: 'stun', stacks: 1, duration: 1 }] } }
    expect(checkWerewolfTransform(s).hero.formState).toBe('werewolf')
  })

  it('HP > 50% в wolf форме → возврат', () => {
    expect(checkWerewolfTransform(makeWolfState(2, 20)).hero.formState).toBe('human')
  })

  it('turnsLeft = 1 → возврат', () => {
    expect(checkWerewolfTransform(makeWolfState(1, 10)).hero.formState).toBe('human')
  })

  it('turnsLeft = 2 → остаётся wolf, декремент до 1', () => {
    const next = checkWerewolfTransform(makeWolfState(2, 10))
    expect(next.hero.formState).toBe('werewolf')
    expect(next.hero.werewolfTurnsLeft).toBe(1)
  })

  it('wolf форма длится ровно 3 хода', () => {
    let s = makeState(15)
    s = checkWerewolfTransform(s)    // transforms; turnsLeft=3
    s = checkWerewolfTransform(s)    // turnsLeft=2
    expect(s.hero.formState).toBe('werewolf')
    s = checkWerewolfTransform(s)    // turnsLeft=1
    expect(s.hero.formState).toBe('werewolf')
    s = checkWerewolfTransform(s)    // turnsLeft=0 → revert
    expect(s.hero.formState).toBe('human')
  })

  it('Death\'s Door выживает при трансформации', () => {
    const s = { ...makeState(0), hero: { ...makeState(0).hero, state: 'death_door' as const } }
    const next = checkWerewolfTransform(s)
    expect(next.hero.formState).toBe('werewolf')
    expect(next.hero.state).toBe('death_door')
  })

  it('статусы выживают при трансформации', () => {
    let s = makeState(10)
    s = addStatus(s, 'hero', { name: 'bleed', stacks: 3 })
    const next = checkWerewolfTransform(s)
    expect(next.hero.statuses[0].stacks).toBe(3)
  })

  it('не-werewolf герой: no-op', () => {
    const s = makeState()
    const paladin = { ...s, hero: { ...s.hero, heroClass: 'paladin' as const } }
    expect(checkWerewolfTransform(paladin)).toBe(paladin)
  })
})

// ─── Human form cards ─────────────────────────────────────────────────────────

describe('playLunarStrike', () => {
  it('HP > 50% → 5 урона', () => {
    const next = playLunarStrike(makeState(20), 'enemy')
    expect(next.enemies[0].hp).toBe(30 - 5)
  })

  it('HP ≤ 50% → 8 урона', () => {
    const next = playLunarStrike(makeState(15), 'enemy')
    expect(next.enemies[0].hp).toBe(30 - 8)
  })
})

describe('playPackSense', () => {
  it('применяет vulnerable к цели', () => {
    const next = playPackSense(makeState(), 'enemy')
    expect(next.enemies[0].statuses.some(s => s.name === 'vulnerable')).toBe(true)
  })

  it('даёт 2 defend герою', () => {
    const next = playPackSense(makeState(), 'enemy')
    const def = next.hero.statuses.find(s => s.name === 'defend')
    expect(def?.stacks).toBe(2)
  })
})

describe('playStalk', () => {
  it('даёт 5 defend', () => {
    const next = playStalk(makeState(), 'enemy')
    expect(next.hero.statuses.find(s => s.name === 'defend')?.stacks).toBe(5)
  })

  it('применяет 1 bleed к цели', () => {
    const next = playStalk(makeState(), 'enemy')
    expect(next.enemies[0].statuses.find(s => s.name === 'bleed')?.stacks).toBe(1)
  })
})

// ─── Wolf form cards ──────────────────────────────────────────────────────────

describe('playRend', () => {
  it('наносит урон (8 базового при полном HP)', () => {
    const next = playRend(makeState(30), 'enemy')
    expect(next.enemies[0].hp).toBe(30 - 8)
  })

  it('bleed применяется ПОСЛЕ урона', () => {
    const next = playRend(makeState(30), 'enemy')
    expect(next.enemies[0].statuses.find(s => s.name === 'bleed')?.stacks).toBe(2)
    expect(next.enemies[0].hp).toBe(22)
  })

  it('урон масштабируется при низком HP', () => {
    const next = playRend(makeState(0, 30), 'enemy')
    // hp=0 → wolfDamage(0/30) = 8 * (1 + 30/30) = 16
    expect(next.enemies[0].hp).toBe(30 - 16)
  })
})

describe('playRampage', () => {
  it('наносит урон единственному врагу', () => {
    const next = playRampage(makeState(30))
    expect(next.enemies[0].hp).toBe(30 - 4)
  })

  it('бьёт всех живых врагов', () => {
    const s: GameState = {
      ...makeState(30),
      enemies: [
        { id: 'e1', name: 'G1', hp: 20, maxHp: 20, state: 'alive', statuses: [], row: 'front', enemyType: 'goblin', intent: { type: 'attack', value: 4 } },
        { id: 'e2', name: 'G2', hp: 20, maxHp: 20, state: 'alive', statuses: [], row: 'front', enemyType: 'goblin', intent: { type: 'attack', value: 4 } },
      ],
    }
    const next = playRampage(s)
    expect(next.enemies[0].hp).toBe(16)
    expect(next.enemies[1].hp).toBe(16)
  })

  it('пропускает мёртвых врагов', () => {
    const s: GameState = {
      ...makeState(30),
      enemies: [
        { id: 'e1', name: 'G1', hp: 0, maxHp: 20, state: 'dead', statuses: [], row: 'front', enemyType: 'goblin', intent: { type: 'attack', value: 4 } },
        { id: 'e2', name: 'G2', hp: 20, maxHp: 20, state: 'alive', statuses: [], row: 'front', enemyType: 'goblin', intent: { type: 'attack', value: 4 } },
      ],
    }
    const next = playRampage(s)
    expect(next.enemies[0].hp).toBe(0)
    expect(next.enemies[1].hp).toBe(16)
  })
})

describe('playRealityCrack', () => {
  it('применяет vulnerable ко всем живым врагам', () => {
    const s: GameState = {
      ...makeState(),
      enemies: [
        { id: 'e1', name: 'G1', hp: 20, maxHp: 20, state: 'alive', statuses: [], row: 'front', enemyType: 'goblin', intent: { type: 'attack', value: 4 } },
        { id: 'e2', name: 'G2', hp: 20, maxHp: 20, state: 'alive', statuses: [], row: 'front', enemyType: 'goblin', intent: { type: 'attack', value: 4 } },
      ],
    }
    const next = playRealityCrack(s)
    expect(next.enemies[0].statuses.some(st => st.name === 'vulnerable')).toBe(true)
    expect(next.enemies[1].statuses.some(st => st.name === 'vulnerable')).toBe(true)
  })
})

// ─── Turn Pipeline integration ───────────────────────────────────────────────

describe('step3 via runTurn — werewolf transform', () => {
  it('трансформируется при HP ≤ 50% в начале хода', () => {
    const next = runTurn(makeState(15), { onStartOfTurnPassives: checkWerewolfTransform })
    expect(next.hero.formState).toBe('werewolf')
  })

  it('не трансформируется при HP > 50%', () => {
    const next = runTurn(makeState(20), { onStartOfTurnPassives: checkWerewolfTransform })
    expect(next.hero.formState).toBe('human')
  })

  it('wolf форма истекает через 3 хода', () => {
    let s = makeState(15)
    s = runTurn(s, { onStartOfTurnPassives: checkWerewolfTransform })  // transforms
    s = runTurn(s, { onStartOfTurnPassives: checkWerewolfTransform })
    s = runTurn(s, { onStartOfTurnPassives: checkWerewolfTransform })
    expect(s.hero.formState).toBe('werewolf')
    s = runTurn(s, { onStartOfTurnPassives: checkWerewolfTransform })  // revert
    expect(s.hero.formState).toBe('human')
  })
})

// ─── Mutation killing tests ───────────────────────────────────────────────────

describe('checkWerewolfTransform — точные граничные значения', () => {
  it('HP = 50% (15/30) → трансформируется (граница включительно)', () => {
    const s = makeState(15)  // 15/30 = 0.5 exactly
    expect(checkWerewolfTransform(s).hero.formState).toBe('werewolf')
  })

  it('HP = 16/30 (>50%) → НЕ трансформируется', () => {
    const s = makeState(16)  // kills hpPct <= 0.5 → true mutant
    expect(checkWerewolfTransform(s).hero.formState).toBe('human')
  })

  it('в wolf форме HP = 16/30 (>50%) → немедленный откат', () => {
    const s = makeWolfState(2, 16)
    expect(checkWerewolfTransform(s).hero.formState).toBe('human')
  })

  it('в wolf форме HP = 15/30 (50%) → остаётся wolf, декремент', () => {
    const s = makeWolfState(2, 15)  // kills hpPct > 0.5 → true mutant
    const next = checkWerewolfTransform(s)
    expect(next.hero.formState).toBe('werewolf')
    expect(next.hero.werewolfTurnsLeft).toBe(1)
  })

  it('maxHp = 0 → hpPct fallback 1 → никогда не трансформируется', () => {
    const s = makeState(0)
    const zeroMax = { ...s, hero: { ...s.hero, maxHp: 0 } }
    // hpPct = maxHp > 0 ? hp/maxHp : 1 → 1 > 0.5 → no transform
    expect(checkWerewolfTransform(zeroMax).hero.formState).toBe('human')  // kills maxHp>0 → false
  })
})

describe('playLunarStrike — threshold boundary', () => {
  it('HP = 50% (15/30) → 8 урона (граница включительно)', () => {
    const s = makeState(15)
    const next = playLunarStrike(s, 'enemy')
    expect(next.enemies[0].hp).toBe(30 - 8)  // kills hpPct<=0.5 → false mutant
  })

  it('HP = 16/30 (>50%) → 5 урона', () => {
    const s = makeState(16)
    const next = playLunarStrike(s, 'enemy')
    expect(next.enemies[0].hp).toBe(30 - 5)  // kills hpPct<=0.5 → true mutant
  })

  it('HP = 14/30 (<50%) → 8 урона', () => {
    const s = makeState(14)
    const next = playLunarStrike(s, 'enemy')
    expect(next.enemies[0].hp).toBe(30 - 8)
  })

  it('maxHp=0 → fallback hpPct=1 → 5 урона (не 8)', () => {
    const s = makeState(0)
    const zeroMax = { ...s, hero: { ...s.hero, maxHp: 0 } }
    const next = playLunarStrike(zeroMax, 'enemy')
    expect(next.enemies[0].hp).toBe(30 - 5)  // kills maxHp>0 → false in LunarStrike
  })
})
