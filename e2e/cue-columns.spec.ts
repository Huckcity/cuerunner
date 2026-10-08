// The cue list's columns, arranged by the operator: a notes column shown from the header's
// menu, a column dragged to another place, one sized by its edge — and the layout still there
// after the window is reloaded, because it is this machine's and not the show's.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp, toolbarCueBtn } from './helpers'

let app: ElectronApplication
let page: Page

test.beforeEach(async () => {
  ;({ app, page } = await launchApp())
  await toolbarCueBtn(page, 'Wait').click()
})

test.afterEach(async () => {
  await closeApp(app)
})

const heading = (column: string) => page.locator(`.cue-list-header [data-column="${column}"]`)

async function x(locator: ReturnType<typeof heading>): Promise<number> {
  return (await locator.boundingBox())!.x
}

test('the header’s menu shows a notes column, which reads each cue’s first note line', async () => {
  await expect(page.locator('.cue-row .col-notes')).toBeHidden()
  await page.locator('.inspector textarea').fill('Stand by LX\nthen house')

  await page.locator('.cue-list-header').click({ button: 'right' })
  await page.locator('.column-menu-item', { hasText: 'Notes' }).locator('input').check()
  await page.keyboard.press('Escape')
  await expect(page.locator('.column-menu')).toHaveCount(0)
  // The Escape closed the menu and stopped nothing.

  await expect(page.locator('.cue-row .col-notes')).toHaveText('Stand by LX')
  await expect(heading('notes')).toBeVisible()

  // The machine's layout, not the show's: it is there after a reload.
  await page.reload()
  await expect(heading('notes')).toBeVisible()
})

test('a heading dragged in front of another takes its column with it, header and rows alike', async () => {
  expect(await x(heading('adv'))).toBeGreaterThan(await x(heading('dur')))
  await heading('adv').dragTo(heading('dur'), { targetPosition: { x: 4, y: 6 } })
  expect(await x(heading('adv'))).toBeLessThan(await x(heading('dur')))
  const row = page.locator('.cue-row').first()
  expect((await row.locator('.col-adv').boundingBox())!.x).toBeLessThan((await row.locator('.col-dur').boundingBox())!.x)
})

test('a heading’s edge sizes its column, and Reset columns puts the list back', async () => {
  const before = (await heading('pre').boundingBox())!.width
  const handle = (await heading('pre').locator('.column-resize').boundingBox())!
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  await page.mouse.move(handle.x + handle.width / 2 - 40, handle.y + handle.height / 2, { steps: 5 })
  await page.mouse.up()
  const after = (await heading('pre').boundingBox())!.width
  expect(after).toBeGreaterThan(before + 30)
  const cell = (await page.locator('.cue-row .col-pre').first().boundingBox())!.width
  expect(Math.abs(cell - after)).toBeLessThan(2)

  await page.locator('.cue-list-header').click({ button: 'right' })
  await page.locator('.column-menu-reset').click()
  expect(Math.abs((await heading('pre').boundingBox())!.width - before)).toBeLessThan(2)
})
