// Visual Regression Testing — Playwright screenshots + baseline comparison.
//
// Captures game UI at key states and compares against stored baselines.
// Detects unexpected visual changes: layout shifts, missing elements, rendering bugs.
//
// First run: creates baseline screenshots in tests/ui/screenshots/
// Subsequent runs: compares against baseline, fails on diff > threshold

import { test, expect } from '@playwright/test'
import * as path from 'path'

const gameUrl = `file://${path.resolve('game/index.html')}`

test.describe('visual regression — game UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(gameUrl)
    await page.waitForTimeout(300)
  })

  test('initial game state — Blood Mage vs Goblin (seed 0)', async ({ page }) => {
    await page.fill('#seedInput', '0')
    await page.click('button:has-text("NEW")')
    await page.click('button[data-hero="bloodmage"]')
    await page.waitForTimeout(200)

    await expect(page).toHaveScreenshot('initial-bloodmage-goblin.png', {
      maxDiffPixelRatio: 0.02,
    })
  })

  test('card selected — targetable enemies highlighted', async ({ page }) => {
    await page.fill('#seedInput', '1')
    await page.click('button:has-text("NEW")')
    await page.click('button[data-hero="bloodmage"]')
    await page.waitForTimeout(200)

    // Select chaos_bolt — enemies should be targetable
    const boltCard = page.locator('.hand-card').filter({ hasText: 'Chaos Bolt' })
    if (await boltCard.count() > 0) {
      await boltCard.first().click()
      await page.waitForTimeout(100)
    }

    await expect(page).toHaveScreenshot('card-selected-targetable.png', {
      maxDiffPixelRatio: 0.02,
    })
  })

  test('Death\'s Door state — hero portrait changes', async ({ page }) => {
    await page.fill('#seedInput', '42')
    await page.click('button:has-text("NEW")')
    await page.click('button[data-hero="paladin"]')
    await page.waitForTimeout(200)

    // Take damage until death's door by ending turns
    for (let i = 0; i < 5; i++) {
      if (await page.isVisible('.overlay-gameover')) break
      const heroState = await page.locator('#heroPanel').getAttribute('class')
      if (heroState?.includes('death')) break
      await page.click('#endTurnBtn')
      await page.waitForTimeout(150)
    }

    await expect(page).toHaveScreenshot('deaths-door-hero.png', {
      maxDiffPixelRatio: 0.05,  // higher threshold — timing-dependent
    })
  })

  test('debugger — timeline loaded', async ({ page }) => {
    const debuggerUrl = `file://${path.resolve('debugger/index.html')}`
    await page.goto(debuggerUrl)
    await page.waitForTimeout(300)

    // Load replay via window.loadJSON
    const { readFileSync, existsSync } = await import('fs')
    const replayPath = path.resolve('artifacts/replay-seed-42.json')
    if (existsSync(replayPath)) {
      const log = JSON.parse(readFileSync(replayPath, 'utf-8'))
      await page.evaluate((data) => { (globalThis as any).loadJSON(data) }, log)
      await page.waitForTimeout(300)
    }

    await expect(page).toHaveScreenshot('debugger-timeline-loaded.png', {
      maxDiffPixelRatio: 0.02,
    })
  })
})
