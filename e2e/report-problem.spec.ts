// Report a Problem: the report is built by the real main process, shown in full, and leaves
// only by the operator's hand. Save writes the file they name, Email puts the report on the
// clipboard and asks the mail program for a message to the support address, and nothing is
// sent by the app itself.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { closeApp, launchApp } from './helpers'

let app: ElectronApplication
let page: Page

test.beforeEach(async () => {
  ;({ app, page } = await launchApp())
})

test.afterEach(async () => {
  await closeApp(app)
})

async function openReport(): Promise<void> {
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu button[data-action="report-problem"]').click()
  await expect(page.getByRole('dialog', { name: 'Report a Problem' })).toBeVisible()
}

const reportText = () => page.locator('.report-text')

test('the report shows this build, this machine and the engine before anything is pressed', async () => {
  await openReport()

  await expect(reportText()).toContainText('CUERUNNER PROBLEM REPORT')
  await expect(reportText()).toContainText('Nothing has been sent anywhere.')
  await expect(reportText()).toContainText(`${process.platform} ${process.arch}`)
  await expect(reportText()).toContainText('AUDIO ENGINE')
})

test('what is written under "What happened" is in the report, and the home folder is not', async () => {
  await openReport()
  const home = await app.evaluate(({ app: electronApp }) => electronApp.getPath('home'))

  await page.locator('#report-description').fill(`It stopped. My file is ${home}/Music/walk-in.wav`)

  await expect(reportText()).toContainText('It stopped.')
  await expect(reportText()).toContainText('~/Music/walk-in.wav')
  await expect(reportText()).not.toContainText(home)
})

test('a description that is markup is shown as text and runs nothing', async () => {
  await openReport()
  const hostile = '<img src=x onerror="document.title=\'pwned\'"><script>document.title=\'pwned\'</script>'

  await page.locator('#report-description').fill(hostile)

  await expect(reportText()).toContainText(hostile)
  await expect(page.locator('.report-text img, .report-text script')).toHaveCount(0)
  expect(await page.title()).not.toBe('pwned')
})

test('Save writes the text that was shown to the file the operator names', async () => {
  const target = path.join(mkdtempSync(path.join(tmpdir(), 'cuerunner-report-')), 'report.txt')
  await app.evaluate(async ({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, target)
  await openReport()
  await page.locator('#report-description').fill('save me')
  await expect(reportText()).toContainText('save me')
  const shown = (await reportText().textContent()) ?? ''

  await page.getByRole('button', { name: 'Save…' }).click()

  await expect(page.locator('.report-status')).toContainText('Saved to')
  expect(readFileSync(target, 'utf8')).toBe(shown)
})

test('cancelling the save dialog writes nothing and says nothing was saved', async () => {
  await app.evaluate(async ({ dialog }) => {
    dialog.showSaveDialog = async () => ({ canceled: true, filePath: '' })
  })
  await openReport()
  await expect(reportText()).toContainText('CUERUNNER PROBLEM REPORT')

  await page.getByRole('button', { name: 'Save…' }).click()

  await expect(page.locator('.report-status')).toHaveText('')
})

test('Email puts the report on the clipboard and opens a message to the support address', async () => {
  await app.evaluate(({ shell }) => {
    const opened: string[] = []
    ;(globalThis as Record<string, unknown>).__opened = opened
    shell.openExternal = async (url: string) => { opened.push(url) }
  })
  await openReport()
  await page.locator('#report-description').fill('mail me')
  await expect(reportText()).toContainText('mail me')
  const shown = (await reportText().textContent()) ?? ''

  await page.getByRole('button', { name: 'Email…' }).click()
  await expect(page.locator('.report-status')).toContainText('On the clipboard')

  const opened = await app.evaluate(() => (globalThis as Record<string, unknown>).__opened as string[])
  expect(opened).toHaveLength(1)
  expect(opened[0].startsWith('mailto:orders@cuerunner.app?')).toBe(true)
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(shown)
})

test('Escape closes it and gives the keyboard back to the show', async () => {
  await openReport()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Report a Problem' })).toHaveCount(0)
})

