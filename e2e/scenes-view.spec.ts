// The Scenes view: the matrix the show is run from and the only place scenes are
// edited. The faders and the cast are Show Settings'; what a row holds is the scene's own
// decision — one thing per row, a strip or a group built from strips here in the grid — and
// nothing else in the show says which fader a channel rides (`show-settings.spec.ts`). The
// test owns a UDP port and the show's desk points at it, so what is asserted here is what
// actually left the app.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import {
  addCueFromMoreMenu,
  buildDeskShow,
  buildEnsembleFromBox,
  closeApp,
  editScenes,
  freePort,
  launchApp,
  listenOsc,
  mintLicense,
  openLogPanel,
  openScenesView,
  openShowSettings,
  pickFromBox,
  pointDeskAtOsc
} from './helpers'

let app: ElectronApplication
let page: Page

test.beforeEach(async () => {
  // The show services, the scenes view, the panels that read them: everything this spec
  // is about is the licensed half of the app.
  ;({ app, page } = await launchApp({ license: mintLicense() }))
})

test.afterEach(async () => {
  await closeApp(app)
})

test('the view holds the show, and recall works from a column', async () => {
  test.setTimeout(60_000)
  const desk = await listenOsc(freePort())

  try {
    await buildDeskShow(page, desk.port)

    // The show's twelve faders down the rows, one scene across the columns — plus the
    // all-closed column that is always there in front of them.
    await expect(page.locator('.matrix-row')).toHaveCount(12)
    await expect(page.locator('.matrix-scene:not([data-all-closed])')).toHaveCount(1)
    await expect(page.locator('.matrix-scene')).toHaveCount(2)

    // The all-closed column places nothing: a fader's row has one cell per scene and a
    // blank where the empty stage is, so a scene's cell index is still its place among
    // the scenes.
    const row = page.locator('.matrix-row').first()
    await expect(row.locator('.matrix-cell')).toHaveCount(1)
    await expect(row.locator('.matrix-cell-blank')).toHaveCount(1)
    // The one cell of the scene the helper built holds the strip it places — one thing, in
    // a block named by the name the performer was given, which is what named the strip.
    await expect(row.locator('.matrix-cell').first().locator('.matrix-block'))
      .toContainText('Ruth')

    // Recalling from the column header is what the view is for. The desk has never been
    // told anything, so the recall says the whole show: the strip the scene places is
    // open, and the eleven it says nothing about are closed — by their own numbers,
    // because a mic's mute is the channel's and never a fader's.
    await page.locator('.matrix-scene:not([data-all-closed]) .matrix-recall').click()
    await expect.poll(() => desk.received.length).toBe(12)
    expect(desk.received[0]).toEqual({ address: '/dca/1/on', args: [1] })
    expect(desk.received.slice(1).map(message => message.address))
      .toEqual(Array.from({ length: 11 }, (_, index) => `/dca/${index + 2}/on`))
    expect(desk.received.slice(1).map(message => message.args[0])).toEqual(Array(11).fill(0))
    await expect(page.locator('.matrix-scene:not([data-all-closed])'))
      .toHaveAttribute('data-current', 'true')
  } finally {
    await desk.close()
  }
})

test('the show is edited in the view, not in a dialog', async () => {
  test.setTimeout(60_000)

  await buildDeskShow(page, freePort())
  const scenes = page.locator('.matrix-scene:not([data-all-closed])')

  // A second scene, and a third to remove.
  await page.locator('.matrix-add-scene').click()
  await expect(scenes).toHaveCount(2)
  await page.locator('.matrix-add-scene').click()
  await expect(scenes).toHaveCount(3)

  // Renaming happens in the column header, where the name is read.
  const second = scenes.nth(1).locator('.scene-name-field')
  await second.fill('Wedding')
  await second.blur()
  // The name lives in an input, so it is the field's value that has to say so.
  await expect(scenes.nth(1).locator('.scene-name-field')).toHaveValue('Wedding')

  // Removing a scene is a ✕ on its column, and it takes its mics with it.
  await scenes.nth(2).locator('.matrix-scene-remove').click()
  await expect(scenes).toHaveCount(2)

  // The all-closed column is not one of them: it has no name to type and no ✕ to remove
  // it by, even while the show is being edited — there is nothing in an empty stage to
  // move into or out of.
  const allClosed = page.locator('.matrix-scene[data-all-closed]')
  await expect(allClosed.locator('.scene-name-static')).toHaveText('Out')
  await expect(allClosed.locator('.scene-name-field')).toHaveCount(0)
  await expect(allClosed.locator('.matrix-scene-remove')).toHaveCount(0)

  // The row is a fader of the show, and a fader is its number: the first row reads 1, and
  // says what the desk calls it in its title. Beside it the cell holds the one thing the
  // scene places on that fader — the name the performer was given named their strip, which
  // is what the console calls it. Which channel rides which fader is the scene's decision,
  // made here and nowhere else.
  const fader = page.locator('.matrix-fader').first()
  await expect(fader).toHaveText('1')
  await expect(fader).toHaveAttribute('title', 'DCA 1')
  await expect(page.locator('.matrix-block').first()).toContainText('Ruth')
  // What the grid does with a strip is place it on a fader. Who is on which strip, and
  // what the console calls it, are Show Settings': the row's own header is a number rather
  // than a picker.
  await expect(page.locator('.matrix-mic').first().locator('select')).toHaveCount(0)
})

