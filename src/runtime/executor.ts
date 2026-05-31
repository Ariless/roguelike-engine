import { createRng, pick } from './rng'
import { tickWithFaults, NO_FAULTS } from './faults'
import type { FaultConfig } from './faults'
import { assertValidGameState } from '../engine/invariants'
import { step9_deathResolution } from '../engine/turnPipeline'
import { addStatus, canAct } from '../engine/statuses'
import { applyDamage } from '../engine/resolution'
import { checkWerewolfTransform } from '../engine/heroes/werewolf'
import { playRighteousStrike, playStubbornRecovery, playDivineCharge } from '../engine/heroes/paladin'
import { playOpenTheWound, playBloodrite, playChaosBolt } from '../engine/heroes/bloodmage'
import { playSavageLunge, playPrimalFury, playPrimalDodge } from '../engine/heroes/berserker'
import { playLunarStrike, playPackSense, playStalk, playRend, playRampage, playRealityCrack } from '../engine/heroes/werewolf'
import type { GameState, HeroClass, EnemyType, Intent } from '../engine/types'
import type { ReplayEvent, ReplayLog } from '../telemetry/types'

// ─── Config ───────────────────────────────────────────────────────────────────

export interface GameConfig {
  seed: number
  heroClass: HeroClass
  enemyType: EnemyType
  faults?: FaultConfig
}

// ─── State hash ───────────────────────────────────────────────────────────────
// 6-char hex for pre/post event verification. Not cryptographic — just unique enough.
function hashState(state: GameState): string {
  const str = JSON.stringify({ hero: state.hero, enemies: state.enemies })
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0
  }
  return (h >>> 0).toString(16).slice(0, 6).padStart(6, '0')
}

// ─── Enemy intent tables ──────────────────────────────────────────────────────
const ENEMY_INTENTS: Record<EnemyType, Intent[]> = {
  goblin:      [{ type: 'attack', value: 6 }, { type: 'attack', value: 6 }, { type: 'attack', value: 6 }],
  guardian:    [{ type: 'defend' },           { type: 'stun' },             { type: 'attack', value: 10 }],
  vampire:     [{ type: 'attack', value: 6, lifesteal: true }, { type: 'bleed', value: 2 },  { type: 'attack', value: 12 }],
  necromancer: [{ type: 'bleed', value: 3 },  { type: 'bleed', value: 3 },  { type: 'bleed', value: 3 }],
}

const ENEMY_STATS: Record<EnemyType, { name: string; hp: number }> = {
  goblin:      { name: 'Goblin',      hp: 20 },
  guardian:    { name: 'Guardian',    hp: 35 },
  vampire:     { name: 'Vampire',     hp: 30 },
  necromancer: { name: 'Necromancer', hp: 25 },
}

// ─── Hero stat tables ─────────────────────────────────────────────────────────
const HERO_STATS: Record<HeroClass, { name: string; hp: number; hand: string[] }> = {
  paladin:   { name: 'Paladin',    hp: 30, hand: ['righteous_strike', 'stubborn_recovery', 'divine_charge'] },
  bloodmage: { name: 'Blood Mage', hp: 25, hand: ['open_the_wound', 'bloodrite', 'chaos_bolt'] },
  berserker: { name: 'Berserker',  hp: 28, hand: ['savage_lunge', 'primal_fury', 'primal_dodge'] },
  werewolf:  { name: 'Werewolf',   hp: 28, hand: ['lunar_strike', 'pack_sense', 'stalk'] },
}

// ─── Initial state factory ────────────────────────────────────────────────────
function makeInitialState(config: GameConfig): GameState {
  const h = HERO_STATS[config.heroClass]
  const e = ENEMY_STATS[config.enemyType]
  return {
    seed: config.seed,
    turn: 1,
    hero: {
      id: 'hero',
      name: h.name,
      hp: h.hp, maxHp: h.hp,
      state: 'alive',
      statuses: [],
      row: 'front',
      heroClass: config.heroClass,
      formState: 'human',
      hand: [...h.hand],
      energy: 3,
      ...(config.heroClass === 'paladin'   ? { chargeStacks: 0 } : {}),
      ...(config.heroClass === 'berserker' ? { rageStacks: 0 }   : {}),
      ...(config.heroClass === 'werewolf'  ? { werewolfTurnsLeft: 0 } : {}),
    },
    enemies: [{
      id: 'enemy',
      name: e.name,
      hp: e.hp, maxHp: e.hp,
      state: 'alive',
      statuses: [],
      row: 'front',
      enemyType: config.enemyType,
      intent: ENEMY_INTENTS[config.enemyType][0],
    }],
    isOver: false,
  }
}

