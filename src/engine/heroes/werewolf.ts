import { resolveAction } from '../actionResolution'
import type { Card, GameState, Hero } from '../types'

// ─── Card definitions — human form (placeholder, art TBD) ─────────────────────

export const lunarStrike: Card = {
  id: 'lunar_strike',
  heroClass: 'werewolf',
  name: 'Lunar Strike',
  energyCost: 1,
  axes: ['Tempo', 'Pressure'],
  rulesText: 'Deal 5 damage. If HP ≤ 50%, deal 8 instead.',
  narrativeLine: 'The moon sharpens every instinct.',
}

export const packSense: Card = {
  id: 'pack_sense',
  heroClass: 'werewolf',
  name: 'Pack Sense',
  energyCost: 1,
  axes: ['Pressure', 'Stability'],
  rulesText: 'Apply vulnerable to target. Gain 2 defend.',
  narrativeLine: 'Weakness is a scent.',
}

export const stalk: Card = {
  id: 'stalk',
  heroClass: 'werewolf',
  name: 'Stalk',
  energyCost: 1,
  axes: ['Stability', 'Conversion'],
  rulesText: 'Gain 5 defend. Apply 1 bleed to target.',
  narrativeLine: 'Patience is predatory.',
}

// ─── Card definitions — wolf form ─────────────────────────────────────────────

export const rend: Card = {
  id: 'rend',
  heroClass: 'werewolf',
  name: 'Rend',
  energyCost: 1,
  axes: ['Pressure', 'Tempo'],
  rulesText: 'Deal 8 damage. Apply 2 bleed.',
  narrativeLine: 'The wound opens. It does not close.',
}

export const rampage: Card = {
  id: 'rampage',
  heroClass: 'werewolf',
  name: 'Rampage',
  energyCost: 2,
  axes: ['Tempo', 'Pressure'],
  rulesText: 'Deal 4 damage to all enemies.',
  narrativeLine: 'Nothing escapes.',
}

export const realityCrack: Card = {
  id: 'reality_crack',
  heroClass: 'werewolf',
  name: 'Reality Crack',
  energyCost: 1,
  axes: ['Pressure', 'Conversion'],
  rulesText: 'Apply vulnerable to all enemies.',
  narrativeLine: 'In wolf form, the world around you breaks.',
}

export const WEREWOLF_HUMAN_CARDS: Card[] = [lunarStrike, packSense, stalk]
export const WEREWOLF_WOLF_CARDS: Card[]  = [rend, rampage, realityCrack]
export const WEREWOLF_CARDS: Card[]       = [...WEREWOLF_HUMAN_CARDS, ...WEREWOLF_WOLF_CARDS]

// ─── Wolf passive ─────────────────────────────────────────────────────────────
// Damage scales with missing HP: base * (1 + missingHp / maxHp).
// Active in wolf form; same formula as old berserker passive.
export function wolfDamage(hero: Hero, base: number): number {
  const missing = hero.maxHp - hero.hp
  return Math.floor(base * (1 + missing / hero.maxHp))
}

// ─── Transformation ───────────────────────────────────────────────────────────
// Called at Turn Pipeline step 3 via TurnHandlers.onStartOfTurnPassives.
// human + HP ≤ 50% → wolf (3 turns); fires even while stunned.
// wolf → human when turnsLeft = 0 OR HP healed above 50%.
// Death's Door and statuses survive form changes.
export function checkWerewolfTransform(state: GameState): GameState {
  if (state.hero.heroClass !== 'werewolf') return state

  const hero = state.hero
  const hpPct = hero.maxHp > 0 ? hero.hp / hero.maxHp : 1

  if (hero.formState === 'human') {
    if (hpPct <= 0.5 && hero.state !== 'dead') {
      return { ...state, hero: { ...hero, formState: 'werewolf', werewolfTurnsLeft: 3 } }
    }
    return state
  }

  const newTurnsLeft = (hero.werewolfTurnsLeft ?? 0) - 1
  if (newTurnsLeft <= 0 || hpPct > 0.5) {
    return { ...state, hero: { ...hero, formState: 'human', werewolfTurnsLeft: 0 } }
  }
  return { ...state, hero: { ...hero, werewolfTurnsLeft: newTurnsLeft } }
}

// ─── Human form cards ─────────────────────────────────────────────────────────

// Deal 5 damage, or 8 if HP ≤ 50% (threshold awareness before transformation).
export function playLunarStrike(state: GameState, targetId: string): GameState {
  const hpPct = state.hero.maxHp > 0 ? state.hero.hp / state.hero.maxHp : 1
  const amount = hpPct <= 0.5 ? 8 : 5
  return resolveAction(state, { type: 'damage', sourceId: 'hero', targetId, amount })
}

// Apply vulnerable to target + gain 2 defend.
export function playPackSense(state: GameState, targetId: string): GameState {
  let s = resolveAction(state, {
    type: 'applyStatus', sourceId: 'hero', targetId,
    status: { name: 'vulnerable', stacks: 1 },
  })
  s = resolveAction(s, {
    type: 'applyStatus', sourceId: 'hero', targetId: s.hero.id,
    status: { name: 'defend', stacks: 2 },
  })
  return s
}

// Gain 5 defend + apply 1 bleed to target.
export function playStalk(state: GameState, targetId: string): GameState {
  let s = resolveAction(state, {
    type: 'applyStatus', sourceId: 'hero', targetId: state.hero.id,
    status: { name: 'defend', stacks: 5 },
  })
  s = resolveAction(s, {
    type: 'applyStatus', sourceId: 'hero', targetId,
    status: { name: 'bleed', stacks: 1 },
  })
  return s
}

// ─── Wolf form cards ──────────────────────────────────────────────────────────

// Deals wolf-scaled damage, then applies 2 bleed. Order matters: bleed AFTER damage.
export function playRend(state: GameState, targetId: string): GameState {
  const amount = wolfDamage(state.hero, 8)
  let s = resolveAction(state, { type: 'damage', sourceId: 'hero', targetId, amount })
  s = resolveAction(s, {
    type: 'applyStatus', sourceId: 'hero', targetId,
    status: { name: 'bleed', stacks: 2 },
  })
  return s
}

// Deals wolf-scaled 4 damage to all living enemies.
export function playRampage(state: GameState): GameState {
  const amount = wolfDamage(state.hero, 4)
  return state.enemies.reduce((s, enemy) => {
    if (enemy.state === 'dead') return s
    return resolveAction(s, { type: 'damage', sourceId: 'hero', targetId: enemy.id, amount })
  }, state)
}

// Applies vulnerable to all living enemies.
export function playRealityCrack(state: GameState): GameState {
  return state.enemies.reduce((s, enemy) => {
    if (enemy.state === 'dead') return s
    return resolveAction(s, {
      type: 'applyStatus', sourceId: 'hero', targetId: enemy.id,
      status: { name: 'vulnerable', stacks: 1 },
    })
  }, state)
}
