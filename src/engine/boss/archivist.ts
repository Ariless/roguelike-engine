import type { GameState } from '../types'

// ─── CorruptionEvent ──────────────────────────────────────────────────────────
// The Archivist does not directly break semantics — it submits inputs.
// The engine either holds or fails on its own terms.
// constraintViolation: true → assertValidGameState() MUST throw TIMELINE CORRUPTED.

export type CorruptionEventType =
  | 'memory_suppression'   // Phase 1: healing effectiveness = 0 for 2 turns
  | 'timeline_inversion'   // Phase 2: post-effects fire before damage calc for 1 turn
  | 'state_reset'          // Phase 3: all statuses cleared (charge stacks survive)
  | 'invariant_breach'     // Phase 4: injects illegal state → must be caught

export interface CorruptionEvent {
  type: CorruptionEventType
  appliedAt: number         // turn when this fired
  scope: 'thisTurn' | 'nextTurn' | 'permanent'
  reversible: boolean
  constraintViolation: boolean  // true = assertValidGameState() MUST catch
}

// ─── Boss HP thresholds ───────────────────────────────────────────────────────

export const ARCHIVIST_HP    = 60
export const PHASE_THRESHOLDS = {
  phase1: 0.75,   // HP < 75% → Memory Suppression
  phase2: 0.50,   // HP < 50% → Timeline Inversion
  phase3: 0.25,   // HP < 25% → State Reset
  phase4: 0.00,   // HP = 0 (death_door) → Invariant Breach
} as const

// Track which phases have fired (prevents re-triggering)
export interface ArchivistPhaseState {
  phase1Fired: boolean
  phase2Fired: boolean
  phase3Fired: boolean
  phase4Fired: boolean
  memorySuppression: number   // turns remaining (0 = inactive)
  timelineInversion: boolean  // active this turn
}

export function initialPhaseState(): ArchivistPhaseState {
  return {
    phase1Fired: false, phase2Fired: false,
    phase3Fired: false, phase4Fired: false,
    memorySuppression: 0, timelineInversion: false,
  }
}

// ─── checkPhases ─────────────────────────────────────────────────────────────
// Called at start of each turn. Returns triggered CorruptionEvents.

export function checkPhases(
  state: GameState,
  bossHp: number,
  phases: ArchivistPhaseState,
): { events: CorruptionEvent[]; phases: ArchivistPhaseState } {
  const hpPct = bossHp / ARCHIVIST_HP
  const events: CorruptionEvent[] = []
  const next = { ...phases }

  if (!phases.phase1Fired && hpPct < PHASE_THRESHOLDS.phase1) {
    next.phase1Fired = true
    next.memorySuppression = 2
    events.push({
      type: 'memory_suppression', appliedAt: state.turn,
      scope: 'nextTurn', reversible: true, constraintViolation: false,
    })
  }

  if (!phases.phase2Fired && hpPct < PHASE_THRESHOLDS.phase2) {
    next.phase2Fired = true
    next.timelineInversion = true
    events.push({
      type: 'timeline_inversion', appliedAt: state.turn,
      scope: 'thisTurn', reversible: true, constraintViolation: false,
    })
  }

  if (!phases.phase3Fired && hpPct < PHASE_THRESHOLDS.phase3) {
    next.phase3Fired = true
    events.push({
      type: 'state_reset', appliedAt: state.turn,
      scope: 'permanent', reversible: false, constraintViolation: false,
    })
  }

  if (!phases.phase4Fired && bossHp === 0) {
    next.phase4Fired = true
    events.push({
      type: 'invariant_breach', appliedAt: state.turn,
      scope: 'permanent', reversible: false, constraintViolation: true,
    })
  }

  return { events, phases: next }
}

// ─── applyCorruptionEvent ─────────────────────────────────────────────────────
// Applies a CorruptionEvent to the game state.
// Phase 4 injects an illegal state — assertValidGameState() MUST catch it.

export function applyCorruptionEvent(state: GameState, event: CorruptionEvent): GameState {
  switch (event.type) {

    case 'memory_suppression':
      // Documented effect — handled in executor by checking memorySuppression counter
      // State is unchanged; executor checks the counter before applying heals
      return state

    case 'timeline_inversion':
      // Documented effect — handled in executor (post-effects fire before damage)
      // State unchanged; executor checks timelineInversion flag during turn
      return state

    case 'state_reset': {
      // ALL statuses cleared from ALL entities. Charge stacks survive (not statuses).
      const resetEntity = <T extends { statuses: unknown[] }>(e: T): T =>
        ({ ...e, statuses: [] })
      return {
        ...state,
        hero: resetEntity(state.hero),
        enemies: state.enemies.map(resetEntity),
      }
    }

    case 'invariant_breach': {
      // The Archivist attempts the impossible: inject dead entity with non-zero HP.
      // This violates 'death-door-hp' invariant (dead → hp must be 0).
      // assertValidGameState() MUST catch this → TIMELINE CORRUPTED.
      // constraintViolation: true on this event — it's the whole point.
      const firstDead = state.enemies.find(e => e.state === 'dead')
      if (firstDead) {
        return {
          ...state,
          enemies: state.enemies.map(e =>
            e.id === firstDead.id
              ? { ...e, hp: e.maxHp }  // dead entity with maxHp → violates invariant
              : e
          ),
        }
      }
      // If no dead entity, corrupt hero HP beyond ceiling
      return {
        ...state,
        hero: { ...state.hero, hp: state.hero.maxHp + 10 },  // violates hp-ceiling
      }
    }
  }
}

// ─── tickPhases ───────────────────────────────────────────────────────────────
// Called at end of turn — decrements/clears timed effects.

export function tickPhases(phases: ArchivistPhaseState): ArchivistPhaseState {
  return {
    ...phases,
    memorySuppression: Math.max(0, phases.memorySuppression - 1),
    timelineInversion: false,  // Timeline inversion lasts only 1 turn
  }
}
