// Playlist groups fire one child per GO. The discriminator against Sequence mode is
// that a step never drags the following child along with it.
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

// Group with two Wait children (default duration 2s), set to playlist mode.
async function buildPlaylist(p: Page) {
  await toolbarCueBtn(p, 'Group').click()
  await toolbarCueBtn(p, 'Wait').click()
  await toolbarCueBtn(p, 'Wait').click()
  await p.locator('.cue-row').first().click()
  await p.locator('.inspector-tab', { hasText: 'Group' }).click()
  await p.locator('.inspector select').selectOption('playlist')
}

test('a playlist group fires one child per GO, then hands the selection over', async () => {
  await buildPlaylist(page)

  const group = page.locator('.cue-row').first()
  const children = page.locator('.cue-row[data-depth="1"]')
  await expect(children).toHaveCount(2)

  await page.getByRole('button', { name: /GO/ }).click()

  // The group keeps the selection so the next GO steps it
  await expect(group).toHaveAttribute('data-selected', 'true')
  await expect(children.nth(0)).toHaveAttribute('data-running', 'true')

  // Once the first child finishes nothing follows it. In sequence mode the second
  // child would already be running by now.
  await expect(children.nth(0)).toHaveAttribute('data-running', 'false', { timeout: 6000 })
  await page.waitForTimeout(400)
  await expect(children.nth(1)).toHaveAttribute('data-running', 'false')
  await expect(group).toHaveAttribute('data-selected', 'true')

  // The second GO fires the second child, and the group then hands over
  await page.getByRole('button', { name: /GO/ }).click()
  await expect(children.nth(1)).toHaveAttribute('data-running', 'true')

  await expect(children.nth(1)).toHaveAttribute('data-running', 'false', { timeout: 6000 })
  await expect(page.locator('.cue-row[data-selected="true"]')).toHaveCount(0)
})

test('STOP returns a playlist group to its first child', async () => {
  await buildPlaylist(page)

  const children = page.locator('.cue-row[data-depth="1"]')

  await page.getByRole('button', { name: /GO/ }).click()
  await expect(children.nth(0)).toHaveAttribute('data-running', 'true')
  await expect(children.nth(0)).toHaveAttribute('data-running', 'false', { timeout: 6000 })

  await page.getByRole('button', { name: /STOP/ }).click()
  await page.getByRole('button', { name: /GO/ }).click()

  // Back to the first child, not the second
  await expect(children.nth(0)).toHaveAttribute('data-running', 'true')
})