test('a show with many scenes still fits the window', async () => {
  test.setTimeout(60_000)

  await buildDeskShow(page, freePort())
  for (let i = 0; i < 12; i++) await page.locator('.matrix-add-scene').click()
  await expect(page.locator('.matrix-scene:not([data-all-closed])')).toHaveCount(13)
  // Thirteen scenes and the all-closed column in front of them.
  await expect(page.locator('.matrix-scene')).toHaveCount(14)
  const sceneWidths = await page.locator('.matrix-scene').evaluateAll(columns =>
    columns.map(column => Math.round(column.getBoundingClientRect().width)))
  expect(sceneWidths).toEqual([88, ...Array(13).fill(176)])

  // The grid scrolls inside the view. The view itself must not grow past the window, or
  // the lock and the far scenes end up clipped somewhere unreachable — which is what
  // happened before: 1532px of view in a 1280px window, and no visible scroller.
  const measured = await page.evaluate(() => {
    const view = document.querySelector('.scenes-view') as HTMLElement
    const scroll = document.querySelector('.matrix-scroll') as HTMLElement
    const lock = document.querySelector('.matrix-lock') as HTMLElement
    return {
      viewScrollWidth: view.scrollWidth,
      gridScrolls: scroll.scrollWidth > scroll.clientWidth,
      lockRight: Math.round(lock.getBoundingClientRect().right),
      windowWidth: window.innerWidth
    }
  })

  expect(measured.viewScrollWidth).toBeLessThanOrEqual(measured.windowWidth)
  expect(measured.gridScrolls).toBe(true)
  expect(measured.lockRight).toBeLessThanOrEqual(measured.windowWidth)

  // And the far end of the show is reachable by scrolling to it.
  await page.locator('.matrix-scroll').evaluate(el => { el.scrollLeft = el.scrollWidth })
  await expect(page.locator('.matrix-scene').last()).toBeInViewport()
})

test('the picker stays over its own cell while the grid is scrolled', async () => {
  test.setTimeout(60_000)

  await buildDeskShow(page, freePort())
  // A show wider than the window, so the grid has somewhere to scroll: the menu is drawn in
  // a portal at the box's own corner, and a menu left where it was measured would hang over
  // whichever cell had moved into its place while its filter and its picks edited this one.
  for (let i = 0; i < 12; i++) await page.locator('.matrix-add-scene').click()
  const scroll = page.locator('.matrix-scroll')
  await scroll.evaluate(el => { el.scrollLeft = 0 })

  // A cell with columns either side of it, so the scroll below moves it a column rather
  // than running it off the edge — a menu goes when the row it belongs to leaves the grid.
  const cell = page.locator('.matrix-row').first().locator('.matrix-cell').nth(4)
  await cell.locator('.matrix-cell-add, .matrix-block-name').first().click()
  const picker = page.locator('.scene-picker')
  await expect(picker).toBeVisible()

  // What the two rectangles say: the menu is over the cell it was opened on — it overlaps
  // that cell, and it hangs off that cell's own corner — which is what makes the list under
  // it the list for this row.
  const anchored = async (): Promise<{ left: number; gap: number; overlaps: boolean }> => {
    const menu = (await picker.boundingBox())!
    const box = (await cell.boundingBox())!
    return {
      left: Math.round(menu.x),
      // The menu is drawn at the box's own left corner, so the two are the same number
      // wherever it is not being held off the window's edge.
      gap: Math.round(menu.x - box.x),
      overlaps: menu.x < box.x + box.width && menu.x + menu.width > box.x &&
        menu.y < box.y + box.height && menu.y + menu.height > box.y
    }
  }
  const before = await anchored()
  expect(before.overlaps).toBe(true)
  expect(Math.abs(before.gap)).toBeLessThan(4)

  // The operator scrolls the grid under the menu. The menu follows the row it belongs to,
  // waited for rather than read once: the re-measure is a render behind the scroll.
  await scroll.evaluate(el => { el.scrollLeft = 176 })
  await expect.poll(async () => (await anchored()).overlaps).toBe(true)
  await expect.poll(async () => Math.abs((await anchored()).gap)).toBeLessThan(4)
  const after = await anchored()

  // Still over its own cell, still hanging off its own corner — and moved with the grid
  // rather than left behind over the cell that took its place.
  expect(after.left).toBeLessThan(before.left)
})

