import type { GameState } from './types'

// ─── Types ────────────────────────────────────────────────────────────────────

// appliesAt: Turn Pipeline step (1–9); 0 = structural invariant, check at any time
export interface Invariant {
  id: string
  appliesAt: number
  severity: 'hard' | 'soft'
  check: (state: GameState) => boolean
  message: (state: GameState) => string
}

// ─── TimelineCorruptedError ───────────────────────────────────────────────────

export class TimelineCorruptedError extends Error {
  constructor(
    public readonly invariantId: string,
    detail: string,
    public readonly state: GameState,
  ) {
    super(
      `TIMELINE CORRUPTED\n\n${detail}\n\nSeed: ${state.seed}  ·  Turn: ${state.turn}\n\nInvariant: ${invariantId}`,
    )
    this.name = 'TimelineCorruptedError'
  }
}

// ─── Invariant helpers ────────────────────────────────────────────────────────

function allEntities(state: GameState) {
  return [state.hero, ...state.enemies]
}

// ─── InvariantRegistry ────────────────────────────────────────────────────────

export const InvariantRegistry: Invariant[] = [
  // ── Structural (appliesAt: 0 = any time) ───────────────────────────────────

  {
    id: 'hp-floor',
    appliesAt: 0,
    severity: 'hard',
    check: state => allEntities(state).every(e => e.hp >= 0),
    message: state => {
      const e = allEntities(state).find(e => e.hp < 0)!
      return `Entity '${e.id}' has hp = ${e.hp} (must be >= 0)`
    },
  },

  {
    id: 'hp-ceiling',
    appliesAt: 0,
    severity: 'hard',
    check: state => allEntities(state).every(e => e.hp <= e.maxHp),
    message: state => {
      const e = allEntities(state).find(e => e.hp > e.maxHp)!
      return `Entity '${e.id}' has hp = ${e.hp} > maxHp = ${e.maxHp}`
    },
  },

  {
    id: 'bleed-cap',
    appliesAt: 0,
    severity: 'hard',
    check: state => allEntities(state).every(e => {
      const bleed = e.statuses.find(s => s.name === 'bleed')
      return !bleed || bleed.stacks <= 10
    }),
    message: state => {
      const e = allEntities(state).find(e => {
        const b = e.statuses.find(s => s.name === 'bleed')
        return b && b.stacks > 10
      })!
      const stacks = e.statuses.find(s => s.name === 'bleed')!.stacks
      return `Entity '${e.id}' has bleed stacks = ${stacks} (cap is 10)`
    },
  },

  {
    id: 'charge-cap',
    appliesAt: 0,
    severity: 'hard',
    check: state => (state.hero.chargeStacks ?? 0) <= 3,
    message: state => `Hero chargeStacks = ${state.hero.chargeStacks} (cap is 3)`,
  },

  // ── Post-step-9 (appliesAt: 9) ─────────────────────────────────────────────
  // These hold after death resolution has swept all entities.

  {
    id: 'death-door-hp',
    appliesAt: 9,
    severity: 'hard',
    check: state => allEntities(state)
      .filter(e => e.state === 'death_door' || e.state === 'dead')
      .every(e => e.hp === 0),
    message: state => {
      const e = allEntities(state)
        .filter(e => e.state === 'death_door' || e.state === 'dead')
        .find(e => e.hp !== 0)!
      return `Entity '${e.id}' is '${e.state}' but has hp = ${e.hp} (must be 0)`
    },
  },

  {
    id: 'alive-hp',
    appliesAt: 9,
    severity: 'hard',
    check: state => allEntities(state)
      .filter(e => e.state === 'alive')
      .every(e => e.hp > 0),
    message: state => {
      const e = allEntities(state)
        .filter(e => e.state === 'alive')
        .find(e => e.hp <= 0)!
      return `Entity '${e.id}' is 'alive' but has hp = ${e.hp} (must be > 0)`
    },
  },

  // ── Soft invariants ────────────────────────────────────────────────────────
  // Violations are logged but do not throw. Used for stability scoring.

  {
    id: 'combat-terminates',
    appliesAt: 0,
    severity: 'soft',
    check: state => state.turn <= 50,
    message: state => `Turn = ${state.turn} exceeds combat turn cap (50) — possible livelock`,
  },
]

// ─── assertValidGameState ─────────────────────────────────────────────────────
// Runs all registered invariants.
// Hard violations throw TimelineCorruptedError immediately.
// Soft violations are collected and returned.

export function assertValidGameState(state: GameState): { softViolations: string[] } {
  const softViolations: string[] = []
  for (const inv of InvariantRegistry) {
    if (!inv.check(state)) {
      if (inv.severity === 'hard') {
        throw new TimelineCorruptedError(inv.id, inv.message(state), state)
      }
      softViolations.push(`${inv.id}: ${inv.message(state)}`)
    }
  }
  return { softViolations }
}
