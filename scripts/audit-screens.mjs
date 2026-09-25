#!/usr/bin/env node
// Every surface of the app, captured to a directory of your choosing.
//
//   node scripts/audit-screens.mjs before      # then make the change
//   node scripts/audit-screens.mjs after       # and compare the two directories
//   AUDIT_UNLICENSED=1 node scripts/audit-screens.mjs after   # the free half as well
//
// capture-screenshots.mjs captures the figures the website publishes, and is held to
// them. This is the other half: it opens every inspector tab of every cue type, every
// settings page, every dock panel, the dialogs and both views, so a change to the look
// can be reviewed against what it replaced rather than against memory. Nothing it writes
// is published; point it at a scratch directory.
//
// Failures are printed and stepped over: a surface that has moved should not take the
// other fifty with it.
import { _electron as electron } from '@playwright/test'
import { generateKeyPairSync } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLicense } from '../src/main/license/key.ts'
import { underVirtualDisplay } from './virtual-display.mjs'

await underVirtualDisplay()

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const appEntry = path.join(root, 'out/main/index.js')
const outDir = path.resolve(process.argv[2] ?? 'audit')
fs.mkdirSync(outDir, { recursive: true })

const licensed = process.env.AUDIT_UNLICENSED !== '1'
const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuerunner-audit-'))
if (licensed) {
  fs.writeFileSync(path.join(userDataDir, 'license.key'), createLicense(
    { v: 1, id: 'CRN-AUDIT1', licensee: 'Audit', issued: new Date().toISOString().slice(0, 10) },
    privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  ))
}

const app = await electron.launch({
  args: [appEntry, `--user-data-dir=${userDataDir}`, '--ozone-platform=x11'],
  env: { ...process.env, CUERUNNER_LICENSE_PUBLIC_KEY: publicKey.export({ type: 'spki', format: 'pem' }).toString() }
})
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900))

const prefix = licensed ? '' : 'free-'
const shot = async (file, selector) => {
  try {
    const target = selector ? page.locator(selector).first() : page
    await target.screenshot({ path: path.join(outDir, prefix + file), scale: 'css', timeout: 5000 })
    console.log(`  ${prefix}${file}`)
  } catch (err) {
    console.log(`  ! ${file}: ${err.message.split('\n')[0]}`)
  }
}
const tryDo = async (label, fn) => {
  try { await fn() } catch (err) { console.log(`  ! ${label}: ${err.message.split('\n')[0]}`) }
}

await shot('00-empty.png')

await page.locator('.toolbar-brand').click()
await shot('00-file-menu.png')
await page.locator('.file-menu button', { hasText: 'Open Demo Workspace' }).click()
await page.locator('.cue-row', { hasText: 'Walk-in Music' }).waitFor()

const selectCue = name => page.locator('.cue-row', { hasText: name }).first().click()
const openTab = name => page.locator('.inspector-tab', { hasText: name }).first().click()

await selectCue('Walk-in Music')
await shot('01-window.png')

const cues = [
  ['Walk-in Music', 'audio'], ['Act 1', 'group'], ['Count 8', 'wait'], ['Strings Patch', 'midi'],
  ['LX Cue 12', 'osc'], ['Trigger Video', 'network'], ['Fade Walk-in', 'fade'],
  ['House Lights', 'script'], ['End of Show', 'stop']
]
for (const [name, type] of cues) {
  await tryDo(name, async () => {
    await selectCue(name)
    const tabs = await page.locator('.inspector-tab').allTextContents()
    for (const [i, t] of tabs.entries()) {
      await page.locator('.inspector-tab').nth(i).click()
      await page.waitForTimeout(80)
      await shot(`10-insp-${type}-${i}-${t.replace(/[^a-z]+/gi, '').toLowerCase()}.png`, '.inspector')
    }
  })
}

await selectCue('Walk-in Music')
await shot('02-context-bar.png', '.context-bar')
await shot('03-transport.png', '.transport-bar')
await shot('04-toolbar.png', '.toolbar')

await tryDo('context', async () => {
  const row = page.locator('.cue-row', { hasText: 'Count 8' })
  await row.scrollIntoViewIfNeeded()
  await page.waitForTimeout(250)
  await row.click({ button: 'right' })
  await shot('05-context-menu.png', '.cue-context-menu')
  await page.keyboard.press('Escape')
})

// Dock panels.
await page.evaluate(() => (document.querySelector('.dock').style.height = '360px'))
for (const [cls, name] of [['btn-cue', 'cue'], ['btn-log', 'log'], ['btn-monitor', 'monitor'], ['btn-rf', 'wireless'], ['btn-script', 'script']]) {
  await tryDo(name, async () => {
    await page.locator(`.${cls}`).click()
    await page.waitForTimeout(150)
    if (name === 'wireless' && licensed) {
      await page.locator('.rf-demo-btn').click().catch(() => {})
      await page.waitForTimeout(300)
    }
    await shot(`20-dock-${name}.png`, '.dock')
  })
}
await tryDo('rf report', async () => {
  await page.locator('.btn-rf').click()
  await page.locator('.rf-mode').click()
  await page.waitForTimeout(150)
  await shot('20-dock-wireless-report.png', '.dock')
  await page.locator('.rf-mode').click()
})

// Settings, every tab.
await page.keyboard.press('Control+,')
await page.locator('.settings-dialog').waitFor()
const settingsTabs = await page.locator('.settings-tab').allTextContents()
for (const [i, t] of settingsTabs.entries()) {
  await page.locator('.settings-tab').nth(i).click()
  await page.waitForTimeout(150)
  await shot(`30-settings-${i}-${t.toLowerCase()}.png`, '.settings-dialog')
}
await page.keyboard.press('Escape')

// Show settings, every tab.
await tryDo('show settings', async () => {
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu button[data-action="show-settings"]').click()
  await page.locator('.show-settings-dialog').waitFor()
  const tabLoc = page.locator('.show-settings-tab')
  const n = await tabLoc.count()
  for (let i = 0; i < n; i++) {
    await tabLoc.nth(i).click()
    await page.waitForTimeout(150)
    await shot(`40-show-${i}.png`, '.show-settings-dialog')
  }
  await page.locator('.show-settings-close').click()
})

// Scenes view.
await tryDo('scenes', async () => {
  await page.locator('.toolbar-view-btn', { hasText: 'Scenes' }).click()
  await page.waitForTimeout(200)
  await shot('50-scenes.png')
  await page.locator('.matrix-lock, .matrix-empty-action').first().click().catch(() => {})
  await page.locator('.matrix-add-scene').click().catch(() => {})
  await page.waitForTimeout(150)
  await shot('51-scenes-unlocked.png')
  await page.locator('.toolbar-view-btn', { hasText: 'Cues' }).click()
})

await app.evaluate(({ app: electronApp }) => electronApp.exit(0))
// The app is still letting go of its own files as this runs, so the temporary profile is
// removed with retries rather than once, hopefully.
fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
console.log('Done.')
