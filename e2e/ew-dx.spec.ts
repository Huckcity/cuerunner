// A Sennheiser EW-DX receiver, from the settings dialog to the show monitor: the operator adds
// the source, enters the password WSM set, and the packs that are linked appear with their
// readings — and a pack that crosses a line says so through the alarms every other source uses.
//
// The receiver here is `src/main/ewdx/fakeReceiver.ts`, which speaks what a Dante EM 4 was
// captured saying, over TLS with a self-signed certificate as a real one does. Everything on the
// app's side is the real thing: the Electron main process, the pinned connection, the machine's
// own credentials file, and the window.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { closeApp, launchApp, mintLicense } from './helpers'
import { startFakeReceiver, type FakeReceiver } from '../src/main/ewdx/fakeReceiver'
import { makeTestCertificate } from '../src/main/ewdx/testCertificate'

const PASSWORD = 'wsm-third-party-password'

let app: ElectronApplication
let page: Page
let userDataDir: string
let receiver: FakeReceiver

/** `https://127.0.0.1:port` as an operator types it: the address, with no scheme. */
const address = (): string => receiver.origin.replace(/^https:\/\//, '')

test.beforeEach(async () => {
  const certificate = makeTestCertificate('cuerunner-e2e-receiver')
  receiver = await startFakeReceiver({ password: PASSWORD, tls: { key: certificate.key, cert: certificate.cert } })
  // There is no multicast to rely on in a harness, so the receiver is announced by name instead
  // of by mDNS. It is still identified over HTTPS, which is the part worth testing here.
  ;({ app, page, userDataDir } = await launchApp({
    license: mintLicense(),
    env: { CUERUNNER_TEST_EWDX_ANNOUNCED: JSON.stringify([address()]) }
  }))
})

test.afterEach(async () => {
  await closeApp(app)
  await receiver.close()
})

async function openWireless(): Promise<ReturnType<Page['getByRole']>> {
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu [data-action="settings"]').click()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await dialog.getByRole('button', { name: 'Wireless', exact: true }).click()
  return dialog
}

/** Adds a source, makes it an EW-DX one and points it at the fake receiver. */
async function addReceiver(dialog: ReturnType<Page['getByRole']>): Promise<void> {
  await dialog.getByRole('button', { name: '+ Add source' }).click()
  await dialog.getByLabel('Source kind').selectOption('ew-dx')
  await dialog.getByLabel('Source address').fill(address())
}

test('an operator adds a receiver, enters its password, and the linked pack appears', async () => {
  const dialog = await openWireless()
  await addReceiver(dialog)

  // Until a password is entered the dialog says where it comes from, and nothing connects.
  await expect(dialog.locator('.ewdx-credentials')).toContainText('Turn on third-party access in WSM first.')
  expect(receiver.sawCredentials()).toBe(false)

  await dialog.getByLabel('Password').fill(PASSWORD)
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()

  // The window never gets the password back: the box empties and says one is held.
  await expect(dialog.getByLabel('Password')).toHaveValue('')
  await expect(dialog.getByLabel('Password')).toHaveAttribute('placeholder', 'Saved on this machine')

  // The first connection sees the receiver's certificate, and the dialog shows it.
  await expect(dialog.locator('.ewdx-fingerprint')).toBeVisible()
  await expect(dialog.locator('.settings-service[data-service="rf"]')).toHaveAttribute('data-state', 'running')

  // The password is kept in a file of the machine's own, readable by its owner alone.
  const stored = join(userDataDir, 'ew-dx.json')
  expect(existsSync(stored)).toBe(true)
  if (process.platform !== 'win32') expect(statSync(stored).mode & 0o077).toBe(0)

  await dialog.getByRole('button', { name: 'Close' }).click()
  await page.locator('.btn-monitor').click()

  // The linked pack, with what the receiver reported: battery, signal, level, frequency.
  const pack = page.locator('.monitor-device', { hasText: '37' })
  await expect(pack).toContainText('76%')
  await expect(pack).toContainText('-83 dBm')
  await expect(pack).toContainText('606.200 MHz')
  // A channel with no transmitter on it is not a pack: it does not appear as one.
  await expect(page.locator('.monitor-device', { hasText: '38' })).toHaveCount(0)
  // -83 dBm is under the show's own "weak signal" line, and the receiver says the link is fine
  // (quality 100, no LowSignal): its word stands, so a healthy pack raises no alarm.
  await expect(page.locator('.monitor-alert')).toHaveCount(0)
})

test('a battery falling through the line raises the same alarm every other source does', async () => {
  const dialog = await openWireless()
  await addReceiver(dialog)
  await dialog.getByLabel('Password').fill(PASSWORD)
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog.locator('.ewdx-fingerprint')).toBeVisible()
  await dialog.getByRole('button', { name: 'Close' }).click()
  await page.locator('.btn-monitor').click()
  await expect(page.locator('.monitor-device', { hasText: '37' })).toContainText('76%')

  // The receiver pushes the change; the app does not have to ask for it.
  receiver.push('/api/transmitters/0/battery', { type: 'PrimaryCell', gauge: 8 })

  await expect(page.locator('.monitor-device', { hasText: '37' })).toContainText('8%')
  await expect(page.locator('.monitor-alert[data-level="critical"]')).toContainText('battery critical')
})

