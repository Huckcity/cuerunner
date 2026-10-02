// A Sennheiser EW-DX receiver, from the settings dialog to the show monitor: the operator adds
// the source, enters the password WSM set, and the packs that are linked appear with their
// readings — and a pack that crosses a line says so through the alarms every other source uses.
//
// The receiver here is `src/main/ewdx/fakeReceiver.ts`, which speaks what a Dante EM 4 was
// captured saying, over TLS with a self-signed certificate as a real one does. Everything on the
// app's side is the real thing: the Electron main process, the pinned connection, the machine's
// own credentials file, and the window.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdtempSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { closeApp, launchApp, mintLicense } from './helpers'
import { startFakeReceiver, type FakeReceiver } from '../src/main/ewdx/fakeReceiver'
import { makeTestCertificate, type TestCertificate } from '../src/main/ewdx/testCertificate'
import { FIXTURE_SERIAL } from '../src/main/ewdx/fixtures'

const PASSWORD = 'wsm-third-party-password'

let app: ElectronApplication
let page: Page
let userDataDir: string
let receiver: FakeReceiver
/** One unit's certificate, which it keeps wherever it is on the network. */
let certificate: TestCertificate
/** The same receiver at another address, listening from the start: where it goes when its lease changes. */
let moved: FakeReceiver

