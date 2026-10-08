// The show monitor: which services are listening, what is on stage, and the OSC that
// reaches the app. Everything here is the part of a show that is not the cue stack.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { createSocket } from 'dgram'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { closeApp, launchApp, mintLicense, openFromRecent, oscPortOfItsOwn, sendOsc } from './helpers'

let app: ElectronApplication
let page: Page
let userDataDir: string

test.beforeEach(async () => {
  // The show services, the scenes view, the panels that read them: everything this spec
  // is about is the licensed half of the app.
  ;({ app, page, userDataDir } = await launchApp({ license: mintLicense() }))
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

// A port another socket already holds is EADDRINUSE on POSIX and EACCES on Windows
// (WSAEACCES is what a Windows bind reports for the same clash). It is one fact either
// way, and the assertion is about the app reporting it, not about the platform it was
// written on.
const PORT_IN_USE = /EADDRINUSE|EACCES/

async function openMonitor(page: Page): Promise<void> {
  await page.locator('.btn-monitor').click()
  await expect(monitor(page)).toBeVisible()
}

async function openShowSettings(page: Page, tab: 'Network' | 'MIDI' = 'Network') {
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu [data-action="settings"]').click()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await dialog.getByRole('button', { name: tab, exact: true }).click()
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

  // OSC input comes up on its default port with no workspace loaded at all. The port is the
  // show's alone, so on a machine where something else already holds 53000 — another app in a
  // parallel run, a QLab — it is refused and says so, on that same port; either way it is up.
  const osc = service(page, 'OSC input')
  await expect(osc).toContainText('53000')
  await expect(osc).toHaveAttribute('data-state', /^(running|degraded)$/)
  if ((await osc.getAttribute('data-state')) === 'degraded') await expect(osc).toContainText(PORT_IN_USE)

  await page.locator('.btn-monitor').click()
  await expect(monitor(page)).toHaveCount(0)
})

test('OSC sent to the app reaches the log, beside what the cues did', async () => {
  const port = await oscPortOfItsOwn(page)
  await sendOsc(port, '/show/go', 1, 'walk-in')

  // What came in is history, and the log is the session's one history.
  await page.locator('.btn-log').click()
  const event = page.locator('.log-panel .log-event[data-kind="osc"]').first()
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

  await sendOsc(port, '/show/port-check')
  await page.locator('.btn-log').click()
  await expect(page.locator('.log-panel .log-event[data-kind="osc"]').first())
    .toContainText('/show/port-check')
})

test('enabling MIDI input starts the service and reports what it found', async () => {
  const dialog = await openShowSettings(page, 'MIDI')
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
    await expect(state).toContainText(PORT_IN_USE)
    await dialog.getByRole('button', { name: 'Close' }).click()

    // A service that cannot start is an alarm the operator can read, and the app is
    // still there to show it.
    await openMonitor(page)
    // This port's alarm: the launch's own default port may have its own where another app in
    // the run holds 53000.
    await expect(monitor(page).locator('.monitor-alert', { hasText: new RegExp(`${port}.*(EADDRINUSE|EACCES)`) })).toBeVisible()
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

test('services coming and going stay in the monitor, out of the log', async () => {
  // A port of its own: 53000 is refused where another app in the run holds it, and a refusal
  // is an alarm, which belongs in the log. Moving the port is a service going and coming.
  await oscPortOfItsOwn(page)
  await openMonitor(page)
  await expect(service(page, 'OSC input')).toHaveAttribute('data-state', 'running')

  await page.locator('.btn-log').click()
  await expect(page.locator('.log-panel')).toBeVisible()
  await expect(page.locator('.log-panel .log-event[data-kind="service"]')).toHaveCount(0)
})

test('a cancelled quit leaves the show services listening', async () => {
  const port = await oscPortOfItsOwn(page)

  // Something to lose, so the quit has to ask before it goes: the prompt is the OS's
  // own, and the answer here is Cancel.
  await page.locator('.toolbar-cue-btn', { hasText: 'Wait' }).click()
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 2, checkboxChecked: false })) as typeof dialog.showMessageBox
  })

  // File → Exit is `app.quit()`: `before-quit` fires, then the window is asked to close,
  // and the operator's Cancel aborts the quit from there.
  await app.evaluate(({ app }) => app.quit())
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length))
    .toBe(1)

  // The listener is really bound and really heard: a datagram sent now reaches the log,
  // which it cannot do if the cancelled quit took the show services with it.
  await sendOsc(port, '/show/after-cancel')
  await page.locator('.btn-log').click()
  await expect(page.locator('.log-panel .log-event[data-kind="osc"]').first())
    .toContainText('/show/after-cancel')
})

