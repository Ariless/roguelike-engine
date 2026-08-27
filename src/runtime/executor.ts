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
import type { GameState, HeroClass, EnemyType, Intent, Enemy } from '../engine/types'
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
// Exported for tests/decision-tables.test.ts: the table is compared against
// docs/DECISION-TABLES.md, which CLAUDE.md declares the intended spec. Without
// the export, a divergence between spec and code can only be spotted by eye.
export const ENEMY_INTENTS: Record<EnemyType, Intent[]> = {
  goblin:      [{ type: 'attack', value: 6 }, { type: 'attack', value: 6 }, { type: 'attack', value: 6 }],
  guardian:    [{ type: 'defend' },           { type: 'stun' },             { type: 'attack', value: 10 }],
  vampire:     [{ type: 'attack', value: 6, lifesteal: true }, { type: 'bleed', value: 2 },  { type: 'attack', value: 12 }],
  necromancer: [{ type: 'bleed', value: 3 },  { type: 'raise' },            { type: 'empower', value: 3 }],
  // A skeleton never cycles a table: it is spawned with its intent already set.
  skeleton:    [{ type: 'attack', value: 4 }],
}

const ENEMY_STATS: Record<EnemyType, { name: string; hp: number }> = {
  goblin:      { name: 'Goblin',      hp: 20 },
  guardian:    { name: 'Guardian',    hp: 35 },
  vampire:     { name: 'Vampire',     hp: 30 },
  necromancer: { name: 'Necromancer', hp: 25 },
  // Not an encounter type: a skeleton only ever enters play through Raise Dead.
  skeleton:    { name: 'Skeleton',    hp: 8 },
}

/** A skeleton's only move. Held here so the spawn site has nothing to invent. */
const SKELETON_INTENT: Intent = { type: 'attack', value: 4 }

// ─── Conditional intents ──────────────────────────────────────────────────────
//
// Until BUG-14 the intent was `intents[turn % length]` — a pure function of the
// turn number, blind to the board. That is why two rows of the Necromancer's
// decision table were unimplementable rather than merely unimplemented: "raise
// if an ally corpse is present" cannot be expressed by a lookup that never sees
// the board.
//
// The table stays the declaration of what an enemy does; this function resolves
// the rows that carry a condition. Enemies without conditional rows fall
// straight through and behave exactly as before.
export function resolveIntent(
  enemyType: EnemyType,
  turnIndex: number,
  state: GameState,
): Intent {
  const intents = ENEMY_INTENTS[enemyType]
  const intent = intents[turnIndex % intents.length]

  if (intent.type === 'raise') {
    // DECISION-TABLES.md:78-79 — a corpse that has not been raised before, else Wither.
    return hasRaisableCorpse(state) ? intent : { type: 'bleed', value: 3 }
  }

  if (intent.type === 'empower') {
    // DECISION-TABLES.md:80 — a living skeleton to empower, else Wither.
    return hasLivingSkeleton(state) ? intent : { type: 'bleed', value: 3 }
  }

  return intent
}

function hasRaisableCorpse(state: GameState): boolean {
  return state.enemies.some(e => e.state === 'dead' && e.raisedOnce !== true)
}

function hasLivingSkeleton(state: GameState): boolean {
  return state.enemies.some(e => e.enemyType === 'skeleton' && e.state !== 'dead')
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
    enemies: makeEncounter(config.enemyType),
    isOver: false,
  }
}

