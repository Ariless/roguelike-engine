import { test, expect, Page } from '@playwright/test'
import * as path from 'path'
import * as fs from 'fs'

const debuggerUrl = `file://${path.resolve('debugger/index.html')}`
const replayPath  = path.resolve('artifacts/replay-seed-42.json')

// Inject a replay log into the debugger page without the file dialog.
async function loadReplay(page: Page, jsonPath: string) {
  const log = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))
  await page.evaluate((data) => {
    // @ts-ignore — call window.loadJSON exposed by debugger for testing
    window.loadJSON(data)
  }, log)
}

test.describe('debugger.html — forensic timeline viewer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(debuggerUrl)
    await loadReplay(page, replayPath)
  })

  test('load screen hides, main view shows after loading replay', async ({ page }) => {
    await expect(page.locator('#loadScreen')).toBeHidden()
    await expect(page.locator('#mainView')).toBeVisible()
  })

  test('top bar shows Timeline ID from seed', async ({ page }) => {
    const meta = await page.locator('#topMeta').textContent()
    expect(meta).toContain('42')
  })

  test('stability badge shows percentage', async ({ page }) => {
    const badge = await page.locator('#stabilityBadge').textContent()
    expect(badge).toMatch(/Timeline Stability: \d+%/)
  })

  test('segment list renders correct number of segments', async ({ page }) => {
    const segments = page.locator('.segment-item')
    await expect(segments).toHaveCount(5)  // replay-seed-42 has 5 segments
  })

  test('first segment shows hero integrity bar', async ({ page }) => {
    const entityBlocks = page.locator('.entity-block')
    await expect(entityBlocks.first()).toBeVisible()
  })

  test('event list renders events with hashes', async ({ page }) => {
    const events = page.locator('.event-row')
    const count = await events.count()
    expect(count).toBeGreaterThan(0)
  })

  test('hash verification shows containment successful for valid log', async ({ page }) => {
    const vBlock = page.locator('#verificationBlock')
    await expect(vBlock).toHaveClass(/ok/)
    const text = await vBlock.textContent()
    expect(text).toContain('Containment successful')
  })

  test('next/prev navigation changes segment', async ({ page }) => {
    const titleBefore = await page.locator('#segmentTitle').textContent()
    await page.locator('#nextBtn').click()
    const titleAfter = await page.locator('#segmentTitle').textContent()
    expect(titleAfter).not.toBe(titleBefore)
  })

  test('prev button disabled on first segment', async ({ page }) => {
    await expect(page.locator('#prevBtn')).toBeDisabled()
  })

  test('keyboard navigation: ArrowRight advances segment', async ({ page }) => {
    const titleBefore = await page.locator('#segmentTitle').textContent()
    await page.keyboard.press('ArrowRight')
    const titleAfter = await page.locator('#segmentTitle').textContent()
    expect(titleAfter).not.toBe(titleBefore)
  })

  test('clicking segment in sidebar shows that segment', async ({ page }) => {
    await page.locator('.segment-item').nth(2).click()
    const title = await page.locator('#segmentTitle').textContent()
    expect(title).toContain('Segment')
  })

  test('export button is visible', async ({ page }) => {
    await expect(page.locator('.export-btn')).toBeVisible()
  })

  test('tampered log shows corruption warning', async ({ page }) => {
    const log = JSON.parse(fs.readFileSync(replayPath, 'utf-8'))
    // Tamper first snapshot — mark it as hash-invalid
    if (log.snapshots.length > 0) {
      log.snapshots[0].hashValid = false
    }
    await page.evaluate((data) => {
      // @ts-ignore
      window.loadJSON(data)
    }, log)

    // Segment 0 is shown automatically — verify corruption state
    const vBlock = page.locator('#verificationBlock')
    await expect(vBlock).toContainText('CORRUPTION EVENT DETECTED')
    // Segment item should have corrupted class
    await expect(page.locator('.segment-item').first()).toHaveClass(/corrupted/)
  })
})
