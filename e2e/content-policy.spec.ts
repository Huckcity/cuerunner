/**
 * The window refuses what it was never meant to run.
 *
 * Everything the window draws is rendered as text, and that is the defence that matters.
 * This is the one behind it: the built page states what it may load and run, and the
 * renderer is sandboxed. Both are asked of the real app, because both are settings that
 * read as "on" in the source and can be off in what ships — the policy is written into the
 * page at build time, and the sandbox is a flag on the window.
 *
 * `page.evaluate` runs through the debugger rather than through the page, so it is not
 * itself subject to the policy — and neither is an eval it calls directly. What the page's
 * own code does is: a script element added to it, an eval called from one of its timers.
 */
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { addCueFromMoreMenu, closeApp, launchApp } from './helpers'
import { RENDERER_CONTENT_POLICY } from '../src/shared/contentPolicy.ts'

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  ;({ app, page } = await launchApp())
})

test.afterAll(async () => {
  await closeApp(app)
})

test('the built page carries the policy the source declares', async () => {
  const carried = await page.evaluate(() =>
    document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ?? null)
  expect(carried).toBe(RENDERER_CONTENT_POLICY)
})

test('a script written into the page does not run, and neither does eval', async () => {
  const result = await page.evaluate(async () => {
    const blocked: string[] = []
    document.addEventListener('securitypolicyviolation', event => blocked.push(event.effectiveDirective))

    const script = document.createElement('script')
    script.textContent = 'window.__inlineScriptRan = true'
    document.head.appendChild(script)

    // From a timer, which is the page's own code running: called straight from here the
    // eval would be the debugger's, and the debugger is let through.
    const evaluated = await new Promise<string>(resolve => {
      setTimeout(() => {
        try {
          resolve(String((0, eval)('1 + 1')))
        } catch (error) {
          resolve((error as Error).name)
        }
      }, 0)
    })
    // The violation reports are queued behind this task.
    await new Promise(resolve => setTimeout(resolve, 50))
    return {
      inlineRan: (window as unknown as { __inlineScriptRan?: boolean }).__inlineScriptRan === true,
      evaluated,
      blocked
    }
  })

  expect(result.inlineRan).toBe(false)
  expect(result.evaluated).toBe('EvalError')
  expect(result.blocked).toContain('script-src-elem')
})

test('the window is sandboxed, and its page has no Node', async () => {
  // Electron answers this and does not declare it: the preferences the window was made with.
  const sandboxed = await app.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents as unknown as {
      getLastWebPreferences(): { sandbox?: boolean } | null
    }
    return contents.getLastWebPreferences()?.sandbox
  })
  expect(sandboxed).toBe(true)

  const node = await page.evaluate(() => ({
    require: typeof (globalThis as { require?: unknown }).require,
    process: typeof (globalThis as { process?: unknown }).process
  }))
  expect(node).toEqual({ require: 'undefined', process: 'undefined' })
})

test('a script cue still runs: its code is evaluated in a worker of its own, not in the page', async () => {
  await addCueFromMoreMenu(page, 'Script')
  await page.locator('.inspector-tab', { hasText: 'Script' }).click()
  await page.locator('.inspector-code').fill("console.log('policy ' + (6 * 7))")
  await page.locator('.btn-log').click()
  await page.getByRole('button', { name: /GO/ }).click()

  await expect(page.locator('.log-panel')).toContainText('policy 42')
})