test('a scene column is the width a scene is, whatever the window', async () => {
  test.setTimeout(60_000)

  await buildDeskShow(page, freePort())

  // The all-closed column first, then a scene per column: 88px of utility and 176px of
  // scene, measured rather than read off the stylesheet. 176 is what an eighteen-character
  // scene name asks for, which the last case measures against the app's own font.
  const layout = (): Promise<{
    columns: number[]
    scrolls: boolean
    viewScrollWidth: number
    windowWidth: number
    documentScrollWidth: number
  }> => page.evaluate(() => {
    const columns = [...document.querySelectorAll('.matrix-scene')].map(
      column => Math.round(column.getBoundingClientRect().width))
    const scroller = document.querySelector('.matrix-scroll') as HTMLElement
    const view = document.querySelector('.scenes-view') as HTMLElement
    return {
      columns,
      scrolls: scroller.scrollWidth > scroller.clientWidth,
      // The view itself must not grow past the window, or the far scenes and the Edit
      // press end up clipped somewhere unreachable: what does not fit scrolls inside the
      // grid, and the document stays the width of the window.
      viewScrollWidth: view.scrollWidth,
      windowWidth: window.innerWidth,
      documentScrollWidth: document.documentElement.scrollWidth
    }
  })

  // One scene. Its column is its own width rather than a share of the window, which is what
  // a show this short used to draw: one column stretched across most of the view with its
  // name and controls huddled at one edge.
  expect((await layout()).columns).toEqual([88, 176])

  // A second scene changes nothing about the first, and the two of them still fit: fixed
  // tracks take what they need rather than dividing what the window has.
  await page.locator('.matrix-add-scene').click()
  await expect(page.locator('.matrix-scene:not([data-all-closed])')).toHaveCount(2)
  const wide = await layout()
  expect(wide.columns).toEqual([88, 176, 176])
  expect(wide.scrolls).toBe(false)
  expect(wide.viewScrollWidth).toBeLessThanOrEqual(wide.windowWidth)
  expect(wide.documentScrollWidth).toBeLessThanOrEqual(wide.windowWidth)

  // A window an operator could be running this on, not the one the suite starts at. The
  // app's own floor has to move for it: a 380px window is below what the toolbar asks for
  // and the product refuses to open that small — what is under test here is the grid's
  // layout at that width, not the window policy.
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.setMinimumSize(320, 400)
    win.setSize(380, 800)
  })
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(380)

  const narrow = await layout()
  // Neither track stretched to fill the window, and the show scrolls inside the view
  // instead of widening the view or the document behind it.
  expect(narrow.columns).toEqual([88, 176, 176])
  expect(narrow.scrolls).toBe(true)
  expect(narrow.viewScrollWidth).toBeLessThanOrEqual(narrow.windowWidth)
  expect(narrow.documentScrollWidth).toBeLessThanOrEqual(narrow.windowWidth)

  // An eighteen-character scene name is what the column is measured for: typed into the
  // header's own field it fits the box, measured in the field's own font rather than
  // assumed, because the name is what the column is read by and the font is the one the app
  // bundles. What does not fit is a longer name, which is cut and readable in its title.
  const named = await page.evaluate(() => {
    const field = document.querySelector<HTMLInputElement>('.scene-name-field')!
    const style = getComputedStyle(field)
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')!
    context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
    const room = field.clientWidth -
      parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
    const name = 'Wedding Scene No 1'
    return {
      letters: name.length,
      text: Math.round(context.measureText(name).width),
      room: Math.round(room)
    }
  })
  expect(named.letters).toBe(18)
  expect(named.text).toBeLessThanOrEqual(named.room)

  // The fader column is a number, not a name: it stays where it is — at the width its own
  // narrow track gives it — whichever way the grid is scrolled, so the numbers are still
  // there to read when the show is at the far end.
  const label = page.locator('.matrix-mic').first()
  const before = await label.boundingBox()
  expect(Math.round(before?.width ?? 0)).toBe(44)
  await page.locator('.matrix-scroll').evaluate(el => { el.scrollLeft = el.scrollWidth })
  const after = await label.boundingBox()
  expect(Math.round(after?.x ?? -1)).toBe(Math.round(before?.x ?? -2))
})

