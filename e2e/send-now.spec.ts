// Send now: an OSC cue's message checked against the console from the inspector, before the
// show, without running the cue.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { addCueFromMoreMenu, closeApp, freePort, launchApp, listenOsc } from './helpers'

let app: ElectronApplication
let page: Page

test.beforeEach(async () => {
  ;({ app, page } = await launchApp())
})

test.afterEach(async () => {
  await closeApp(app)
})

test('Send now puts the OSC cue’s message on the wire and says so, without running the cue', async () => {
  const listener = await listenOsc(freePort())
  try {
    await addCueFromMoreMenu(page, 'OSC')
    await page.locator('.inspector-tab', { hasText: 'OSC' }).click()
    await page.locator('.field-row', { hasText: 'Port' }).locator('input').fill(String(listener.port))
    await page.locator('.field-row', { hasText: 'Address' }).locator('input').fill('/eos/key/go')

    await page.locator('.send-now-btn').click()
    await expect(page.locator('.send-now-result')).toHaveText('Sent')
    await expect.poll(() => listener.received.map(message => message.address)).toEqual(['/eos/key/go'])
    // Checked, not run: the row never lit.
    await expect(page.locator('.cue-row').first()).toHaveAttribute('data-running', 'false')
    await page.locator('.btn-log').click()
    await expect(page.locator('.log-panel')).not.toContainText('completed')
  } finally {
    await listener.close()
  }
})

test('Send now on a MIDI cue with nothing in it is not offered', async () => {
  await addCueFromMoreMenu(page, 'MIDI')
  await page.locator('.inspector-tab', { hasText: 'MIDI' }).click()
  await expect(page.locator('.send-now-btn')).toBeDisabled()
})