// ─── Encounters ───────────────────────────────────────────────────────────────
//
// Until BUG-14 every encounter was exactly one enemy. That was invisible as a
// limitation until Raise Dead landed: the Necromancer raises *ally* corpses, and
// with no ally there is never a corpse, so the mechanic was implemented and
// unreachable at the same time. The simulation reported no change at all —
// correct code, zero effect.
//
// game/index.html has carried a `goblin+necro` encounter since May
// (ENCOUNTER_DEFS, line 1676). The engine simply never had the concept. This
// brings the engine in line with the definition the UI was already using.
function makeEncounter(enemyType: EnemyType): Enemy[] {
  const spawn = (type: EnemyType, id: string): Enemy => {
    const stats = ENEMY_STATS[type]
    return {
      id,
      name: stats.name,
      hp: stats.hp, maxHp: stats.hp,
      state: 'alive',
      statuses: [],
      row: 'front',
      enemyType: type,
      intent: ENEMY_INTENTS[type][0],
    }
  }

  // The Necromancer is "The Accumulator": his table is built around a body to
  // raise. Alone he is a bleed dispenser, which is exactly what BUG-14 measured.
  if (enemyType === 'necromancer') {
    return [spawn('goblin', 'e0'), spawn('necromancer', 'e1')]
  }

  return [spawn(enemyType, 'enemy')]
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
// Exported for tests/necromancer.test.ts: choosing an intent and executing it are
// separate failures, and the execution side needs to be checked on a board built
// by hand rather than only through whole battles.
export function executeIntent(state: GameState, intent: Intent, actorId?: string): GameState {
  const heroId = state.hero.id
  // Which enemy is acting. Defaults to the first for every caller written before
  // more than one enemy could act in a turn.
  const actor = actorId ?? state.enemies[0]?.id

  switch (intent.type) {
    case 'attack': {
      const heroBefore = state.hero.hp
      const acting = state.enemies.find(e => e.id === actor)
      // Empower is spent on the next attack whether or not it lands: the bonus
      // was granted a turn earlier, and holding it until a hit would let a
      // skeleton bank empowerments across turns.
      const bonus = acting?.empowered ?? 0
      let s = applyDamage(state, heroId, intent.value + bonus)

      if (bonus > 0) {
        s = {
          ...s,
          enemies: s.enemies.map(e => (e.id === actor ? { ...e, empowered: 0 } : e)),
        }
      }

      // Lifesteal: heals attacker for actual damage dealt (post-defend), capped at missing HP
      if (intent.lifesteal) {
        const actualDmg = heroBefore - s.hero.hp  // real HP lost after defend absorption
        if (actualDmg > 0) {
          s = {
            ...s,
            enemies: s.enemies.map(e =>
              e.id === actor
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
      return addStatus(state, actor!, { name: 'defend', stacks: 8 })
    case 'stun':
      return addStatus(state, heroId, { name: 'stun', stacks: 1 })

    case 'raise': {
      // The corpse is consumed, not merely read: raisedOnce is what stops one
      // body from supplying skeletons forever.
      const corpse = state.enemies.find(e => e.state === 'dead' && e.raisedOnce !== true)
      if (!corpse) return state  // graceful no-op — DECISIONS.md:335

      // A deterministic id. The UI builds this as `skeleton-${Date.now()}`,
      // which breaks "same seed, same log" in the game layer; the engine cannot
      // afford that, so the id counts skeletons ever raised in this battle.
      const raisedSoFar = state.enemies.filter(e => e.enemyType === 'skeleton').length
      const skeleton: Enemy = {
        id: `skeleton-${raisedSoFar + 1}`,
        name: ENEMY_STATS.skeleton.name,
        hp: ENEMY_STATS.skeleton.hp,
        maxHp: ENEMY_STATS.skeleton.hp,
        state: 'alive',
        statuses: [],
        row: 'front',
        enemyType: 'skeleton',
        intent: SKELETON_INTENT,
      }

      return {
        ...state,
        enemies: [
          ...state.enemies.map(e => (e.id === corpse.id ? { ...e, raisedOnce: true } : e)),
          skeleton,
        ],
      }
    }

    case 'empower': {
      const skeleton = state.enemies.find(e => e.enemyType === 'skeleton' && e.state !== 'dead')
      if (!skeleton) return state  // graceful no-op

      return {
        ...state,
        enemies: state.enemies.map(e =>
          e.id === skeleton.id ? { ...e, empowered: (e.empowered ?? 0) + intent.value } : e
        ),
      }
    }

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

      // BUG-23: an id with no entry in CARD_COSTS used to fall back to 1, get its energy
      // deducted, and then land in dispatchCard's default branch — spending a point on
      // nothing. The card table is the authority on what a card is; an id that is not in it
      // is not a card, and the turn is left untouched.
      const cost = CARD_COSTS[cardId]
      if (cost === undefined) return state
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

      // Step 5: enemies act
      //
      // Iterates over a snapshot of the ids taken before the loop. Raise Dead
      // appends a skeleton mid-step, and a skeleton must not act on the turn it
      // was raised — iterating the live array would let it attack immediately,
      // which is neither in the decision table nor survivable for the hero.
      {
        const actingIds = state.enemies.filter(e => e.state !== 'dead').map(e => e.id)

        for (const actorId of actingIds) {
          const enemy = state.enemies.find(e => e.id === actorId)
          // The hero may have killed it earlier in this same step, and a
          // skeleton's own attack can end the battle.
          if (!enemy || enemy.state === 'dead' || state.isOver) continue

          // No stun guard here: nothing in the game can stun an enemy. The only
          // source of stun is the Guardian's intent, and it applies to the hero
          // (executeIntent's 'stun' case targets heroId). The guard that used to
          // wrap this block, and the branch that cleared the stun afterwards, were
          // unreachable on every path — see BUG-18 for the flag they answered to.
          // Restore both alongside the card or intent that first stuns an enemy.

          // A skeleton carries its intent; every other enemy cycles its table,
          // resolved against the board so conditional rows can fire.
          // Resolved against the acting enemy's own type, not the encounter's
          // headline type. With an escort on the field those differ, and using
          // the config type would have a goblin performing necromancy.
          const intent = enemy.enemyType === 'skeleton'
            ? enemy.intent
            : resolveIntent(enemy.enemyType, intentIndex, state)

          const pre = state
          state = executeIntent(state, intent, actorId)
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
      }

      // Step 7: status tick on enemy
      {
        const pre = state
        state = tickWithFaults(state, state.enemies[0]?.id ?? 'enemy', faults)
        // BUG-18: this call used to omit `faults`. Three of the four win checks
        // passed them through and this one did not, so ignoreDeathDoor was
        // bypassed here on every turn and the flag injected nothing at all.
        state = checkWin(state, faults)
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
        // BUG-22: this used to hand every enemy the encounter type's row, so a goblin
        // escort previewed necromancy and — worse — the skeleton, the one enemy that
        // executes its stored intent rather than re-resolving its own type (step 5
        // below), lost the attack it was spawned with. Each enemy now previews its own
        // table, through the same resolver the execution path uses, so the announced
        // intent and the executed one cannot disagree (the rule BUG-20 established).
        enemies: state.enemies.map(e =>
          e.enemyType === 'skeleton'
            ? e
            : { ...e, intent: resolveIntent(e.enemyType, intentIndex, state) }
        ),
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
