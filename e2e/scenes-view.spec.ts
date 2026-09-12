// The Scenes view: the matrix the show is run from and the only place scenes, mics and
// desk groups are edited. The test owns a UDP port and the desk groups point at it, so
// what is asserted is what actually left the app.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import {
  addCueFromMoreMenu,
  buildDeskShow,
  closeApp,
  freePort,
  launchApp,
  listenOsc,
  mintLicense
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

    // Twelve mics down the rows, one scene across the columns.
    await expect(page.locator('.matrix-row')).toHaveCount(12)
    await expect(page.locator('.matrix-scene')).toHaveCount(1)

    // Recalling from the column header is what the view is for.
    await page.locator('.matrix-recall').first().click()
    await expect.poll(() => desk.received.length).toBe(1)
    expect(desk.received[0]).toEqual({ address: '/dca/1/mute', args: [1] })
    await expect(page.locator('.matrix-scene').first()).toHaveAttribute('data-current', 'true')
  } finally {
    await desk.close()
  }
})

test('the show is edited in the view, not in a dialog', async () => {
  test.setTimeout(60_000)

  await buildDeskShow(page, freePort())

  // A second scene, and a third to remove.
  await page.locator('.scenes-add').click()
  await expect(page.locator('.matrix-scene')).toHaveCount(2)
  await page.locator('.scenes-add').click()
  await expect(page.locator('.matrix-scene')).toHaveCount(3)

  // Renaming happens in the column header, where the name is read.
  const second = page.locator('.matrix-scene').nth(1).locator('.scene-name-field')
  await second.fill('Wedding')
  await second.blur()
  // The name lives in an input, so it is the field's value that has to say so.
  await expect(page.locator('.matrix-scene').nth(1).locator('.scene-name-field'))
    .toHaveValue('Wedding')

  // Removing a scene is a ✕ on its column, and it takes its mics with it.
  await page.locator('.matrix-scene').nth(2).locator('.matrix-scene-remove').click()
  await expect(page.locator('.matrix-scene')).toHaveCount(2)

  // The row is who is wearing the mic. Which group that mic feeds is a patch, set up with
  // the rest of the plot rather than in the grid the show is run from.
  await expect(page.locator('.matrix-performer').first()).toHaveText('Aldonza')
  await expect(page.locator('.matrix-row').first().locator('select')).toHaveCount(0)
})

