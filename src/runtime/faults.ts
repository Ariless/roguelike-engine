import type { GameState } from '../engine/types'
import { tickStatuses } from '../engine/statuses'

// ─── FaultConfig ──────────────────────────────────────────────────────────────
// Controlled bugs injected at createGame time. Tests use these to verify
// that property invariants catch the bug and fast-check shrinks the failing case.

export interface FaultConfig {
  bleedOffByOne?: boolean   // bleed ticks for (stacks - 1) instead of stacks
  ignoreStun?: boolean      // stunned enemies act anyway (stun has no effect)
  ignoreDeathDoor?: boolean // death_door → entity continues acting as alive (no kill on second hit)
  allowDeadToAct?: boolean  // dead entities can still execute intents (triggers TIMELINE CORRUPTED)
}

export const NO_FAULTS: FaultConfig = {}

// ─── Faulted tick ─────────────────────────────────────────────────────────────
// Wraps tickStatuses with optional fault injection.
// bleedOffByOne: reduces bleed stacks by 1 before the tick fires,
// so the entity takes (stacks - 1) damage instead of stacks.
export function tickWithFaults(
  state: GameState,
  entityId: string,
  faults: FaultConfig,
): GameState {
  if (!faults.bleedOffByOne) return tickStatuses(state, entityId)

  const isHero = entityId === state.hero.id
  const entity = isHero ? state.hero : state.enemies.find(e => e.id === entityId)
  if (!entity) return tickStatuses(state, entityId)

  const bleed = entity.statuses.find(s => s.name === 'bleed')
  if (!bleed || bleed.stacks <= 0) return tickStatuses(state, entityId)

  // Reduce bleed by 1 before ticking — bug: off-by-one in tick formula
  const withReducedBleed: GameState = isHero
    ? {
        ...state,
        hero: {
          ...state.hero,
          statuses: state.hero.statuses.map(s =>
            s.name === 'bleed' ? { ...s, stacks: Math.max(0, s.stacks - 1) } : s
          ),
        },
      }
    : {
        ...state,
        enemies: state.enemies.map(e =>
          e.id === entityId
            ? {
                ...e,
                statuses: e.statuses.map(s =>
                  s.name === 'bleed' ? { ...s, stacks: Math.max(0, s.stacks - 1) } : s
                ),
              }
            : e
        ),
      }

  return tickStatuses(withReducedBleed, entityId)
}
