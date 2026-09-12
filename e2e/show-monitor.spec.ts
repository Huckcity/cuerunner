// The show monitor: which services are listening, what is on stage, and the OSC that
// reaches the app. Everything here is the part of a show that is not the cue stack.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { createSocket } from 'dgram'
import { closeApp, launchApp, mintLicence, sendOsc } from './helpers'

let app: ElectronApplication
let page: Page

test.beforeEach(async () => {
  // The show services, the scenes view, the panels that read them: everything this spec
  // is about is the licensed half of the app.
  ;({ app, page } = await launchApp({ licence: mintLicence() }))
})

test.afterEach(async () => {
  await closeApp(app)
})

function monitor(page: Page) {
  return page.locator('.monitor-panel')
}

function service(page: Page, label: string) {
  return monitor(page).locator('.monitor-service', { hasText: label })
}

async function openMonitor(page: Page): Promise<void> {
  await page.locator('.btn-monitor').click()
  await expect(monitor(page)).toBeVisible()
}

async function openShowSettings(page: Page) {
  await page.locator('.toolbar-brand').click()
  await page.getByRole('button', { name: /Settings/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await dialog.getByRole('button', { name: 'Show', exact: true }).click()
  return dialog
}

test('the monitor opens on the running services, and closes the log', async () => {
  await expect(monitor(page)).toHaveCount(0)

  // The two panels share the bottom of the window, so opening one closes the other.
  await page.locator('.btn-log').click()
  await expect(page.locator('.log-panel')).toBeVisible()

  await openMonitor(page)
  await expect(page.locator('.log-panel')).toHaveCount(0)
  await expect(page.locator('.btn-monitor')).toHaveAttribute('data-active', 'true')

  // OSC input comes up on its default port with no workspace loaded at all.
  await expect(service(page, 'OSC input')).toHaveAttribute('data-state', 'running')
  await expect(service(page, 'OSC input')).toContainText('53000')

  await page.locator('.btn-monitor').click()
  await expect(monitor(page)).toHaveCount(0)
})

test('OSC sent to the app reaches the monitor', async () => {
  await openMonitor(page)
  await expect(service(page, 'OSC input')).toHaveAttribute('data-state', 'running')

  await sendOsc(53000, '/show/go', 1, 'walk-in')

  const event = monitor(page).locator('.monitor-event[data-kind="osc"]').first()
  await expect(event).toContainText('/show/go')
  await expect(event).toContainText('127.0.0.1')
  await expect(event).toContainText('walk-in')
})

test('moving the OSC port rebinds the listener in place', async () => {
  // Somewhere nothing else in the run is listening, so this does not race the default.
  const port = 43000 + Math.floor(Math.random() * 5000)

  const dialog = await openShowSettings(page)
  const field = dialog.locator('#settings-osc-port')
  await field.fill(String(port))
  await field.blur()
  // The dialog reports the service's own state, so the rebind is visible on the screen
  // that asked for it.
  await expect(dialog.locator('.settings-service[data-service="osc-in"]')).toContainText(String(port))
  await dialog.getByRole('button', { name: 'Close' }).click()

  await openMonitor(page)
  await sendOsc(port, '/show/port-check')
  await expect(monitor(page).locator('.monitor-event[data-kind="osc"]').first())
    .toContainText('/show/port-check')
})

test('enabling MIDI input starts the service and reports what it found', async () => {
  const dialog = await openShowSettings(page)
  await dialog.locator('#settings-midi-in').check()

  // A test machine with no MIDI inputs has a service that says so rather than one that
  // pretends to listen; a machine that has them reports running. Either way it is no
  // longer stopped, which is what enabling the checkbox asked for.
  const state = dialog.locator('.settings-service[data-service="midi-in"]')
  await expect(state).toHaveAttribute('data-state', /^(running|degraded)$/)
  await dialog.getByRole('button', { name: 'Close' }).click()

  await openMonitor(page)
  await expect(service(page, 'MIDI input')).toHaveAttribute('data-state', /^(running|degraded)$/)
})

test('a port another program holds is reported instead of swallowed', async () => {  // Hold the port the way another app on the machine would: without SO_REUSEADDR, so
  // the app's bind is the one that fails.
  const squatter = createSocket('udp4')
  const port = 48000 + Math.floor(Math.random() * 5000)
  await new Promise<void>(resolve => squatter.bind(port, '0.0.0.0', resolve))

  try {
    const dialog = await openShowSettings(page)
    const field = dialog.locator('#settings-osc-port')
    await field.fill(String(port))
    await field.blur()

    const state = dialog.locator('.settings-service[data-service="osc-in"]')
    await expect(state).toHaveAttribute('data-state', 'degraded')
    await expect(state).toContainText('EADDRINUSE')
    await dialog.getByRole('button', { name: 'Close' }).click()

    // A service that cannot start is an alarm the operator can read, and the app is
    // still there to show it.
    await openMonitor(page)
    await expect(monitor(page).locator('.monitor-alert', { hasText: 'EADDRINUSE' })).toBeVisible()
  } finally {
    squatter.close()
  }
})

test('enabling network presence starts the service and reports what it found', async () => {
  const dialog = await openShowSettings(page)
  await dialog.locator('#settings-presence').check()

  // A runner with no mDNS responder and a runner with one both end up somewhere
  // useful: browsing, or saying why it cannot. Stopped is the only wrong answer.
  const state = dialog.locator('.settings-service[data-service="presence"]')
  await expect(state).toHaveAttribute('data-state', /^(running|degraded)$/)
  await dialog.getByRole('button', { name: 'Close' }).click()

  await openMonitor(page)
  await expect(service(page, 'Network devices')).toHaveAttribute('data-state', /^(running|degraded)$/)
})
