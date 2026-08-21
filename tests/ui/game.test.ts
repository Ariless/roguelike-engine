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
    // Seed 5 is the goblin+necro encounter (pickEncounter: keys[seed % 7]).
    //
    // BUG-16: this test used to assert `toBeGreaterThanOrEqual(2)` while its
    // name and its own comment talked about a third panel. Two panels exist
    // from the start, so it passed whether or not the goblin died and whether
    // or not a skeleton ever appeared — it asserted the starting condition and
    // called it a result.
    //
    // Fixing the assertion exposed a second problem: the old scenario played
    // Blood Mage and spammed Chaos Bolt, which picks targets at random and
    // finished both enemies before the necromancer ever reached his raise turn.
    // The scenario now targets the goblin deliberately and leaves the
    // necromancer alive, which is the only board on which raise can fire.
    await openGame(page, 5)
    await page.click('button[data-hero="paladin"]')
    await page.waitForTimeout(150)

    const goblinPanel = page.locator('[id^="enemy-panel-"]').filter({ hasText: 'Goblin' }).first()

    // Strike the goblin until it is archived, ending turns to refresh energy.
    for (let turn = 0; turn < 8; turn++) {
      const dead = await goblinPanel.evaluate(el => el.className.includes('dead')).catch(() => false)
      if (dead) break

      for (let card = 0; card < 3; card++) {
        const strike = page.locator('.hand-card').filter({ hasText: 'Righteous Strike' }).first()
        if (await strike.count() === 0) break
        await strike.click()
        await page.waitForTimeout(60)
        await goblinPanel.click()
        await page.waitForTimeout(80)
      }

      if (await page.isVisible('.overlay-gameover')) break
      const endTurn = page.locator('#endTurnBtn')
      if (!(await endTurn.isEnabled())) break
      await endTurn.click()
      await page.waitForTimeout(150)
    }

    // With a corpse on the field the necromancer's raise row can fire. Give it
    // the turns it needs to come around in the intent cycle.
    for (let turn = 0; turn < 4; turn++) {
      const skeleton = page.locator('[id^="enemy-panel-"]').filter({ hasText: 'Skeleton' })
      if (await skeleton.count() > 0) break
      if (await page.isVisible('.overlay-gameover')) break
      const endTurn = page.locator('#endTurnBtn')
      if (!(await endTurn.isEnabled())) break
      await endTurn.click()
      await page.waitForTimeout(200)
    }

    const skeletonPanel = page.locator('[id^="enemy-panel-"]').filter({ hasText: 'Skeleton' })
    await expect(skeletonPanel).toHaveCount(1)
  })

  test('necromancer log shows raise attempt', async ({ page }) => {
    await openGame(page, 5)
    // End 2 turns — necromancer bleed on turn 1, raise on turn 2
    await page.click('#endTurnBtn')
    await page.waitForTimeout(200)
    await page.click('#endTurnBtn')
    await page.waitForTimeout(200)

    const logText = await page.locator('#combatLog').textContent()
    // Also BUG-16: this was a disjunction covering both outcomes — a raise that
    // worked and a raise that found nothing — so any log at all satisfied it.
    // On turn 2 with the goblin still alive there is no corpse, so the only
    // correct outcome is the attempt, and that is what gets asserted.
    expect(logText).toContain('attempts to raise')
  })
})

// ─── Enemy death from bleed (regression: ROG-42) ─────────────────────────────
// Bug: tickStatuses in the game UI did not convert death_door → dead for enemies.
// An enemy at HP=0 from bleed played the death-door-archive animation and only died
// a turn later. Fix: added the same conversion as dealDamage line 1901.

test.describe('Enemy death — bleed kills immediately (ROG-42 regression)', () => {
  // seed 0 % 7 = 0 → single goblin encounter; bloodmage is default hero
  // Turn 1: Chaos Bolt (5 dmg) + Bloodrite (8 dmg) → goblin 7 HP. End turn.
  // Turn 2: Open the Wound (3 bleed) + Chaos Bolt (5 dmg) → goblin 2 HP. End turn.
  //   endTurn: goblin attacks, then bleed tick 3 → goblin 0 HP → dead.

  async function playCard(page: any, cardName: string, enemyId?: string) {
    const card = page.locator('.hand-card').filter({ hasText: cardName })
    await card.first().click()
    await page.waitForTimeout(80)
    if (enemyId) {
      await page.locator(`#enemy-panel-${enemyId}`).click()
      await page.waitForTimeout(80)
    }
  }

  test('enemy killed by bleed gets dead class, not death-door-archive', async ({ page }) => {
    await openGame(page, 0)  // single goblin

    // Turn 1: deal 13 damage (chaos_bolt random-targets automatically)
    await playCard(page, 'Chaos Bolt')        // 5 dmg → goblin 15 HP
    await playCard(page, 'Bloodrite', 'e0')   // 8 dmg → goblin 7 HP, self 3
    await page.click('#endTurnBtn')
    await page.waitForTimeout(300)

    // Turn 2: apply bleed + 5 dmg → goblin 2 HP with 3 bleed
    await playCard(page, 'Open the Wound', 'e0')  // 3 bleed stacks
    await playCard(page, 'Chaos Bolt')             // 5 dmg → goblin 2 HP
    await page.click('#endTurnBtn')
    await page.waitForTimeout(400)  // wait for bleed tick animation

    const portrait = page.locator('#enemy-portrait-e0')

    // Regression assertion: portrait must have 'dead' class — not 'death-door-archive'
    await expect(portrait).toHaveClass(/dead/)
    await expect(portrait).not.toHaveClass(/death-door-archive/)
  })

  test('game shows victory overlay immediately after bleed kill — not after next end turn', async ({ page }) => {
    await openGame(page, 0)

    await playCard(page, 'Chaos Bolt')
    await playCard(page, 'Bloodrite', 'e0')
    await page.click('#endTurnBtn')
    await page.waitForTimeout(300)

    await playCard(page, 'Open the Wound', 'e0')
    await playCard(page, 'Chaos Bolt')
    await page.click('#endTurnBtn')
    await page.waitForTimeout(400)

    // Victory must appear THIS turn — before any additional endTurn
    await expect(page.locator('#overlayGameover')).toBeVisible()
    const label = await page.locator('.gameover-title').textContent()
    expect(label).toMatch(/containment|archived|timeline|victory/i)
  })

  test('enemy HP text shows 0 and intent shows Archived after bleed kill', async ({ page }) => {
    await openGame(page, 0)

    await playCard(page, 'Chaos Bolt')
    await playCard(page, 'Bloodrite', 'e0')
    await page.click('#endTurnBtn')
    await page.waitForTimeout(300)

    await playCard(page, 'Open the Wound', 'e0')
    await playCard(page, 'Chaos Bolt')
    await page.click('#endTurnBtn')
    await page.waitForTimeout(400)

    await expect(page.locator('#enemy-hptext-e0')).toHaveText('0/20')
    await expect(page.locator('#enemy-intent-e0')).toHaveText('✦ Archived')
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
