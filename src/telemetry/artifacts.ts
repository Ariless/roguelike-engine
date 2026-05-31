import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import type { ReplayLog } from './types'
import type { ReplayResult } from './replayer'

const ARTIFACTS_DIR = join(process.cwd(), 'artifacts')

// ─── saveFailingRun ───────────────────────────────────────────────────────────
// Archives a failing replay log to /artifacts/failing-seed-{seed}.json.
// Called when: a property test finds a failing seed, or replayGame() diverges.
// The Archivist preserves corrupted timelines for analysis.
export function saveFailingRun(log: ReplayLog, result?: ReplayResult): string {
  if (!existsSync(ARTIFACTS_DIR)) {
    mkdirSync(ARTIFACTS_DIR, { recursive: true })
  }

  const filename = `failing-seed-${log.seed}.json`
  const path = join(ARTIFACTS_DIR, filename)

  const artifact = {
    ...log,
    _meta: {
      savedAt: new Date().toISOString(),
      divergedAt: result?.divergedAt ?? null,
      divergedTurn: result?.divergedTurn ?? null,
      eventsReplayed: result?.eventsReplayed ?? log.events.length,
    },
  }

  writeFileSync(path, JSON.stringify(artifact, null, 2))
  return path
}

// ─── loadArtifact ─────────────────────────────────────────────────────────────
// Loads a previously saved artifact by seed.
export function loadArtifact(seed: number): ReplayLog | null {
  const path = join(ARTIFACTS_DIR, `failing-seed-${seed}.json`)
  if (!existsSync(path)) return null
  const raw = require('fs').readFileSync(path, 'utf-8')
  return JSON.parse(raw) as ReplayLog
}