test('the view follows the show past the side of the window', async () => {
  test.setTimeout(120_000)

  await buildDeskShow(page, freePort())
  const columns = page.locator('.matrix-scene:not([data-all-closed])')

  // Twenty numbers: a musical is wider than any window, so the scene the show is in can sit
  // thousands of pixels off the side.
  const first = columns.first().locator('.scene-name-field')
  await first.fill('Number 1')
  await first.blur()
  for (let i = 0; i < 19; i++) {
    await page.locator('.matrix-add-scene').click()
    const field = columns.last().locator('.scene-name-field')
    await field.fill(`Number ${i + 2}`)
    await field.blur()
  }

  // The show reaches the nineteenth through the cue stack: the operator is watching the
  // stage, and nothing has been clicked in the grid at all.
  await page.locator('.toolbar-view-btn', { hasText: 'Cues' }).click()
  await addCueFromMoreMenu(page, 'Scene')
  await page.locator('.inspector-tab', { hasText: 'Scene' }).click()
  await page.locator('#scene-cue-select').selectOption({ label: 'Number 19' })
  await page.locator('.btn-go').click()
  await page.locator('.toolbar-view-btn', { hasText: 'Scenes' }).click()
  // The show has moved: the scenes view follows what the desk was told, so the cue has to
  // have landed before the view is asked where the show is.
  await expect(columns.nth(18)).toHaveAttribute('data-current', 'true')

  const current = page.locator('.matrix-scene[data-current="true"]')
  await expect(current).toHaveCount(1)
  // The nineteenth of twenty: both the scene the desk is in and the one after it are on
  // screen, which is the point of following at all — a short number cannot hide the next.
  await expect(current).toBeInViewport({ ratio: 1 })
  await expect(columns.nth(19)).toBeInViewport({ ratio: 1 })
  // The nineteenth of twenty, and the one after it, both on screen — which is the point of
  // following at all, since a short number cannot hide the next scene.
  await expect(columns.nth(18)).toHaveAttribute('data-current', 'true')
  await expect(columns.nth(19)).toHaveAttribute('data-current', 'false')

  // Never behind the plot column either: what is on screen is the scene, not a sliver of it.
  const hidden = await page.evaluate(() => {
    const column = document.querySelector('.matrix-scene[data-current="true"]')!.getBoundingClientRect()
    const plot = document.querySelector('.matrix-mic')!.getBoundingClientRect()
    return Math.round(plot.right - column.left)
  })
  expect(hidden).toBeLessThanOrEqual(0)

  // Mid-show, where the grid can still move: the recalled scene is parked at the left of the
  // columns, so everything after it is laid out to the right for the next press.
  await columns.nth(4).locator('.matrix-recall').click()
  await expect(columns.nth(4)).toHaveAttribute('data-current', 'true')
  const gap = await page.evaluate(() => {
    const column = document.querySelector('.matrix-scene[data-current="true"]')!.getBoundingClientRect()
    const plot = document.querySelector('.matrix-mic')!.getBoundingClientRect()
    return Math.round(column.left - plot.right)
  })
  expect(Math.abs(gap)).toBeLessThanOrEqual(1)

  // Deep in the show, where there is nothing left to scroll: the scene the desk is on and
  // the one after it are both on screen, which is what following has to guarantee.
  await columns.nth(14).locator('.matrix-recall').click()
  await expect(columns.nth(14)).toHaveAttribute('data-current', 'true')
  await expect(columns.nth(14)).toBeInViewport({ ratio: 1 })
  await expect(columns.nth(15)).toBeInViewport({ ratio: 1 })

  // Scrolling by hand belongs to the operator: the view does not drag it back while nothing
  // is moving the show.
  await page.locator('.matrix-scroll').evaluate(el => { el.scrollLeft = 0 })
  await expect(columns.nth(14)).not.toBeInViewport()

  // And the next recall brings it back to the show, whichever hand moved the desk. The
  // press waits out the firing window first: two GO presses in one breath are one firing,
  // and this is a second, deliberate press rather than a hand that shook.
  await page.waitForTimeout(400)
  await page.locator('.btn-go').click()
  await expect(columns.nth(18)).toHaveAttribute('data-current', 'true')
  await expect(columns.nth(18)).toBeInViewport({ ratio: 1 })
})

test('deleting a scene leaves the view where it is, and undo puts it back', async () => {
  test.setTimeout(120_000)

  await buildDeskShow(page, freePort())
  const columns = page.locator('.matrix-scene:not([data-all-closed])')

  // Fifteen numbers, one of them named for what it does and with a mic of its own. It is the
  // second scene because this test deletes it, which is also why the press has to be one the
  // operator can make without moving the grid — the delete below says why.
  for (let i = 0; i < 14; i++) {
    await page.locator('.matrix-add-scene').click()
    const field = columns.last().locator('.scene-name-field')
    await field.fill(`Number ${i + 2}`)
    await field.blur()
  }
  const vows = columns.nth(1).locator('.scene-name-field')
  await vows.fill('Vows')
  await vows.blur()
  // Vows places a strip on the seventh fader: the second cell of that row is the second
  // scene, because the all-closed column is a blank in the row rather than a cell.
  const vowsCell = page.locator('.matrix-row').nth(6).locator('.matrix-cell').nth(1)
  await pickFromBox(page, vowsCell, 'Ruth')
  await expect(vowsCell).toHaveAttribute('data-placed', 'true')

  // The show reaches the fifteenth through the cue stack. The cue is armed here; the press
  // that fires it belongs to the view the show is run from, so the grid is left where an
  // operator watching the top of the show would have it, and the show is left to move it.
  await page.locator('.toolbar-view-btn', { hasText: 'Cues' }).click()
  await addCueFromMoreMenu(page, 'Scene')
  await page.locator('.inspector-tab', { hasText: 'Scene' }).click()
  await page.locator('#scene-cue-select').selectOption({ label: 'Number 15' })
  await page.locator('.toolbar-view-btn', { hasText: 'Scenes' }).click()
  const scroll = page.locator('.matrix-scroll')
  await scroll.evaluate(el => { el.scrollLeft = 0 })

  // GO, and the view follows the show: the desk is on the last scene, which following takes
  // as far right as the grid goes. Waited for, and the wait is only unambiguous because the
  // box was just put at the top by hand. The follow is a passive effect — queued in the
  // commit that flips `data-current`, flushed on a task the browser is free to run after the
  // next call from here — so until it has run the view is still on its way, and a scroll of
  // ours at that moment races the show rather than the delete.
  await page.locator('.btn-go').click()
  await expect(columns.nth(14)).toHaveAttribute('data-current', 'true')
  const rightEnd = await scroll.evaluate(el => el.scrollWidth - el.clientWidth)
  await expect.poll(() => scroll.evaluate(el => el.scrollLeft)).toBe(rightEnd)

  // The operator scrolls back to the top of the show and deletes a scene they do not want.
  // That is an edit: the desk has not moved, so the view must not either — it used to snap
  // back to wherever the show was, as though the delete had been a recall. The second scene
  // is the one that goes because its ✕ is on screen from the top of the show: a control that
  // is not on screen is scrolled into view before it is pressed, and that scroll would be the
  // harness's own hand inside the measurement made below. The line before the press holds
  // that to the layout, so a ✕ pushed off the side fails there, where the reason is, rather
  // than three lines later at a scroll assertion.
  const remove = columns.nth(1).locator('.matrix-scene-remove')
  await scroll.evaluate(el => { el.scrollLeft = 0 })
  await expect(remove).toBeInViewport({ ratio: 1 })
  await remove.click()
  await expect(columns).toHaveCount(14)
  expect(await scroll.evaluate(el => el.scrollLeft)).toBe(0)
  await expect(columns.last()).not.toBeInViewport()

  // Undo returns it where it was, with the mic it opens.
  await app.evaluate(({ Menu, BrowserWindow }) => {
    Menu.getApplicationMenu()
      ?.getMenuItemById('edit-undo')
      ?.click(undefined, BrowserWindow.getAllWindows()[0])
  })
  await expect(columns).toHaveCount(15)
  await expect(columns.nth(1).locator('.scene-name-field')).toHaveValue('Vows')
  // With the placement it had: the cell names the strip again.
  await expect(page.locator('.matrix-row').nth(6).locator('.matrix-cell').nth(1))
    .toHaveAttribute('data-placed', 'true')
})

