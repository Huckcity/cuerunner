import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp, closeApp } from './helpers'

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  ;({ app, page } = await launchApp())
})

test.afterAll(async () => {
  await closeApp(app)
})

async function openSettings(p: Page) {
  await p.locator('.toolbar-brand').click()
  await p.locator('.file-menu [data-action="settings"]').click()
  await expect(p.getByRole('dialog', { name: 'Settings' })).toBeVisible()
}

async function closeSettings(p: Page) {
  const dialog = p.getByRole('dialog', { name: 'Settings' })
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(dialog).not.toBeVisible()
}

test('settings dialog opens via WinsLab file menu', async () => {
  await openSettings(page)
  await closeSettings(page)
})

test('settings dialog has Audio and MIDI tabs', async () => {
  await openSettings(page)
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await expect(dialog.getByRole('button', { name: 'Audio', exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'MIDI', exact: true })).toBeVisible()
  await closeSettings(page)
})

test('Audio tab offers the real device options the engine can honour', async () => {
  await openSettings(page)
  const dialog = page.getByRole('dialog', { name: 'Settings' })

  const device = dialog.locator('.field-row', { hasText: 'Output device' })
  await expect(device.locator('select')).toBeVisible()
  await expect(device.locator('option')).toContainText(['Default Output'])

  // Sample rate, buffer and channels are the engine's settings, not the page's guess.
  await expect(dialog.locator('.field-row', { hasText: 'Sample rate' }).locator('select')).toBeVisible()
  await expect(dialog.locator('.field-row', { hasText: 'Buffer' }).locator('select')).toBeVisible()
  await expect(dialog.locator('.field-row', { hasText: 'Channels' }).locator('select')).toBeVisible()
  await expect(dialog.locator('.field-row', { hasText: 'Exclusive' }).locator('input[type=checkbox]')).toBeVisible()

  await closeSettings(page)
})

test('Audio tab reports exactly what the engine says it is running', async () => {
  const info = await app.evaluate(async () => {
    const harness = globalThis.__winslabDevHarness
    return harness ? harness.engineInfo() : null
  })
  expect(info).not.toBeNull()

  await openSettings(page)
  const dialog = page.getByRole('dialog', { name: 'Settings' })

  // The capability readout is the engine's own numbers, so the operator can check a rig
  // before a show without trusting the page's memory of what it asked for. The regex is
  // case-sensitive because the Device row's name mentions the silent backend too.
  const backend = dialog.locator('.field-row', { hasText: /Backend/ }).locator('.settings-info')
  await expect(backend).toHaveText(info!.backend)

  const runningAt = dialog.locator('.field-row', { hasText: 'Running at' }).locator('.settings-info')
  await expect(runningAt).toHaveText(
    `${info!.sampleRate.toLocaleString()} Hz`
    + (info!.channels > 0 ? ` · ${info!.channels} ch` : '')
    + (info!.bufferFrames ? ` · ${info!.bufferFrames} frames` : '')
  )

  const dropouts = dialog.locator('.field-row', { hasText: 'Dropouts' }).locator('.settings-info')
  await expect(dropouts).toHaveText(
    `${info!.media.xruns} ${info!.media.xruns === 1 ? 'xrun' : 'xruns'}`
    + ` · ${info!.media.decodeUnderruns} ${info!.media.decodeUnderruns === 1 ? 'decode underrun' : 'decode underruns'}`
  )

  // The silent backend refuses every device request, including the one the window
  // sends when it opens — and that is not a fault anyone can act on, so it is not shown
  // as one. The Backend row above already says which engine this is; the red line is
  // kept for a real device's refusal, in the engine's own words.
  await expect(dialog.locator('.settings-device-error')).toHaveCount(0)

  // The latency is either a number labelled with how it was arrived at, or it is
  // honestly unknown — never a number pretending to be measured.
  const expectedLatency = info!.latencySource === 'unknown' || info!.latencyMs === null
    ? 'unknown'
    : `${info!.latencyMs.toFixed(1)} ms (${info!.latencySource})`
  const latency = dialog.locator('.field-row', { hasText: 'Latency' }).locator('.settings-info')
  await expect(latency).toHaveText(expectedLatency)

  await closeSettings(page)
})

test('the device section sets exclusive mode, and says what it costs', async () => {
  await openSettings(page)
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  const exclusive = dialog.locator('#settings-exclusive')
  await expect(exclusive).toBeVisible()

  // The trade-off is stated where the choice is made, in the operator's terms: it takes
  // the device away from everything else on the machine.
  const tradeOff = dialog.locator('.inspector-hint', { hasText: 'Exclusive locks' })
  await expect(tradeOff).toContainText('system sounds')
  await expect(tradeOff).toContainText('conferencing')
  await expect(tradeOff).toContainText('real channel count')

  const wasOn = await exclusive.isChecked()
  await exclusive.setChecked(!wasOn)

  await closeSettings(page)
  // A device setting belongs to the workspace, so it is still there next time.
  await openSettings(page)
  await expect(page.locator('#settings-exclusive')).toBeChecked({ checked: !wasOn })

  await page.locator('#settings-exclusive').setChecked(wasOn)
  await closeSettings(page)
})

