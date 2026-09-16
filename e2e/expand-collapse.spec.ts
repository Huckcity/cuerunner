// Expand all / collapse all, top level only (ROADMAP R5).
//
// A long show is a list of groups, and folding them away is the only way to see its
// shape. The two presses are the whole of it: Expand opens the groups at the top level
// and leaves the ones nested inside them as the operator left them — opening everything
// to reach the top level would take away a decision somebody made — and Collapse closes
// every group, because a half-collapsed list is not a reading of anything.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp, toolbarCueBtn } from './helpers'

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  ;({ app, page } = await launchApp())

  // An outer group holding an inner group and a wait of its own, and a wait inside the
  // inner group: four rows, two of them headers.
  await toolbarCueBtn(page, 'Group').click()
  await toolbarCueBtn(page, 'Group').click()
  await toolbarCueBtn(page, 'Wait').click()
  await page.locator('.cue-row').first().click()
  await toolbarCueBtn(page, 'Wait').click()
  await expect(page.locator('.cue-row')).toHaveCount(4)
})

test.afterAll(async () => {
  await closeApp(app)
})

function rows() {
  return page.locator('.cue-row')
}

/** The two group headers, in the order they are drawn — outer first, inner second. */
function groups() {
  return page.locator('.cue-row:has(.group-toggle)')
}

/** Whether each group is open, by its chevron. Read through a retrying assertion, because
 *  a one-shot read of a re-rendering list is a race the runners will lose. */
function chevrons() {
  return groups().locator('.group-chevron')
}

function expand() {
  return page.locator('.toolbar-list-btn', { hasText: 'Expand' })
}

function collapse() {
  return page.locator('.toolbar-list-btn', { hasText: 'Collapse' })
}

test('Expand opens the top level and leaves the nested group as it was', async () => {
  // Fold the inner group first, then the outer: one fold is the top level's business,
  // the other is somebody's decision about the group inside it.
  await groups().nth(1).locator('.group-toggle').click()
  await groups().nth(0).locator('.group-toggle').click()
  await expect(rows()).toHaveCount(1)

  await expand().click()

  // The outer group is open again — 3 rows of its 4 — and the inner one is still folded.
  await expect(rows()).toHaveCount(3)
  await expect(chevrons().nth(0)).toHaveAttribute('data-open', 'true')
  await expect(chevrons().nth(1)).toHaveAttribute('data-open', 'false')
})

test('Collapse closes every group, and Expand opens the top level again', async () => {
  await collapse().click()

  // Everything folded: one row, whatever is inside anything.
  await expect(rows()).toHaveCount(1)

  // Expand opens the top level only, so the inner group is a row again and its wait is
  // still hidden.
  await expand().click()
  await expect(rows()).toHaveCount(3)
  await expect(chevrons().nth(0)).toHaveAttribute('data-open', 'true')
  await expect(chevrons().nth(1)).toHaveAttribute('data-open', 'false')
})

test('Expand leaves a nested group the operator opened by hand open', async () => {
  // Open the inner group by hand, then fold the outer one around it: what the operator
  // chose is still the choice when the top level is opened again.
  await groups().nth(1).locator('.group-toggle').click()
  await expect(rows()).toHaveCount(4)
  await groups().nth(0).locator('.group-toggle').click()
  await expect(rows()).toHaveCount(1)

  await expand().click()

  await expect(rows()).toHaveCount(4)
  await expect(chevrons().nth(0)).toHaveAttribute('data-open', 'true')
  await expect(chevrons().nth(1)).toHaveAttribute('data-open', 'true')
})