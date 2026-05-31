import { resolveAction } from '../actionResolution'
import type { Card, GameState, Hero } from '../types'

// ─── Card definitions ─────────────────────────────────────────────────────────

export const savageLunge: Card = {
  id: 'savage_lunge',
  heroClass: 'berserker',
  name: 'Savage Lunge',
  energyCost: 1,
  axes: ['Tempo', 'Stability'],
  rulesText: 'Deal 6 damage (×1.5 in Rage). Push target to back row.',
  narrativeLine: 'The world narrows to a single point of impact.',
}

export const primalFury: Card = {
  id: 'primal_fury',
  heroClass: 'berserker',
  name: 'Primal Fury',
  energyCost: 1,
  axes: ['Conversion', 'Tempo'],
  rulesText: 'Deal 4 damage (×1.5 in Rage). Gain 1 rage stack.',
  narrativeLine: 'Every blow feeds the fire.',
}

export const primalDodge: Card = {
  id: 'primal_dodge',
  heroClass: 'berserker',
  name: 'Primal Dodge',
  energyCost: 1,
  axes: ['Stability', 'Conversion'],
  rulesText: 'Gain 4 defend. In Rage, gain 1 energy.',
  narrativeLine: 'Pain sharpens reflex.',
}

export const BERSERKER_CARDS: Card[] = [savageLunge, primalFury, primalDodge]

// ─── Rage Mode ────────────────────────────────────────────────────────────────
// Active when HP ≤ 25% of maxHp. Purely derived — no stored flag needed.
// Applies ×1.5 multiplier to all outgoing damage for the current turn.
export function isInRage(hero: Hero): boolean {
  return hero.state !== 'dead' && hero.hp <= Math.floor(hero.maxHp * 0.25)
}

export function rageDamage(hero: Hero, base: number): number {
  return isInRage(hero) ? Math.floor(base * 1.5) : base
}

// ─── Cards ────────────────────────────────────────────────────────────────────

// Deals rage-scaled melee damage + pushes target to back row.
export function playSavageLunge(state: GameState, targetId: string): GameState {
  const amount = rageDamage(state.hero, 6)
  let s = resolveAction(state, {
    type: 'damage', sourceId: 'hero', targetId, amount, rangeType: 'melee',
  })
  s = {
    ...s,
    enemies: s.enemies.map(e => e.id === targetId ? { ...e, row: 'back' as const } : e),
  }
  return s
}

// Deals rage-scaled damage + gains 1 rage stack (max 5).
export function playPrimalFury(state: GameState, targetId: string): GameState {
  const amount = rageDamage(state.hero, 4)
  let s = resolveAction(state, { type: 'damage', sourceId: 'hero', targetId, amount })
  const newRage = Math.min((s.hero.rageStacks ?? 0) + 1, 5)
  return { ...s, hero: { ...s.hero, rageStacks: newRage } }
}

// Gains 4 defend. In Rage (HP ≤ 25%), gains 1 bonus energy.
export function playPrimalDodge(state: GameState): GameState {
  let s = resolveAction(state, {
    type: 'applyStatus', sourceId: 'hero', targetId: state.hero.id,
    status: { name: 'defend', stacks: 4 },
  })
  if (isInRage(s.hero)) {
    s = { ...s, hero: { ...s.hero, energy: s.hero.energy + 1 } }
  }
  return s
}