test('editing a cell moves the scene, and the desk is told only when asked', async () => {
  test.setTimeout(60_000)
  const desk = await listenOsc(freePort())

  try {
    await buildDeskShow(page, desk.port)

    // The first recall says the whole show, because the desk has never been told anything:
    // the strip the scene places is open and the eleven it says nothing about are closed.
    await page.locator('.matrix-scene:not([data-all-closed]) .matrix-recall').click()
    await expect.poll(() => desk.received.length).toBe(12)
    expect(desk.received[0]).toEqual({ address: '/dca/1/on', args: [1] })

    // Editing is not applying. A row holds one thing, so the strip the operator picks takes
    // the place of the one the row was holding — the block renames itself — and the desk
    // hears nothing until the operator says so.
    const firstFader = page.locator('.matrix-row').first().locator('.matrix-cell').first()
    // The strip that takes the place is named for the performer standing on it, which is
    // what the grid and the picker both call it.
    await pickFromBox(page, firstFader, 'Sancho')
    await expect(firstFader.locator('.matrix-block')).toContainText('Sancho')
    await expect(firstFader.locator('.matrix-block')).not.toContainText('Ruth')
    await page.waitForTimeout(300)
    expect(desk.received).toHaveLength(12)

    // The press that moves the room: the strip that left the row is closed by its own
    // number, the one that took its place is opened by its own — and the membership the row
    // now carries is reported as a gap, because a desk that takes a note on and a note off
    // has no assignment for Cuerunner to write.
    await page.locator('.matrix-scene:not([data-all-closed]) .matrix-recall').click()
    await expect.poll(() => desk.received.length).toBe(14)
    expect(desk.received[12]).toEqual({ address: '/dca/2/on', args: [1] })
    expect(desk.received[13]).toEqual({ address: '/dca/1/on', args: [0] })
    await openLogPanel(page)
    await expect(page.locator('.log-panel')).toContainText('Cannot be told to this desk')
    await expect(page.locator('.log-panel')).toContainText('OSC takes no assignment')

    // The mutes are done — a second press changes nothing on the wire — but the placement
    // is still owed: an OSC desk takes no assignment, so the record never learns it and
    // the press stays up with the gap in the log, rather than going quiet about half a
    // recall. That is the honest half: the mic is open, the fader is not Cuerunner's to set.
    const written = desk.received.length
    await page.locator('.matrix-scene:not([data-all-closed]) .matrix-recall').click()
    await page.waitForTimeout(300)
    expect(desk.received).toHaveLength(written)
  } finally {
    await desk.close()
  }
})

test('a scene cue moves the desk when GO reaches it', async () => {
  test.setTimeout(60_000)
  const desk = await listenOsc(freePort())

  try {
    await buildDeskShow(page, desk.port)

    // A cue in the stack that names the scene, so the desk follows the show rather than
    // the operator remembering to click.
    await page.locator('.toolbar-view-btn', { hasText: 'Cues' }).click()
    await addCueFromMoreMenu(page, 'Scene')
    await page.locator('.inspector-tab', { hasText: 'Scene' }).click()
    await page.locator('#scene-cue-select').selectOption({ label: 'Scene 1' })

    await page.locator('.btn-go').click()

    // The desk has heard nothing yet, so the cue says the whole show: the strip the scene
    // places opened by its own number, and the eleven the scene does not place closed.
    await expect.poll(() => desk.received.length).toBe(12)
    expect(desk.received[0]).toEqual({ address: '/dca/1/on', args: [1] })
    await page.locator('.btn-log').click()
    await expect(page.locator('.log-panel')).toContainText('Scene "Scene 1" — 1 opened, 11 closed')
  } finally {
    await desk.close()
  }
})

