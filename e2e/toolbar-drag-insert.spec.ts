// A cue type dragged off the toolbar lands where it is let go: between two cues, at the top
// of the list, or into an open group — not after whatever happens to be selected.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp, toolbarCueBtn } from './helpers'

let app: ElectronApplication
let page: Page

test.beforeEach(async () => {
  ;({ app, page } = await launchApp())
})

test.afterEach(async () => {
  await closeApp(app)
})

/** The rows' types, top to bottom, with a group's children marked by their depth. */
async function shape(): Promise<string[]> {
  return page.$$eval('.cue-row', rows => rows.map(row =>
    `${row.getAttribute('data-depth') === '1' ? '  ' : ''}${row.getAttribute('data-type')}`))
}

/** Drags a toolbar button onto the top or bottom half of a row, the way a hand does it. */
async function dragButton(label: string, rowIndex: number, edge: 'top' | 'bottom'): Promise<void> {
  const button = toolbarCueBtn(page, label)
  const from = (await button.boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 2 + 4, from.y + from.height / 2 + 10, { steps: 4 })
  const box = (await page.locator('.cue-row').nth(rowIndex).boundingBox())!
  const y = edge === 'top' ? box.y + 4 : box.y + box.height - 4
  await page.mouse.move(box.x + box.width / 2, y, { steps: 12 })
  // A hand comes to rest with a last small movement; the browser reads the position the drag
  // is over on a move, not on the arrival.
  await page.mouse.move(box.x + box.width / 2 + 2, y + 1)
  await expect(page.locator('.cue-drop-indicator')).toBeVisible()
  await page.mouse.up()
}

test('a cue dragged between two others lands between them, numbered next and selected', async () => {
  await toolbarCueBtn(page, 'Wait').click()
  await toolbarCueBtn(page, 'Wait').click()
  // The selection is on the last wait: a click would add after it, the drag does not.
  await dragButton('Fade', 1, 'top')

  expect(await shape()).toEqual(['wait', 'fade', 'wait'])
  const fade = page.locator('.cue-row').nth(1)
  await expect(fade.locator('.cue-number')).toHaveText('3')
  await expect(fade).toHaveAttribute('data-selected', 'true')
  await expect(page.locator('.cue-drop-indicator')).toHaveCount(0)
})

test('a cue dragged to the top half of the first row goes in front of the whole show', async () => {
  await toolbarCueBtn(page, 'Wait').click()
  await dragButton('Stop', 0, 'top')
  expect(await shape()).toEqual(['stop', 'wait'])
})

test('a cue dragged under an open group’s header becomes its first child', async () => {
  await toolbarCueBtn(page, 'Group').click()
  // Added with the group selected, the wait is the group's child.
  await toolbarCueBtn(page, 'Wait').click()
  expect(await shape()).toEqual(['group', '  wait'])

  await dragButton('Fade', 1, 'top')
  expect(await shape()).toEqual(['group', '  fade', '  wait'])
})

test('a drag let go outside the list adds nothing and leaves no line behind', async () => {
  await toolbarCueBtn(page, 'Wait').click()
  const button = toolbarCueBtn(page, 'Fade')
  const from = (await button.boundingBox())!
  const row = (await page.locator('.cue-row').first().boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(row.x + row.width / 2, row.y + 4, { steps: 10 })
  await page.mouse.move(row.x + row.width / 2 + 2, row.y + 5)
  await expect(page.locator('.cue-drop-indicator')).toBeVisible()
  // Back to the toolbar, and let go there.
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2, { steps: 10 })
  await page.mouse.up()

  await expect(page.locator('.cue-drop-indicator')).toHaveCount(0)
  expect(await shape()).toEqual(['wait'])
})
