// The remote: the transport run from a tablet or a console over OSC, in Cuerunner's own
// namespace and in QLab's, on the port the show already listens on. The whole path is the
// one exercised — a datagram lands on the socket, reaches the window, and the show moves.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp, oscPortOfItsOwn, sendOsc, toolbarCueBtn } from './helpers'

let app: ElectronApplication
let page: Page
let port: number

test.beforeEach(async () => {
  // No key: the remote is the free half of the app, like the triggers it sits beside.
  ;({ app, page } = await launchApp())
  port = await oscPortOfItsOwn(page)
})

test.afterEach(async () => {
  await closeApp(app)
})

function row(number: string) {
  return page.locator('.cue-row').filter({ has: page.locator('.cue-number', { hasText: new RegExp(`^${number}$`) }) })
}

/** Three wait cues, long enough to be seen running, with the show standing on the first. */
async function threeWaits(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await toolbarCueBtn(page, 'Wait').click()
  }
  await expect(page.locator('.cue-row')).toHaveCount(3)
  await row('1').click()
  await expect(row('1')).toHaveAttribute('data-selected', 'true')
}

/** Opens Settings on the Network tab: where the OSC listener's settings are. */
async function networkSettings() {
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu [data-action="settings"]').click()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await dialog.getByRole('button', { name: 'Network', exact: true }).click()
  return dialog
}

async function showLog(): Promise<void> {
  if (await page.locator('.log-panel').count() === 0) await page.locator('.btn-log').click()
  await expect(page.locator('.log-panel')).toBeVisible()
}

function oscInLog(address: string) {
  return page.locator('.log-panel .log-event[data-kind="osc"]', { hasText: `${address} from` })
}

/**
 * A changed OSC setting restarts the listener, and a datagram sent while it rebinds is lost
 * — which would make "nothing happened" prove nothing. So a probe is sent until the log has
 * heard one: the listener is up, and what is sent after it is heard or refused on its merits.
 */
async function untilHeard(): Promise<void> {
  await showLog()
  await expect.poll(async () => {
    await sendOsc(port, '/probe/listening')
    return oscInLog('/probe/listening').count()
  }).toBeGreaterThan(0)
}

test('a QLab remote’s /go fires the cue the show stands on and moves the selection on', async () => {
  await threeWaits()

  await sendOsc(port, '/go')

  await expect(row('1')).toHaveAttribute('data-running', 'true')
  await expect(row('2')).toHaveAttribute('data-selected', 'true')

  // The log says who pressed GO, so a remote press reads differently from the operator's.
  await showLog()
  await expect(page.locator('.log-panel')).toContainText('GO from OSC /go from 127.0.0.1')
})

test('/cue/{n}/start fires that cue where it is, and /stop stops everything', async () => {
  await threeWaits()

  await sendOsc(port, '/workspace/ANY-ID/cue/3/start')
  await expect(row('3')).toHaveAttribute('data-running', 'true')
  // The selection is the operator's: firing a cue by number does not move it.
  await expect(row('1')).toHaveAttribute('data-selected', 'true')

  await sendOsc(port, '/cuerunner/stop')
  await expect(row('3')).toHaveAttribute('data-running', 'false')
})

test('next, previous and /select/{n} move the selection without firing anything', async () => {
  await threeWaits()

  await sendOsc(port, '/select/next')
  await expect(row('2')).toHaveAttribute('data-selected', 'true')
  // A different address, so the repeat guard does not take it for the same press twice.
  await sendOsc(port, '/playhead/next')
  await expect(row('3')).toHaveAttribute('data-selected', 'true')
  await sendOsc(port, '/select/1')
  await expect(row('1')).toHaveAttribute('data-selected', 'true')

  await expect(page.locator('.cue-row[data-running="true"]')).toHaveCount(0)
})

test('with the remote turned off the transport is deaf to it', async () => {
  await threeWaits()
  const dialog = await networkSettings()
  await dialog.locator('#settings-osc-remote').uncheck()
  await expect(dialog.locator('#settings-osc-remote')).not.toBeChecked()
  await dialog.getByRole('button', { name: 'Close' }).click()
  await untilHeard()

  await sendOsc(port, '/go')
  // The datagram arrived — the log shows it — and moved nothing.
  await expect(oscInLog('/go')).toHaveCount(1)
  await expect(page.locator('.cue-row[data-running="true"]')).toHaveCount(0)
  await expect(row('1')).toHaveAttribute('data-selected', 'true')
})

test('a sender off the allow list is not heard at all, and is named once', async () => {
  await threeWaits()
  const dialog = await networkSettings()
  // An entry that is not an address is refused where it was typed, and nothing is written.
  await dialog.locator('#settings-osc-allow').fill('the lighting desk')
  await expect(dialog.locator('#settings-osc-allow')).toHaveAttribute('aria-invalid', 'true')
  // The spec's datagrams come from 127.0.0.1; this list names someone else.
  await dialog.locator('#settings-osc-allow').fill('10.99.0.0/16')
  await dialog.locator('#settings-osc-allow').press('Enter')
  await expect(dialog.locator('#settings-osc-allow')).toHaveValue('10.99.0.0/16')
  await dialog.getByRole('button', { name: 'Close' }).click()

  // The refusal is what says the listener is up and turned this sender away.
  await showLog()
  const refusal = page.locator('.log-panel .log-row', { hasText: 'ignored 127.0.0.1, which is not on the allow list' })
  await expect.poll(async () => {
    await sendOsc(port, '/go')
    return refusal.count()
  }).toBeGreaterThan(0)

  await sendOsc(port, '/go')
  await page.waitForTimeout(300)
  await expect(refusal).toHaveCount(1)
  await expect(oscInLog('/go')).toHaveCount(0)
  await expect(page.locator('.cue-row[data-running="true"]')).toHaveCount(0)
})