test('the all-closed column closes everything the show drives', async () => {
  test.setTimeout(60_000)
  const desk = await listenOsc(freePort())

  try {
    await buildDeskShow(page, desk.port)

    // The first column is the empty stage, and recalling it closes every channel the show
    // has — a scene of its own is not needed to get the desk back to nothing.
    await page.locator('.matrix-scene[data-all-closed] .matrix-recall').click()
    await expect.poll(() => desk.received.length).toBe(12)
    expect(desk.received.map(message => message.address)).toEqual(
      Array.from({ length: 12 }, (_, index) => `/dca/${index + 1}/on`)
    )
    expect(desk.received.map(message => message.args[0])).toEqual(Array(12).fill(0))

    // The desk is left somewhere the view can say: the all-closed column is the state it
    // is on, not an absence of one.
    await expect(page.locator('.matrix-scene[data-all-closed]'))
      .toHaveAttribute('data-current', 'true')
  } finally {
    await desk.close()
  }
})

test('a scene that applies an ensemble to a row rides every member of it', async () => {
  test.setTimeout(60_000)
  const desk = await listenOsc(freePort())

  try {
    await buildDeskShow(page, desk.port)

    // The two performers — the one the scene places and the one after them — are grouped
    // into one ensemble, built from the row the first of them is on.
    const row = page.locator('.matrix-row').first().locator('.matrix-cell').first()
    await expect(row.locator('.matrix-block')).toContainText('Ruth')
    await buildEnsembleFromBox(page, row, 'Principals', ['Ruth', 'Sancho'])

    // An ensemble routes nothing itself: a row holding it carries every member, and the
    // block names the group while its title names the mics the group opens.
    const cell = page.locator('.matrix-row').first().locator('.matrix-cell').first()
    await expect(cell.locator('.matrix-block')).toHaveAttribute('data-kind', 'ensemble')
    await expect(cell.locator('.matrix-block')).toContainText('Principals')
    await expect(cell.locator('.matrix-block'))
      .toHaveAttribute('title', 'Principals — Ruth, Sancho')

    // And the group is a thing to apply, not a copy of one row's: the row below takes it
    // from the picker's own Ensembles section, and reads as carrying it in its turn.
    const below = page.locator('.matrix-row').nth(1).locator('.matrix-cell').first()
    await pickFromBox(page, below, 'Principals')
    await expect(below.locator('.matrix-block')).toHaveAttribute('data-kind', 'ensemble')
    await expect(below.locator('.matrix-block')).toContainText('Principals')

    // It is one grid: a cell sits over its own column, whatever it is carrying. A row that
    // is one cell short draws every column a place to the left — and takes every row after
    // it with it, which is a thing the clicks still do correctly and the eye does not.
    const boxOf = async (selector: string): Promise<{ x: number; width: number }> => {
      const box = await page.locator(selector).first().boundingBox()
      if (box === null) throw new Error(`${selector} is not on screen`)
      return box
    }
    const cellBox = await boxOf('.matrix-row .matrix-cell')
    const sceneHeader = await boxOf('.matrix-scene:not([data-all-closed])')
    // The cell is inset by its own margin, so it starts a couple of pixels inside its
    // column — a scene column is 176px, so anything that is not that is a whole column out.
    expect(Math.abs(cellBox.x - sceneHeader.x)).toBeLessThan(4)

    // Both members are told by their own channel numbers, at the addresses those numbers
    // make, and the ten the scene says nothing about are closed.
    await page.locator('.matrix-scene:not([data-all-closed]) .matrix-recall').click()
    await expect.poll(() => desk.received.length).toBe(12)
    expect(desk.received[0]).toEqual({ address: '/dca/1/on', args: [1] })
    expect(desk.received[1]).toEqual({ address: '/dca/2/on', args: [1] })
    expect(desk.received.slice(2).map(message => message.args[0])).toEqual(Array(10).fill(0))
  } finally {
    await desk.close()
  }
})

test('a long hostile name renders inert, whole in its title, and never widens the grid', async () => {
  test.setTimeout(60_000)
  await buildDeskShow(page, freePort())

  // A name as long as a company's own and as hostile as one pasted out of a browser. The
  // channel and the scene each take it; the fader cannot, because a fader is its number.
  const hostileName = '<img src=x onerror="window.__scenePwned=1"> & the rest of a name no 176px column holds'
  await openShowSettings(page, 'channels')
  const settings = page.locator('.show-settings-dialog')
  const channel = settings.locator('.channel-row').first().locator('.channel-name')
  await channel.fill(hostileName)
  await expect(channel).toHaveValue(hostileName)
  await channel.press('Enter')
  await settings.locator('.show-settings-done').click()

  // The scene's own name takes the same one, in the column header it is edited from.
  const sceneName = page.locator('.matrix-scene[data-scene-id] .scene-name-field').first()
  await sceneName.fill(hostileName)
  await sceneName.press('Enter')

  // Each of the two reads as text: characters to read, nothing to load, nothing to run.
  const block = page.locator('.matrix-block').first()
  await expect(block).toContainText(hostileName)
  await expect(block.locator('img')).toHaveCount(0)
  expect(await page.evaluate(() => (window as Window & { __scenePwned?: number }).__scenePwned))
    .toBeUndefined()

  // The column cuts the name; the whole of it is on the element — the block's own title, and
  // the scene header the column is named by. The row's header is the fader's number and
  // never a name, so the hostile one cannot reach it.
  await expect(block).toHaveAttribute('title', hostileName)
  await expect(page.locator('.matrix-fader').first()).toHaveText('1')
  await expect(page.locator('.matrix-fader').first()).toHaveAttribute('title', 'DCA 1')
  await expect(sceneName).toHaveAttribute('title', hostileName)

  // The cut reads as an ellipsis rather than a name that stops mid-word, nothing spills out
  // of a cell, and none of it widens the view.
  const measured = await page.evaluate(() => {
    const view = document.querySelector('.scenes-view') as HTMLElement
    const name = document.querySelector('.matrix-block-name') as HTMLElement
    return {
      viewScrollWidth: view.scrollWidth,
      windowWidth: window.innerWidth,
      nameCut: name.scrollWidth > name.clientWidth,
      nameTextOverflow: getComputedStyle(name).textOverflow,
      cellsOverflow: [...document.querySelectorAll('.matrix-cell')]
        .map(cell => cell.scrollWidth - cell.clientWidth)
    }
  })
  expect(measured.viewScrollWidth).toBeLessThanOrEqual(measured.windowWidth)
  expect(measured.nameCut).toBe(true)
  expect(measured.nameTextOverflow).toBe('ellipsis')
  expect(measured.cellsOverflow.every(overflow => overflow <= 0)).toBe(true)
})