// ─── Card energy costs ────────────────────────────────────────────────────────
const CARD_COSTS: Record<string, number> = {
  righteous_strike: 1, stubborn_recovery: 1, divine_charge: 1,
  open_the_wound: 1, bloodrite: 2, chaos_bolt: 1,
  savage_lunge: 1, primal_fury: 1, primal_dodge: 1,
  lunar_strike: 1, pack_sense: 1, stalk: 1,
  rend: 1, rampage: 2, reality_crack: 1,
}

// ─── Win condition check ──────────────────────────────────────────────────────
// Enemies: death_door → dead immediately (no second hit required at executor level).
// Heroes: death_door persists until healed or struck again.
function resolveAndCheckWin(s: GameState, faults: FaultConfig = {}): GameState {
  if (s.isOver) return s

  // Fault: ignoreDeathDoor — entities survive at death_door indefinitely (no kill on second hit)
  if (!faults.ignoreDeathDoor) {
    s = {
      ...s,
      enemies: s.enemies.map(e =>
        e.state === 'death_door' ? { ...e, state: 'dead' as const } : e
      ),
    }
  }

  if (s.enemies.every(e => e.state === 'dead')) {
    return { ...s, isOver: true, winner: 'hero' }
  }
  if (s.hero.state === 'dead') {
    return { ...s, isOver: true, winner: 'enemies' }
  }
  return s
}

// Alias for contexts where only hero death matters (enemy actions)
function checkWin(s: GameState, f: FaultConfig = {}): GameState {
  return resolveAndCheckWin(s, f)
}

// ─── Card dispatch ────────────────────────────────────────────────────────────
// Resolves RNG-dependent targets before calling the play function.
function dispatchCard(
  state: GameState,
  cardId: string,
  targetId: string,
  rng: () => number,
): GameState {
  const enemyId = state.enemies[0]?.id ?? 'enemy'

  switch (cardId) {
    // Paladin
    case 'righteous_strike': return playRighteousStrike(state, targetId || enemyId)
    case 'stubborn_recovery': return playStubbornRecovery(state)
    case 'divine_charge': return playDivineCharge(state)
    // Blood Mage
    case 'open_the_wound': return playOpenTheWound(state, targetId || enemyId)
    case 'bloodrite': return playBloodrite(state, targetId || enemyId)
    case 'chaos_bolt': {
      // RNG resolves target — engine receives deterministic targetId
      const living = state.enemies.filter(e => e.state !== 'dead')
      const target = living.length > 0 ? pick(rng, living) : state.enemies[0]
      return playChaosBolt(state, target.id)
    }
    // Berserker
    case 'savage_lunge': return playSavageLunge(state, targetId || enemyId)
    case 'primal_fury': return playPrimalFury(state, targetId || enemyId)
    case 'primal_dodge': return playPrimalDodge(state)
    // Werewolf (human)
    case 'lunar_strike': return playLunarStrike(state, targetId || enemyId)
    case 'pack_sense': return playPackSense(state, targetId || enemyId)
    case 'stalk': return playStalk(state, targetId || enemyId)
    // Werewolf (wolf)
    case 'rend': return playRend(state, targetId || enemyId)
    case 'rampage': return playRampage(state)
    case 'reality_crack': return playRealityCrack(state)
    default: return state
  }
}

