// The Scenes view: the matrix the show is run from and the only place scenes are
// edited. The DCAs, the cast and the ensembles are Show Settings'
// (`show-settings.spec.ts`); the test owns a UDP port and the show's desk points at it, so
// what is asserted here is what actually left the app.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import {
  addCueFromMoreMenu,
  buildDeskShow,
  closeApp,
  freePort,
  launchApp,
  listenOsc,
  mintLicense,
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

    // Twelve mics down the rows, one scene across the columns — plus the all-closed
    // column that is always there in front of them.
    await expect(page.locator('.matrix-row')).toHaveCount(12)
    await expect(page.locator('.matrix-scene:not([data-all-closed])')).toHaveCount(1)
    await expect(page.locator('.matrix-scene')).toHaveCount(2)

    // The all-closed column takes no one: a performer row has one cell per scene and a
    // blank where the empty stage is, so a scene's cell index is still its place among
    // the scenes.
    const row = page.locator('.matrix-row').first()
    await expect(row.locator('.matrix-cell')).toHaveCount(1)
    await expect(row.locator('.matrix-cell-blank')).toHaveCount(1)

    // Recalling from the column header is what the view is for.
    await page.locator('.matrix-scene:not([data-all-closed]) .matrix-recall').click()
    await expect.poll(() => desk.received.length).toBe(1)
    expect(desk.received[0]).toEqual({ address: '/dca/1/on', args: [1] })
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

  // The row is the performer, with the strip their mic is patched to beside them — the
  // name they were given named the strip, which is what the console calls it. Which DCA
  // that opens is set up in Show Settings, not in the grid the show is run from.
  await expect(page.locator('.matrix-performer').first()).toHaveText('Ruth')
  await expect(page.locator('.matrix-channel').first()).toHaveText('Ch 1 · Ruth')
  await expect(page.locator('.matrix-row').first().locator('select')).toHaveCount(0)
})

test('a show with many scenes still fits the window', async () => {
  test.setTimeout(60_000)

  await buildDeskShow(page, freePort())
  for (let i = 0; i < 12; i++) await page.locator('.scenes-add').click()
  await expect(page.locator('.matrix-scene:not([data-all-closed])')).toHaveCount(13)
  // Thirteen scenes and the all-closed column in front of them.
  await expect(page.locator('.matrix-scene')).toHaveCount(14)

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
  // The show has moved: the scenes view follows what the desk was told, so the cue has to
  // have landed before the view is asked where the show is.
  await expect(page.locator('.scenes-now')).toContainText('Number 19')
  await page.locator('.toolbar-view-btn', { hasText: 'Scenes' }).click()

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

  // And the next recall brings it back to the show, whichever hand moved the desk.
  await page.locator('.btn-go').click()
  await expect(page.locator('.scenes-now')).toContainText('Number 19')
  await expect(columns.nth(18)).toHaveAttribute('data-current', 'true')
  await expect(columns.nth(18)).toBeInViewport({ ratio: 1 })
})

