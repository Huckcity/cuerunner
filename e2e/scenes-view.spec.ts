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
  listenOsc
} from './helpers'

let app: ElectronApplication
let page: Page

test.beforeEach(async () => {
  ;({ app, page } = await launchApp())
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

  // The group a mic feeds is a select on its row: this is the patch, where the mic is.
  const firstRow = page.locator('.matrix-row').first()
  await firstRow.locator('.matrix-group-select').selectOption('')
  await expect(firstRow.locator('.matrix-group-select')).toHaveValue('')
  await firstRow.locator('.matrix-group-select').selectOption({ label: 'DCA 1' })
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
    await expect(page.locator('.matrix-row').first().locator('.matrix-group-select')).toBeDisabled()
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
