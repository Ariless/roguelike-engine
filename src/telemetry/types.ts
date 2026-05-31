import type { HeroClass, EnemyType } from '../engine/types'

// ─── Replay event ─────────────────────────────────────────────────────────────
// One observable action. Recorded before and after every state mutation.
// preStateHash + postStateHash enable byte-perfect replay verification.

export type ReplayEventType =
  | 'play_card'
  | 'turn_end'        // marks when endTurn() was called — replayer uses this as trigger
  | 'enemy_action'
  | 'status_tick'
  | 'transform'
  | 'death_resolution'
  | 'game_over'

export interface ReplayEvent {
  type: ReplayEventType
  turn: number
  cardId?: string
  targetId?: string
  rngValue?: number      // recorded when RNG was called (e.g. Chaos Bolt)
  preStateHash: string   // 6-char hex hash of state before this event
  postStateHash: string  // 6-char hex hash of state after this event
}

// ─── Turn snapshot ────────────────────────────────────────────────────────────
// Full entity state captured after each turn_end. Debugger reads these directly
// without re-simulating the game — telemetry is self-contained.

export interface EntitySnapshot {
  id: string
  name: string
  hp: number
  maxHp: number
  state: 'alive' | 'death_door' | 'dead'
  statuses: Array<{ name: string; stacks: number }>
}

export interface TurnSnapshot {
  turn: number
  hero: EntitySnapshot & { formState?: string }
  enemies: EntitySnapshot[]
  events: ReplayEvent[]  // events that fired during this turn
  hashValid: boolean     // true = all event hashes verified
}

// ─── Replay log ───────────────────────────────────────────────────────────────
// Complete record of one game run. Same seed + same events = byte-perfect replay.

export interface ReplayLog {
  seed: number
  heroClass: HeroClass
  enemyType: EnemyType
  faults: Record<string, boolean>
  events: ReplayEvent[]
  snapshots: TurnSnapshot[]
  outcome: 'hero_wins' | 'hero_loses' | 'in_progress'
}