test('the builder makes a group from the strips it is given, and one undo puts it back', async () => {
  test.setTimeout(60_000)
  const desk = await listenOsc(freePort())

  try {
    await buildDeskShow(page, desk.port)

    // The row as the helper built it: one performer's strip placed by hand on the first
    // fader, named for the performer standing on it.
    const cell = page.locator('.matrix-row').first().locator('.matrix-cell').first()
    await expect(cell.locator('.matrix-block')).toContainText('Ruth')

    // The group is built out of the strips the operator moves across in the builder, which
    // is reached from the row's own box. Grouping is a settings edit rather than a command
    // to the desk: the desk has heard nothing, and the save does not change that.
    //
    // The dialog is a fixed size — its lists hold a number of rows taken from the show — so
    // moving a strip between them cannot walk the box up or down under the pointer, and the
    // press keeps the place: something is still picked, so the arrow is still live.
    await cell.locator('.matrix-cell-add, .matrix-block-name').first().click()
    await page.locator('.scene-picker')
      .getByRole('button', { name: 'Ensemble…', exact: true }).click()
    const builder = page.getByRole('dialog', { name: 'New ensemble' })
    const opened = Math.round((await builder.boundingBox())!.height)
    for (const strip of ['Ruth', 'Sancho']) {
      await builder.locator('[data-pane="free"]')
        .getByRole('button', { name: strip, exact: true }).click()
      await builder.locator('.ensemble-move').first().click()
      expect(Math.round((await builder.boundingBox())!.height)).toBe(opened)
    }
    await expect(builder.locator('.ensemble-item[aria-pressed="true"]')).toHaveCount(1)
    await builder.getByRole('button', { name: 'Cancel' }).click()

    await buildEnsembleFromBox(page, cell, 'Principals', ['Ruth', 'Sancho'])
    const block = cell.locator('.matrix-block')
    await expect(block).toHaveAttribute('data-kind', 'ensemble')
    await expect(block).toContainText('Principals')
    // The whole of what the row holds is in the block's title: the group, and the mics its
    // members stand on.
    await expect(block).toHaveAttribute('title', 'Principals — Ruth, Sancho')
    await page.waitForTimeout(300)
    expect(desk.received).toHaveLength(0)

    // What the scene holds is what a recall writes: the group's two members open, and the
    // ten strips the scene says nothing about are closed.
    await page.locator('.matrix-scene:not([data-all-closed]) .matrix-recall').click()
    await expect.poll(() => desk.received.length).toBe(12)
    expect(desk.received[0]).toEqual({ address: '/dca/1/on', args: [1] })
    expect(desk.received[1]).toEqual({ address: '/dca/2/on', args: [1] })
    expect(desk.received.slice(2).map(message => message.args[0])).toEqual(Array(10).fill(0))

    // Undo is one press for the whole thing: the new group goes and the row is the hand
    // placement it was.
    await app.evaluate(({ Menu, BrowserWindow }) => {
      Menu.getApplicationMenu()
        ?.getMenuItemById('edit-undo')
        ?.click(undefined, BrowserWindow.getAllWindows()[0])
    })
    await expect(cell.locator('.matrix-block')).toHaveAttribute('data-kind', 'channel')
    await expect(cell.locator('.matrix-block')).toContainText('Ruth')
    await expect(cell.locator('.matrix-block')).not.toContainText('Principals')
  } finally {
    await desk.close()
  }
})

