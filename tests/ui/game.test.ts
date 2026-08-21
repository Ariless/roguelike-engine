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
    // BUG-16: this test used to assert `toBeGreaterThanOrEqual(2)` while its name
    // talked about a third panel. Two panels exist from the start, so it passed
    // whether or not a skeleton ever appeared.
    //
    // On timing: an earlier version drove the scenario with fixed waits and a
    // fixed number of turns. It passed locally and failed inside the CI container
    // twice — the machine was slower, the pauses were not, and the loop ran out
    // of turns before the goblin died. Nothing here waits for a duration now:
    // every step waits for the state it needs, and the whole scenario is bounded
    // by one deadline rather than by an iteration count. A test for a
    // deterministic engine has no business being timing-dependent.
    // The scenario plays a full battle through the UI, so it needs more than the
    // default per-test budget. Stated explicitly rather than left to chance.
    test.setTimeout(90_000)

    await openGame(page, 5)
    await page.click('button[data-hero="paladin"]')

    const goblinPanel = page.locator('[id^="enemy-panel-"]').filter({ hasText: 'Goblin' }).first()
    const goblinHp = goblinPanel.locator('.hp-text')
    const skeletonPanel = page.locator('[id^="enemy-panel-"]').filter({ hasText: 'Skeleton' })
    const endTurnBtn = page.locator('#endTurnBtn')

    await expect(goblinHp).toBeVisible()

    // The `dead` class lands on the .portrait-frame inside the panel, not on the
    // panel itself. An earlier version of this test checked the panel, never saw
    // the goblin die, and spun until its deadline — which read as flakiness and
    // was in fact a wrong selector. Timing was never the problem.
    const isArchived = () =>
      goblinPanel
        .locator('.portrait-frame')
        .evaluate(el => /\bdead\b/.test(el.className))
        .catch(() => false)

    // One fingerprint of everything a turn can move: the turn counter, the log and
    // every HP readout. Waiting on any single one of them is fragile — a turn can
    // pass without the counter changing, or without a new log line — and that
    // fragility is what made the earlier version flake in CI.
    const fingerprint = () => page.evaluate(() => [
      document.getElementById('turnDisplay')?.textContent,
      document.getElementById('combatLog')?.textContent,
      [...document.querySelectorAll('.hp-text')].map(e => e.textContent).join('|'),
    ].join('§'))

    /** Ends the turn and waits for the board to actually move. False if it did not. */
    async function advanceTurn(): Promise<boolean> {
      const before = await fingerprint()
      await endTurnBtn.click()
      return page
        .waitForFunction(
          prev => [
            document.getElementById('turnDisplay')?.textContent,
            document.getElementById('combatLog')?.textContent,
            [...document.querySelectorAll('.hp-text')].map(e => e.textContent).join('|'),
          ].join('§') !== prev,
          before,
          { timeout: 5000 },
        )
        .then(() => true)
        .catch(() => false)
    }

    const deadline = Date.now() + 45_000
    const outOfTime = () => Date.now() > deadline

    // ── Phase 1: strike the goblin down, leaving the necromancer alive ──────
    while (!(await isArchived()) && !outOfTime()) {
      if (await page.locator('.overlay-gameover').isVisible()) break

      const strike = page.locator('.hand-card').filter({ hasText: 'Righteous Strike' }).first()
      if (await strike.isVisible()) {
        const hpBefore = await goblinHp.textContent().catch(() => null)
        if (hpBefore === null) break   // the panel is gone: the goblin is already archived
        await strike.click()
        await goblinPanel.click()

        // The card landed when the target's HP changes, or when the goblin is
        // archived and its HP text goes away. A card can also legitimately not
        // land — with no energy left the click is a no-op — so this is a soft
        // wait: if nothing moved, fall through and end the turn to refresh
        // energy. Asserting here would fail the test on a normal game state.
        const landed = await page
          .waitForFunction(
            ([sel, before]) => {
              const el = document.querySelector(sel)
              return el === null || el.textContent !== before
            },
            [`#${await goblinHp.evaluate(el => el.id)}`, hpBefore],
            { timeout: 1500 },
          )
          .then(() => true)
          .catch(() => false)

        if (landed) continue
      }

      if (!(await endTurnBtn.isEnabled())) break
      if (!(await advanceTurn())) break
    }

    expect(await isArchived(), 'the goblin has to be archived before raise can fire').toBe(true)

    // ── Phase 2: end turns until the raise row comes around the intent cycle ──
    while ((await skeletonPanel.count()) === 0 && !outOfTime()) {
      if (await page.locator('.overlay-gameover').isVisible()) break
      if (!(await endTurnBtn.isEnabled())) break
      if (!(await advanceTurn())) break
    }

    await expect(skeletonPanel).toHaveCount(1)
  })

  test('with the goblin alive the necromancer withers instead of raising', async ({ page }) => {
    // BUG-20. This test used to assert the log contained "attempts to raise" on
    // turn 2 — it was pinning the defect. The UI read intents straight from the
    // static table, so Raise was announced and "attempted" with no corpse on the
    // field. DECISION-TABLES.md:79 is explicit: with no ally dead the turn is
    // Wither. What the log should show is bleed, and what the panel should
    // announce is Wither.
    await openGame(page, 5)
    await page.click('#endTurnBtn')
    await page.waitForTimeout(200)
    await page.click('#endTurnBtn')
    await page.waitForTimeout(200)

    const necroIntent = await page.locator('[id^="enemy-intent-"]').last().textContent()
    expect(necroIntent).toContain('Wither')

    const logText = await page.locator('#combatLog').textContent()
    expect(logText).not.toContain('attempts to raise')
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
