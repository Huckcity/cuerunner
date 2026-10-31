// The mic plot as a tool rather than a read-out: an operator enters the plot in Show
// Settings, a pack changes hands mid-show, and the night's report says who was wearing
// what.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp, openShowSettings } from './helpers'

let app: ElectronApplication
let page: Page

test.beforeEach(async () => {
  ;({ app, page } = await launchApp())
})

test.afterEach(async () => {
  await closeApp(app)
})

/** The demo rack gives the editor a live rack to patch against, and the panel stays open. */
async function liveRack(): Promise<void> {
  await page.locator('.btn-rf').click()
  await page.locator('.rf-demo-btn').click()
  await expect(page.locator('.rf-row')).toHaveCount(12)
}

test('an operator enters the plot, and the panel follows it', async () => {
  await liveRack()
  await openShowSettings(page, 'mic-plot')

  const dialog = page.locator('.show-settings-dialog')
  await expect(dialog).toBeVisible()

  // A channel can be picked from what is reporting rather than typed from memory.
  const channel = dialog.locator('.plot-pack-row').first().locator('.plot-channel')
  await expect(channel).toHaveAttribute('list', 'plot-channels')
  // Polled: the list is what the rack has reported, and under a loaded run the first
  // poll can land after the dialog opens.
  await expect.poll(() => dialog.locator('#plot-channels option').evaluateAll(
    nodes => nodes.map(node => (node as HTMLOptionElement).value)
  )).toContain('demo-pack-1')
  await dialog.locator('.show-settings-done').click()

  // Renaming a performer is the Cast tab's, not the plot's: the plot only says who is
  // currently wearing what.
  await openShowSettings(page, 'cast')
  const cast = page.locator('.show-settings-dialog')
  const name = cast.locator('.performer-row').first().locator('.performer-name')
  await name.fill('Aldonza Test')
  await name.blur()
  await cast.locator('.show-settings-done').click()

  await expect(page.locator('.rf-panel')).toContainText('Aldonza Test')
})

test('a pack changing hands is recorded, logged and reported', async () => {
  await liveRack()
  await openShowSettings(page, 'mic-plot')

  const dialog = page.locator('.show-settings-dialog')
  const firstPack = dialog.locator('.plot-pack-row').first()
  const assignment = firstPack.locator('.plot-pack-performer')

  // The demo's first pack belongs to Aldonza; hand it to the second performer.
  const options = await assignment.locator('option').evaluateAll(
    nodes => nodes.map(node => ({ value: (node as HTMLOptionElement).value, label: node.textContent }))
  )
  const second = options.filter(option => option.value !== '')[1]
  await assignment.selectOption(second.value)

  // The record is visible where it was made, and the run log has it for the timeline.
  await expect(dialog.locator('.plot-swaps')).toContainText('→')
  await dialog.locator('.show-settings-done').click()
  await page.locator('.btn-log').click()
  await expect(page.locator('.log-panel')).toContainText('Swap: Pack 1')

  // The strips share the bottom of the window, so the wireless panel has to come back
  // before its report can be read.
  await page.locator('.btn-rf').click()
  await page.locator('.rf-mode').click()
  const report = page.locator('.rf-report-row').first()
  await expect(report).toContainText(second.label ?? '')
  await expect(report).toContainText('lowest')
  await expect(report).toContainText('1 swap')
})
