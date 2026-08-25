// Pins the fast-check seed so a property run is reproducible.
//
// Why: mutation score is computed from which mutants the suite kills, and four test
// files drive the engine through fc-generated game seeds. With fast-check choosing a
// fresh seed per run, each Stryker run exercised a different set of games and killed
// a different set of mutants — three consecutive measurements of executor.ts came out
// at 72.80%, 74.79% and 68.49% on code that had only gained tests. A gate cannot sit
// on a number that moves on its own.
//
// The seed stays overridable: `FC_SEED=<n> npm test` deliberately explores other
// games, which is the part of property testing this pin would otherwise remove. Change
// the default on purpose — a new default is a new set of games, and the score moves
// with it. 2026-08-25.
import * as fc from 'fast-check'

const seed = process.env.FC_SEED ? Number(process.env.FC_SEED) : 0x5EED

fc.configureGlobal({ seed })