/** `https://127.0.0.1:port` as an operator types it: the address, with no scheme. */
const address = (): string => receiver.origin.replace(/^https:\/\//, '')

test.beforeEach(async () => {
  certificate = makeTestCertificate('cuerunner-e2e-receiver')
  const tls = { key: certificate.key, cert: certificate.cert }
  receiver = await startFakeReceiver({ password: PASSWORD, tls })
  // The same unit — same serial, same certificate — somewhere else on the network.
  moved = await startFakeReceiver({ password: PASSWORD, tls })
  // There is no multicast to rely on in a harness, so receivers are announced by name instead of
  // by mDNS. Each is still identified over HTTPS, which is the part worth testing here. One serial
  // is one receiver, so both announcements are offered as the one.
  ;({ app, page, userDataDir } = await launchApp({
    license: mintLicense(),
    env: { CUERUNNER_TEST_EWDX_ANNOUNCED: JSON.stringify([address(), moved.origin.replace(/^https:\/\//, '')]) }
  }))
})

test.afterEach(async () => {
  await closeApp(app)
  await receiver.close()
  await moved.close()
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

test('a key that does not match is critical, said once, and shown under the pack until it clears', async () => {
  const dialog = await openWireless()
  await addReceiver(dialog)
  await dialog.getByLabel('Password').fill(PASSWORD)
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog.locator('.ewdx-fingerprint')).toBeVisible()
  await dialog.getByRole('button', { name: 'Close' }).click()
  await page.locator('.btn-rf').click()
  await expect(page.locator('.rf-row', { hasText: '37' })).toBeVisible()
  await expect(page.locator('.rf-warning')).toHaveCount(0)

  // The pack is linked and the receiver cannot decrypt it: nobody would hear this one.
  receiver.push('/api/channel/0/warnings', ['Aes256Error'])

  const row = page.locator('.rf-row', { hasText: '37' })
  await expect(row.locator('.rf-warning')).toHaveText('encryption error — no audio')
  await expect(row).toHaveAttribute('data-state', 'critical')
  await expect(page.locator('.rf-alert[data-level="critical"]')).toHaveCount(1)
  await expect(page.locator('.rf-alert')).toContainText('encryption error — no audio')

  // It standing is not news again; its clearing takes the line away.
  await page.waitForTimeout(2500)
  await expect(page.locator('.rf-alert')).toHaveCount(1)
  receiver.push('/api/channel/0/warnings', [])
  await expect(page.locator('.rf-warning')).toHaveCount(0)
  await expect(row).toHaveAttribute('data-state', 'ok')
})

test('the check says whether every pack is ready, and changes as the receiver does', async () => {
  const dialog = await openWireless()
  await addReceiver(dialog)
  await dialog.getByLabel('Password').fill(PASSWORD)
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog.locator('.ewdx-fingerprint')).toBeVisible()
  await dialog.getByRole('button', { name: 'Close' }).click()
  await page.locator('.btn-rf').click()
  await expect(page.locator('.rf-row', { hasText: '37' })).toBeVisible()

  await page.getByRole('button', { name: 'Check', exact: true }).click()
  const verdict = page.locator('.rf-check-verdict')
  await expect(verdict).toHaveText('All 1 pack ready.')

  // Clipping is worth a look and not worth stopping for.
  receiver.push('/api/channel/0/warnings', ['AfPeak'])
  await expect(verdict).toHaveText('0 of 1 pack ready — worth a look at the rest.')
  await expect(page.locator('.rf-check-row')).toContainText('audio clipping')

  // A key that does not match is not ready, and it outranks the clipping beside it.
  receiver.push('/api/channel/0/warnings', ['AfPeak', 'Aes256Error'])
  await expect(verdict).toHaveText('0 of 1 pack ready — 1 not ready.')
  await expect(page.locator('.rf-check-row[data-readiness="not-ready"]')).toContainText('encryption error — no audio')

  // Fixed, and it goes green without anybody pressing anything.
  receiver.push('/api/channel/0/warnings', [])
  await expect(verdict).toHaveText('All 1 pack ready.')
})

test('a pack that a show would use up is flagged by the check, from what it used last time', async () => {
  // Last time this pack was worn it went from 95% to 35% over three hours, on this machine.
  await closeApp(app)
  const userData = mkdtempSync(join(tmpdir(), 'cuerunner-e2e-battery-'))
  const startedAt = Date.now() - 2 * 24 * 3600 * 1000
  writeFileSync(join(userData, 'rf-battery.json'), JSON.stringify({
    version: 1,
    packs: {
      [`ew-dx:${FIXTURE_SERIAL}:0`]: {
        finished: [{ start: 95, floor: 35, startedAt, endedAt: startedAt + 3 * 3600 * 1000 }]
      }
    }
  }))
  ;({ app, page, userDataDir } = await launchApp({
    userDataDir: userData,
    license: mintLicense(),
    env: { CUERUNNER_TEST_EWDX_ANNOUNCED: JSON.stringify([address()]) }
  }))

  const dialog = await openWireless()
  await addReceiver(dialog)
  await dialog.getByLabel('Password').fill(PASSWORD)
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog.locator('.ewdx-fingerprint')).toBeVisible()
  await dialog.getByRole('button', { name: 'Close' }).click()
  await page.locator('.btn-rf').click()
  await expect(page.locator('.rf-row', { hasText: '37' })).toContainText('76%')

  // 76% looks healthy, and a show cost this pack 60%: it would be at the urgent line before the end.
  await page.getByRole('button', { name: 'Check', exact: true }).click()
  await expect(page.locator('.rf-check-verdict')).toHaveText('0 of 1 pack ready — worth a look at the rest.')
  await expect(page.locator('.rf-check-row')).toContainText('battery 76% — a show used 60% last time')
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

test('a receiver whose address changes is found again by its serial, with nothing touched', async () => {
  const dialog = await openWireless()
  await dialog.locator('.ewdx-found').getByRole('button', { name: 'Add' }).click()
  await page.keyboard.type(PASSWORD)
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog.locator('.settings-service[data-service="rf"]')).toHaveAttribute('data-state', 'running')
  // Reaching it is how this machine learns which receiver it is.
  await expect(dialog.locator('.ewdx-serial')).toHaveText(FIXTURE_SERIAL)

  // Its lease changes: nothing answers where it was, and the same unit answers somewhere else.
  await receiver.close()

  // The show still names the old address. The machine looked for the serial, went to the new one,
  // and says so; the service is running again and nobody entered anything.
  await expect(dialog.locator('.ewdx-credentials')).toContainText(`Now at ${moved.origin.replace(/^https:\/\//, '')}`, {
    timeout: 30_000
  })
  await expect(dialog.locator('.settings-service[data-service="rf"]')).toHaveAttribute('data-state', 'running')
  await expect(dialog.getByLabel('Source address')).toHaveValue(address())
  expect(moved.sawCredentials()).toBe(true)

  await dialog.getByRole('button', { name: 'Close' }).click()
  await page.locator('.btn-rf').click()
  await expect(page.locator('.rf-row', { hasText: '37' })).toContainText('76%')
})

test('a different receiver at the address is refused before it is sent the password', async () => {
  const dialog = await openWireless()
  await dialog.locator('.ewdx-found').getByRole('button', { name: 'Add' }).click()
  await page.keyboard.type(PASSWORD)
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog.locator('.ewdx-serial')).toHaveText(FIXTURE_SERIAL)
  await expect(dialog.locator('.settings-service[data-service="rf"]')).toHaveAttribute('data-state', 'running')

  // Somebody else's receiver takes the address: a different serial, on the same certificate.
  await receiver.close()
  await moved.close()
  const stranger = await startFakeReceiver({
    password: PASSWORD,
    port: Number(new URL(receiver.origin).port),
    tls: { key: certificate.key, cert: certificate.cert },
    serial: '0000000099'
  })
  try {
    await expect(dialog.locator('.settings-service[data-service="rf"]')).toContainText('a different receiver answers here', {
      timeout: 30_000
    })
    expect(stranger.sawCredentials()).toBe(false)
  } finally {
    await stranger.close()
  }
})