test('MIDI tab offers a default output port select', async () => {
  await openSettings(page)
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await dialog.getByRole('button', { name: 'MIDI', exact: true }).click()
  const row = dialog.locator('.field-row', { hasText: 'Default output' })
  await expect(row.locator('select')).toBeVisible()
  await closeSettings(page)
})

test('the Wireless tab sets the alarms, and refuses a value that would misfire', async () => {
  await openSettings(page)
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await dialog.getByRole('button', { name: 'Wireless', exact: true }).click()

  const quiet = dialog.locator('#settings-rf-gone')
  await expect(quiet).toHaveValue('6')

  // Six seconds is the default; a show whose packs are switched off between scenes wants
  // a longer window, and that is a setting rather than an edit to the workspace file.
  await quiet.fill('30')
  await quiet.blur()
  await expect(quiet).toHaveValue('30')

  // Zero would alarm on every poll. An out-of-range value is dropped, not written.
  await quiet.fill('0')
  await quiet.blur()
  await expect(quiet).toHaveValue('30')

  await dialog.locator('#settings-rf-battery-critical').fill('15')
  await dialog.locator('#settings-rf-battery-critical').blur()
  await expect(dialog.locator('#settings-rf-battery-critical')).toHaveValue('15')

  await closeSettings(page)
  // It is workspace state, not dialog state, so it is still there next time.
  await openSettings(page)
  await page.getByRole('dialog', { name: 'Settings' })
    .getByRole('button', { name: 'Wireless', exact: true }).click()
  await expect(page.locator('#settings-rf-gone')).toHaveValue('30')
  await closeSettings(page)
})

test('settings dialog closes with Escape key', async () => {
  await openSettings(page)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Settings' })).not.toBeVisible()
})

test('settings dialog opens via Ctrl+, keyboard shortcut', async () => {
  await page.keyboard.press('Control+,')
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
  await closeSettings(page)
})

test('the dialog is the same box on every tab, and only its own ways close it', async () => {
  await openSettings(page)
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  const audio = await dialog.boundingBox()
  expect(audio).not.toBeNull()

  // A tab with a different amount on it does not move the frame: the header, the tab
  // strip and the ✕ stay where the operator's pointer left them.
  await dialog.getByRole('button', { name: 'License', exact: true }).click()
  await expect(dialog.locator('.settings-tab[data-active="true"]')).toHaveText('License')
  const license = await dialog.boundingBox()
  expect(license).not.toBeNull()
  expect({
    x: Math.round(license!.x),
    y: Math.round(license!.y),
    width: Math.round(license!.width),
    height: Math.round(license!.height)
  }).toEqual({
    x: Math.round(audio!.x),
    y: Math.round(audio!.y),
    width: Math.round(audio!.width),
    height: Math.round(audio!.height)
  })

  // The backdrop is not a close button: half-typed is a state this panel is in, and a
  // press that lands beside the dialog must not take it with it.
  await page.locator('.settings-overlay').click({ position: { x: 5, y: 5 } })
  await expect(dialog).toBeVisible()

  // The ✕ still closes it.
  await closeSettings(page)
})

test('settings are grouped by what is being set up, and close one way', async () => {
  await openSettings(page)
  const dialog = page.getByRole('dialog', { name: 'Settings' })

  await expect(dialog.locator('.settings-tab')).toHaveText(['Audio', 'MIDI', 'Network', 'Wireless', 'License'])

  // MIDI out and MIDI in are one subject, on one tab.
  await dialog.getByRole('button', { name: 'MIDI', exact: true }).click()
  await expect(dialog.locator('.field-row', { hasText: 'Default output' })).toBeVisible()
  await expect(dialog.locator('#settings-midi-in')).toBeVisible()

  // What listens on the network, and what serves it, together.
  await dialog.getByRole('button', { name: 'Network', exact: true }).click()
  await expect(dialog.locator('#settings-osc-in')).toBeVisible()
  await expect(dialog.locator('#settings-presence')).toBeVisible()
  await expect(dialog.locator('#settings-companion')).toBeVisible()
  await expect(dialog.locator('#settings-rf-gone')).toHaveCount(0)

  // The packs' readings and the alarms they raise.
  await dialog.getByRole('button', { name: 'Wireless', exact: true }).click()
  await expect(dialog.locator('#settings-rf-gone')).toBeVisible()

  // The ✕ and Escape close it; there is no second Close at the bottom.
  await expect(dialog.getByRole('button', { name: /Close/ })).toHaveCount(1)
  await closeSettings(page)
})