// ─── Enemy intent execution ───────────────────────────────────────────────────
function executeIntent(state: GameState, intent: Intent): GameState {
  const heroId = state.hero.id
  switch (intent.type) {
    case 'attack': {
      const heroBefore = state.hero.hp
      let s = applyDamage(state, heroId, intent.value)
      // Lifesteal: heals attacker for actual damage dealt (post-defend), capped at missing HP
      if (intent.lifesteal) {
        const actualDmg = heroBefore - s.hero.hp  // real HP lost after defend absorption
        if (actualDmg > 0) {
          s = {
            ...s,
            enemies: s.enemies.map(e =>
              e.id === state.enemies[0]?.id
                ? { ...e, hp: Math.min(e.maxHp, e.hp + Math.min(actualDmg, e.maxHp - e.hp)) }
                : e
            ),
          }
        }
      }
      return s
    }
    case 'bleed':
      return addStatus(state, heroId, { name: 'bleed', stacks: intent.value })
    case 'defend':
      return addStatus(state, state.enemies[0].id, { name: 'defend', stacks: 8 })
    case 'stun':
      return addStatus(state, heroId, { name: 'stun', stacks: 1 })
    default:
      return state
  }
}

// ─── GameHandle ───────────────────────────────────────────────────────────────

export interface GameHandle {
  playCard(cardId: string, targetId?: string): GameState
  endTurn(): GameState
  getState(): GameState
  getLog(): ReplayLog
}

// ─── createGame ───────────────────────────────────────────────────────────────

