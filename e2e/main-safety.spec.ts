// What main does when the show is on the line and the window is not: sequencing that
// keeps time while the window is off screen, a panic that lands without the renderer,
// a watchdog that notices a dead renderer, network cues that do not need CORS headers,
// and MIDI that says so when it is not there.
//
// The panic tests read the main process and the native engine, not the page: the whole
// point of those paths is that they work when the page cannot answer, so an assertion
// against the renderer would prove the wrong thing. `__cuerunnerDevHarness` is installed
// only by a build running from the source tree, and the engine runs its real mixer
// against the silent backend, so a voice that really was playing really stops.
import { test, expect, type ElectronApplication, type Page, type TestInfo } from '@playwright/test'
import {
  addCueFromMoreMenu,
  capturedOutputPeak,
  closeApp,
  freePort,
  launchApp,
  listenOsc,
  readRecovered,
  sendOsc,
  startServer,
  type TestServer
} from './helpers'
import type { PlaybackDevHarness } from '../src/main/safety/devHarness'
import type { PlaybackSafetyState } from '../src/main/safety/PlaybackSafety'
import type { AudioEngineEvent } from '../src/shared/audio'

async function mainState(app: ElectronApplication): Promise<PlaybackSafetyState | null> {
  return app.evaluate(() => {
    const harness: PlaybackDevHarness | undefined = globalThis.__cuerunnerDevHarness
    return harness ? harness.safety() : null
  })
}

async function engineVoices(app: ElectronApplication): Promise<number | null> {
  return app.evaluate(async () => {
    const harness: PlaybackDevHarness | undefined = globalThis.__cuerunnerDevHarness
    if (!harness) return null
    return (await harness.engineInfo()).activeVoices
  })
}

async function engineEvents(app: ElectronApplication): Promise<AudioEngineEvent[]> {
  return app.evaluate(() => globalThis.__cuerunnerDevHarness?.engineEvents() ?? [])
}

/**
 * The crash banner as the reloaded window renders it. The read itself is `readRecovered`, the
 * suite's one reader of a window the page handle can no longer ask; what is here is the
 * selector, so the two specs that watch this banner read the same element.
 */
const CRASH_BANNER = "document.querySelector('.app-notice[data-kind=\"crash\"]')?.textContent ?? null"

/** The menu item's own click, from the main process — a synthesized key never reaches it. */
async function clickMenu(app: ElectronApplication, id: string): Promise<void> {
  await app.evaluate(({ Menu, BrowserWindow }, itemId) => {
    Menu.getApplicationMenu()
      ?.getMenuItemById(itemId)
      ?.click(undefined, BrowserWindow.getAllWindows()[0])
  }, id)
}

async function openSettings(page: Page): Promise<void> {
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu [data-action="settings"]').click()
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
}

async function openDemo(page: Page): Promise<void> {
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu button', { hasText: 'Open Demo Workspace' }).click()
  await expect(page.locator('.cue-row', { hasText: 'Walk-in Music' })).toBeVisible()
}

async function setWaitDuration(page: Page, ms: number): Promise<void> {
  await page.locator('.inspector-tab', { hasText: 'Wait' }).click()
  await page.locator('.field-row').filter({ hasText: 'Duration' }).locator('input').fill(String(ms / 1000))
}

async function setAdvance(page: Page, value: 'none' | 'on-start' | 'on-end'): Promise<void> {
  await page.locator('.inspector-tab', { hasText: 'Basics' }).click()
  await page.locator('.field-row').filter({ hasText: 'Advance' }).locator('select').selectOption(value)
}

async function configureOscCue(page: Page, port: number, address: string): Promise<void> {
  await page.locator('.inspector-tab', { hasText: 'OSC' }).click()
  await page.locator('.field-row').filter({ hasText: 'Host' }).locator('input').fill('127.0.0.1')
  await page.locator('.field-row').filter({ hasText: 'Port' }).locator('input').fill(String(port))
  await page.locator('.field-row').filter({ hasText: 'Address' }).locator('input').fill(address)
}

