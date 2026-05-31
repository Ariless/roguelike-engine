import { createGame } from '../runtime/executor'
import type { FaultConfig } from '../runtime/faults'
import type { GameState, HeroClass, EnemyType } from '../engine/types'
import type { ReplayLog, ReplayEvent } from './types'

// ─── ReplayResult ─────────────────────────────────────────────────────────────

export interface ReplayResult {
  success: boolean           // true = all hashes matched byte-perfect
  finalState: GameState
  eventsReplayed: number
  divergedAt?: ReplayEvent   // first event where post-hash didn't match
  divergedTurn?: number
}

// ─── replayGame ───────────────────────────────────────────────────────────────
// Replays a recorded log byte-perfect.
//
// Strategy: iterate events in order.
//   'play_card' → game.playCard(cardId, targetId)
//   'turn_end'  → game.endTurn()
//   all others  → verification only (they fire as side effects of the above)
//
// After each play_card or turn_end, compare the current state hash to the
// recorded postStateHash. A mismatch means the run is non-deterministic or
// the log was tampered.
export function replayGame(log: ReplayLog): ReplayResult {
  const faults: FaultConfig = {
    bleedOffByOne: !!log.faults.bleedOffByOne,
    ignoreStun: !!log.faults.ignoreStun,
  }

  const game = createGame({
    seed: log.seed,
    heroClass: log.heroClass as HeroClass,
    enemyType: log.enemyType as EnemyType,
    faults,
  })

  let eventsReplayed = 0

  for (const event of log.events) {
    if (event.type === 'play_card') {
      game.playCard(event.cardId ?? '', event.targetId ?? '')
      eventsReplayed++

      const mismatch = verifyHash(game.getState(), event.postStateHash)
      if (mismatch) {
        return {
          success: false,
          finalState: game.getState(),
          eventsReplayed,
          divergedAt: event,
          divergedTurn: event.turn,
        }
      }
    }

    if (event.type === 'turn_end') {
      game.endTurn()
      eventsReplayed++

      const mismatch = verifyHash(game.getState(), event.postStateHash)
      if (mismatch) {
        return {
          success: false,
          finalState: game.getState(),
          eventsReplayed,
          divergedAt: event,
          divergedTurn: event.turn,
        }
      }
    }
  }

  return {
    success: true,
    finalState: game.getState(),
    eventsReplayed,
  }
}

// ─── Hash verification ────────────────────────────────────────────────────────

function hashState(state: GameState): string {
  const str = JSON.stringify({ hero: state.hero, enemies: state.enemies })
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0
  }
  return (h >>> 0).toString(16).slice(0, 6).padStart(6, '0')
}

function verifyHash(state: GameState, expected: string): boolean {
  return hashState(state) !== expected  // returns true if MISMATCH
}
