// Every card, played through the executor.
//
// The hero files test each card's effect by calling playX() directly, and the executor
// tests drive a handful of cards to move a battle along. Nothing played the whole roster
// through `playCard`, so `dispatchCard` — the switch that maps a card id to its handler —
// was the least covered part of the file: 43 of its survivors were StringLiteral mutants
// on the `case` labels alone. A blanked label means the card falls through to the default
// and silently does nothing, while the energy has already been spent.
import { describe, it, expect } from 'vitest'
import { createGame } from '../../src/runtime/executor'
import type { GameState, HeroClass } from '../../src/engine/types'

/** A fingerprint of everything a card could plausibly change. */
function fingerprint(state: GameState): string {
  return JSON.stringify({ hero: state.hero, enemies: state.enemies })
}

const HUMAN_ROSTER: Array<{ heroClass: HeroClass; cards: string[] }> = [
  { heroClass: 'paladin', cards: ['righteous_strike', 'stubborn_recovery', 'divine_charge'] },
  { heroClass: 'bloodmage', cards: ['open_the_wound', 'bloodrite', 'chaos_bolt'] },
  { heroClass: 'berserker', cards: ['savage_lunge', 'primal_fury', 'primal_dodge'] },
  { heroClass: 'werewolf', cards: ['lunar_strike', 'pack_sense', 'stalk'] },
]

describe('dispatchCard — every card reaches a handler', () => {
  for (const { heroClass, cards } of HUMAN_ROSTER) {
    for (const cardId of cards) {
      it(`${heroClass}: ${cardId} changes the board`, () => {
        const game = createGame({ seed: 5, heroClass, enemyType: 'goblin' })
        const before = fingerprint(game.getState())

        game.playCard(cardId, 'enemy')

        // A card that fell through the switch would leave the board untouched while the
        // energy was already deducted — the exact shape a blanked case label produces.
        expect(fingerprint(game.getState()), `${cardId} did nothing`).not.toBe(before)
      })
    }
  }

  it('an unknown card id spends nothing and changes nothing', () => {
    const game = createGame({ seed: 5, heroClass: 'paladin', enemyType: 'goblin' })
    const before = fingerprint(game.getState())

    game.playCard('no_such_card', 'enemy')

    expect(fingerprint(game.getState())).toBe(before)
  })

  // Kill: LogicalOperator on `targetId || enemyId` — the fallback that lets a card be
  // played without naming a target. With `&&` the call would target an empty string.
  it('a damage card with no target given still hits the enemy', () => {
    const game = createGame({ seed: 5, heroClass: 'paladin', enemyType: 'goblin' })
    const hpBefore = game.getState().enemies[0].hp

    game.playCard('righteous_strike')

    expect(game.getState().enemies[0].hp).toBeLessThan(hpBefore)
  })
})

describe('dispatchCard — the wolf hand', () => {
  /** Plays turns against a goblin until the werewolf transforms. */
  function transformed() {
    const game = createGame({ seed: 42, heroClass: 'werewolf', enemyType: 'goblin' })
    for (let i = 0; i < 5 && game.getState().hero.formState !== 'werewolf'; i++) game.endTurn()
    expect(game.getState().hero.formState).toBe('werewolf')
    return game
  }

  for (const cardId of ['rend', 'rampage', 'reality_crack']) {
    it(`${cardId} changes the board once the wolf is out`, () => {
      const game = transformed()
      const before = fingerprint(game.getState())

      game.playCard(cardId, 'enemy')

      expect(fingerprint(game.getState()), `${cardId} did nothing`).not.toBe(before)
    })
  }
})

describe('chaos_bolt — target selection', () => {
  // Kill: ConditionalExpression and MethodExpression around `living.length > 0`. The
  // filter exists so the bolt cannot pick a corpse; with a dead enemy on the board and a
  // living one beside it, a mutant that ignores the filter targets the corpse instead.
  it('never spends the bolt on a corpse while something lives', () => {
    const game = createGame({ seed: 11, heroClass: 'bloodmage', enemyType: 'necromancer' })

    // Kill the escort, leaving one corpse and one living enemy.
    for (let turn = 0; turn < 6 && game.getState().enemies[0].state !== 'dead'; turn++) {
      for (let card = 0; card < 3; card++) {
        if (game.getState().enemies[0].state === 'dead') break
        game.playCard('open_the_wound', 'e0')
      }
      if (game.getState().enemies[0].state !== 'dead') game.endTurn()
    }

    const state = game.getState()
    expect(state.enemies[0].state, 'setup: escort should be dead').toBe('dead')
    const necromancerHpBefore = state.enemies[1].hp

    game.playCard('chaos_bolt')

    expect(game.getState().enemies[1].hp).toBeLessThan(necromancerHpBefore)
  })
})
