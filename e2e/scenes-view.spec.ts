// The Scenes view: the matrix the show is run from and the only place scenes are
// edited. The faders, the cast and the ensembles are Show Settings' — a scene says which
// channels ride which fader, and nothing else in the show says it (`show-settings.spec.ts`).
// The test owns a UDP port and the show's desk points at it, so what is asserted here is
// what actually left the app.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import {
  addCueFromMoreMenu,
  buildDeskShow,
  closeApp,
  freePort,
  launchApp,
  listenOsc,
  mintLicense,
  openLogPanel,
  openShowSettings
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
    // The one cell of the scene the helper built names the strip it places.
    await expect(row.locator('.matrix-cell').first().locator('.matrix-channel'))
      .toContainText('Ch 1 · Ruth')

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
  await page.locator('.scenes-add').click()
  await expect(scenes).toHaveCount(2)
  await page.locator('.scenes-add').click()
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
  await expect(allClosed.locator('.scene-name-static')).toHaveText('All closed')
  await expect(allClosed.locator('.scene-name-field')).toHaveCount(0)
  await expect(allClosed.locator('.matrix-scene-remove')).toHaveCount(0)

  // The row is a fader of the show, and the cell names the strips that scene places on
  // it — the name the performer was given named their strip, which is what the console
  // calls it. Which channel rides which fader is the scene's decision, made here and
  // nowhere else.
  await expect(page.locator('.matrix-mic').first()).toContainText('DCA 1')
  await expect(page.locator('.matrix-channel').first()).toContainText('Ch 1 · Ruth')
  // What the grid does with a strip is place it on a fader. Who is on which strip, and
  // what the console calls it, are Show Settings': the row's own header is a label rather
  // than a picker.
  await expect(page.locator('.matrix-mic').first().locator('select')).toHaveCount(0)
})

