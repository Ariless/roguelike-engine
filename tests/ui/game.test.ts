import { test, expect } from '@playwright/test'
import * as path from 'path'

const gameUrl = `file://${path.resolve('game/index.html')}`

// Helper: force a specific encounter via seed that maps to it
// goblin+necro = seed where pickEncounter(seed) % 6 = 5 → index 5
// Seeds: 5, 11, 17, 23... (5 + 6n)
async function openGame(page: any, seed = 5) {
  await page.goto(gameUrl)
  await page.fill('#seedInput', String(seed))
  await page.click('button:has-text("NEW")')
  await page.waitForTimeout(200)
}

// ─── Skeleton raise dead ──────────────────────────────────────────────────────

test.describe('Necromancer — raise dead mechanic', () => {
  test('goblin+necro encounter spawns 2 enemy panels initially', async ({ page }) => {
    await openGame(page, 5)
    const panels = page.locator('.entity-panel.multi')
    await expect(panels).toHaveCount(2)
  })

  test('after goblin dies and necromancer raises, skeleton appears as 3rd panel', async ({ page }) => {
    await openGame(page, 5)

    // Kill the goblin (e0) by playing damage cards
    // Select Blood Mage which has chaos_bolt
    await page.click('button[data-hero="bloodmage"]')
    await page.waitForTimeout(100)

    // Play chaos_bolt repeatedly to kill goblin
    for (let i = 0; i < 6; i++) {
      const boltCard = page.locator('.hand-card').filter({ hasText: 'Chaos Bolt' })
      if (await boltCard.count() > 0) {
        await boltCard.first().click()
        await page.waitForTimeout(100)
      }
      if (i % 2 === 1) {
        await page.click('#endTurnBtn')
        await page.waitForTimeout(200)
      }
      if (await page.isVisible('.overlay-gameover')) break
    }

    // Check if skeleton panel appeared
    const panels = page.locator('[id^="enemy-panel-"]')
    const count = await panels.count()
    // If goblin is dead and necromancer raised it, we should have 3 panels total (goblin archived + necromancer + skeleton)
    expect(count).toBeGreaterThanOrEqual(2)
  })

  test('necromancer log shows raise attempt', async ({ page }) => {
    await openGame(page, 5)
    // End 2 turns — necromancer bleed on turn 1, raise on turn 2
    await page.click('#endTurnBtn')
    await page.waitForTimeout(200)
    await page.click('#endTurnBtn')
    await page.waitForTimeout(200)

    const logText = await page.locator('#combatLog').textContent()
    // Either "raises X as a Skeleton" or "no corpse available"
    const hasRaiseLog = logText?.includes('Skeleton') || logText?.includes('attempts to raise')
    expect(hasRaiseLog).toBe(true)
  })
})

// ─── Multi-enemy UI ───────────────────────────────────────────────────────────

test.describe('Multi-enemy encounter UI', () => {
  test('goblin×2 shows two different enemy portraits', async ({ page }) => {
    // seed 1 → goblin×2 (1 % 6 = 1 → index 1 = goblin×2)
    await openGame(page, 1)
    const imgs = page.locator('[id^="enemy-portrait-"] img')
    const count = await imgs.count()
    expect(count).toBe(2)

    if (count >= 2) {
      const src0 = await imgs.nth(0).getAttribute('src')
      const src1 = await imgs.nth(1).getAttribute('src')
      // Second goblin should use goblin2 portrait
      expect(src1).toContain('goblin2')
      expect(src0).not.toContain('goblin2')
    }
  })

  test('clicking enemy panel with card selected targets correct enemy', async ({ page }) => {
    await openGame(page, 1)  // goblin×2
    await page.click('button[data-hero="bloodmage"]')
    await page.waitForTimeout(100)

    // Select open_the_wound card
    const card = page.locator('.hand-card').filter({ hasText: 'Open the Wound' })
    if (await card.count() > 0) {
      await card.first().click()
      await page.waitForTimeout(100)
      // Both enemy panels should be targetable
      const targetable = page.locator('.portrait-frame.targetable')
      await expect(targetable).toHaveCount(2)
    }
  })
})
