// Scenes: who is open on stage, and what the desk is told about it. The test owns a UDP
// port and the desk groups are pointed at it, so what is asserted is what actually left
// the app rather than what it intended to send.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import {
  addCueFromMoreMenu,
  buildDeskShow,
  closeApp,
  freePort,
  launchApp,
  listenOsc,
  openSceneEditor,
  openScenes
} from './helpers'

let app: ElectronApplication
let page: Page

test.beforeEach(async () => {
  ;({ app, page } = await launchApp())
})

test.afterEach(async () => {
  await closeApp(app)
})

test('a scene opens a mic and the desk is told about it', async () => {
  test.setTimeout(60_000)
  const desk = await listenOsc(freePort())

  try {
    await buildDeskShow(page, desk.port)

    // Recall it: the group carrying the open mic is opened.
    await openScenes(page)
    await page.locator('.scene-recall').first().click()
    await expect.poll(() => desk.received.length).toBe(1)
    expect(desk.received[0]).toEqual({ address: '/dca/1/mute', args: [1] })

    // Close the mic in the scene, and the panel says the desk has not been told yet.
    await openSceneEditor(page)
    await page.locator('.scene-dialog .scene-mic-row').first().locator('.scene-mic-toggle').uncheck()
    await page.locator('.scene-close').click()
    await expect(page.locator('.scene-pending')).toBeVisible()

    await page.locator('.scene-recall').first().click()
    await expect.poll(() => desk.received.length).toBe(2)
    expect(desk.received[1]).toEqual({ address: '/dca/1/mute', args: [0] })

    // And the log says what happened, in the operator's language rather than the wire's.
    await page.locator('.btn-log').click()
    await expect(page.locator('.log-panel')).toContainText('Scene')
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
    await addCueFromMoreMenu(page, 'Scene')
    await page.locator('.inspector-tab', { hasText: 'Scene' }).click()
    await page.locator('#scene-cue-select').selectOption({ label: 'Scene 1' })

    await page.locator('.btn-go').click()

    await expect.poll(() => desk.received.length).toBe(1)
    expect(desk.received[0]).toEqual({ address: '/dca/1/mute', args: [1] })

    // The run log reads as one story: the cue started, and the desk was told.
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

    // Back to the scenes: the strips share the bottom of the window.
    await openScenes(page)
    await page.locator('.scenes-actions .scenes-btn', { hasText: 'Mics off' }).click()

    await expect.poll(() => desk.received.length).toBe(1)
    expect(desk.received[0].args).toEqual([0])
    await expect(page.locator('.desk-row').first()).toHaveAttribute('data-live', 'false')
  } finally {
    await desk.close()
  }
})
