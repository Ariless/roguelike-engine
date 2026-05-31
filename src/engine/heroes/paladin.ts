import { resolveAction } from '../actionResolution'
import { hasStatus } from '../statuses'
import type { Card, GameState } from '../types'

// ─── Card definitions ─────────────────────────────────────────────────────────

export const righteousStrike: Card = {
  id: 'righteous_strike',
  heroClass: 'paladin',
  name: 'Righteous Strike',
  energyCost: 1,
  axes: ['Tempo', 'Conversion'],
  rulesText: 'Deal 5 damage. If target is vulnerable, gain 1 charge.',
}

export const stubbornRecovery: Card = {
  id: 'stubborn_recovery',
  heroClass: 'paladin',
  name: 'Stubborn Recovery',
  energyCost: 1,
  axes: ['Stability', 'Conversion'],
  rulesText: 'Heal self for 6 HP.',
  narrativeLine: 'Not healing — refusing to die.',
}

export const divineCharge: Card = {
  id: 'divine_charge',
  heroClass: 'paladin',
  name: 'Divine Charge',
  energyCost: 1,
  axes: ['Tempo', 'Conversion'],
  rulesText: 'Gain 1 charge (max 3). At 3 charges your next attack deals double damage.',
}

export const PALADIN_CARDS: Card[] = [righteousStrike, stubbornRecovery, divineCharge]

// ─── playRighteousStrike ──────────────────────────────────────────────────────
// ARP step 4: if chargeStacks >= 3 → double damage, reset charges to 0
// ARP step 5: if target was vulnerable → gain 1 charge
export function playRighteousStrike(state: GameState, targetId: string): GameState {
  const charges = state.hero.chargeStacks ?? 0
  const isChargeActive = charges >= 3

  const allEntities = [state.hero, ...state.enemies]
  const target = allEntities.find(e => e.id === targetId)
  const targetWasVulnerable = target ? hasStatus(target, 'vulnerable') : false

  const amount = isChargeActive ? 10 : 5
  let s = resolveAction(state, { type: 'damage', sourceId: 'hero', targetId, amount })

  // Reset charges after double-damage fires (step 4 post)
  if (isChargeActive) {
    s = { ...s, hero: { ...s.hero, chargeStacks: 0 } }
  }

  // Gain 1 charge if target was vulnerable (step 5)
  if (targetWasVulnerable) {
    const newCharge = Math.min((s.hero.chargeStacks ?? 0) + 1, 3)
    s = { ...s, hero: { ...s.hero, chargeStacks: newCharge } }
  }

  return s
}

// ─── playStubbornRecovery ─────────────────────────────────────────────────────
// Heal self for 6 HP. HP ceiling invariant enforced by applyHeal.
export function playStubbornRecovery(state: GameState): GameState {
  return resolveAction(state, { type: 'heal', sourceId: 'hero', targetId: 'hero', amount: 6 })
}

// ─── playDivineCharge ─────────────────────────────────────────────────────────
// Gain 1 charge stack (max 3). Double-damage fires on the next attack (not this card).
export function playDivineCharge(state: GameState): GameState {
  const charges = state.hero.chargeStacks ?? 0
  return { ...state, hero: { ...state.hero, chargeStacks: Math.min(charges + 1, 3) } }
}
