// What the window says, and how it lines up: shortcut labels written for this keyboard,
// one icon column, a header that reads as words, and an empty list that says so where
// the list is.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { addCueFromMoreMenu, closeApp, launchApp, mintLicense, toolbarCueBtn, unreadableText } from './helpers'

let app: ElectronApplication
let page: Page

test.beforeEach(async ({}, testInfo) => {
  // A scene cue is the licensed half of the app; the rest is not.
  const licensed = testInfo.title.includes('scene cue')
  ;({ app, page } = await launchApp(licensed ? { license: mintLicense() } : {}))
})

test.afterEach(async () => {
  await closeApp(app)
})

const mac = process.platform === 'darwin'

test('shortcuts are labelled for the keyboard this machine has', async () => {
  await page.locator('.toolbar-brand').click()
  const menu = page.locator('.file-menu')
  await expect(menu.locator('button', { hasText: 'Save As…' }).locator('kbd'))
    .toHaveText(mac ? '⇧⌘S' : 'Ctrl+Shift+S')
  await expect(menu.locator('button', { hasText: 'New' }).locator('kbd'))
    .toHaveText(mac ? '⌘N' : 'Ctrl+N')
  await page.keyboard.press('Escape')
  await page.mouse.click(600, 400)

  await toolbarCueBtn(page, 'Wait').click()
  await page.locator('.cue-row').first().click({ button: 'right' })
  await expect(page.locator('.cue-context-menu-item', { hasText: 'Duplicate' }).locator('kbd'))
    .toHaveText(mac ? '⌘D' : 'Ctrl+D')

  await expect(page.locator('.transport-keys')).toContainText('Space go')
})

test('every row keeps its type icon in one column, a group included', async () => {
  await toolbarCueBtn(page, 'Group').click()
  await toolbarCueBtn(page, 'Wait').click()

  // A group's icon is the chevron that opens it, so it is in the same slot as the rest.
  const icons = page.locator('.cue-row .col-num .cue-type-icon')
  await expect(icons).toHaveCount(2)
  await expect(page.locator('.cue-row .col-name .cue-type-icon')).toHaveCount(0)

  // The child row is indented as a child; within its number column, the icon sits in
  // the same slot as the group's.
  const [group, child] = await icons.evaluateAll(nodes =>
    nodes.map(node => node.getBoundingClientRect().left -
      node.closest('.col-num')!.getBoundingClientRect().left))
  expect(Math.round(child)).toBe(Math.round(group))
})

test('a scene cue has a drawing of its own, not a group’s', async () => {
  await addCueFromMoreMenu(page, 'Scene')
  const scene = page.locator('.cue-row .cue-type-icon').first()
  await expect(scene).toHaveAttribute('data-type', 'scene')
  await toolbarCueBtn(page, 'Group').click()
  // The group row's slot holds the chevron, which says group as well as opening it.
  const group = page.locator('.cue-row .cue-type-icon').nth(1)
  await expect(group).toHaveAttribute('data-type', 'group')
  await expect(group).toHaveClass(/group-chevron/)
  await expect(scene).not.toHaveClass(/group-chevron/)
})

test('the list header is dim words with room between them', async () => {
  const header = page.locator('.cue-list-header')
  const color = (selector: string) =>
    header.locator(selector).evaluate(node => getComputedStyle(node).color)
  expect(await color('.col-adv')).toBe(await color('.col-dur'))

  const post = await header.locator('.col-post').boundingBox()
  // The heading's words, not its resize handle, which reaches back into the gap on purpose.
  const adv = await header.locator('.col-adv .column-label').evaluate(node => {
    const range = document.createRange()
    range.selectNodeContents(node)
    return range.getBoundingClientRect().left
  })
  expect(adv - (post!.x + post!.width)).toBeGreaterThanOrEqual(12)
})

test('an empty list says so in the middle of the list', async () => {
  const list = await page.locator('.cue-list-container').boundingBox()
  const hint = await page.locator('.cue-list-empty div').first().boundingBox()
  const middle = list!.y + list!.height / 2
  expect(Math.abs(hint!.y + hint!.height / 2 - middle)).toBeLessThan(60)
})

test('every tone the window writes in is readable on the panel behind it', async () => {
  // scripts/theme.test.ts holds the tokens to 4.5:1. This holds the window itself to it:
  // a token is only readable if the element that uses it is drawn on the surface the
  // token was measured against, and a hardcoded colour or an unexpected parent is how
  // that stops being true.
  await toolbarCueBtn(page, 'Audio').click()
  await toolbarCueBtn(page, 'Group').click()

  const failures = await unreadableText(page)

  expect(failures, failures.join('\n')).toEqual([])
})