/**
 * What a quit's answer left behind: the platform's own outcome, and the only one.
 *
 * These are not two ways of saying "closed". Off darwin the last window closed *is* the
 * quit running — `window-all-closed` calls `app.quit()` — so the process goes. On macOS the
 * guard at `window-all-closed` keeps the application running with no window: a quit the
 * unsaved-changes prompt interrupts closes the window and is never resumed, which is that
 * platform's convention and a decision recorded at the guard, not a defect. An oracle that
 * accepted either arm as one outcome could not tell a quit that worked from one that was
 * never resumed, and it was exactly that ambiguity the divergence hid behind.
 */
interface QuitOutcome {
  /** The process is gone. */
  exited: boolean
  /** How many windows main still reported, or null before it could be asked. */
  windows: number | null
}

/** The window list's own poll interval, and the settle that follows it on macOS. */
const QUIT_POLL_MS = 100
/**
 * How long the macOS arm keeps watching the process once the window has gone. There the
 * application staying up *is* the outcome, and a value read a millisecond after the window
 * closed cannot tell that from a quit that resumes a beat later: a resumed quit exits inside
 * this window, and the watch is what catches it.
 */
const QUIT_SETTLE_MS = 2000

/**
 * The quit's outcome, watched from before the quit is asked for and read from main, which is
 * the only place it can be read: `app.evaluate` cannot be called once the process is going.
 * The watch ends when this platform's own outcome has arrived — the process going, or, on
 * macOS, the window list emptying and then staying that way past `QUIT_SETTLE_MS` — and
 * reports the last thing it saw at the deadline, because a window that never closes is a
 * failed close rather than a test that hangs.
 */
async function whenWindowClosed(): Promise<QuitOutcome> {
  const proc = app.process()
  const gone = (): boolean => proc.exitCode !== null || proc.signalCode !== null
  const deadline = Date.now() + 15_000
  let windows: number | null = null
  // When the settle ends, taken from the first reading of an empty window list: until then
  // the platform's outcome is still undecided on macOS.
  let settledAt: number | null = null
  for (;;) {
    // Checked on every turn, the settle's included: a process that goes inside it is a
    // failure there, and the outcome the lane asserts on carries it.
    if (gone()) return { exited: true, windows }
    try {
      windows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
    } catch {
      // The app is on its way out: the exit flags above are the answer, read on the next
      // turn of this loop.
    }
    // Off darwin the empty window list is the beginning of the quit rather than its end: the
    // process going is the outcome, so the loop keeps to the exit flags above.
    if (windows === 0 && process.platform === 'darwin') {
      // On macOS it is the other way round. The window going is what a quit looks like there,
      // and what the lane has to rule out is the quit being resumed behind it — so the
      // process is watched until the settle is out, and only then is staying up the answer.
      // The settle is the loop's own bound here, so the deadline below cannot cut it short.
      settledAt ??= Date.now() + QUIT_SETTLE_MS
      if (Date.now() >= settledAt) return { exited: false, windows }
    } else if (Date.now() > deadline) {
      return { exited: gone(), windows }
    }
    const { promise: tick, resolve: tock } = Promise.withResolvers<void>()
    setTimeout(tock, QUIT_POLL_MS)
    await tick
  }
}

