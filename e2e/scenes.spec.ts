// Scenes: who is open on stage, and what the desk is told about it. The test owns a UDP
// port and the desk groups are pointed at it, so what is asserted is what actually left
// the app rather than what it intended to send.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { addCueFromMoreMenu, closeApp, launchApp, listenOsc } from './helpers'

let app: ElectronApplication
let page: Page

test.beforeEach(async () => {
  ;({ app, page } = await launchApp())
})

test.afterEach(async () => {
  await closeApp(app)
})

async function liveRack(): Promise<void> {
  await page.locator('.btn-rf').click()
  await page.locator('.rf-demo-btn').click()
  await expect(page.locator('.rf-row')).toHaveCount(12)
  await page.locator('.btn-rf').click()
}

async function openScenes(): Promise<void> {
  await page.locator('.btn-scenes').click()
  await expect(page.locator('.scenes-panel')).toBeVisible()
}

async function openSceneEditor(): Promise<void> {
  await page.locator('.scenes-actions .scenes-btn', { hasText: 'Edit scenes' }).click()
  await expect(page.locator('.scene-dialog')).toBeVisible()
}

/** Points the first pack in the plot at a desk group, the way an operator patches it. */
async function firstPackFeeds(label: string): Promise<void> {
  await page.locator('.btn-rf').click()
  await page.locator('.rf-edit').click()
  await page.locator('.plot-dialog .plot-pack-desk').first().selectOption({ label })
  await page.locator('.plot-close').click()
  await page.locator('.btn-rf').click()
}

/**
 * The whole setup, in the order an operator would do it: a group on the desk driven over
 * OSC at the port this test owns, a scene with the first mic open in it, and the pack
 * feeding that group.
 */
async function buildScene(port: number): Promise<void> {
  await liveRack()
  await openScenes()
  await openSceneEditor()

  const dialog = page.locator('.scene-dialog')
  await dialog.locator('.group-add').click()
  await dialog.locator('.group-delivery').first().selectOption('osc')
  await dialog.locator('.group-host').first().fill('127.0.0.1')
  await dialog.locator('.group-osc-port').first().fill(String(port))
  await dialog.locator('.group-osc-port').first().blur()
  await dialog.locator('.group-address').first().fill('/dca/1/mute')
  await dialog.locator('.group-address').first().blur()
  await expect(dialog.locator('.group-summary').first()).toContainText('/dca/1/mute')

  await dialog.locator('.scene-add').click()
  await dialog.locator('.scene-mic-row').first().locator('.scene-mic-toggle').check()
  await dialog.locator('.scene-close').click()

  await firstPackFeeds('DCA 1')
}

function port(): number {
  return 43600 + Math.floor(Math.random() * 2000)
}

test('a scene opens a mic and the desk is told about it', async () => {
  test.setTimeout(60_000)
  const desk = await listenOsc(port())

  try {
    await buildScene(desk.port)

    // Recall it: the group carrying the open mic is opened.
    await openScenes()
    await page.locator('.scene-recall').first().click()
    await expect.poll(() => desk.received.length).toBe(1)
    expect(desk.received[0]).toEqual({ address: '/dca/1/mute', args: [1] })

    // Close the mic in the scene, and the panel says the desk has not been told yet.
    await openSceneEditor()
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
  const desk = await listenOsc(port())

  try {
    await buildScene(desk.port)

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
  const desk = await listenOsc(port())

  try {
    await buildScene(desk.port)

    // Back to the scenes: the strips share the bottom of the window.
    await openScenes()
    await page.locator('.scenes-actions .scenes-btn', { hasText: 'Mics off' }).click()

    await expect.poll(() => desk.received.length).toBe(1)
    expect(desk.received[0].args).toEqual([0])
    await expect(page.locator('.desk-row').first()).toHaveAttribute('data-live', 'false')
  } finally {
    await desk.close()
  }
})
