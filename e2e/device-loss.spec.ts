// The device going away mid-show. On a real backend this is the USB interface being
// unplugged, the Dante subscription dropping, another application taking exclusive
// access — and what the operator needs from it is definite: the sound stops rather than
// pouring into a device that is no longer there, the reason is on screen in the engine's
// own words, and the show can go on when the rig comes back.
//
// The engine runs its real classification (the same function its backend callback uses)
// and only accepts the test hook on the silent backend, so this cannot mask or imitate
// a genuine event. The engine is the real one either way.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp } from './helpers'
import type { PlaybackDevHarness } from '../src/main/safety/devHarness'
import type { AudioEndedEvent, AudioEngineEvent, AudioErrorEvent } from '../src/shared/audio'
import type { ShowAlert } from '../src/shared/show'

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  ;({ app, page } = await launchApp())
})

test.afterAll(async () => {
  await closeApp(app)
})

async function engineVoices(): Promise<number | null> {
  return app.evaluate(async () => {
    const harness: PlaybackDevHarness | undefined = globalThis.__cuerunnerDevHarness
    if (!harness) return null
    return (await harness.engineInfo()).activeVoices
  })
}

async function engineEvents(): Promise<AudioEngineEvent[]> {
  return app.evaluate(() => globalThis.__cuerunnerDevHarness?.engineEvents() ?? [])
}

async function openDemo(): Promise<void> {
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu button', { hasText: 'Open Demo Workspace' }).click()
  await expect(page.locator('.cue-row', { hasText: 'Walk-in Music' })).toBeVisible()
}

/** The demo's walk-in, looped until something stops it. */
async function playWalkInForever(): Promise<void> {
  await page.locator('.cue-row', { hasText: 'Walk-in Music' }).click()
  await page.locator('.inspector-tab', { hasText: 'Time & Loops' }).click()
  await page.locator('.field-row').filter({ hasText: 'Loop count' }).locator('input').fill('-1')
  await page.getByRole('button', { name: /GO/ }).click()
}

