// Target balance corridors.
//
// IMPORTANT, on where these numbers come from. A corridor is design INTENT,
// fixed before the run. It is not derived from the simulation results.
// A corridor fitted to the measurement always passes and therefore says nothing:
// the check "the system behaves the way it behaves" is a tautology.
//
// So these bounds are set from what the game means, and the simulation is fully entitled
// to fail them. FAIL here means "balance diverged from intent", not
// "the script broke". A divergence is the result the run exists to produce.
//
// The same approach is used in balance_sim.py on another project, where corridors on
// battle types (normal 45–80%, elite 20–45%, boss 30–55%) are also set by design.

import type { Corridor } from './stats'

// ─── Class win rate ──────────────────────────────────────────────────────────
//
// Measured with a random-greedy auto-player that plays deliberately sub-optimally.
//
// Lower bound 45%: if the hero loses more often than they win even with sub-optimal play,
// the fight gives the player nothing to stand on — the draw decides the outcome, not their decisions.
//
// Upper bound 80%: if random play wins more often than 4 battles out of 5,
// then the fight has no challenge and the player's decisions change nothing. That is the worse of the two
// failures: broken difficulty is obvious immediately, while an absent challenge reads as
// boredom with no obvious cause.
export const CLASS_WINRATE: Corridor = { min: 0.45, max: 0.80 }

// ─── Win rate of an individual hero/enemy pair ───────────────────────────────
//
// A wider corridor: asymmetry within a pair is a normal part of design, heroes are meant
// to have comfortable and awkward opponents. But a pair outside 15–95%
// means one of the two sides is not taking part in the fight.
export const MATCHUP_WINRATE: Corridor = { min: 0.15, max: 0.95 }

// ─── Battle duration ─────────────────────────────────────────────────────────
//
// Below 3 turns the mechanics never get to fire: bleed does not tick, the berserker
// never accumulates missing HP, the werewolf never transforms. Above 12 the fight is
// the same turn repeated, with nothing new happening.
export const BATTLE_DURATION: Corridor = { min: 3, max: 12 }

// ─── Cross-batch stability ───────────────────────────────────────────────────
//
// Win-rate spread across batches on different base seeds. Within-batch noise
// is estimated by the confidence interval; what is checked here is different — that the estimate
// does not depend on which seed sampling started from. A spread above 5 percentage points
// across tens of thousands of runs means the seed picks the outcome, and the result of
// a single batch cannot be presented as a property of the system.
export const CROSS_BATCH_SPREAD_MAX = 0.05