/** A cue that really is playing: the demo's walk-in, looped until something stops it. */
async function playWalkInForever(page: Page): Promise<void> {
  await openDemo(page)
  await page.locator('.cue-row', { hasText: 'Walk-in Music' }).click()
  // Loop count lives on the Timing tab, with the start/end times it interacts with.
  await page.locator('.inspector-tab', { hasText: 'Time & Loops' }).click()
  await page.locator('.field-row').filter({ hasText: 'Loop count' }).locator('input').fill('-1')
  await page.getByRole('button', { name: /GO/ }).click()
  // The window holds the run; the engine's own answer is waited on next, and together
  // they are what makes the panic assertions mean something.
  await expect(page.locator('.running-badge')).toHaveText('1 running', { timeout: 4000 })
}

/**
 * The silencing the operator cares about, from the engine rather than from a flag: the
 * panic event arrived, a run ended because of it, and the voice count it answered with
 * is not zero. A state boolean could have turned false without anything being stopped.
 */
async function expectEngineSilenced(
  app: ElectronApplication,
  capturePath?: string
): Promise<void> {
  await expect.poll(async () => {
    const events = await engineEvents(app)
    return events.some(event => event.type === 'panic') ||
      events.some(event => event.type === 'ended' && event.reason === 'stopped')
  }, { timeout: 10_000 }).toBe(true)

  await expect.poll(async () => (await mainState(app))?.lastStoppedVoices ?? 0).toBeGreaterThanOrEqual(1)
  await expect.poll(async () => await engineVoices(app), { timeout: 10_000 }).toBe(0)

  if (capturePath !== undefined) {
    // The engine's real mixer output: once the panic's fade has run out, the tail of
    // the capture is silent. A show that was still playing would show its waveform here.
    await expect.poll(() => capturedOutputPeak(capturePath, 400), { timeout: 10_000 }).toBe(0)
  }
}

/**
 * Where this test's engine capture goes. Launched with it in the environment, the
 * engine tees its real mixer output there, which is what "the sound stopped" is
 * checked against.
 */
async function startCapturedRun(testInfo: TestInfo): Promise<{
  app: ElectronApplication
  page: Page
  capturePath: string
}> {
  const capturePath = testInfo.outputPath('engine-output.wav')
  const { app, page } = await launchApp({
    env: { CUERUNNER_TEST_AUDIO_CAPTURE: capturePath }
  })
  try {
    await playAndConfirmSound(app, page, capturePath)
    return { app, page, capturePath }
  } catch (error) {
    await closeApp(app)
    throw error
  }
}

/**
 * Plays the demo's walk-in on a loop and waits until sound is really coming out of the
 * engine — the precondition for proving that a panic stopped it.
 *
 * One bounded wait covers both halves (the window holding the run, and the engine's
 * output carrying signal), so an engine that cannot play fails here with a reason
 * instead of running the 20 s test budget out and leaving the app behind.
 */
async function playAndConfirmSound(
  app: ElectronApplication,
  page: Page,
  capturePath: string
): Promise<void> {
  await playWalkInForever(page)
  await expect.poll(async () => {
    const running = (await mainState(app))?.playing ?? false
    return running && capturedOutputPeak(capturePath, 300) > 0.001
  }, {
    timeout: 9000,
    message: 'the walk-in cue never became audible: playback must work for a panic test to mean anything'
  }).toBe(true)
}

// ── Sequencing while the window is not on screen ───────────────────────────────

