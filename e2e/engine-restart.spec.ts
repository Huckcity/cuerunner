// The engine dying mid-show. The native engine is a separate process and the renderer's
// show clock is projected from it, so a replacement engine — counting from zero again —
// used to leave every command carrying a time from before the restart ("start at
// 5,400,000") refused with "beyond the engine horizon", while the app reported itself
// perfectly healthy and nothing would fire for the rest of the night.
//
// The engine runs its real mixer on the silent backend, and `__winslabDevHarness` —
// installed only by a build running from the source tree — kills the child outright, the
// way a crash would. What is asserted is the show after it: the engine comes back under
// a new session, the cue chain keeps its time across the change, the next cue's audio
// really reaches the replacement engine, and the operator is told.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp } from './helpers'
import type { PlaybackDevHarness } from '../src/main/safety/devHarness'

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  ;({ app, page } = await launchApp())
})

test.afterAll(async () => {
  await closeApp(app)
})

// Between lives there is no engine to ask, so a read that cannot be served is "not yet"
// rather than a failure — the poll is what waits for the replacement to answer.
async function engineSession(): Promise<string | null> {
  return app.evaluate(async () => {
    const harness: PlaybackDevHarness | undefined = globalThis.__winslabDevHarness
    if (!harness) return null
    try {
      return (await harness.engineInfo()).sessionId
    } catch {
      return null
    }
  })
}

async function engineVoices(): Promise<number | null> {
  return app.evaluate(async () => {
    const harness: PlaybackDevHarness | undefined = globalThis.__winslabDevHarness
    if (!harness) return null
    try {
      return (await harness.engineInfo()).activeVoices
    } catch {
      return null
    }
  })
}

async function openDemo(): Promise<void> {
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu button', { hasText: 'Open Demo Workspace' }).click()
  await expect(page.locator('.cue-row', { hasText: 'Walk-in Music' })).toBeVisible()
}

test('a cue fires after the engine is killed mid-sequence, and the show says so', async () => {
  test.setTimeout(120_000)
  await openDemo()

  // The interval wait hands over on its own to the Walk-out group, whose first child is
  // an audio cue with real media. The handover with the engine replaced under it is what
  // puts a voice back into the new engine.
  await page.locator('.cue-row', { hasText: 'Interval' }).click()
  await page.locator('.inspector-tab', { hasText: 'Wait' }).click()
  await page.locator('.field-row').filter({ hasText: 'Duration' }).locator('input').fill('6000')

  const before = await engineSession()
  expect(before).toMatch(/^[0-9a-f]{16}$/)

  await page.locator('.btn-go').click()
  // Mid-count: the engine is killed outright, as a crash would.
  await page.waitForTimeout(1000)
  await app.evaluate(() => globalThis.__winslabDevHarness?.killEngine())

  // The replacement is a different engine, and the app reconnects to it on its own.
  await expect.poll(async () => {
    const session = await engineSession()
    return session !== null && session !== before ? session : null
  }, { timeout: 30_000, message: 'the engine never came back under a new session' }).not.toBeNull()

  // The wait kept its own time across the restart: 6000 ms from its start, not 6000 ms
  // plus however long the engine was away.
  await page.locator('.btn-log').click()
  await expect(page.locator('.log-panel')).toContainText('10 · Interval')
  await expect(page.locator('.log-panel')).toContainText('completed in 6000ms', { timeout: 15_000 })

  // The handover then fired the next cue's audio into the replacement engine: the
  // absolute time it carried was translated onto the new session's clock, not refused.
  await expect.poll(engineVoices, { timeout: 15_000 }).toBeGreaterThanOrEqual(1)
  await expect(page.locator('.log-panel')).not.toContainText('Audio playback failed')

  // And the operator is told, on both surfaces: the session log line that explains it,
  // and the warnings bar that keeps it on screen for the rest of the show.
  await expect(page.locator('.log-panel')).toContainText('audio engine restarted')
  await page.locator('.toolbar-brand').click()
  await page.getByRole('button', { name: /Settings/ }).click()
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
  await expect(page.locator('.settings-warning')).toContainText('audio engine restarted')
  await expect(page.locator('.settings-warning')).toContainText('the show clock carried on')
  await page.keyboard.press('Escape')

  await page.locator('.btn-stop').click()
  await expect.poll(engineVoices, { timeout: 10_000 }).toBe(0)
})
