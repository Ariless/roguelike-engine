import { resolveAction } from '../actionResolution'
import { hasStatus } from '../statuses'
import type { Card, GameState } from '../types'

// ─── Card definitions ─────────────────────────────────────────────────────────

export const openTheWound: Card = {
  id: 'open_the_wound',
  heroClass: 'bloodmage',
  name: 'Open the Wound',
  energyCost: 1,
  axes: ['Pressure', 'Stability'],
  rulesText: 'Apply 3 bleed. If target is already bleeding, also apply vulnerable.',
  narrativeLine: 'Deliberate. Not an accident.',
}

export const bloodrite: Card = {
  id: 'bloodrite',
  heroClass: 'bloodmage',
  name: 'Bloodrite',
  energyCost: 2,
  axes: ['Conversion', 'Pressure'],
  rulesText: 'Deal 8 damage. Take 3 self-damage.',
  narrativeLine: 'You pay in blood for power.',
}

export const chaosBolt: Card = {
  id: 'chaos_bolt',
  heroClass: 'bloodmage',
  name: 'Chaos Bolt',
  energyCost: 1,
  axes: ['Tempo', 'Pressure'],
  rulesText: 'Deal 5 damage to a random target.',
  narrativeLine: 'Reality fractures at the point of impact.',
}

export const BLOODMAGE_CARDS: Card[] = [openTheWound, bloodrite, chaosBolt]

// ─── playOpenTheWound ─────────────────────────────────────────────────────────
// Apply 3 bleed. If target was already bleeding (pre-cast) → also apply vulnerable.
// "already bleeding" is evaluated BEFORE bleed is added — prevents self-triggering.
export function playOpenTheWound(state: GameState, targetId: string): GameState {
  const allEntities = [state.hero, ...state.enemies]
  const target = allEntities.find(e => e.id === targetId)
  const targetWasBleeding = target ? hasStatus(target, 'bleed') : false

  let s = resolveAction(state, {
    type: 'applyStatus',
    sourceId: 'hero',
    targetId,
    status: { name: 'bleed', stacks: 3 },
  })

  if (targetWasBleeding) {
    s = resolveAction(s, {
      type: 'applyStatus',
      sourceId: 'hero',
      targetId,
      status: { name: 'vulnerable', stacks: 1 },
    })
  }

  return s
}

// ─── playBloodrite ────────────────────────────────────────────────────────────
// Deal 8 damage to target (through normal pipeline — vulnerable applies).
// Take 3 self-damage: bypasses defend (deliberate sacrifice, not an attack).
// Self-damage still triggers death_door → dead state machine.
export function playBloodrite(state: GameState, targetId: string): GameState {
  let s = resolveAction(state, {
    type: 'damage',
    sourceId: 'hero',
    targetId,
    amount: 8,
  })

  // Self-damage bypasses defend — direct HP reduction
  const currentHp = s.hero.hp
  const newHp = Math.max(0, currentHp - 3)
  let newState = s.hero.state

  if (newHp === 0 && s.hero.state === 'alive')      newState = 'death_door'
  else if (newHp === 0 && s.hero.state === 'death_door') newState = 'dead'

  s = { ...s, hero: { ...s.hero, hp: newHp, state: newState } }

  return s
}

// ─── playChaosBolt ────────────────────────────────────────────────────────────
// Deal 5 damage to targetId. Target is determined by the caller using seeded RNG —
// engine receives the resolved targetId, never calls RNG directly.
// No rangeType → not melee → bypasses positional block (can hit back row).
export function playChaosBolt(state: GameState, targetId: string): GameState {
  return resolveAction(state, {
    type: 'damage',
    sourceId: 'hero',
    targetId,
    amount: 5,
  })
}
