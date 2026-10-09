// The toolbar's controls stay inside the window.
//
// The toolbar is one row that does not wrap, in a window that clips rather than scrolls,
// and the rightmost thing in it — the Cues/Scenes switch — is what an operator reaches for
// to run the show. Two things pushed it off the edge. The row at its full spacing was
// wider than the smallest window the app allows, so at that size "Scenes" was cut in half
// and "More" wrapped onto two lines; and the show's name was drawn at whatever length it
// had, so a long one pushed the switch out of a window of any size.
//
// Both are read here off the real window: where each control's edges are against the
// window's own, at the sizes the app permits.
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

interface Edge {
  what: string
  left: number
  right: number
  height: number
}

/** Every control in the toolbar, with where it is, and the width of the window it is in. */
async function toolbarEdges(): Promise<{ windowWidth: number; controls: Edge[] }> {
  return page.evaluate(() => {
    const controls = [...document.querySelectorAll<HTMLElement>(
      '.toolbar-brand, .toolbar-cue-btn, .toolbar-more-btn, .toolbar-list-btn, .toolbar-view-btn'
    )].map(control => {
      const box = control.getBoundingClientRect()
      return {
        what: (control.textContent ?? '').trim(),
        left: Math.round(box.left),
        right: Math.round(box.right),
        height: Math.round(box.height)
      }
    })
    return { windowWidth: window.innerWidth, controls }
  })
}

async function expectEveryControlOnScreen(): Promise<void> {
  const { windowWidth, controls } = await toolbarEdges()
  // The whole row is there to be measured: the file menu, five cue types and More, the
  // list's two, and all three views.
  expect(controls.map(control => control.what)).toEqual(expect.arrayContaining(['Audio', 'Stop', 'Collapse', 'Cues']))
  expect(controls).toHaveLength(12)
  for (const control of controls) {
    expect(control.left, `${control.what} starts inside the window`).toBeGreaterThanOrEqual(0)
    expect(control.right, `${control.what} ends inside a window ${windowWidth}px wide`).toBeLessThanOrEqual(windowWidth)
  }
  // One row means one line each: a control that wrapped is taller than the one beside it.
  const heights = new Set(controls.filter(control => control.what !== 'Cuerunner▾').map(control => control.height))
  expect([...heights], 'every tray button is one line high').toHaveLength(1)
}

/** The window made as narrow as it will go: its own minimum, less `inset` for a frame. */
async function narrowTo(inset: number): Promise<number> {
  const width = await app.evaluate(({ BrowserWindow }, inset) => {
    const win = BrowserWindow.getAllWindows()[0]
    const [minWidth, minHeight] = win.getMinimumSize()
    // A frame takes its width out of the window's: this lane draws none, so the room one
    // takes is taken by hand, which needs the floor out of the way first.
    if (inset > 0) win.setMinimumSize(minWidth - inset, minHeight)
    win.setContentSize(minWidth - inset, 600)
    return minWidth - inset
  }, inset)
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(width)
  return width
}

// The free build is the wider row — its Scenes button carries the Pro mark — so it is the
// one measured.
for (const [name, inset] of [
  ['the smallest window the app allows', 0],
  // Windows draws the resize border inside the window's own bounds, about eight pixels a
  // side: the same minimum is that much narrower where the page is.
  ['that window inside a Windows frame', 16]
] as const) {
  test(`every toolbar control is on screen in ${name}`, async () => {
    await page.locator('.cue-list-empty-demo').click()
    await expect(page.locator('.cue-row', { hasText: 'Walk-in Music' })).toBeVisible()
    // An unsaved show, so the dot beside the name is taking its room too.
    await toolbarCueBtn(page, 'Wait').click()
    await expect(page.locator('.dirty-dot')).toBeVisible()

    await narrowTo(inset)

    await expectEveryControlOnScreen()
  })
}

test('a long show name is cut short rather than pushing the view switch off the window', async () => {
  const long = 'The Complete Works of William Shakespeare (Abridged) — Spring Tour 2027 — Venue B rig'
  await page.locator('.workspace-name-text').dblclick()
  await page.locator('.workspace-name-input').fill(long)
  await page.keyboard.press('Enter')
  await expect(page).toHaveTitle(new RegExp('Venue B rig'))

  // At the size the window opens at, and at the narrowest it goes.
  await expectEveryControlOnScreen()
  await narrowTo(16)
  await expectEveryControlOnScreen()

  // The name is all there — the title bar and a rename still have it — and is drawn as
  // far as it fits.
  const label = page.locator('.workspace-name-label')
  await expect(label).toHaveText(long)
  const cut = await label.evaluate(element => ({
    shown: element.clientWidth,
    whole: element.scrollWidth,
    ellipsis: getComputedStyle(element).textOverflow
  }))
  expect(cut.whole).toBeGreaterThan(cut.shown)
  expect(cut.ellipsis).toBe('ellipsis')

  // What the ellipsis must not take: the dot that says the show is unsaved.
  const dot = await page.locator('.dirty-dot').boundingBox()
  const firstCueButton = await toolbarCueBtn(page, 'Audio').boundingBox()
  expect(dot).not.toBeNull()
  expect(dot!.width).toBeGreaterThan(0)
  expect(dot!.x + dot!.width).toBeLessThanOrEqual(firstCueButton!.x)
})