test('the view opens to run the show: Edit gives it back, and recalling never stops', async () => {
  test.setTimeout(60_000)
  const desk = await listenOsc(freePort())

  try {
    await buildDeskShow(page, desk.port)

    // Locked: the show is being run, and a stray click changes nothing. A cell is a readout
    // — the one thing its row holds — and the presses that would change the show are not
    // drawn at all: an empty row's box is there and asleep, and a block carries no ✕.
    await page.locator('.matrix-lock').click()
    await expect(page.locator('.scenes-view')).toHaveAttribute('data-editing', 'false')
    await expect(page.locator('.matrix-lock')).toHaveAttribute('data-editing', 'false')

    const cell = page.locator('.matrix-row').nth(1).locator('.matrix-cell').first()
    await expect(cell).toHaveAttribute('data-placed', 'false')
    // The box is still drawn — the grid says what every row holds, and an empty row is a
    // fact about the scene — and it is asleep rather than a press that opens anything.
    const box = cell.locator('.matrix-cell-add')
    await expect(box).toBeVisible()
    await expect(box).toBeDisabled()
    await box.click({ force: true })
    await expect(page.locator('.scene-picker')).toHaveCount(0)
    await expect(page.locator('.matrix-block-remove')).toHaveCount(0)
    // Adding a scene is an edit, so the plus is not drawn while the show runs.
    await expect(page.locator('.matrix-add-scene')).toHaveCount(0)
    await expect(page.locator('.matrix-scene-remove')).toHaveCount(0)

    // Recalling is what the view is for: it stays live. The desk has heard nothing, so the
    // recall says the whole show.
    await page.locator('.matrix-scene:not([data-all-closed]) .matrix-recall').click()
    await expect.poll(() => desk.received.length).toBe(12)
    expect(desk.received[0].args).toEqual([1])

    // And unlocking gives the show back.
    await page.locator('.matrix-lock').click()
    await pickFromBox(page, cell, 'Sancho')
    await expect(cell.locator('.matrix-block')).toContainText('Sancho')
  } finally {
    await desk.close()
  }
})

test('a show with nobody cast can be grouped, because a group holds strips', async () => {
  test.setTimeout(60_000)
  const desk = await listenOsc(freePort())

  try {
    // A fresh show: twelve strips and no cast at all — the one case where a group holding
    // performers would have left the builder with nothing it could move across.
    await pointDeskAtOsc(page, desk.port)
    await page.locator('.show-settings-done').click()
    await openScenesView(page)
    await editScenes(page)
    await page.locator('.matrix-add-scene').click()

    const cell = page.locator('.matrix-row').first().locator('.matrix-cell').first()
    await buildEnsembleFromBox(page, cell, 'Playback', ['Ch 1', 'Ch 2'])

    // The row holds the group, and the group holds the strips: a recall opens both mics and
    // closes the ten the scene says nothing about.
    const block = cell.locator('.matrix-block')
    await expect(block).toHaveAttribute('data-kind', 'ensemble')
    await expect(block.locator('.matrix-block-name')).toHaveText('Playback')
    await expect(block).toHaveAttribute('title', 'Playback — Ch 1, Ch 2')

    await page.locator('.matrix-scene:not([data-all-closed]) .matrix-recall').click()
    await expect.poll(() => desk.received.length).toBe(12)
    expect(desk.received[0]).toEqual({ address: '/dca/1/on', args: [1] })
    expect(desk.received[1]).toEqual({ address: '/dca/2/on', args: [1] })
    expect(desk.received.slice(2).map(message => message.args[0])).toEqual(Array(10).fill(0))
  } finally {
    await desk.close()
  }
})

test('deleting every scene leaves the grid in order', async () => {
  test.setTimeout(60_000)
  // A show with no scenes is a grid like any other: the faders down the side, the Out column
  // beside them, and the plus after the last scene — of which there are none. It used to fall
  // back to two auto tracks, which drew the Out column across half the window with the faders
  // pushed off to its right.
  await openScenesView(page)
  await editScenes(page)
  await page.locator('.matrix-add-scene').click()
  await page.locator('.matrix-add-scene').click()
  await expect(page.locator('.matrix-scene[data-scene-id]')).toHaveCount(2)

  await page.locator('.matrix-scene-remove').first().click()
  await page.locator('.matrix-scene-remove').first().click()
  await expect(page.locator('.matrix-scene[data-scene-id]')).toHaveCount(0)

  const laid = await page.evaluate(() => {
    const box = (selector: string) => {
      const rect = document.querySelector(selector)!.getBoundingClientRect()
      return { x: Math.round(rect.x), width: Math.round(rect.width) }
    }
    return {
      tracks: getComputedStyle(document.querySelector('.matrix-grid') as HTMLElement)
        .gridTemplateColumns,
      corner: box('.matrix-corner'),
      out: box('.matrix-scene[data-all-closed]'),
      mic: box('.matrix-mic'),
      plus: box('.matrix-add-scene')
    }
  })

  // Three tracks, each the width the stylesheet gives it: the corner and the fader column
  // start at the left edge, the Out column is beside them, and the plus is one column on.
  expect(laid.tracks).toContain('44px')
  expect(laid.corner.x).toBe(0)
  expect(laid.mic.x).toBe(0)
  expect(laid.out.x).toBe(laid.corner.width)
  expect(laid.plus.x).toBeGreaterThan(laid.out.x)
  await expect(page.locator('.matrix-fader').first()).toHaveText('1')
})

test('an opened show always starts out being run, whatever it was left as', async () => {
  test.setTimeout(60_000)
  await buildDeskShow(page, freePort())
  await expect(page.locator('.scenes-view')).toHaveAttribute('data-editing', 'true')

  // The cue toolbar belongs to the cue stack, not to this view.
  await expect(page.locator('.toolbar-cue-btn').first()).toBeHidden()

  // Opening another show hands the view back to running it. The show was changed, so the
  // app asks first; the answer is Don't Save, given for the OS's own dialog.
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox
  })
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu button', { hasText: 'Open Demo Workspace' }).click()
  await page.locator('.toolbar-view-btn', { hasText: 'Scenes' }).click()
  await expect(page.locator('.scenes-view')).toHaveAttribute('data-editing', 'false')
})