test('a show with many scenes still fits the window', async () => {
  test.setTimeout(60_000)

  await buildDeskShow(page, freePort())
  for (let i = 0; i < 12; i++) await page.locator('.scenes-add').click()
  await expect(page.locator('.matrix-scene')).toHaveCount(13)

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

test('the view follows the show past the side of the window', async () => {
  test.setTimeout(120_000)

  await buildDeskShow(page, freePort())

  // Twenty numbers: a musical is wider than any window, so the scene the show is in can sit
  // thousands of pixels off the side.
  const first = page.locator('.matrix-scene').first().locator('.scene-name-field')
  await first.fill('Number 1')
  await first.blur()
  for (let i = 0; i < 19; i++) {
    await page.locator('.scenes-add').click()
    const field = page.locator('.matrix-scene').last().locator('.scene-name-field')
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

  const current = page.locator('.matrix-scene[data-current="true"]')
  await expect(current).toHaveCount(1)
  // The nineteenth of twenty: both the scene the desk is in and the one after it are on
  // screen, which is the point of following at all — a short number cannot hide the next.
  await expect(current).toBeInViewport({ ratio: 1 })
  await expect(page.locator('.matrix-scene').nth(18)).toBeInViewport({ ratio: 1 })
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
  await page.locator('.matrix-scene').nth(4).locator('.matrix-recall').click()
  await expect(page.locator('.matrix-scene').nth(4)).toHaveAttribute('data-current', 'true')
  const gap = await page.evaluate(() => {
    const column = document.querySelector('.matrix-scene[data-current="true"]')!.getBoundingClientRect()
    const plot = document.querySelector('.matrix-mic')!.getBoundingClientRect()
    return Math.round(column.left - plot.right)
  })
  expect(Math.abs(gap)).toBeLessThanOrEqual(1)

  // Deep in the show, where there is nothing left to scroll: the scene the desk is on and
  // the one after it are both on screen, which is what following has to guarantee.
  await page.locator('.matrix-scene').nth(14).locator('.matrix-recall').click()
  await expect(page.locator('.matrix-scene').nth(14)).toHaveAttribute('data-current', 'true')
  await expect(page.locator('.matrix-scene').nth(14)).toBeInViewport({ ratio: 1 })
  await expect(page.locator('.matrix-scene').nth(15)).toBeInViewport({ ratio: 1 })

  // Scrolling by hand belongs to the operator: the view does not drag it back while nothing
  // is moving the show.
  await page.locator('.matrix-scroll').evaluate(el => { el.scrollLeft = 0 })
  await expect(page.locator('.matrix-scene').nth(14)).not.toBeInViewport()

  // And the next recall brings it back to the show, whichever hand moved the desk.
  await page.locator('.btn-go').click()
  await expect(page.locator('.scenes-now')).toContainText('Number 19')
  await expect(page.locator('.matrix-scene').nth(18)).toHaveAttribute('data-current', 'true')
  await expect(page.locator('.matrix-scene').nth(18)).toBeInViewport({ ratio: 1 })
})

test('deleting a scene leaves the view where it is, and undo puts it back', async () => {
  test.setTimeout(120_000)

  await buildDeskShow(page, freePort())

  // Fifteen numbers, one of them named for what it does and with a mic of its own.
  for (let i = 0; i < 14; i++) {
    await page.locator('.scenes-add').click()
    const field = page.locator('.matrix-scene').last().locator('.scene-name-field')
    await field.fill(`Number ${i + 2}`)
    await field.blur()
  }
  const vows = page.locator('.matrix-scene').nth(2).locator('.scene-name-field')
  await vows.fill('Vows')
  await vows.blur()
  await page.locator('.matrix-row').nth(6).locator('.matrix-cell').nth(2).click()

  // The show reaches the fifteenth through the cue stack.
  await page.locator('.toolbar-view-btn', { hasText: 'Cues' }).click()
  await addCueFromMoreMenu(page, 'Scene')
  await page.locator('.inspector-tab', { hasText: 'Scene' }).click()
  await page.locator('#scene-cue-select').selectOption({ label: 'Number 15' })
  await page.locator('.btn-go').click()
  await page.locator('.toolbar-view-btn', { hasText: 'Scenes' }).click()
  await expect(page.locator('.matrix-scene').nth(14)).toHaveAttribute('data-current', 'true')

  // The operator scrolls back to the top of the show and deletes a scene they do not want.
  // That is an edit: the desk has not moved, so the view must not either — it used to snap
  // back to wherever the show was, as though the delete had been a recall.
  await page.locator('.matrix-scroll').evaluate(el => { el.scrollLeft = 0 })
  await page.locator('.matrix-scene').nth(2).locator('.matrix-scene-remove').click()
  await expect(page.locator('.matrix-scene')).toHaveCount(14)
  expect(await page.locator('.matrix-scroll').evaluate(el => el.scrollLeft)).toBe(0)
  await expect(page.locator('.matrix-scene').nth(14)).not.toBeInViewport()

  // Undo returns it where it was, with the mic it opens.
  await app.evaluate(({ Menu, BrowserWindow }) => {
    Menu.getApplicationMenu()
      ?.getMenuItemById('edit-undo')
      ?.click(undefined, BrowserWindow.getAllWindows()[0])
  })
  await expect(page.locator('.matrix-scene')).toHaveCount(15)
  await expect(page.locator('.matrix-scene').nth(2).locator('.scene-name-field'))
    .toHaveValue('Vows')
  await expect(page.locator('.matrix-row').nth(6).locator('.matrix-cell').nth(2))
    .toHaveAttribute('data-live', 'true')
})

test('editing a cell moves the scene, and the desk is told only when asked', async () => {
  test.setTimeout(60_000)
  const desk = await listenOsc(freePort())

  try {
    await buildDeskShow(page, desk.port)

    await page.locator('.matrix-recall').first().click()
    await expect.poll(() => desk.received.length).toBe(1)
    expect(desk.received[0].args).toEqual([1])

    // Opening a second mic in the same group changes nothing on the desk: the group was
    // already open for the first one, and the view says so by not offering to apply.
    const secondMic = page.locator('.matrix-row').nth(1).locator('.matrix-cell').first()
    await secondMic.click()
    await expect(secondMic).toHaveAttribute('data-live', 'true')
    await expect(page.locator('.matrix-apply')).toHaveCount(0)
    expect(desk.received).toHaveLength(1)

    // Closing the mic that was holding the group open does change it, and editing is not
    // applying: the desk waits until the operator says so.
    const firstMic = page.locator('.matrix-row').first().locator('.matrix-cell').first()
    await firstMic.click()
    await expect(firstMic).toHaveAttribute('data-live', 'false')
    await expect(page.locator('.matrix-apply')).toBeVisible()
    expect(desk.received).toHaveLength(1)

    await page.locator('.matrix-apply').click()
    await expect.poll(() => desk.received.length).toBe(2)
    // The last mic went out, so the group closes.
    expect(desk.received[1]).toEqual({ address: '/dca/1/mute', args: [0] })
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
    expect(desk.received[0]).toEqual({ address: '/dca/1/mute', args: [1] })
    await page.locator('.btn-log').click()
    await expect(page.locator('.log-panel')).toContainText('Scene "Scene 1" — 1 opened')
  } finally {
    await desk.close()
  }
})

test('mics off closes everything the plot drives', async () => {
  test.setTimeout(60_000)
  const desk = await listenOsc(freePort())

  try {
    await buildDeskShow(page, desk.port)

    await page.locator('.scenes-mics-off').click()

    await expect.poll(() => desk.received.length).toBe(1)
    expect(desk.received[0].args).toEqual([0])
    await expect(page.locator('.group-state').first()).toHaveText('muted')
  } finally {
    await desk.close()
  }
})

test('locking stops editing and leaves recalling alone', async () => {
  test.setTimeout(60_000)
  const desk = await listenOsc(freePort())

  try {
    await buildDeskShow(page, desk.port)

    await page.locator('.matrix-lock').click()
    await expect(page.locator('.scenes-view')).toHaveAttribute('data-locked', 'true')
    await expect(page.locator('.scenes-locked-hint')).toBeVisible()

    // Nothing can be moved, however hard it is clicked.
    const cell = page.locator('.matrix-row').nth(1).locator('.matrix-cell').first()
    await expect(cell).toBeDisabled()
    await cell.click({ force: true })
    await expect(cell).toHaveAttribute('data-live', 'false')
    await expect(page.locator('.scenes-add')).toBeDisabled()
    await expect(page.locator('.matrix-scene-remove').first()).toBeDisabled()
    await expect(page.locator('.scenes-groups .group-label').first()).toBeDisabled()

    // Recalling is what the lock is for: it stays live, so does applying.
    await page.locator('.matrix-recall').first().click()
    await expect.poll(() => desk.received.length).toBe(1)
    expect(desk.received[0].args).toEqual([1])

    // And unlocking gives the show back.
    await page.locator('.matrix-lock').click()
    await expect(cell).toBeEnabled()
    await expect(page.locator('.scenes-add')).toBeEnabled()
  } finally {
    await desk.close()
  }
})
