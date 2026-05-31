import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/ui',
  use: {
    baseURL: 'file://' + process.cwd(),
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})