test('a device that goes away mid-show silences the show, says why, and the show goes on', async () => {
  test.setTimeout(120_000)
  await openDemo()
  await playWalkInForever()
  await expect.poll(engineVoices, { timeout: 15_000 }).toBeGreaterThanOrEqual(1)

  // What the engine had said before the loss, so the lines below are read against the
  // loss's own report rather than against everything main has kept: this device is not
  // the only thing that can end a voice, and it is not the only thing that can alarm.
  const endsBeforeLoss = (await engineEvents()).filter((event) => event.type === 'ended').length

  // The device is gone.
  await app.evaluate(async () => {
    await globalThis.__cuerunnerDevHarness?.simulateDeviceLoss()
  })

  // The engine stops what it was playing rather than playing into a dead device.
  await expect.poll(engineVoices, { timeout: 15_000, message: 'the show kept playing into a lost device' }).toBe(0)

  // And it says what happened, engine-wide, in its own words.
  await expect
    .poll(
      async () => (await engineEvents()).some((event) => event.type === 'error' && event.code === 'device'),
      { timeout: 10_000, message: 'no device error was reported' }
    )
    .toBe(true)
  const deviceError = (await engineEvents()).find(
    (event): event is AudioErrorEvent => event.type === 'error' && event.code === 'device'
  )
  expect(deviceError?.message).toMatch(/stopped unexpectedly/)
  // The fault belongs to the engine, not to a cue: the operator reads it as a device
  // problem rather than as something the cue did wrong.
  expect(deviceError?.cueId).toBeNull()

  // The voice the device took ended with a reason of its own, and that is what releases
  // the row: `device-lost`, with the cue's end recorded against the loss rather than a
  // stop nobody asked for.
  const lossEnds = async (): Promise<string[]> =>
    (await engineEvents())
      .filter((event): event is AudioEndedEvent => event.type === 'ended')
      .slice(endsBeforeLoss)
      .map((event) => event.reason)
  await expect
    .poll(lossEnds, { timeout: 10_000, message: 'no device-lost end for the cue the device took' })
    .toContain('device-lost')
  expect(await lossEnds()).not.toContain('stopped')

  // Nothing reads as playing once the loss is reported: the transport is idle again, and
  // the cue's own record carries the fault.
  await expect(page.locator('.running-badge')).toHaveText('idle')

  // The session log carries it too, phrased as the engine speaking — and as the cue's own
  // failure, which is the line the release is recorded from.
  await page.locator('.btn-log').click()
  await expect(page.locator('.log-panel')).toContainText('audio engine:')
  await expect(page.locator('.log-panel')).toContainText('stopped unexpectedly')
  await expect(page.locator('.log-panel')).toContainText('audio device lost')

  // The loss raises an alarm where the operator already looks for alarms: the engine's
  // own fault line, on the monitor's strip and in the transport's chip, raised in main
  // where the engine events are consumed rather than invented by the window. Standing
  // alarms are shared with every other service, so this asks that the loss's is among
  // them.
  const alertSnapshot = await page.evaluate<ShowAlert[]>(
    'window.cuerunner.show.snapshot().then(snapshot => snapshot.alerts)'
  )
  expect(alertSnapshot).toContainEqual(
    expect.objectContaining({ level: 'critical', source: 'audio', message: expect.stringMatching(/stopped unexpectedly/) })
  )
  await page.locator('.btn-monitor').click()
  const strip = page.locator('.monitor-alert', { hasText: 'stopped unexpectedly' })
  await expect(strip).toBeVisible()
  await expect(page.locator('.alert-chip')).toContainText('stopped unexpectedly')

  // And it is dismissed the way every other alarm is.
  await strip.locator('.monitor-alert-dismiss').click()
  await expect(page.locator('.alert-chip', { hasText: 'stopped unexpectedly' })).toHaveCount(0)
  await expect(page.locator('.monitor-alert', { hasText: 'stopped unexpectedly' })).toHaveCount(0)

  // And it stays on screen while the condition lasts, where a rig is checked.
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu [data-action="settings"]').click()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await expect(dialog).toBeVisible()
  // The warning lives beside the engine readout, which is the Audio tab's.
  await dialog.getByRole('button', { name: 'Audio', exact: true }).click()
  await expect(page.locator('.settings-warning')).toContainText('stopped unexpectedly', { timeout: 15_000 })
  await page.keyboard.press('Escape')

  // The show is not over: the same cue plays again on the same engine, which is what the
  // release bought — a GO on the row the device took is a new firing, not a refused
  // repeat of a cue that is still somehow making a sound.
  await playWalkInForever()
  try {
    await expect.poll(engineVoices, { timeout: 15_000 }).toBeGreaterThanOrEqual(1)
  } catch (error) {
    // Saying only "it did not play" costs a CI round trip; say what the engine and the
    // session log had to say about it.
    const info = await app.evaluate(async () => {
      const harness = globalThis.__cuerunnerDevHarness
      return harness ? await harness.engineInfo() : null
    })
    const log = await page.locator('.log-panel').innerText().catch(() => '')
    // What the engine actually did with the second start, which is the difference between
    // "the cue never reached it" and "it played and ended on its own".
    const events = await app.evaluate(() => {
      const harness = globalThis.__cuerunnerDevHarness
      return (harness?.engineEvents() ?? []).slice(-12).map(event => {
        if (event.type === 'ended') return `ended ${event.cueId} ${event.reason} loops=${event.loopsCompleted}`
        if (event.type === 'error') return `error ${event.code}: ${event.message}`
        if (event.type === 'panic') return 'panic'
        return `state ${event.cueId ?? '-'} ${event.state ?? '-'} playing=${event.playing}`
      })
    })
    throw new Error(
      `nothing played after the device came back\n` +
        `engine warnings: ${JSON.stringify(info?.warnings ?? [])}\n` +
        `engine lastError: ${String(info?.lastError)}\n` +
        `engine events: ${events.join(' | ')}\n` +
        `session log tail: ${log.slice(-600)}`
    )
  }
  await page.locator('.btn-stop').click()
  await expect.poll(engineVoices, { timeout: 10_000 }).toBe(0)
})