test('a show with many scenes still fits the window', async () => {
  test.setTimeout(60_000)

  await buildDeskShow(page, freePort())
  for (let i = 0; i < 12; i++) await page.locator('.scenes-add').click()
  await expect(page.locator('.matrix-scene:not([data-all-closed])')).toHaveCount(13)
  // Thirteen scenes and the all-closed column in front of them.
  await expect(page.locator('.matrix-scene')).toHaveCount(14)
  const sceneWidths = await page.locator('.matrix-scene').evaluateAll(columns =>
    columns.map(column => Math.round(column.getBoundingClientRect().width)))
  expect(sceneWidths).toEqual([112, ...Array(13).fill(192)])

  // The grid scrolls inside the view. The view itself must not grow past the window, or
  // the Edit press and the far scenes end up clipped somewhere unreachable — which is what
  // happened before: 1532px of view in a 1280px window, and no visible scroller.
  const measured = await page.evaluate(() => {
    const view = document.querySelector('.scenes-view') as HTMLElement
    const scroll = document.querySelector('.matrix-scroll') as HTMLElement
    const lock = document.querySelector('.scenes-edit') as HTMLElement
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

test('a scene column is the width a scene is, whatever the window', async () => {
  test.setTimeout(60_000)

  await buildDeskShow(page, freePort())

  // The all-closed column first, then a scene per column: 112px of utility and 192px of
  // scene, measured rather than read off the stylesheet.
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
  expect((await layout()).columns).toEqual([112, 192])

  // A second scene changes nothing about the first, and the two of them still fit: fixed
  // tracks take what they need rather than dividing what the window has.
  await page.locator('.scenes-add').click()
  await expect(page.locator('.matrix-scene:not([data-all-closed])')).toHaveCount(2)
  const wide = await layout()
  expect(wide.columns).toEqual([112, 192, 192])
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
  expect(narrow.columns).toEqual([112, 192, 192])
  expect(narrow.scrolls).toBe(true)
  expect(narrow.viewScrollWidth).toBeLessThanOrEqual(narrow.windowWidth)
  expect(narrow.documentScrollWidth).toBeLessThanOrEqual(narrow.windowWidth)

  // The fader labels are the row's name, not a column: they stay where they are — at the
  // width their own track gives them — whichever way the grid is scrolled.
  const label = page.locator('.matrix-mic').first()
  const before = await label.boundingBox()
  expect(Math.round(before?.width ?? 0)).toBe(170)
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
    await page.locator('.scenes-add').click()
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
  await expect(page.locator('.scenes-now')).toContainText('Number 19')

  const current = page.locator('.matrix-scene[data-current="true"]')
  await expect(current).toHaveCount(1)
  // The nineteenth of twenty: both the scene the desk is in and the one after it are on
  // screen, which is the point of following at all — a short number cannot hide the next.
  await expect(current).toBeInViewport({ ratio: 1 })
  await expect(columns.nth(19)).toBeInViewport({ ratio: 1 })
  await expect(page.locator('.scenes-now')).toContainText('Number 19')
  await expect(page.locator('.scenes-next')).toContainText('Number 20')

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
  await expect(page.locator('.scenes-now')).toContainText('Number 19')
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
    await page.locator('.scenes-add').click()
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
  await vowsCell.locator('.matrix-place').selectOption({ label: 'Ch 1 · Ruth' })
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

    // Editing is not applying: the second strip joins the first on its fader, and the desk
    // hears nothing until the operator says so.
    const firstFader = page.locator('.matrix-row').first().locator('.matrix-cell').first()
    await firstFader.locator('.matrix-place').selectOption({ label: 'Ch 2' })
    await expect(firstFader.locator('.matrix-channel')).toHaveCount(2)
    await expect(page.locator('.matrix-apply')).toBeVisible()
    await page.waitForTimeout(300)
    expect(desk.received).toHaveLength(12)

    // The press that moves the room: the channel the scene has just placed is opened by
    // its own number, and the membership it now rides is reported as a gap — a desk that
    // takes a note on and a note off has no assignment for Cuerunner to write.
    await page.locator('.matrix-apply').click()
    await expect.poll(() => desk.received.length).toBe(13)
    expect(desk.received[12]).toEqual({ address: '/dca/2/on', args: [1] })
    await openLogPanel(page)
    await expect(page.locator('.log-panel')).toContainText('Cannot be told to this desk')
    await expect(page.locator('.log-panel')).toContainText('OSC takes no assignment')

    // The mutes are done — a second press changes nothing on the wire — but the placement
    // is still owed: an OSC desk takes no assignment, so the record never learns it and
    // the press stays up with the gap in the log, rather than going quiet about half a
    // recall. That is the honest half: the mic is open, the fader is not Cuerunner's to set.
    const written = desk.received.length
    await page.locator('.matrix-apply').click()
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
    // into one ensemble by its own member list, built in the Cast tab.
    await openShowSettings(page)
    const settings = page.locator('.show-settings-dialog')
    await settings.locator('.show-settings-tab', { hasText: 'Cast' }).click()
    const performers = settings.locator('.performer-row')
    const first = await performers.nth(0).locator('.performer-name').inputValue()
    const second = await performers.nth(1).locator('.performer-name').inputValue()
    await settings.locator('.ensemble-add').click()
    const ensemble = settings.locator('.ensemble-row').first()
    await ensemble.locator('.member-add').selectOption({ label: first })
    await ensemble.locator('.member-add').selectOption({ label: second })
    await expect(ensemble.locator('.member-chip')).toHaveCount(2)
    await settings.locator('.show-settings-done').click()

    // An ensemble routes nothing itself: applying it to a row is what puts both members'
    // strips on that fader, and the row names it and the members it now carries.
    const cell = page.locator('.matrix-row').first().locator('.matrix-cell').first()
    await cell.locator('.matrix-ensemble-add').selectOption({ label: 'Ensemble 1' })
    await expect(cell.locator('.matrix-ensemble')).toHaveAttribute('data-applied', 'on')
    await expect(cell.locator('.matrix-channel')).toHaveCount(2)

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
    // column — a column is ninety wide, so anything that is not that is a whole column out.
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

test('a member left off an ensemble rides nothing, and a recall closes it', async () => {
  test.setTimeout(60_000)
  const desk = await listenOsc(freePort())

  try {
    await buildDeskShow(page, desk.port)

    // The same two performers the case above groups: one the scene places by hand, one
    // the ensemble would bring on with it.
    await openShowSettings(page)
    const settings = page.locator('.show-settings-dialog')
    await settings.locator('.show-settings-tab', { hasText: 'Cast' }).click()
    const performers = settings.locator('.performer-row')
    const first = await performers.nth(0).locator('.performer-name').inputValue()
    const second = await performers.nth(1).locator('.performer-name').inputValue()
    await settings.locator('.ensemble-add').click()
    const ensemble = settings.locator('.ensemble-row').first()
    await ensemble.locator('.member-add').selectOption({ label: first })
    await ensemble.locator('.member-add').selectOption({ label: second })
    await expect(ensemble.locator('.member-chip')).toHaveCount(2)
    await settings.locator('.show-settings-done').click()

    const cell = page.locator('.matrix-row').first().locator('.matrix-cell').first()
    await cell.locator('.matrix-ensemble-add').selectOption({ label: 'Ensemble 1' })
    await expect(cell.locator('.matrix-channel')).toHaveCount(2)

    // Leaving a member off is a press on that member rather than a way of applying the
    // ensemble, so the member stays on the row and reads left off — while their strip's
    // chip, the one that says this row carries them, is gone. The group reads partly on:
    // that is the operator's sign that somebody in it is not riding this row.
    const leftOff = cell.locator('.matrix-member', { hasText: second })
    await leftOff.click()
    await expect(leftOff).toHaveAttribute('data-excluded', 'true')
    await expect(cell.locator('.matrix-channel')).toHaveCount(1)
    await expect(cell.locator('.matrix-channel')).toContainText(first)
    await expect(cell.locator('.matrix-ensemble')).toHaveAttribute('data-applied', 'partial')

    // A recall reads the row as it stands: the member left off is closed by its own
    // number, and only the strip still carrying the row is opened.
    const column = page.locator('.matrix-scene:not([data-all-closed]) .matrix-recall')
    await column.click()
    await expect.poll(() => desk.received.length).toBe(12)
    expect(desk.received[0]).toEqual({ address: '/dca/1/on', args: [1] })
    expect(desk.received[1]).toEqual({ address: '/dca/2/on', args: [0] })
    expect(desk.received.slice(2)).toEqual(
      [3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(number => ({ address: `/dca/${number}/on`, args: [0] }))
    )

    // The exclusion is the scene's state rather than a one-shot: the desk has been told,
    // so a second press has nothing left to say about the mutes.
    const recalled = desk.received.length
    await column.click()
    await page.waitForTimeout(300)
    expect(desk.received).toHaveLength(recalled)

    // The press is a toggle, and the member is back on the row. It is an edit, so the
    // desk hears nothing until a press asks it to.
    await leftOff.click()
    await expect(leftOff).toHaveAttribute('data-excluded', 'false')
    await expect(cell.locator('.matrix-channel')).toHaveCount(2)
    await expect(cell.locator('.matrix-ensemble')).toHaveAttribute('data-applied', 'on')
    await page.waitForTimeout(300)
    expect(desk.received).toHaveLength(recalled)

    // Where the operator reads it: the recall opened the one strip still on the row and
    // closed the other eleven — a dropped exclusion would read two opened.
    await openLogPanel(page)
    await expect(page.locator('.log-panel')).toContainText('Scene "Scene 1" — 1 opened, 11 closed')
  } finally {
    await desk.close()
  }
})

test('a long hostile name renders inert, whole in its title, and never widens the grid', async () => {
  test.setTimeout(60_000)
  await buildDeskShow(page, freePort())

  // A name as long as a company's own and as hostile as one pasted out of a browser. The
  // channel, the fader and the scene each take it.
  const hostileName = '<img src=x onerror="window.__scenePwned=1"> & the rest of a name no 192px column holds'
  await openShowSettings(page, 'channels')
  const settings = page.locator('.show-settings-dialog')
  const channel = settings.locator('.channel-row').first().locator('.channel-name')
  await channel.fill(hostileName)
  await expect(channel).toHaveValue(hostileName)
  await channel.press('Enter')
  const fader = settings.locator('.dca-row').first().locator('.dca-label')
  await fader.fill(hostileName)
  await fader.press('Enter')
  await settings.locator('.show-settings-done').click()

  // The scene's own name takes the same one, in the column header it is edited from.
  const sceneName = page.locator('.matrix-scene[data-scene-id] .scene-name-field').first()
  await sceneName.fill(hostileName)
  await sceneName.press('Enter')

  // Each of the three reads as text: characters to read, nothing to load, nothing to run.
  const chip = page.locator('.matrix-channel').first()
  await expect(chip).toContainText(hostileName)
  await expect(chip.locator('img')).toHaveCount(0)
  expect(await page.evaluate(() => (window as Window & { __scenePwned?: number }).__scenePwned))
    .toBeUndefined()

  // The column cuts the name; the whole of it is on the element — the chip's own title, the
  // row's fader label, and the scene header the column is named by.
  await expect(chip).toHaveAttribute('title', `Ch 1 · ${hostileName}`)
  await expect(page.locator('.matrix-fader').first()).toHaveAttribute('title', `1 · ${hostileName}`)
  await expect(sceneName).toHaveAttribute('title', hostileName)

  // The cut reads as an ellipsis rather than a name that stops mid-word, nothing spills out
  // of a cell, and none of it widens the view.
  const measured = await page.evaluate(() => {
    const view = document.querySelector('.scenes-view') as HTMLElement
    const name = document.querySelector('.matrix-channel-name') as HTMLElement
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

test('Create ensemble folds a row into one group, and one undo puts it back', async () => {
  test.setTimeout(60_000)
  const desk = await listenOsc(freePort())

  try {
    await buildDeskShow(page, desk.port)

    // The demo rack gives every strip a performer, and an ensemble names people: for the
    // row to carry something a group cannot hold, the second strip's performer comes off it.
    await openShowSettings(page, 'cast')
    const settings = page.locator('.show-settings-dialog')
    await settings.locator('.performer-row').nth(1).locator('.performer-channel')
      .selectOption({ label: '— unpatched —' })
    await settings.locator('.show-settings-done').click()

    // The row as the helper built it: one performer's strip placed by hand on the first
    // fader. The bare strip goes on beside it, so the row carries something a group can
    // hold and something it cannot.
    const cell = page.locator('.matrix-row').first().locator('.matrix-cell').first()
    await expect(cell.locator('.matrix-place option').first()).toHaveText('Place channel')
    await cell.locator('.matrix-place').selectOption({ label: 'Ch 2' })
    await expect(cell.locator('.matrix-channel')).toHaveCount(2)

    // What the scene carries is what a recall writes: two mics open and ten closed. The
    // desk is told exactly that before anything is grouped.
    await page.locator('.matrix-scene:not([data-all-closed]) .matrix-recall').click()
    await expect.poll(() => desk.received.length).toBe(12)
    expect(desk.received[0]).toEqual({ address: '/dca/1/on', args: [1] })
    expect(desk.received[1]).toEqual({ address: '/dca/2/on', args: [1] })
    expect(desk.received.slice(2).map(message => message.args[0])).toEqual(Array(10).fill(0))

    // The press says what it does, and is only there while it has a job. Grouping itself
    // is a settings edit, not a command to the desk.
    await expect(cell.locator('.matrix-ensemble-new')).toHaveText('Create ensemble')
    await expect(cell.locator('.matrix-ensemble-new'))
      .toHaveAttribute('title', 'Make a reusable ensemble from this row and apply it here')
    const written = desk.received.length
    await cell.locator('.matrix-ensemble-new').click()

    // One group, applied here, holding the performer: the strip nobody is patched to stays
    // a placement of its own, so the row carries exactly what it carried — and the control
    // goes with the job.
    await expect(cell.locator('.matrix-ensemble')).toHaveText('Ensemble 1')
    await expect(cell.locator('.matrix-ensemble')).toHaveAttribute('data-applied', 'on')
    await expect(cell.locator('.matrix-channel')).toHaveCount(2)
    await expect(cell.locator('.matrix-channel').first()).toContainText('Ch 1 · Ruth')
    await expect(cell.locator('.matrix-channel').last()).toContainText('Ch 2')
    await expect(cell.locator('.matrix-ensemble-new')).toHaveCount(0)

    // The desk has only received the earlier recall's two opened mics and ten closed, and
    // it is given the moment a message would have taken to arrive before that is read.
    await page.waitForTimeout(300)
    expect(desk.received).toHaveLength(written)

    // Undo is one press for the whole thing: the new group goes and the row is the hand
    // placements it was.
    await app.evaluate(({ Menu, BrowserWindow }) => {
      Menu.getApplicationMenu()
        ?.getMenuItemById('edit-undo')
        ?.click(undefined, BrowserWindow.getAllWindows()[0])
    })
    await expect(cell.locator('.matrix-ensemble')).toHaveCount(0)
    await expect(cell.locator('.matrix-channel')).toHaveCount(2)
    await expect(cell.locator('.matrix-ensemble-new')).toHaveText('Create ensemble')
  } finally {
    await desk.close()
  }
})

test('the view opens to run the show: Edit gives it back, and recalling never stops', async () => {
  test.setTimeout(60_000)
  const desk = await listenOsc(freePort())

  try {
    await buildDeskShow(page, desk.port)

    // Done: the show is being run, and a stray click changes nothing. A cell is a readout
    // — the strips its row places — and the presses that would change the show are not
    // drawn as presses: the pickers are gone and the ✕ beside a strip is disabled.
    await page.locator('.scenes-edit').click()
    await expect(page.locator('.scenes-view')).toHaveAttribute('data-editing', 'false')
    await expect(page.locator('.scenes-editing-hint')).toHaveCount(0)

    const cell = page.locator('.matrix-row').nth(1).locator('.matrix-cell').first()
    await expect(cell).toHaveAttribute('data-placed', 'false')
    await expect(page.locator('.matrix-place')).toHaveCount(0)
    await expect(page.locator('.matrix-ensemble-add')).toHaveCount(0)
    await expect(page.locator('.matrix-channel-remove').first()).toBeDisabled()
    await expect(page.locator('.scenes-add')).toHaveCount(0)
    await expect(page.locator('.matrix-scene-remove')).toHaveCount(0)

    // Recalling is what the view is for: it stays live. The desk has heard nothing, so the
    // recall says the whole show.
    await page.locator('.matrix-scene:not([data-all-closed]) .matrix-recall').click()
    await expect.poll(() => desk.received.length).toBe(12)
    expect(desk.received[0].args).toEqual([1])

    // And Edit gives the show back.
    await page.locator('.scenes-edit').click()
    await cell.locator('.matrix-place').selectOption({ label: 'Ch 2' })
    await expect(cell.locator('.matrix-channel')).toHaveCount(1)
  } finally {
    await desk.close()
  }
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
