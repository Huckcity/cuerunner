// An OSC cue that sends several messages, one through a named OSC patch the show keeps in
// Settings and one to a host of its own — and the patch's address changed in one place.
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

async function networkSettings() {
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu [data-action="settings"]').click()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await dialog.getByRole('button', { name: 'Network', exact: true }).click()
  return dialog
}

test('a cue sends its messages in order, each through its patch or to its own host', async () => {
  const desk = await listenOsc(freePort())
  const video = await listenOsc(freePort())
  const moved = await listenOsc(freePort())
  try {
    // The show's patch: a name, and where it is.
    let dialog = await networkSettings()
    await dialog.locator('.osc-patch-add').click()
    await dialog.locator('#osc-patch-0-name').fill('Lighting desk')
    await dialog.locator('#osc-patch-0-name').blur()
    await dialog.locator('#osc-patch-0-host').fill('127.0.0.1')
    await dialog.locator('#osc-patch-0-host').blur()
    await dialog.locator('#osc-patch-0-port').fill(String(desk.port))
    await dialog.locator('#osc-patch-0-port').blur()
    await dialog.getByRole('button', { name: 'Close' }).click()

    await addCueFromMoreMenu(page, 'OSC')
    await page.locator('.inspector-tab', { hasText: 'OSC' }).click()
    await page.locator('#osc-message-0-patch').selectOption({ label: `Lighting desk (127.0.0.1:${desk.port})` })
    await page.locator('#osc-message-0-address').fill('/eos/cue/12/fire')
    await page.locator('.osc-add-message').click()
    await page.locator('#osc-message-1-patch').selectOption('')
    await page.locator('#osc-message-1-host').fill('127.0.0.1')
    await page.locator('#osc-message-1-port').fill(String(video.port))
    await page.locator('#osc-message-1-address').fill('/video/go')
    await expect(page.locator('.osc-message')).toHaveCount(2)

    await page.locator('.cue-row').first().click()
    await page.keyboard.press('Space')
    await expect.poll(() => desk.received.map(message => message.address)).toEqual(['/eos/cue/12/fire'])
    await expect.poll(() => video.received.map(message => message.address)).toEqual(['/video/go'])

    // The desk moves: one address in Settings, and the cue follows it.
    dialog = await networkSettings()
    await dialog.locator('#osc-patch-0-port').fill(String(moved.port))
    await dialog.locator('#osc-patch-0-port').blur()
    await dialog.getByRole('button', { name: 'Close' }).click()
    await page.waitForTimeout(400)
    await page.locator('.cue-row').first().click()
    await page.keyboard.press('Space')
    await expect.poll(() => moved.received.map(message => message.address)).toEqual(['/eos/cue/12/fire'])
    expect(desk.received).toHaveLength(1)
  } finally {
    await desk.close()
    await video.close()
    await moved.close()
  }
})

test('a message whose patch was removed is not sent, and the run says which', async () => {
  const listener = await listenOsc(freePort())
  try {
    let dialog = await networkSettings()
    await dialog.locator('.osc-patch-add').click()
    await dialog.getByRole('button', { name: 'Close' }).click()

    await addCueFromMoreMenu(page, 'OSC')
    await page.locator('.inspector-tab', { hasText: 'OSC' }).click()
    await page.locator('#osc-message-0-patch').selectOption({ index: 1 })
    await page.locator('#osc-message-0-address').fill('/gone')
    await page.locator('.osc-add-message').click()
    await page.locator('#osc-message-1-patch').selectOption('')
    await page.locator('#osc-message-1-port').fill(String(listener.port))
    await page.locator('#osc-message-1-address').fill('/still/sent')

    // Removing a patch a cue sends through asks first.
    dialog = await networkSettings()
    await dialog.locator('.osc-patch-remove').click()
    await expect(dialog.locator('.osc-patch')).toContainText('1 OSC cue sends through it')
    await dialog.locator('.osc-patch-remove').click()
    await expect(dialog.locator('.osc-patch')).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Close' }).click()

    await page.locator('.inspector-tab', { hasText: 'OSC' }).click()
    await expect(page.locator('#osc-message-0-patch option:checked')).toHaveText('— patch not in this show —')
    await page.locator('.cue-row').first().click()
    await page.keyboard.press('Space')
    await expect.poll(() => listener.received.map(message => message.address)).toEqual(['/still/sent'])
    await page.locator('.btn-log').click()
    await expect(page.locator('.log-panel')).toContainText('message 1 (/gone): its OSC patch is not in this show')
  } finally {
    await listener.close()
  }
})
