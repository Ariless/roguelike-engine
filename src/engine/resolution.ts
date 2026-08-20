import type { Enemy, Entity, GameState, Hero } from './types'

// Finds an entity in the state by id (hero or enemy)
function findEntity(state: GameState, id: string): Entity | undefined {
  if (state.hero.id === id) return state.hero
  return state.enemies.find(e => e.id === id)
}

// Returns a new state with the entity updated
function updateEntity(state: GameState, updated: Hero | Enemy): GameState {
  if (state.hero.id === updated.id) {
    return { ...state, hero: updated as Hero }
  }
  return {
    ...state,
    enemies: state.enemies.map(e => e.id === updated.id ? updated as Enemy : e),
  }
}

// ─── Damage ──────────────────────────────────────────────────────────────────

export function applyDamage(state: GameState, targetId: string, amount: number): GameState {
  const target = findEntity(state, targetId)
  if (!target || target.state === 'dead') return state

  // Defend absorbs damage first
  const defend = target.statuses.find(s => s.name === 'defend')
  let remaining = amount
  let newStatuses = target.statuses

  if (defend && defend.stacks > 0) {
    const absorbed = Math.min(defend.stacks, remaining)
    remaining -= absorbed
    newStatuses = newStatuses
      .map(s => s.name === 'defend' ? { ...s, stacks: s.stacks - absorbed } : s)
      .filter(s => s.name !== 'defend' || s.stacks > 0)
  }

  const newHp = Math.max(0, target.hp - remaining)

  let newState: import('./types').EntityState = target.state
  if (newHp === 0 && target.state === 'alive') {
    newState = 'death_door'
  } else if (remaining > 0 && target.state === 'death_door') {
    // second hit while at death's door → dead
    newState = 'dead'
  }

  const updated = { ...target, hp: newHp, state: newState, statuses: newStatuses } as Hero | Enemy
  return updateEntity(state, updated)
}

// ─── Healing ─────────────────────────────────────────────────────────────────

export function applyHeal(state: GameState, targetId: string, amount: number): GameState {
  const target = findEntity(state, targetId)
  if (!target) return state

  const newHp = Math.min(target.hp + amount, target.maxHp)

  // death_door → alive on healing
  const newState = target.state === 'death_door' ? 'alive' as const : target.state

  const updated = { ...target, hp: newHp, state: newState } as Hero | Enemy
  return updateEntity(state, updated)
}
