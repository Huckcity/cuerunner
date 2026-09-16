// Failure surfaces: a crashed renderer comes back with an explanation, and errors the
// operator cannot see in a packaged build reach the session log.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { closeApp, launchApp } from './helpers'

let app: ElectronApplication
let page: Page
let userDataDir: string

test.beforeEach(async () => {
  ;({ app, page, userDataDir } = await launchApp())
})

test.afterEach(async () => {
  await closeApp(app)
})

test('recovers from a renderer crash with an explanation', async () => {
  // Recovery plus a React boot is quick alone, but the suite runs eight Electron
  // instances at once, so this test waits rather than assumes.
  test.setTimeout(90_000)

  // Everything the main process says about the crash, so a failure here is readable
  // rather than a bare timeout.
  const mainLog: string[] = []
  app.process().stdout?.on('data', chunk => mainLog.push(String(chunk)))
  app.process().stderr?.on('data', chunk => mainLog.push(String(chunk)))

  // Unsaved work, written where the autosave leaves it. The session that is about to die
  // has already booted, so this is its snapshot as the next window will find it — and the
  // crash bar has to explain the crash without telling the operator this is gone.
  fs.writeFileSync(
    path.join(userDataDir, 'recovery.cuerunner'),
    JSON.stringify({
      savedAt: Date.now(),
      sourcePath: null,
      selectedCueId: 'c1',
      workspace: {
        version: 1,
        id: 'w1',
        name: 'Crashed Show',
        createdAt: '2026-01-01T00:00:00.000Z',
        audioSettings: { outputDeviceId: 'default' },
        midiSettings: { outputPortName: '' },
        cues: [{
          id: 'c1', number: '1', name: 'Where I Was', type: 'wait', colorLabel: 'none',
          parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 1000,
          advance: 'none', isArmed: true, notes: ''
        }]
      }
    })
  )

  // A real crash: the renderer process is killed outright. Electron's
  // forcefullyCrashRenderer() goes through Chromium's hung-process path instead, which
  // on a GPU-less runner leaves the window with no renderer and nothing reloading it.
  const rendererPid = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.getOSProcessId())
  process.kill(rendererPid, 'SIGKILL')

  // executeJavaScript issued while the renderer is being torn down never settles, and
  // isCrashed() can still read false for a moment after the crash is requested — so a
  // single read can hang the poll for its whole timeout. Race every read against a
  // deadline and let the poll try again.
  const readRecovered = (expression: string) => app.evaluate(async ({ BrowserWindow }, code) => {
    const wc = BrowserWindow.getAllWindows()[0].webContents
    if (wc.isCrashed()) return null
    const deadline = new Promise(resolve => setTimeout(() => resolve(null), 2000))
    return Promise.race([wc.executeJavaScript(code).catch(() => null), deadline]) as Promise<unknown>
  }, expression)

  // Playwright's page handle stays marked as crashed after the renderer is replaced,
  // so the recovered window is inspected through its own webContents instead.
  try {
    // A crash, a reload and a React boot on a shared runner: generous on purpose, and
    // the failure path below says what was happening if it still runs out.
    await expect.poll(
      async () => readRecovered("!!document.querySelector('.toolbar')"),
      { timeout: 60_000 }
    ).toBe(true)
  } catch (error) {
    const state = await app.evaluate(({ BrowserWindow }) => {
      const wc = BrowserWindow.getAllWindows()[0]?.webContents
      if (!wc) return 'no window'
      return `crashed=${wc.isCrashed()} destroyed=${wc.isDestroyed()} loading=${wc.isLoading()} url=${wc.getURL()} pid=${wc.getOSProcessId()}`
    }).catch(e => `window state unavailable: ${String(e)}`)
    throw new Error(`${String(error)}\nwindow: ${state}\nmain process said:\n${mainLog.join('')}`)
  }

  const banner = await readRecovered("document.querySelector('[data-kind=\"crash\"]')?.textContent ?? null")
  expect(banner).toContain('The interface stopped unexpectedly')
  expect(banner).toContain('The workspace file on disk is untouched')
  expect(banner).toContain('was reloaded')
  // Which reason Electron reports depends on the platform ('killed' on macOS, 'crashed'
  // on Linux), so the contract is that the banner says why, not which word it picks.
  expect(banner).toMatch(/\((crashed|killed|oom|launch-failed|integrity-failure)\)/)

  // And the two bars agree with each other: the crash is explained, and the work the
  // autosave caught is offered back with the cue the session was standing on, rather than
  // being written off by the banner above it.
  await expect.poll(
    () => readRecovered("document.querySelector('[data-kind=\"recovery\"]')?.textContent ?? null"),
    { timeout: 30_000 }
  ).toContain('1 · Where I Was')

  // The interface answers input again, not just renders: the LOG toggle works.
  const logOpened = await app.evaluate(async ({ BrowserWindow }) => {
    const wc = BrowserWindow.getAllWindows()[0].webContents
    await wc.executeJavaScript("document.querySelector('.btn-log').click()")
    return wc.executeJavaScript("!!document.querySelector('.log-panel')")
  })
  expect(logOpened).toBe(true)
})

test('an unhandled rejection in the renderer reaches the session log', async () => {
  await page.evaluate(() => { void Promise.reject(new Error('e2e unhandled rejection')) })

  await page.locator('.btn-log').click()
  await expect(page.locator('.log-panel')).toContainText('Unhandled rejection: e2e unhandled rejection')
})

test('a main-process exception reaches the session log and leaves the app running', async () => {
  await app.evaluate(() => {
    setTimeout(() => { throw new Error('e2e main boom') }, 0)
  })

  await page.locator('.btn-log').click()
  await expect(page.locator('.log-panel')).toContainText('e2e main boom')

  // Still usable: the log toggles and the transport bar answers a GO.
  await page.locator('.btn-log').click()
  await expect(page.locator('.log-panel')).toHaveCount(0)
  await expect(page.locator('.btn-go')).toBeEnabled()
})