// Takes the app's window off screen. `minimize()` needs a window manager to iconify the
// window, and the suite runs on a bare Xvfb with none — there `isMinimized()` never turns
// true and a test would fail on its own precondition. Hiding puts the window in the same
// state the operator produces by minimizing: unmapped, with its page marked hidden.
//
// The harness also launches Electron with --disable-background-timer-throttling, so a
// timer that Chromium would drag out to a whole second on the desk is not dragged here:
// these tests hold the sequencing contract — waits and chains keep their time with the
// window gone — not the clamp that motivated `backgroundThrottling: false` in main.
async function takeWindowOffScreen(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.hide())
  await expect.poll(
    () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? true)
  ).toBe(false)
}

test('a 3000 ms wait fires its follow-on cue while the window is off screen', async () => {
  const { app, page } = await launchApp()
  const port = freePort()
  const listener = await listenOsc(port)

  try {
    // The case the handoff asked for first: one three-second wait, then a cue that
    // puts a message on the wire, with the window out of sight for the whole of it.
    await page.locator('.toolbar-cue-btn', { hasText: 'Wait' }).click()
    const waitRow = page.locator('.cue-row').first()
    await waitRow.click()
    await setWaitDuration(page, 3000)
    await setAdvance(page, 'on-end')

    await addCueFromMoreMenu(page, 'OSC')
    await page.locator('.cue-row').last().click()
    await configureOscCue(page, port, '/cuerunner/handoff')

    await waitRow.click()
    const startedAt = performance.now()
    await page.getByRole('button', { name: /GO/ }).click()

    await takeWindowOffScreen(app)

    await expect.poll(() => listener.received.length, { timeout: 12_000 }).toBe(1)
    // Stamped when the datagram landed, on the same monotonic clock as `startedAt`.
    const elapsed = listener.receivedAt[0] - startedAt

    expect(listener.received[0].address).toBe('/cuerunner/handoff')
    // 3000 ms of wait plus the click, taking the window off screen, and the send.
    expect(elapsed).toBeGreaterThanOrEqual(2900)
    expect(elapsed).toBeLessThan(3800)
  } finally {
    await listener.close()
    await closeApp(app)
  }
})

test('chained short waits keep time while the window is off screen', async () => {
  const { app, page } = await launchApp()
  const port = freePort()
  const listener = await listenOsc(port)

  try {
    // Six 400 ms steps chained inside a group, then the OSC cue that proves the chain
    // finished. The bound below holds the whole chain under four seconds, which separates
    // "kept time" from "the chain stalled" — not merely from "never fired".
    await page.locator('.toolbar-cue-btn', { hasText: 'Group' }).click()
    const groupRow = page.locator('.cue-row[data-depth="0"]').first()
    await groupRow.click()
    for (let step = 0; step < 6; step++) {
      await page.locator('.toolbar-cue-btn', { hasText: 'Wait' }).click()
      await page.locator('.cue-row[data-depth="1"]').last().click()
      await setWaitDuration(page, 400)
    }
    await groupRow.click()
    await setAdvance(page, 'on-end')

    await addCueFromMoreMenu(page, 'OSC')
    await page.locator('.cue-row').last().click()
    await configureOscCue(page, port, '/cuerunner/handoff')

    await groupRow.click()
    const startedAt = performance.now()
    await page.getByRole('button', { name: /GO/ }).click()

    // The real window, taken off screen the way the operator's minimized one is.
    await takeWindowOffScreen(app)

    await expect.poll(() => listener.received.length, { timeout: 12_000 }).toBe(1)
    // Stamped when the datagram landed, not when the poll noticed.
    const elapsed = listener.receivedAt[0] - startedAt

    expect(listener.received[0].address).toBe('/cuerunner/handoff')
    // 2400 ms of waits, plus the click, taking the window off screen, and the send.
    expect(elapsed).toBeGreaterThanOrEqual(2300)
    expect(elapsed).toBeLessThan(3800)
  } finally {
    await listener.close()
    await closeApp(app)
  }
})

// ── Panic that does not need the renderer ──────────────────────────────────────

