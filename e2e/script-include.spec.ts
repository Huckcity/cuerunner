// include() is a module system now: a file is read and run once, an include inside it
// resolves against that file rather than the workspace, and a cycle is reported. Every
// one of those crosses the worker, the script host, the preload bridge and the main
// process, so they are tested through the app rather than at the seams.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { addCueFromMoreMenu, closeApp, launchApp } from './helpers'

let app: ElectronApplication
let page: Page
let userDataDir: string

test.beforeEach(async () => {
  ;({ app, page, userDataDir } = await launchApp())
})

test.afterEach(async () => {
  await closeApp(app)
})

/** Writes a workspace with the given files beside it, then opens it the way a user would. */
async function openWorkspaceWith(files: Record<string, string>): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuerunner-include-'))
  for (const [name, content] of Object.entries(files)) {
    const full = path.join(dir, name)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }

  const workspace = path.join(dir, 'Include Show.wlab')
  fs.writeFileSync(workspace, JSON.stringify({
    version: 1,
    id: 'w1',
    name: 'Include Show',
    createdAt: '2026-01-01T00:00:00.000Z',
    audioSettings: { outputDeviceId: 'default' },
    midiSettings: { outputPortName: '' },
    cues: []
  }))

  fs.writeFileSync(path.join(userDataDir, 'recent.json'), JSON.stringify([workspace]))
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu-recent', { hasText: 'Show.wlab' }).click()
  await expect(page.locator('.workspace-name')).toContainText('Include Show')
}

async function runScript(script: string, timeoutMs = 120_000): Promise<void> {
  await addCueFromMoreMenu(page, 'Script')
  await page.locator('.inspector-tab', { hasText: 'Script' }).click()
  await page.locator('.inspector-code').fill(script)
  await page.locator('.field-row').filter({ hasText: 'Timeout' }).locator('input').fill(String(timeoutMs))
  await page.locator('.btn-log').click()
  await page.getByRole('button', { name: /GO/ }).click()
}

const logPanel = (): ReturnType<Page['locator']> => page.locator('.log-panel')

test('an included file runs once and hands back what it returned', async () => {
  await openWorkspaceWith({ 'lib.js': "console.log('lib ran')\nreturn 7" })
  await runScript("console.log('first', await include('./lib.js'))\nconsole.log('second', await include('./lib.js'))")

  await expect(logPanel()).toContainText('first 7')
  await expect(logPanel()).toContainText('second 7')
  // Running it twice would log twice.
  await expect(logPanel().locator('.log-row', { hasText: 'lib ran' })).toHaveCount(1)
})

test('an include inside an included file resolves against that file', async () => {
  await openWorkspaceWith({
    'cues/kit.js': "return (await include('./lamp.js')) + ' and kit'",
    'cues/lamp.js': "return 'lamp'"
  })
  await runScript("console.log(await include('./cues/kit.js'))")

  // './lamp.js' only exists next to kit.js, so resolving it against the workspace fails.
  await expect(logPanel()).toContainText('lamp and kit')
})

test('a cycle between two files is reported, not run until the timeout', async () => {
  await openWorkspaceWith({
    'a.js': "return await include('./b.js')",
    'b.js': "return await include('./a.js')"
  })
  await runScript("await include('./a.js')")

  await page.locator('.cue-row').first().click()
  await page.locator('.inspector-tab', { hasText: 'Script' }).click()
  await expect(page.locator('.last-run-badge')).toHaveText('failed')
  await expect(page.locator('.last-run-error')).toContainText('include() cycle')
})