/**
 * The platform's own outcome, held to as that outcome rather than as either arm of it: off
 * darwin the process exits, and on darwin no window remains while the application runs on.
 */
function expectQuitOutcome(outcome: QuitOutcome, what: string): void {
  if (process.platform === 'darwin') {
    // First, because it decides whether the window count means anything: an application that
    // quit cannot be asked what it has open, and on macOS quitting here is the failure. The
    // flag is read after the settle the watch applies, so a quit resumed behind the closed
    // window — the divergence this platform's convention is recorded against — fails here.
    expect(outcome.exited, `${what}: the application must still be running on macOS`).toBe(false)
    expect(outcome.windows, `${what}: no window may be left open`).toBe(0)
    return
  }
  expect(outcome.exited, `${what}: the process did not exit`).toBe(true)
}

/** A show on disk, opened the way an operator opens one: from the File menu's recent list. */
async function openSavedShow(dir: string, name: string): Promise<string> {
  const file = path.join(dir, `${name}.cuerunner`)
  fs.writeFileSync(file, `${JSON.stringify({
    version: 1,
    id: 'w-quit',
    name,
    createdAt: '2026-01-01T00:00:00.000Z',
    audioSettings: { outputDeviceId: 'default' },
    midiSettings: { outputPortName: '' },
    cues: []
  }, null, 2)}\n`)
  await openFromRecent(page, userDataDir, file)
  await expect(page.locator('.workspace-name')).toContainText(name)
  return file
}

test('a quit answered Don’t Save closes the window and leaves the file alone', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuerunner-quit-discard-'))
  try {
    const file = await openSavedShow(dir, 'Unsaved Show')
    const onDisk = fs.readFileSync(file, 'utf-8')

    // An edit, so the close has something to ask about, and the answer is Don't Save.
    await page.locator('.toolbar-cue-btn', { hasText: 'Wait' }).click()
    await expect(page.locator('.workspace-name')).toContainText('●')
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox
    })

    const closed = whenWindowClosed()
    await app.evaluate(({ app }) => app.quit())

    // The close is allowed through the pair's accept path (`app:confirm-close`), which is
    // what actually takes the window down; the answer was not Cancel, so nothing may wait.
    // What the quit then leaves is this platform's own outcome, not either arm of it.
    expectQuitOutcome(await closed, 'the window did not close when the close was answered')
    // And discarding the session is not writing it.
    expect(fs.readFileSync(file, 'utf-8')).toBe(onDisk)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('a quit answered Save writes the show through the dialog and then closes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuerunner-quit-save-'))
  try {
    // A session nobody has saved yet, so the Save the operator answers with has to ask
    // where to put the show: the dialog is stubbed to answer with a file in this test's
    // own directory, which is where the app then writes it.
    await page.locator('.toolbar-cue-btn', { hasText: 'Wait' }).click()
    await expect(page.locator('.workspace-name')).toContainText('●')

    const file = path.join(dir, 'Quitting Show.cuerunner')
    await app.evaluate(({ dialog }, target) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: target })) as typeof dialog.showSaveDialog
      dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox
    }, file)

    const closed = whenWindowClosed()
    await app.evaluate(({ app }) => app.quit())
    expectQuitOutcome(await closed, 'the window did not close after the save was answered')

    // The show was really written before the window went: the cue the operator added is in
    // the file, which is what the close prompt's Save promised.
    const saved = JSON.parse(fs.readFileSync(file, 'utf-8')) as { name: string; cues: Array<{ type: string }> }
    // And it is the show the operator named in the dialog: a session nobody had named
    // takes its file's name on the save that first puts it in one.
    expect(saved.name).toBe('Quitting Show')
    expect(saved.cues.map(cue => cue.type)).toEqual(['wait'])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