test('the menu silences the engine and cancels what the renderer still holds', async ({}, testInfo) => {
  const { app, page, capturePath } = await startCapturedRun(testInfo)
  try {
    await clickMenu(app, 'playback-panic')

    await expect.poll(async () => (await mainState(app))?.lastPanic?.source).toBe('menu')
    await expectEngineSilenced(app, capturePath)
    // The broadcast reached the window, which dropped the cue it was holding.
    await expect(page.locator('.running-badge')).toHaveText('idle', { timeout: 5000 })
  } finally {
    await closeApp(app)
  }
})

test('a crashed renderer mid-playback is silenced from main before it is brought back', async ({}, testInfo) => {
  // The crash, the reload and the window's React boot on a shared runner: the panic path
  // alone is quick, and the banner this lane reads is only on screen after the reload.
  test.setTimeout(60_000)
  const { app, capturePath } = await startCapturedRun(testInfo)
  try {
    // The renderer is the only thing that could have stopped the cue, and it is gone.
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.webContents.forcefullyCrashRenderer()
    })

    await expect.poll(async () => (await mainState(app))?.lastPanic?.source ?? null, { timeout: 5000 }).not.toBeNull()

    // Two things silence the show from main, and both are main acting alone: the crash
    // this test is about, and the watchdog — which fires when the renderer has gone
    // quiet past its three seconds, as a loaded CI runner can starve it, and a renderer
    // that stopped answering is not one a crash can be delivered to. That is the safety
    // net working, not this test's subject, so it is reported as skipped rather than
    // failed; on a machine that can keep a renderer answering, the crash path is what
    // runs here.
    const source = (await mainState(app))?.lastPanic?.source
    if (source === 'watchdog') {
      test.skip(true, 'the watchdog silenced the show before the crash could land')
    }

    expect(source).toBe('renderer-crash')
    await expectEngineSilenced(app, capturePath)

    const state = await mainState(app)
    // Chromium picks the word per platform — a crashed renderer reports 'crashed' on
    // Linux and 'killed' on macOS — so what is pinned is the line the operator reads.
    expect(state?.lastPanic?.reason).toMatch(/^renderer stopped \(/)

    // And the window comes back saying so: `app:renderer-crash` is what the reloaded window
    // reads on mount, and the banner is the only place that tells the operator the show was
    // reset while the file on disk was left alone. Without the pair's registration the crash
    // is known to main and to nobody else.
    await expect.poll(() => readRecovered(app, CRASH_BANNER), { timeout: 30_000 })
      .toContain('The interface stopped unexpectedly')
    // And what it says about the show: the banner is the only place the operator reads
    // that the session was reset while the file on disk was left alone.
    await expect.poll(() => readRecovered(app, CRASH_BANNER), { timeout: 10_000 })
      .toContain('The workspace file on disk is untouched')
  } finally {
    await closeApp(app)
  }
})

// ── The show inputs ────────────────────────────────────────────────────────────

test('OSC /cuerunner/panic silences the show through the OSC input', async ({}, testInfo) => {
  const capturePath = testInfo.outputPath('engine-output.wav')
  const { app, page } = await launchApp({
    env: { CUERUNNER_TEST_AUDIO_CAPTURE: capturePath }
  })
  const port = freePort()
  try {
    // The walk-in starts first: enabling OSC input marks the workspace dirty, and a demo
    // opened after that raises the real save-confirm dialog, which blocks the window.
    await playAndConfirmSound(app, page, capturePath)

    await openSettings(page)
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await dialog.getByRole('button', { name: 'Network', exact: true }).click()
    await dialog.locator('#settings-osc-in').check()
    await dialog.locator('#settings-osc-port').fill(String(port))
    await dialog.locator('#settings-osc-port').blur()
    // The socket has to be bound before the message is sent, or the datagram is lost.
    await expect(dialog.locator('.settings-service[data-service="osc-in"]')).toContainText('listening')
    await dialog.getByRole('button', { name: 'Close' }).click()
    // And the dialog has to be gone before the toolbar is touched again.
    await expect(dialog).not.toBeVisible()

    await sendOsc(port, '/cuerunner/panic')

    await expect.poll(async () => (await mainState(app))?.lastPanic?.source).toBe('osc')
    await expectEngineSilenced(app, capturePath)
    await expect(page.locator('.running-badge')).toHaveText('idle', { timeout: 5000 })
  } finally {
    await closeApp(app)
  }
})