export function createGame(config: GameConfig): GameHandle {
  const rng = createRng(config.seed)
  const faults = config.faults ?? NO_FAULTS
  let state = makeInitialState(config)
  let intentIndex = 0

  const log: ReplayLog = {
    seed: config.seed,
    heroClass: config.heroClass,
    enemyType: config.enemyType,
    faults: {
      bleedOffByOne: !!faults.bleedOffByOne,
      ignoreStun: !!faults.ignoreStun,
    },
    events: [],
    snapshots: [],
    outcome: 'in_progress',
  }

  // Track which events belong to the current turn
  let turnEvents: ReplayEvent[] = []

  function record(type: ReplayEvent['type'], pre: GameState, post: GameState, extra?: Partial<ReplayEvent>): void {
    const ev: ReplayEvent = {
      type,
      turn: state.turn,
      preStateHash: hashState(pre),
      postStateHash: hashState(post),
      ...extra,
    }
    log.events.push(ev)
    turnEvents.push(ev)
  }

  function recordSnapshot(s: GameState): void {
    const snap = {
      turn: s.turn,
      hero: {
        id: s.hero.id, name: s.hero.name,
        hp: s.hero.hp, maxHp: s.hero.maxHp, state: s.hero.state,
        statuses: s.hero.statuses.map(st => ({ name: st.name, stacks: st.stacks })),
        formState: s.hero.formState,
      },
      enemies: s.enemies.map(e => ({
        id: e.id, name: e.name,
        hp: e.hp, maxHp: e.maxHp, state: e.state,
        statuses: e.statuses.map(st => ({ name: st.name, stacks: st.stacks })),
      })),
      events: [...turnEvents],
      hashValid: turnEvents.every(ev =>
        ev.preStateHash !== '000000' && ev.postStateHash !== '000000'
      ),
    }
    log.snapshots.push(snap)
    turnEvents = []
  }

  // ─── Step 3: start-of-turn passives (Werewolf transform) ──────────────────
  function applyStartOfTurnPassives(): void {
    if (config.heroClass !== 'werewolf') return
    const pre = state
    state = checkWerewolfTransform(state)
    if (hashState(pre) !== hashState(state)) {
      record('transform', pre, state)
      // Update hand to match new form
      if (state.hero.formState === 'werewolf') {
        state = { ...state, hero: { ...state.hero, hand: ['rend', 'rampage', 'reality_crack'] } }
      } else {
        state = { ...state, hero: { ...state.hero, hand: HERO_STATS.werewolf.hand.slice() } }
      }
    }
  }

  return {
    playCard(cardId: string, targetId = ''): GameState {
      if (state.isOver) return state
      if (!canAct(state.hero)) return state

      const cost = CARD_COSTS[cardId] ?? 1
      if (state.hero.energy < cost) return state

      const pre = state

      // Deduct energy first
      state = { ...state, hero: { ...state.hero, energy: state.hero.energy - cost } }

      // RNG for chaos_bolt resolved here so the value is recorded in telemetry
      let rngValue: number | undefined
      let dispatchRng = rng
      if (cardId === 'chaos_bolt') {
        rngValue = rng()
        dispatchRng = () => rngValue!
      }

      state = dispatchCard(state, cardId, targetId, dispatchRng)
      state = resolveAndCheckWin(state, faults)
      assertValidGameState(state)

      record('play_card', pre, state, { cardId, targetId: targetId || undefined, rngValue })

      if (state.isOver) log.outcome = state.winner === 'hero' ? 'hero_wins' : 'hero_loses'
      return state
    },

    endTurn(): GameState {
      if (state.isOver) return state

      // Record turn_end as a marker — replayer uses this to know when endTurn() was called
      const turnEndPre = state

      // ── Turn Pipeline ──────────────────────────────────────────────────────

      // Step 7: status tick on hero
      {
        const pre = state
        state = tickWithFaults(state, state.hero.id, faults)
        record('status_tick', pre, state, { targetId: 'hero' })
        if (state.isOver) {
          log.outcome = 'hero_loses'
          record('turn_end', turnEndPre, state)
          recordSnapshot(state)
          record('game_over', state, state)
          return state
        }
      }

      // Step 5: enemy acts (unless stunned + ignoreStun=false)
      if (state.enemies[0]?.state !== 'dead') {
        const enemy = state.enemies[0]
        const isStunned = enemy.statuses.some(s => s.name === 'stun')

        if (!isStunned || faults.ignoreStun) {
          const intents = ENEMY_INTENTS[config.enemyType]
          const intent = intents[intentIndex % intents.length]
          const pre = state
          state = executeIntent(state, intent)
          state = checkWin(state, faults)
          record('enemy_action', pre, state, { targetId: 'hero' })
          if (state.isOver) {
            log.outcome = 'hero_loses'
            record('turn_end', turnEndPre, state)
            recordSnapshot(state)
            record('game_over', state, state)
            return state
          }
        }

        // Clear stun after skip
        if (isStunned && !faults.ignoreStun) {
          state = {
            ...state,
            enemies: state.enemies.map(e => ({
              ...e,
              statuses: e.statuses.filter(s => s.name !== 'stun'),
            })),
          }
        }
      }

      // Step 7: status tick on enemy
      {
        const pre = state
        state = tickWithFaults(state, state.enemies[0]?.id ?? 'enemy', faults)
        state = checkWin(state)
        record('status_tick', pre, state, { targetId: 'enemy' })
        if (state.isOver) {
          log.outcome = 'hero_wins'
          record('turn_end', turnEndPre, state)
          recordSnapshot(state)
          record('game_over', state, state)
          return state
        }
      }

      // Step 9: death resolution
      {
        const pre = state
        state = step9_deathResolution(state)
        if (hashState(pre) !== hashState(state)) record('death_resolution', pre, state)
      }

      // Advance turn
      intentIndex = (intentIndex + 1) % ENEMY_INTENTS[config.enemyType].length
      state = {
        ...state,
        turn: state.turn + 1,
        hero: { ...state.hero, energy: 3 },
        enemies: state.enemies.map((e, i) => ({
          ...e,
          intent: ENEMY_INTENTS[config.enemyType][(intentIndex) % ENEMY_INTENTS[config.enemyType].length],
        })),
      }

      // Step 3: start-of-turn passives
      applyStartOfTurnPassives()

      assertValidGameState(state)

      // Record turn_end after all processing — gives replayer the post-turn hash
      record('turn_end', turnEndPre, state)
      recordSnapshot(state)

      if (state.isOver) {
        log.outcome = state.winner === 'hero' ? 'hero_wins' : 'hero_loses'
        record('game_over', state, state)
      }

      return state
    },

    getState(): GameState { return state },
    getLog(): ReplayLog { return { ...log, events: [...log.events] } },
  }
}
