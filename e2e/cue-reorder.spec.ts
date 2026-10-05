// Mouse reordering of cues (HTML5 drag & drop over the virtualized list).
// Each scenario needs a clean cue list, so every test launches its own app.
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

// Visible rows as `${depth}${'G' if group}` so order and nesting are both asserted,
// e.g. ['0G', '1 ', '1 ', '0 '].
async function rowShapes(): Promise<string[]> {
  return page.$$eval('.cue-row', els =>
    els.map(e => `${e.getAttribute('data-depth')}${e.querySelector('.group-toggle') ? 'G' : ' '}`)
  )
}

// Drag row `fromIndex` onto the top/bottom half of another row, or into the empty gap
// below the list. The drop half decides the insertion index and the parent, so the
// exact pointer position matters here.
async function dragRow(fromIndex: number, target: { index: number; edge: 'top' | 'bottom' } | 'gap') {
  const from = (await page.locator('.cue-row').nth(fromIndex).boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 + 8, { steps: 5 })

  if (target === 'gap') {
    const scroll = (await page.locator('.cue-list-scroll').boundingBox())!
    await page.mouse.move(scroll.x + scroll.width / 2, scroll.y + scroll.height - 6, { steps: 10 })
  } else {
    const box = (await page.locator('.cue-row').nth(target.index).boundingBox())!
    const y = target.edge === 'top' ? box.y + 4 : box.y + box.height - 4
    await page.mouse.move(box.x + box.width / 2, y, { steps: 10 })
  }

  await page.mouse.up()
  await page.waitForTimeout(150)
}

test('dragging a group carries its children along', async () => {
  await toolbarCueBtn(page, 'Wait').click()
  await toolbarCueBtn(page, 'Group').click()
  await toolbarCueBtn(page, 'Wait').click()
  await toolbarCueBtn(page, 'Wait').click()
  expect(await rowShapes()).toEqual(['0 ', '0G', '1 ', '1 '])

  await dragRow(1, { index: 0, edge: 'top' })

  // The group lands above the wait with both children still inside it.
  expect(await rowShapes()).toEqual(['0G', '1 ', '1 ', '0 '])
})

test('dragging a group below its own subtree leaves it in place', async () => {
  await toolbarCueBtn(page, 'Group').click()
  await toolbarCueBtn(page, 'Wait').click()
  expect(await rowShapes()).toEqual(['0G', '1 '])

  await dragRow(0, { index: 1, edge: 'bottom' })

  expect(await rowShapes()).toEqual(['0G', '1 '])
})

test('reordering a collapsed group keeps the group and its children', async () => {
  await toolbarCueBtn(page, 'Group').click()
  await toolbarCueBtn(page, 'Wait').click()
  await page.locator('.group-toggle').first().click()
  expect(await rowShapes()).toEqual(['0G'])

  await dragRow(0, 'gap')

  expect(await rowShapes()).toEqual(['0G'])
  expect(page.locator('.cue-list-empty')).toHaveCount(0)

  await page.locator('.group-toggle').first().click()
  expect(await rowShapes()).toEqual(['0G', '1 '])
})

test('dropping into the gap below the list lands at the top level, not in the group above', async () => {
  await toolbarCueBtn(page, 'Wait').click()
  await toolbarCueBtn(page, 'Group').click()
  await toolbarCueBtn(page, 'Wait').click()
  expect(await rowShapes()).toEqual(['0 ', '0G', '1 '])

  // The gap under the last row is the end of the list. A drop there that joined the
  // group above would leave that group's child with no place below it to be dragged to:
  // the space under the last row is the only aim point there is.
  await dragRow(2, 'gap')

  expect(await rowShapes()).toEqual(['0 ', '0G', '0 '])
})

// The list's file-drop hint is raised and lowered by counting drag enters and leaves, and a
// reorder used to be counted too: its drop is taken by the list before the container sees
// it, so every reorder left the count one high. The next file dragged over the list and
// away again left "Drop audio files to create cues" over a dimmed list until a file was
// actually dropped.
test('a file dragged over the list and away leaves no drop hint behind, after a reorder', async () => {
  await toolbarCueBtn(page, 'Wait').click()
  await toolbarCueBtn(page, 'Wait').click()
  await toolbarCueBtn(page, 'Wait').click()
  const numbers = (): Promise<string[]> => page.locator('.cue-number').allTextContents()
  expect(await numbers()).toEqual(['1', '2', '3'])

  // A real reorder, by the mouse: this is what left the count high.
  await dragRow(0, { index: 2, edge: 'bottom' })
  expect(await numbers()).toEqual(['2', '3', '1'])

  // A file from the desktop cannot be dragged by the suite, so the two events the list
  // hears from one are sent to it: over the list, and away again without a drop.
  const during = await page.evaluate(() => {
    const list = document.querySelector('.cue-list-container')
    if (list === null) throw new Error('no cue list on screen')
    const data = new DataTransfer()
    data.items.add(new File(['RIFF'], 'sting.wav', { type: 'audio/wav' }))
    list.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: data }))
    return new Promise<boolean>(resolve => requestAnimationFrame(() => {
      const up = document.querySelector('.cue-list-drop-hint') !== null
      list.dispatchEvent(new DragEvent('dragleave', { bubbles: true, cancelable: true, dataTransfer: data }))
      resolve(up)
    }))
  })
  // The hint did come up — otherwise its absence below would prove nothing.
  expect(during).toBe(true)

  await expect(page.locator('.cue-list-drop-hint')).toHaveCount(0)
  await expect(page.locator('.cue-list-container')).toHaveAttribute('data-drag-over', 'false')
})