// ── Network cues, without a page origin ────────────────────────────────────────

test('a network cue reaches a server that sends no CORS headers', async () => {
  const { app, page } = await launchApp()
  let server: TestServer | undefined
  try {
    server = await startServer({ cors: false })

    await addCueFromMoreMenu(page, 'Network')
    await page.locator('.inspector-tab', { hasText: 'Network' }).click()
    await page.locator('.field-row').filter({ hasText: 'Method' }).locator('select').selectOption('POST')
    await page.locator('.field-row').filter({ hasText: 'URL' }).locator('input').fill(`${server.baseUrl}/hit`)
    await page.locator('.inspector-add-btn').click()
    await page.locator('.field-row').filter({ hasText: 'Header 1' }).locator('input').nth(0).fill('X-Show')
    await page.locator('.field-row').filter({ hasText: 'Header 1' }).locator('input').nth(1).fill('demo')
    await page.locator('.inspector textarea').fill('{"scene":3}')

    await page.getByRole('button', { name: /GO/ }).click()

    await expect.poll(() => server!.hits.length, { timeout: 10_000 }).toBe(1)
    const hit = server.hits[0]
    expect(hit.method).toBe('POST')
    expect(hit.url).toBe('/hit')
    expect(hit.body).toBe('{"scene":3}')
    expect(hit.headers['x-show']).toBe('demo')
    // No Origin: this was not the page making a cross-origin request.
    expect(hit.headers.origin).toBeUndefined()

    // And the cue reports the response it got, as it always did.
    await page.locator('.cue-row').first().click()
    await page.locator('.inspector-tab', { hasText: 'Network' }).click()
    await expect(page.locator('.last-run-badge')).toHaveText('ok')
    await expect(page.locator('.last-run')).toContainText('200 OK')
  } finally {
    await server?.close()
    await closeApp(app)
  }
})

// ── MIDI that is not there at all ──────────────────────────────────────────────

test('a build without the MIDI module says so, on the badge and on the cue', async () => {
  // The dev-only harness switch: the native module is withheld so the missing-module
  // path is exercised by the real application, not by a mock standing in for it.
  const { app, page } = await launchApp({
    env: { CUERUNNER_TEST_MIDI_MISSING: '1' }
  })
  try {
    const badge = page.locator('.midi-status')
    await expect(badge).toBeVisible()
    await expect(badge).toHaveText('MIDI unavailable')
    await expect(badge).toHaveAttribute('title', /not installed/)

    // The badge leads to Settings → MIDI, and the page it leads to says the same thing:
    // an empty port list there used to read as a machine with nothing plugged in.
    await badge.click()
    const explained = page.locator('#settings-midi-unavailable')
    await expect(explained).toContainText('MIDI is unavailable')
    await expect(explained).toContainText('not installed')
    await expect(page.locator('.settings-dialog')).not.toContainText('No MIDI inputs on this machine')
    await page.keyboard.press('Escape')
    await expect(page.locator('.settings-dialog')).toHaveCount(0)

    await addCueFromMoreMenu(page, 'MIDI')
    await page.getByRole('button', { name: /GO/ }).click()

    await page.locator('.cue-row').first().click()
    await page.locator('.inspector-tab', { hasText: 'MIDI' }).click()
    await expect(page.locator('.last-run-badge')).toHaveText('failed')
    await expect(page.locator('.last-run-error')).toContainText('MIDI is unavailable')
  } finally {
    await closeApp(app)
  }
})
