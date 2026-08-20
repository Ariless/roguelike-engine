import type { Entity, GameState, Hero, Enemy, Status, StatusName } from './types'

// ─── Adding a status ─────────────────────────────────────────────────────────

export function addStatus(state: GameState, targetId: string, incoming: Status): GameState {
  const target = findEntity(state, targetId)
  if (!target) return state

  const updated = applyStatusToEntity(target, incoming) as Hero | Enemy
  return updateEntity(state, updated)
}

function applyStatusToEntity(entity: Entity, incoming: Status): Entity {
  const existing = entity.statuses.find(s => s.name === incoming.name)

  // Stun does not stack — it just resets duration to 1
  if (incoming.name === 'stun') {
    if (existing) {
      return {
        ...entity,
        statuses: entity.statuses.map(s =>
          s.name === 'stun' ? { ...s, duration: 1 } : s
        ),
      }
    }
    return { ...entity, statuses: [...entity.statuses, { ...incoming, duration: 1 }] }
  }

  // Bleed stacks, capped at 10
  if (incoming.name === 'bleed') {
    if (existing) {
      const newStacks = Math.min(existing.stacks + incoming.stacks, 10)
      return {
        ...entity,
        statuses: entity.statuses.map(s =>
          s.name === 'bleed' ? { ...s, stacks: newStacks } : s
        ),
      }
    }
    return {
      ...entity,
      statuses: [...entity.statuses, { ...incoming, stacks: Math.min(incoming.stacks, 10) }],
    }
  }

  // Defend stacks
  if (incoming.name === 'defend') {
    if (existing) {
      return {
        ...entity,
        statuses: entity.statuses.map(s =>
          s.name === 'defend' ? { ...s, stacks: s.stacks + incoming.stacks } : s
        ),
      }
    }
    return { ...entity, statuses: [...entity.statuses, incoming] }
  }

  // Vulnerable does not stack — just add it if absent
  if (!existing) {
    return { ...entity, statuses: [...entity.statuses, incoming] }
  }
  return entity
}

// ─── Status tick (start of turn) ─────────────────────────────────────────────

// Applies every status on the entity and removes the expired ones
export function tickStatuses(state: GameState, targetId: string): GameState {
  const target = findEntity(state, targetId)
  if (!target) return state

  let entity = { ...target, statuses: [...target.statuses] }

  // Bleed: removes HP equal to the number of stacks
  const bleed = entity.statuses.find(s => s.name === 'bleed')
  if (bleed) {
    entity = { ...entity, hp: Math.max(0, entity.hp - bleed.stacks) }
    // HP reached 0 — death_door
    if (entity.hp === 0 && entity.state === 'alive') {
      entity = { ...entity, state: 'death_door' }
    }
  }

  // Drop statuses whose duration has expired
  // Stun lasts 1 turn, defend is cleared at the end of the turn
  entity = {
    ...entity,
    statuses: entity.statuses
      .map(s => s.duration !== undefined ? { ...s, duration: s.duration - 1 } : s)
      .filter(s => s.duration === undefined || s.duration > 0),
  }

  return updateEntity(state, entity as Hero | Enemy)
}

// ─── Checks ──────────────────────────────────────────────────────────────────

export function hasStatus(entity: Entity, name: StatusName): boolean {
  return entity.statuses.some(s => s.name === name)
}

export function canAct(entity: Entity): boolean {
  return !hasStatus(entity, 'stun')
}

// ─── Helpers (copied from resolution.ts to avoid a dependency) ───────────────

function findEntity(state: GameState, id: string): Entity | undefined {
  if (state.hero.id === id) return state.hero
  return state.enemies.find(e => e.id === id)
}

function updateEntity(state: GameState, updated: Hero | Enemy): GameState {
  if (state.hero.id === updated.id) {
    return { ...state, hero: updated as Hero }
  }
  return {
    ...state,
    enemies: state.enemies.map(e => e.id === updated.id ? updated as Enemy : e),
  }
}
