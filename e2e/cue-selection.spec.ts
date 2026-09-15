// Selection behaviour of the cue list. Each test launches its own app so it starts
// from an empty cue list (selection is app state, not per-test state).
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp, closeApp, toolbarCueBtn } from './helpers'

let app: ElectronApplication
let page: Page

test.beforeEach(async () => {
  ;({ app, page } = await launchApp())
})

test.afterEach(async () => {
  await closeApp(app)
})

// Visible rows as `${depth}${'G' if group}`, e.g. ['0G', '1 ', '0 '].
async function rowShapes(): Promise<string[]> {
  return page.$$eval('.cue-row', els =>
    els.map(e => `${e.getAttribute('data-depth')}${e.querySelector('.group-toggle') ? 'G' : ' '}`)
  )
}

// Clicks the empty space below the last cue row.
async function clickEmptyListSpace() {
  await page.locator('.cue-list-scroll').click({ position: { x: 60, y: 200 } })
}

test('clicking below the cues clears the selection', async () => {
  await toolbarCueBtn(page, 'Wait').click()
  await expect(page.locator('.cue-row[data-selected="true"]')).toHaveCount(1)

  await clickEmptyListSpace()

  await expect(page.locator('.cue-row[data-selected="true"]')).toHaveCount(0)
  await expect(page.locator('.inspector-empty')).toBeVisible()
})

test('Escape stops the show and leaves the selection where it is', async () => {
  await toolbarCueBtn(page, 'Wait').click()
  const row = page.locator('.cue-row').first()
  await row.click()

  // Long enough that nothing but the Escape can have ended it.
  await page.locator('.inspector-tab', { hasText: 'Wait' }).click()
  const duration = page.locator('.field-row').filter({ hasText: 'Duration' }).locator('input')
  await duration.fill('30000')
  await duration.press('Enter')
  await page.getByRole('button', { name: /GO/ }).click()
  await expect(row).toHaveAttribute('data-running', 'true')

  // GO moves the selection on, and there is nothing after this cue: the operator puts
  // their hand back on the row they are watching, which is where the panel below the
  // list — the waveform the show is being read from — is drawn from.
  await row.click()
  await expect(row).toHaveAttribute('data-selected', 'true')

  // Escape is the show's press.
  await page.locator('.cue-list-container').press('Escape')

  await expect(row).not.toHaveAttribute('data-running', 'true')
  await expect(row).toHaveAttribute('data-selected', 'true')
})

test('cues created after deselecting a group are top-level', async () => {
  // A new group is selected, so the next cue lands inside it...
  await toolbarCueBtn(page, 'Group').click()
  await toolbarCueBtn(page, 'Wait').click()
  expect(await rowShapes()).toEqual(['0G', '1 '])

  // ...until the selection is dropped: the next cue goes to the end of the list.
  await clickEmptyListSpace()
  await toolbarCueBtn(page, 'Wait').click()

  expect(await rowShapes()).toEqual(['0G', '1 ', '0 '])
})

test('Escape while renaming cancels the rename and keeps the selection', async () => {
  await toolbarCueBtn(page, 'Wait').click()
  const row = page.locator('.cue-row').first()
  await row.click()
  await row.dblclick()
  await page.locator('.name-edit').fill('Discard me')
  await page.locator('.name-edit').press('Escape')

  await expect(page.locator('.name-edit')).toHaveCount(0)
  await expect(row.locator('.name-text')).not.toContainText('Discard me')
  await expect(row).toHaveAttribute('data-selected', 'true')
})