test('a wrong password is refused by name, and nothing is shown as a pack', async () => {
  const dialog = await openWireless()
  await addReceiver(dialog)
  await dialog.getByLabel('Password').fill('not the password')
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()

  await expect(dialog.locator('.settings-service[data-service="rf"]')).toContainText('password rejected')
  await expect(dialog.locator('.settings-service[data-service="rf"]')).toHaveAttribute('data-state', 'degraded')

  await dialog.getByRole('button', { name: 'Close' }).click()
  await page.locator('.btn-monitor').click()
  await expect(page.locator('.monitor-device')).toHaveCount(0)
})

test('a receiver that goes away is reported, and comes back by itself', async () => {
  const dialog = await openWireless()
  await addReceiver(dialog)
  await dialog.getByLabel('Password').fill(PASSWORD)
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog.locator('.settings-service[data-service="rf"]')).toHaveAttribute('data-state', 'running')

  // A receiver that is down, not one that blinked: the client reopens a dropped session in
  // about a second, quicker than a poll can notice, and that is as it should be. Stalled, it
  // cannot answer, so the outage outlasts the poll and has to be reported.
  receiver.stall(true)
  receiver.dropStreams()
  await expect(dialog.locator('.settings-service[data-service="rf"]')).toHaveAttribute('data-state', 'degraded', {
    timeout: 20_000
  })
  await expect(dialog.locator('.settings-service[data-service="rf"]')).toContainText(/connection lost|did not answer/)

  // It comes back by itself: no restart, no re-entering the password.
  receiver.stall(false)
  await expect(dialog.locator('.settings-service[data-service="rf"]')).toHaveAttribute('data-state', 'running', {
    timeout: 30_000
  })
})

test('a receiver on the network is found, added in one click, and shown without a plot', async () => {
  const dialog = await openWireless()

  // Nobody typed an address: the receiver is offered by the model it identified itself as.
  const found = dialog.locator('.ewdx-found')
  await expect(found).toHaveCount(1)
  await expect(found).toContainText('EW-DX EM 4 Dante')
  await expect(found).toContainText('127.0.0.1')

  await found.getByRole('button', { name: 'Add' }).click()

  // It is a source now and no longer offered; the cursor is where the one missing thing goes.
  await expect(dialog.locator('.ewdx-found')).toHaveCount(0)
  await expect(dialog.getByLabel('Source kind')).toHaveValue('ew-dx')
  await expect(dialog.getByLabel('Password')).toBeFocused()

  await page.keyboard.type(PASSWORD)
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog.locator('.settings-service[data-service="rf"]')).toHaveAttribute('data-state', 'running')
  await dialog.getByRole('button', { name: 'Close' }).click()

  // No plot was entered, and the panel is not empty: a reporting channel shows by itself.
  await page.locator('.btn-rf').click()
  const row = page.locator('.rf-row', { hasText: '37' })
  await expect(row).toBeVisible()
  await expect(row).toContainText('76%')
  await expect(page.locator('.rf-empty')).toHaveCount(0)
})

test('a machine with nothing configured has nothing to say about wireless', async () => {
  // No source, no plot: the wireless service is off, nothing is on the panel but how to start,
  // and no alarm has been raised about a receiver nobody asked it to watch.
  await page.locator('.btn-rf').click()
  await expect(page.locator('.rf-empty')).toBeVisible()
  await expect(page.locator('.rf-row')).toHaveCount(0)
  await expect(page.locator('.rf-alert')).toHaveCount(0)

  await page.locator('.btn-monitor').click()
  await expect(page.locator('.monitor-alert')).toHaveCount(0)
  // The receiver the harness announced was not looked for, so it was not added or logged into.
  expect(receiver.requests).toEqual([])
  expect(receiver.sawCredentials()).toBe(false)
})