test('deleting a scene leaves the view where it is, and undo puts it back', async () => {
  test.setTimeout(120_000)

  await buildDeskShow(page, freePort())
  const columns = page.locator('.matrix-scene:not([data-all-closed])')

  // Fifteen numbers, one of them named for what it does and with a mic of its own.
  for (let i = 0; i < 14; i++) {
    await page.locator('.scenes-add').click()
    const field = columns.last().locator('.scene-name-field')
    await field.fill(`Number ${i + 2}`)
    await field.blur()
  }
  const vows = columns.nth(2).locator('.scene-name-field')
  await vows.fill('Vows')
  await vows.blur()
  // The third cell of the row is the third scene: the all-closed column is a blank in
  // the row rather than a cell, so the index did not move.
  await page.locator('.matrix-row').nth(6).locator('.matrix-cell').nth(2).click()

  // The show reaches the fifteenth through the cue stack.
  await page.locator('.toolbar-view-btn', { hasText: 'Cues' }).click()
  await addCueFromMoreMenu(page, 'Scene')
  await page.locator('.inspector-tab', { hasText: 'Scene' }).click()
  await page.locator('#scene-cue-select').selectOption({ label: 'Number 15' })
  await page.locator('.btn-go').click()
  await page.locator('.toolbar-view-btn', { hasText: 'Scenes' }).click()
  await expect(columns.nth(14)).toHaveAttribute('data-current', 'true')

  // The operator scrolls back to the top of the show and deletes a scene they do not want.
  // That is an edit: the desk has not moved, so the view must not either — it used to snap
  // back to wherever the show was, as though the delete had been a recall.
  await page.locator('.matrix-scroll').evaluate(el => { el.scrollLeft = 0 })
  await columns.nth(2).locator('.matrix-scene-remove').click()
  await expect(columns).toHaveCount(14)
  expect(await page.locator('.matrix-scroll').evaluate(el => el.scrollLeft)).toBe(0)
  await expect(columns.last()).not.toBeInViewport()

  // Undo returns it where it was, with the mic it opens.
  await app.evaluate(({ Menu, BrowserWindow }) => {
    Menu.getApplicationMenu()
      ?.getMenuItemById('edit-undo')
      ?.click(undefined, BrowserWindow.getAllWindows()[0])
  })
  await expect(columns).toHaveCount(15)
  await expect(columns.nth(2).locator('.scene-name-field')).toHaveValue('Vows')
  await expect(page.locator('.matrix-row').nth(6).locator('.matrix-cell').nth(2))
    .toHaveAttribute('data-live', 'true')
})

test('editing a cell moves the scene, and the desk is told only when asked', async () => {
  test.setTimeout(60_000)
  const desk = await listenOsc(freePort())

  try {
    await buildDeskShow(page, desk.port)

    await page.locator('.matrix-scene:not([data-all-closed]) .matrix-recall').click()
    await expect.poll(() => desk.received.length).toBe(1)
    expect(desk.received[0].args).toEqual([1])

    // Two mics on one fader is what makes the desk's silence observable: the second strip
    // joins the first, so the second mic opening rides a fader that is already open.
    await openShowSettings(page)
    const settings = page.locator('.show-settings-dialog')
    await settings.locator('.channel-row').nth(1).locator('.channel-dca')
      .selectOption({ label: '1 · DCA 1' })
    await settings.locator('.show-settings-done').click()

    const secondMic = page.locator('.matrix-row').nth(1).locator('.matrix-cell').first()
    await secondMic.click()
    await expect(secondMic).toHaveAttribute('data-live', 'true')
    await expect(page.locator('.matrix-apply')).toHaveCount(0)
    expect(desk.received).toHaveLength(1)

    // The first mic closing leaves the second still riding the fader, so still nothing.
    const firstMic = page.locator('.matrix-row').first().locator('.matrix-cell').first()
    await firstMic.click()
    await expect(firstMic).toHaveAttribute('data-live', 'false')
    await expect(page.locator('.matrix-apply')).toHaveCount(0)
    expect(desk.received).toHaveLength(1)

    // The last mic on the fader closing does change it, and editing is not applying: the
    // desk waits until the operator says so.
    await secondMic.click()
    await expect(secondMic).toHaveAttribute('data-live', 'false')
    await expect(page.locator('.matrix-apply')).toBeVisible()
    expect(desk.received).toHaveLength(1)

    await page.locator('.matrix-apply').click()
    await expect.poll(() => desk.received.length).toBe(2)
    // The last mic went out, so the DCA closes.
    expect(desk.received[1]).toEqual({ address: '/dca/1/on', args: [0] })
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

    await expect.poll(() => desk.received.length).toBe(1)
    expect(desk.received[0]).toEqual({ address: '/dca/1/on', args: [1] })
    await page.locator('.btn-log').click()
    await expect(page.locator('.log-panel')).toContainText('Scene "Scene 1" — 1 opened')
  } finally {
    await desk.close()
  }
})

test('the all-closed column closes everything the show drives', async () => {
  test.setTimeout(60_000)
  const desk = await listenOsc(freePort())

  try {
    await buildDeskShow(page, desk.port)

    // The first column is the empty stage, and recalling it closes every DCA the show
    // drives — a scene of its own is not needed to get the desk back to nothing.
    await page.locator('.matrix-scene[data-all-closed] .matrix-recall').click()
    await expect.poll(() => desk.received.length).toBe(1)
    expect(desk.received[0]).toEqual({ address: '/dca/1/on', args: [0] })

    // The desk is left somewhere the view can say: the all-closed column is the state it
    // is on, not an absence of one.
    await expect(page.locator('.matrix-scene[data-all-closed]'))
      .toHaveAttribute('data-current', 'true')
  } finally {
    await desk.close()
  }
})

