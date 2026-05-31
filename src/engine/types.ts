// ─── Status effects ───────────────────────────────────────────────────────────

export type StatusName = 'bleed' | 'stun' | 'defend' | 'vulnerable'

export interface Status {
  name: StatusName
  stacks: number
  duration?: number  // сколько ходов осталось (undefined = бесконечно пока не снят)
}

// ─── Enemy intent (что враг сделает в следующий ход) ─────────────────────────

export type Intent =
  | { type: 'attack'; value: number; lifesteal?: boolean }
  | { type: 'bleed';  value: number }
  | { type: 'defend' }
  | { type: 'stun' }

// ─── Entities ─────────────────────────────────────────────────────────────────

export type EntityState = 'alive' | 'death_door' | 'dead'
export type Row = 'front' | 'back'

export interface Entity {
  id: string
  name: string
  hp: number
  maxHp: number
  state: EntityState
  statuses: Status[]
  row: Row
}

export type HeroClass = 'paladin' | 'bloodmage' | 'berserker' | 'werewolf'
export type FormState = 'human' | 'werewolf'
export type Axis = 'Tempo' | 'Pressure' | 'Stability' | 'Conversion'

export interface Card {
  id: string
  heroClass: HeroClass
  name: string
  energyCost: number
  axes: [Axis, Axis]
  rulesText: string
  narrativeLine?: string
}

export interface Hero extends Entity {
  heroClass: HeroClass
  formState: FormState
  hand: string[]       // id карт в руке
  energy: number       // очки действий за ход
  chargeStacks?: number     // Paladin only; undefined = 0
  rageStacks?: number       // Berserker only; undefined = 0
  werewolfTurnsLeft?: number // Berserker only; 0 = not in werewolf form
}

export type EnemyType = 'goblin' | 'guardian' | 'vampire' | 'necromancer'

export interface Enemy extends Entity {
  enemyType: EnemyType
  intent: Intent       // что сделает в этот ход
}

// ─── Game state ───────────────────────────────────────────────────────────────

export interface GameState {
  seed: number
  turn: number
  hero: Hero
  enemies: Enemy[]
  isOver: boolean
  winner?: 'hero' | 'enemies'
}
