// Generates a sample replay.json for debugger testing.
// Usage: npx tsx scripts/generate-replay.ts

import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { createGame } from '../src/runtime/executor'

const seed = parseInt(process.argv[2] ?? '42')

const game = createGame({ seed, heroClass: 'werewolf', enemyType: 'guardian' })

// Turn 1: human form — setup
game.playCard('pack_sense')
game.playCard('stalk')
game.endTurn()

// Turn 2: guardian stuns
game.endTurn()

// Turn 3: guardian attacks heavily — hero goes low → transforms
game.playCard('lunar_strike')
game.endTurn()

// Turn 4: werewolf form active
game.playCard('rend')
game.playCard('reality_crack')
game.endTurn()

// Turn 5: finish
game.playCard('rend')
game.playCard('rampage')
game.endTurn()

const log = game.getLog()

const dir = join(process.cwd(), 'artifacts')
if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

const path = join(dir, `replay-seed-${seed}.json`)
writeFileSync(path, JSON.stringify(log, null, 2))

console.log(`Archived timeline saved: ${path}`)
console.log(`Segments: ${log.snapshots.length}  |  Outcome: ${log.outcome}  |  Events: ${log.events.length}`)
console.log(`Open: debugger/index.html → load ${path}`)