test('a scene that applies an ensemble opens every member of it', async () => {
  test.setTimeout(60_000)
  const desk = await listenOsc(freePort())

  try {
    await buildDeskShow(page, desk.port)

    // A second fader for the second mic: an ensemble is two mics moving together, and the
    // show the helper built drives one DCA.
    await openShowSettings(page)
    const settings = page.locator('.show-settings-dialog')
    await settings.locator('.dca-count-select').selectOption('2')
    await settings.locator('.channel-row').nth(1).locator('.channel-dca')
      .selectOption({ label: '2 · DCA 2' })

    // The two performers — the one the scene has open and the one after them — are grouped
    // into one ensemble by its member list.
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

    // An ensemble routes nothing itself: applying it to the scene is what opens both
    // mics, and each member's own DCA is told, at the address its own number makes.
    const applied = page.locator('.matrix-ensemble-row').first().locator('.matrix-cell').first()
    await applied.click()
    await expect(applied).toHaveAttribute('data-applied', 'on')

    // It is one grid: an ensemble's cell for a scene sits over the performers' cells for
    // the same scene, under the same header. A row that is one cell short draws every
    // column a place to the left — and takes every row after it with it, which is a
    // thing the clicks still do correctly and the eye does not.
    const boxOf = async (selector: string): Promise<{ x: number; width: number }> => {
      const box = await page.locator(selector).first().boundingBox()
      if (box === null) throw new Error(`${selector} is not on screen`)
      return box
    }
    const ensembleCell = await boxOf('.matrix-ensemble-row .matrix-cell')
    const performerCell = await boxOf('.matrix-row .matrix-cell')
    const sceneHeader = await boxOf('.matrix-scene:not([data-all-closed])')
    expect(ensembleCell.x).toBe(performerCell.x)
    expect(ensembleCell.width).toBe(performerCell.width)
    // The cell is inset by its own margin, so it starts a couple of pixels inside its
    // column — a column is ninety wide, so anything that is not that is a whole column out.
    expect(Math.abs(ensembleCell.x - sceneHeader.x)).toBeLessThan(4)

    await page.locator('.matrix-scene:not([data-all-closed]) .matrix-recall').click()
    await expect.poll(() => desk.received.length).toBe(2)
    expect(desk.received[0]).toEqual({ address: '/dca/1/on', args: [1] })
    expect(desk.received[1]).toEqual({ address: '/dca/2/on', args: [1] })
  } finally {
    await desk.close()
  }
})

test('the view opens to run the show: Edit gives it back, and recalling never stops', async () => {
  test.setTimeout(60_000)
  const desk = await listenOsc(freePort())

  try {
    await buildDeskShow(page, desk.port)

    // Done: the show is being run, and a stray click changes nothing.
    await page.locator('.scenes-edit').click()
    await expect(page.locator('.scenes-view')).toHaveAttribute('data-editing', 'false')
    await expect(page.locator('.scenes-editing-hint')).toHaveCount(0)

    const cell = page.locator('.matrix-row').nth(1).locator('.matrix-cell').first()
    await expect(cell).toBeDisabled()
    await cell.click({ force: true })
    await expect(cell).toHaveAttribute('data-live', 'false')
    await expect(page.locator('.scenes-add')).toHaveCount(0)
    await expect(page.locator('.matrix-scene-remove')).toHaveCount(0)
    // Editing the cast is not this view's either: Show Settings stays in the menu.
    await expect(page.locator('.scenes-ensemble')).toHaveCount(0)

    // Recalling is what the view is for: it stays live.
    await page.locator('.matrix-scene:not([data-all-closed]) .matrix-recall').click()
    await expect.poll(() => desk.received.length).toBe(1)
    expect(desk.received[0].args).toEqual([1])

    // And Edit gives the show back.
    await page.locator('.scenes-edit').click()
    await expect(cell).toBeEnabled()
    await expect(page.locator('.scenes-add')).toBeVisible()
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
