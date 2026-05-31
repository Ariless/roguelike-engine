import type { Entity, GameState, Hero, Enemy } from './types'
import { tickStatuses } from './statuses'

// ─── Turn Pipeline — 9 steps ──────────────────────────────────────────────────
//
// One full turn in order. Steps 4 and 5 call the Action Resolution Pipeline
// per action/intent. All rules reference these step numbers (1–9).
//
// Step 1   Apply battlefield conditions
// Step 2   Determine turn order
// Step 3   Start-of-turn passive checks (canAct, werewolf threshold)
// Step 4   Player actions        → Action Resolution Pipeline per card
// Step 5   Enemy actions         → Action Resolution Pipeline per intent
// Step 6   Damage resolution
// Step 7   Status tick           (bleed damage, stun/defend expiry)
// Step 8   End-of-turn effects   (Vampire lifesteal)
// Step 9   Death resolution      (idempotent sweep)

// Handlers injected for steps that require heroes / enemies / RNG.
// Omitting a handler is safe — the step becomes a pass-through.
export interface TurnHandlers {
  onStartOfTurnPassives?: (state: GameState) => GameState
  playerActions?: (state: GameState) => GameState
  enemyActions?: (state: GameState) => GameState
  endOfTurnEffects?: (state: GameState) => GameState
}

// ─── Step 1 — Battlefield conditions ─────────────────────────────────────────
// BattlefieldCondition scope: modifies only this step (turn order shuffle).
// No conditions in v1 — pass-through.
export function step1_battlefieldConditions(state: GameState): GameState {
  return state
}

// ─── Step 2 — Turn order ─────────────────────────────────────────────────────
// Seeded shuffle when Broken Order is active.
// RNG not yet wired — pass-through until runtime/rng.ts exists.
export function step2_turnOrder(state: GameState): GameState {
  return state
}

// ─── Step 3 — Start-of-turn passive checks ───────────────────────────────────
// canAct (stun) is derived from statuses — no stored flag needed.
// Berserker transform check injected via handlers.
export function step3_startOfTurnPassives(state: GameState, handlers?: TurnHandlers): GameState {
  return handlers?.onStartOfTurnPassives?.(state) ?? state
}

// ─── Step 4 — Player actions ─────────────────────────────────────────────────
// Calls Action Resolution Pipeline per card played.
// Requires heroes + cards — injected via handlers.
export function step4_playerActions(state: GameState, handlers?: TurnHandlers): GameState {
  return handlers?.playerActions?.(state) ?? state
}

// ─── Step 5 — Enemy actions ───────────────────────────────────────────────────
// Calls Action Resolution Pipeline per intent.
// Requires enemies with intent tables — injected via handlers.
export function step5_enemyActions(state: GameState, handlers?: TurnHandlers): GameState {
  return handlers?.enemyActions?.(state) ?? state
}

// ─── Step 6 — Damage resolution ──────────────────────────────────────────────
// Resolves pending damage after all actions complete.
// Deferred damage queue not needed until actions produce multi-target damage.
export function step6_damageResolution(state: GameState): GameState {
  return state
}

// ─── Step 7 — Status tick ─────────────────────────────────────────────────────
// Applies to hero and all enemies: bleed deals damage, stun/defend expire.
export function step7_statusTick(state: GameState): GameState {
  const ids = [state.hero.id, ...state.enemies.map(e => e.id)]
  return ids.reduce((s, id) => tickStatuses(s, id), state)
}

// ─── Step 8 — End-of-turn effects ────────────────────────────────────────────
// Vampire lifesteal fires here (post-damage, post-tick).
// Requires Vampire implementation — injected via handlers.
export function step8_endOfTurnEffects(state: GameState, handlers?: TurnHandlers): GameState {
  return handlers?.endOfTurnEffects?.(state) ?? state
}

// ─── Step 9 — Death resolution (idempotent) ───────────────────────────────────
// Final sweep: any entity with HP=0 and state=alive → death_door.
// Defensive invariant — applyDamage and tickStatuses already handle this,
// but this step guarantees correctness regardless of how state was modified.
export function step9_deathResolution(state: GameState): GameState {
  const sweep = <T extends Entity>(entity: T): T =>
    entity.hp === 0 && entity.state === 'alive'
      ? { ...entity, state: 'death_door' as const }
      : entity

  return {
    ...state,
    hero: sweep(state.hero) as Hero,
    enemies: state.enemies.map(e => sweep(e) as Enemy),
  }
}

// ─── runTurn — composes all 9 steps ───────────────────────────────────────────
export function runTurn(state: GameState, handlers?: TurnHandlers): GameState {
  let s = state
  s = step1_battlefieldConditions(s)
  s = step2_turnOrder(s)
  s = step3_startOfTurnPassives(s, handlers)
  s = step4_playerActions(s, handlers)
  s = step5_enemyActions(s, handlers)
  s = step6_damageResolution(s)
  s = step7_statusTick(s)
  s = step8_endOfTurnEffects(s, handlers)
  s = step9_deathResolution(s)
  return { ...s, turn: s.turn + 1 }
}
