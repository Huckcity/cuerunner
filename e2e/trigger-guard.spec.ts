// The two things R6 promises a show: a doubled message is one firing, and a cue that is
// already running is not cut off by the second half of that message.
//
// The message is a real OSC datagram through the real listener, and what is observed is a
// network cue's HTTP request — the far end of the app, reached only if the cue actually
// ran. Through the UI this would be the keyboard; a datagram is the harder half of the
// same path, so it is the one pinned here.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  addCueFromMoreMenu,
  closeApp,
  launchApp,
  mintLicense,
  openFromRecent,
  oscPortOfItsOwn,
  sendOsc,
  startServer,
  type TestServer
} from './helpers'

let app: ElectronApplication
let page: Page
let server: TestServer | undefined

test.beforeEach(async () => {
  ;({ app, page } = await launchApp({ license: mintLicense() }))
})

test.afterEach(async () => {
  await closeApp(app)
  await server?.close()
  server = undefined
})

/** A network cue that answers to one OSC address, with the request as the proof. */
async function triggeredNetworkCue(address: string): Promise<void> {
  await addCueFromMoreMenu(page, 'Network')
  await page.locator('.inspector-tab', { hasText: 'Network' }).click()
  await page.locator('.field-row', { hasText: 'URL' }).locator('input')
    .fill(`${server!.baseUrl}/fired`)
  await page.locator('.inspector-tab', { hasText: 'Triggers' }).click()
  await page.locator('#trigger-osc-address').fill(address)
  await page.locator('.trigger-section[data-kind="osc"] .trigger-add').click()
  await expect(page.locator('.trigger-row[data-kind="osc"]')).toContainText(address)
}

/** Sets the show's firing window, the way an operator would, and closes the panel. */
async function setGuardWindow(ms: number): Promise<void> {
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu button[data-action="settings"]').click()
  await page.locator('#settings-guard-window').fill(String(ms))
  await page.locator('#settings-guard-window').press('Enter')
  await expect(page.locator('#settings-guard-window')).toHaveValue(String(ms))
  await page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Close' }).click()
}

function hits(): number {
  return server?.hits.length ?? 0
}

test('two identical datagrams in one breath fire one cue', async () => {
  server = await startServer()
  const port = await oscPortOfItsOwn(page)
  await triggeredNetworkCue('/eos/cue/12/fire')

  // A bounce, or a desk with two sends of the same message: on the wire twice, and the
  // second one lands a few milliseconds behind the first.
  await sendOsc(port, '/eos/cue/12/fire')
  await sendOsc(port, '/eos/cue/12/fire')
  await page.waitForTimeout(800)

  expect(hits()).toBe(1)
})

test('the window is the show’s, and it is over when it is over', async () => {
  server = await startServer()
  const port = await oscPortOfItsOwn(page)
  await triggeredNetworkCue('/eos/cue/12/fire')

  // One and a half seconds: far longer than any desk's double send, and a config the
  // operator typed rather than the third-of-a-second default.
  await setGuardWindow(1500)

  await sendOsc(port, '/eos/cue/12/fire')
  await expect.poll(hits).toBe(1)

  // Inside the window, and long after the cue itself has finished: it is the guard that
  // has to refuse this one, not the re-fire interlock.
  await page.waitForTimeout(1000)
  await sendOsc(port, '/eos/cue/12/fire')
  await page.waitForTimeout(400)
  expect(hits()).toBe(1)

  // And a window is a window: once it has passed, the same datagram is heard again.
  await page.waitForTimeout(1100)
  await sendOsc(port, '/eos/cue/12/fire')
  await expect.poll(hits).toBe(2)
})

test('a second message in the same breath is a second instruction', async () => {
  // The guard keys on the message, not on the cue that happened to run: two different
  // addresses from one desk in the same breath are two cues, however close together.
  server = await startServer()
  const port = await oscPortOfItsOwn(page)
  await triggeredNetworkCue('/eos/cue/12/fire')

  await addCueFromMoreMenu(page, 'Network')
  await page.locator('.inspector-tab', { hasText: 'Network' }).click()
  await page.locator('.field-row').filter({ hasText: 'URL' }).locator('input')
    .fill(`${server.baseUrl}/second`)
  await page.locator('.inspector-tab', { hasText: 'Triggers' }).click()
  await page.locator('#trigger-osc-address').fill('/eos/cue/13/fire')
  await page.locator('.trigger-section[data-kind="osc"] .trigger-add').click()

  await sendOsc(port, '/eos/cue/12/fire')
  await sendOsc(port, '/eos/cue/13/fire')
  await expect.poll(hits).toBe(2)
})

// A show carries its guard: the window is answered to the desk that is in the room, so
// it is written in the file rather than kept as this machine's preference.
test('the guard travels with the show and comes back with it', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cuerunner-guard-'))
  const showPath = path.join(root, 'Guard.wlab')
  fs.writeFileSync(showPath, `${JSON.stringify({
    version: 1,
    id: 'w-guard',
    name: 'Guard',
    createdAt: '2026-01-01T00:00:00.000Z',
    audioSettings: { outputDeviceId: 'default' },
    midiSettings: { outputPortName: '' },
    cues: []
  }, null, 2)}\n`)
  const userDataDir = path.join(root, 'userdata')
  fs.mkdirSync(userDataDir, { recursive: true })
  fs.writeFileSync(path.join(userDataDir, 'recent.json'), JSON.stringify([showPath]))

  await closeApp(app)
  ;({ app, page } = await launchApp({ license: mintLicense(), userDataDir }))

  await openFromRecent(page, userDataDir, showPath)
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu button[data-action="settings"]').click()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  // A show written before the guard existed opens on the default: a third of a second.
  await expect(dialog.locator('#settings-guard-window')).toHaveValue('300')

  await dialog.locator('#settings-guard-window').fill('450')
  await dialog.locator('#settings-guard-window').press('Enter')
  await dialog.getByRole('button', { name: 'Close' }).click()

  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu button[data-action="save"]').click()
  await expect(page.locator('.workspace-name')).not.toContainText('●')

  const written = JSON.parse(fs.readFileSync(showPath, 'utf-8'))
  expect(written.triggerGuard).toEqual({ windowMs: 450 })

  // And the show it comes back as says the same thing, which is what an operator sees
  // when they open the file on another machine.
  await closeApp(app)
  ;({ app, page } = await launchApp({ license: mintLicense(), userDataDir }))
  await openFromRecent(page, userDataDir, showPath)
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu button[data-action="settings"]').click()
  await expect(page.locator('#settings-guard-window')).toHaveValue('450')

  // The show's own directory goes after the app holding it: on Windows the temp tree is
  // still locked while the window is up, and the remove is what fails.
  await closeApp(app)
  fs.rmSync(root, { recursive: true, force: true })
})
