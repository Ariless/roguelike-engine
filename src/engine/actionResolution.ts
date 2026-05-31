import type { GameState, Status } from './types'
import { applyDamage, applyHeal } from './resolution'
import { addStatus, hasStatus } from './statuses'

// ─── Action types ─────────────────────────────────────────────────────────────
// One action resolved per ARP call. Turn Pipeline steps 4 and 5 call resolveAction
// per card played / per enemy intent.

export type Action =
  | { type: 'damage';      sourceId: string; targetId: string; amount: number; rangeType?: 'melee' | 'ranged' }
  | { type: 'heal';        sourceId: string; targetId: string; amount: number }
  | { type: 'applyStatus'; sourceId: string; targetId: string; status: Status }

// Handlers for steps that require Berserker / Vampire — not yet built.
// Omitting a handler is safe: that step becomes a pass-through.
export interface ActionHandlers {
  onStateTransition?: (state: GameState, action: Action) => GameState
  onPostEffects?: (state: GameState, action: Action, finalDamage?: number) => GameState
}

// ─── Step 1 — State transitions ───────────────────────────────────────────────
// Werewolf form change (Berserker), entity spawn (Necromancer raise).
// Injected via handlers when heroes/enemies are built.
export function arp1_stateTransitions(state: GameState, action: Action, handlers?: ActionHandlers): GameState {
  return handlers?.onStateTransition?.(state, action) ?? state
}

// ─── Step 2 — Status application ─────────────────────────────────────────────
// Applies a status to the target for applyStatus actions.
// Other action types pass through unchanged.
export function arp2_statusApplication(state: GameState, action: Action): GameState {
  if (action.type !== 'applyStatus') return state
  return addStatus(state, action.targetId, action.status)
}

// ─── Step 3 — Positional check ────────────────────────────────────────────────
// Returns true if the action is blocked by position rules.
// Melee attacks cannot reach a back-row enemy when any front-row enemy is alive.
export function arp3_isBlocked(state: GameState, action: Action): boolean {
  if (action.type !== 'damage' || action.rangeType !== 'melee') return false

  const target = state.enemies.find(e => e.id === action.targetId)
  if (!target || target.row !== 'back') return false

  return state.enemies.some(
    e => e.row === 'front' && e.state !== 'dead' && e.id !== action.targetId
  )
}

// ─── Step 4 — Damage / heal calculation ──────────────────────────────────────
// Damage: applies vulnerable modifier (×1.5), then calls applyDamage.
// Berserker scaling (missing HP ratio) added when Berserker is built.
// Heal: calls applyHeal. Future: incomingHealing hooks (bleed ×0.5, boss phase 1).
export function arp4_calculate(
  state: GameState,
  action: Action
): { state: GameState; finalAmount?: number } {
  if (action.type === 'damage') {
    const target = [state.hero, ...state.enemies].find(e => e.id === action.targetId)
    if (!target) return { state }

    let amount = action.amount
    if (hasStatus(target, 'vulnerable')) {
      amount = Math.floor(amount * 1.5)
    }

    return { state: applyDamage(state, action.targetId, amount), finalAmount: amount }
  }

  if (action.type === 'heal') {
    return { state: applyHeal(state, action.targetId, action.amount), finalAmount: action.amount }
  }

  return { state }
}

// ─── Step 5 — Post-effects ────────────────────────────────────────────────────
// Vampire lifesteal, death notification → marks corpse for Necromancer raise.
// Injected via handlers when enemies are built.
export function arp5_postEffects(
  state: GameState,
  action: Action,
  finalAmount?: number,
  handlers?: ActionHandlers
): GameState {
  return handlers?.onPostEffects?.(state, action, finalAmount) ?? state
}

// ─── resolveAction — composes all 5 steps ─────────────────────────────────────
export function resolveAction(state: GameState, action: Action, handlers?: ActionHandlers): GameState {
  let s = state

  s = arp1_stateTransitions(s, action, handlers)
  s = arp2_statusApplication(s, action)

  if (arp3_isBlocked(s, action)) return s

  const { state: s4, finalAmount } = arp4_calculate(s, action)
  s = s4

  s = arp5_postEffects(s, action, finalAmount, handlers)

  return s
}
