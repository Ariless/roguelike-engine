// The Vitest config Stryker runs against. Everything comes from vitest.config.ts;
// the only difference is the test timeout.
//
// Why it has to differ: Stryker instruments every mutated line for perTest coverage,
// which makes the same suite run an order of magnitude slower — the dry run alone
// takes ~20s for tests that finish in 1.4s under `npm test`. The fast-check property
// tests sit closest to the edge, and at the 5s default they push the whole job over:
// two consecutive mutation runs died in the dry run, on two *different* property
// tests, with `ConfigError: There were failed tests in the initial test run` — before
// a single mutant had been tested. A CI runner is slower than the machine that
// happened to catch this, so it is not a local quirk.
//
// The ordinary suite keeps the 5s default on purpose: there a slow test is a signal
// worth seeing, and nothing there is instrumented. 60s is sized for the measured ~20x
// slowdown with room to spare, not tuned to any single test. 2026-08-26.
import { defineConfig, mergeConfig } from 'vitest/config'
import base from './vitest.config'

export default mergeConfig(
  base,
  defineConfig({
    test: {
      testTimeout: 60_000,
    },
  }),
)
