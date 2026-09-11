// The matrix: the view the show is run from. Scenes down the columns, mics down the rows,
// and a lock so that what happens at curtain up is recalling rather than editing.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { buildDeskShow, closeApp, freePort, launchApp, listenOsc } from './helpers'

let app: ElectronApplication
let page: Page

test.beforeEach(async () => {
  ;({ app, page } = await launchApp())
})

test.afterEach(async () => {
  await closeApp(app)
})

async function switchTo(view: 'Cues' | 'Matrix'): Promise<void> {
  await page.locator('.toolbar-view-btn', { hasText: view }).click()
}

test('the matrix is a view of the show, and recall works from it', async () => {
  test.setTimeout(60_000)
  const desk = await listenOsc(freePort())

  try {
    await buildDeskShow(page, desk.port)

    // The view the show is run from, in place of the cue list and the inspector.
    await switchTo('Matrix')
    const matrix = page.locator('.matrix-view')
    await expect(matrix).toBeVisible()
    await expect(page.locator('.inspector')).toHaveCount(0)

    // Twelve mics down the rows, one scene across the columns.
    await expect(page.locator('.matrix-row')).toHaveCount(12)
    await expect(page.locator('.matrix-scene')).toHaveCount(1)

    // Recalling from the column header is what the view is for.
    await page.locator('.matrix-recall').first().click()
    await expect.poll(() => desk.received.length).toBe(1)
    expect(desk.received[0]).toEqual({ address: '/dca/1/mute', args: [1] })
    await expect(page.locator('.matrix-scene').first()).toHaveAttribute('data-current', 'true')

    // And the cue stack is one click away again.
    await switchTo('Cues')
    await expect(page.locator('.inspector')).toBeVisible()
    await expect(matrix).toHaveCount(0)
  } finally {
    await desk.close()
  }
})

test('editing a cell moves the scene, and the desk is told only when asked', async () => {
  test.setTimeout(60_000)
  const desk = await listenOsc(freePort())

  try {
    await buildDeskShow(page, desk.port)
    await switchTo('Matrix')

    // Recall the scene as built: one mic open, and the group it feeds opened.
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

test('locking the view stops editing and leaves recalling alone', async () => {
  test.setTimeout(60_000)
  const desk = await listenOsc(freePort())

  try {
    await buildDeskShow(page, desk.port)
    await switchTo('Matrix')

    await page.locator('.matrix-lock').click()
    await expect(page.locator('.matrix-view')).toHaveAttribute('data-locked', 'true')
    await expect(page.locator('.matrix-locked-hint')).toBeVisible()

    // A cell cannot be moved, however hard it is clicked.
    const cell = page.locator('.matrix-row').nth(1).locator('.matrix-cell').first()
    await expect(cell).toBeDisabled()
    await cell.click({ force: true })
    await expect(cell).toHaveAttribute('data-live', 'false')

    // The editors are unreachable while the show is locked, from anywhere in the app.
    await page.locator('.btn-rf').click()
    await expect(page.locator('.rf-edit')).toBeDisabled()
    await page.locator('.btn-rf').click()
    await page.locator('.btn-scenes').click()
    await expect(page.locator('.scenes-actions .scenes-btn', { hasText: 'Edit scenes' })).toBeDisabled()
    await page.locator('.btn-scenes').click()

    // Recalling is what the lock is for: it stays live.
    await page.locator('.matrix-recall').first().click()
    await expect.poll(() => desk.received.length).toBe(1)
    expect(desk.received[0].args).toEqual([1])

    // And unlocking gives the show back.
    await page.locator('.matrix-lock').click()
    await expect(cell).toBeEnabled()
  } finally {
    await desk.close()
  }
})
