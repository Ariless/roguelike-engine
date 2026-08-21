// ─── Status effects ───────────────────────────────────────────────────────────

export type StatusName = 'bleed' | 'stun' | 'defend' | 'vulnerable'

export interface Status {
  name: StatusName
  stacks: number
  duration?: number  // turns remaining (undefined = indefinite until removed)
}

// ─── Enemy intent (what the enemy will do next turn) ─────────────────────────

export type Intent =
  | { type: 'attack'; value: number; lifesteal?: boolean }
  | { type: 'bleed';  value: number }
  | { type: 'defend' }
  | { type: 'stun' }
  // Raise Dead: spawns a skeleton from an ally corpse that has not been raised
  // before. Declared in docs/DECISION-TABLES.md since May; existed only in the
  // UI until BUG-14 was closed.
  | { type: 'raise' }
  // Empower: adds to the next attack of an allied skeleton.
  | { type: 'empower'; value: number }

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
  hand: string[]       // ids of the cards in hand
  energy: number       // action points per turn
  chargeStacks?: number     // Paladin only; undefined = 0
  rageStacks?: number       // Berserker only; undefined = 0
  werewolfTurnsLeft?: number // Berserker only; 0 = not in werewolf form
}

export type EnemyType = 'goblin' | 'guardian' | 'vampire' | 'necromancer' | 'skeleton'

export interface Enemy extends Entity {
  enemyType: EnemyType
  intent: Intent       // what it will do this turn
  /**
   * Bonus damage added to this entity's next attack, then consumed.
   * Set by the Necromancer's Empower.
   */
  empowered?: number
  /**
   * True once this corpse has been used by Raise Dead. Prevents an endless
   * skeleton supply from a single body — the rule DECISIONS.md:335 calls a
   * "graceful no-op" when there is nothing left to raise.
   */
  raisedOnce?: boolean
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
