import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    exclude: ['**/node_modules/**', '**/.stryker-tmp/**', 'tests/ui/**'],
    // Pins the fast-check seed — see tests/setup/fast-check.ts for why the score
    // moved between runs without it.
    setupFiles: ['./tests/setup/fast-check.ts'],
  },
})
