// Show Settings: the DCAs the desk has and how they are driven, the strips and who is
// patched to them, the ensembles that group the cast, and the mic plot. It is opened
// from the menu rather than from the Scenes view, so that is where the dialog is
// asserted from; the Scenes view only runs what this sets up (`scenes-view.spec.ts`).
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import {
  closeApp,
  editScenes,
  freePort,
  launchApp,
  listenOsc,
  liveRack,
  mintLicense,
  openScenesView,
  openShowSettings,
  wireDca
} from './helpers'

let app: ElectronApplication
let page: Page

test.beforeEach(async () => {
  ;({ app, page } = await launchApp({ license: mintLicense() }))
})

test.afterEach(async () => {
  await closeApp(app)
})

test('the WinsLab menu opens Show Settings on its Channels tab', async () => {
  // The application menu carries the same item, but it is Electron's own menu bar and
  // not part of the page; only the window's WinsLab ▾ menu can be driven from here.
  await page.locator('.toolbar-brand').click()
  const item = page.locator('.file-menu [data-action="show-settings"]')
  await expect(item).toBeVisible()
  await expect(item).toContainText('Show Settings')
  await item.click()

  const dialog = page.getByRole('dialog', { name: 'Show Settings' })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('.show-settings-tab')).toHaveCount(3)
  // A show is set up starting from the console, so that is the tab the dialog lands on.
  await expect(dialog.locator('.show-settings-tab', { hasText: 'Channels' }))
    .toHaveAttribute('data-active', 'true')
  await expect(dialog.locator('.dca-count-select')).toHaveValue('0')
})

test('the Channels tab sets up the DCAs, the strips and what carries each one', async () => {
  await openShowSettings(page)
  const dialog = page.locator('.show-settings-dialog')

  // A show with no DCAs drives nothing, and says so rather than showing an empty row.
  await expect(dialog.locator('.dca-row')).toHaveCount(0)
  await dialog.locator('.dca-count-select').selectOption('2')
  await expect(dialog.locator('.dca-row')).toHaveCount(2)

  // A strip is a number, a name, and whether it is in tonight's patch.
  const first = dialog.locator('.channel-row').first()
  await first.locator('.channel-name').fill('Ruth')
  await first.locator('.channel-name').blur()
  await expect(first.locator('.channel-number')).toHaveText('1')
  await expect(first).toHaveAttribute('data-enabled', 'true')

  // Which DCA a strip carries is the whole desk-routing question, and the DCA row says
  // what is routed to it.
  await first.locator('.channel-dca').selectOption({ label: 'DCA 1' })
  await expect(dialog.locator('.dca-row').first().locator('.dca-carrying'))
    .toContainText('Ch 1 · Ruth')

  // Taking a strip out of the patch leaves it named and where it was; only the switch
  // changes, because the strip is remembered for the night it is back in.
  await first.locator('.channel-enabled').uncheck()
  await expect(first).toHaveAttribute('data-enabled', 'false')
  await expect(first.locator('.channel-name')).toHaveValue('Ruth')
})

test("a performer's strip is what drives the desk, not the performer", async () => {
  test.setTimeout(60_000)
  const desk = await listenOsc(freePort())

  try {
    await liveRack(page)
    await openShowSettings(page)
    const settings = page.locator('.show-settings-dialog')

    // One DCA on the desk, wired to the test's port, carried by the first strip.
    await settings.locator('.dca-count-select').selectOption('1')
    await wireDca(settings.locator('.dca-row').first(), desk.port, '/dca/1/mute')
    await settings.locator('.channel-row').first().locator('.channel-dca')
      .selectOption({ label: 'DCA 1' })

    // The first performer wears that strip; the second wears one in no DCA at all.
    await settings.locator('.show-settings-tab', { hasText: 'Cast' }).click()
    const performers = settings.locator('.performer-row')
    await performers.nth(0).locator('.performer-channel').selectOption({ label: 'Ch 1' })
    await performers.nth(1).locator('.performer-channel').selectOption({ label: 'Ch 2' })
    await settings.locator('.show-settings-done').click()

    await openScenesView(page)
    await editScenes(page)
    await page.locator('.scenes-add').click()

    // A row says what its performer is patched to.
    const rows = page.locator('.matrix-row')
    await expect(rows.nth(0).locator('.matrix-channel')).toHaveText('Ch 1')
    await expect(rows.nth(1).locator('.matrix-channel')).toHaveText('Ch 2')

    // Both mics are open in the scene, but only the strip that carries the DCA opens
    // anything on the desk.
    await rows.nth(0).locator('.matrix-cell').first().click()
    await rows.nth(1).locator('.matrix-cell').first().click()
    await page.locator('.matrix-scene:not([data-all-closed]) .matrix-recall').click()

    await expect.poll(() => desk.received.length).toBe(1)
    expect(desk.received[0]).toEqual({ address: '/dca/1/mute', args: [1] })
  } finally {
    await desk.close()
  }
})

test('an ensemble built in the Cast tab opens every member when a scene applies it', async () => {
  test.setTimeout(60_000)
  const desk = await listenOsc(freePort())

  try {
    await liveRack(page)
    await openShowSettings(page)
    const settings = page.locator('.show-settings-dialog')

    // Two DCAs on two addresses, carried by the first two strips...
    await settings.locator('.dca-count-select').selectOption('2')
    await wireDca(settings.locator('.dca-row').nth(0), desk.port, '/dca/1/mute')
    await wireDca(settings.locator('.dca-row').nth(1), desk.port, '/dca/2/mute')
    await settings.locator('.channel-row').nth(0).locator('.channel-dca')
      .selectOption({ label: 'DCA 1' })
    await settings.locator('.channel-row').nth(1).locator('.channel-dca')
      .selectOption({ label: 'DCA 2' })

    // ...worn by the first two performers...
    await settings.locator('.show-settings-tab', { hasText: 'Cast' }).click()
    const performers = settings.locator('.performer-row')
    await performers.nth(0).locator('.performer-channel').selectOption({ label: 'Ch 1' })
    await performers.nth(1).locator('.performer-channel').selectOption({ label: 'Ch 2' })

    // ...who are put in one ensemble by name, from its own member list.
    await settings.locator('.ensemble-add').click()
    const ensemble = settings.locator('.ensemble-row').first()
    const first = await performers.nth(0).locator('.performer-name').inputValue()
    const second = await performers.nth(1).locator('.performer-name').inputValue()
    await ensemble.locator('.member-add').selectOption({ label: first })
    await ensemble.locator('.member-add').selectOption({ label: second })
    await expect(ensemble.locator('.member-chip')).toHaveCount(2)
    await expect(ensemble.locator('.ensemble-count')).toHaveText('2 members')
    await settings.locator('.show-settings-done').click()

    // The ensemble itself routes nothing: applying it to the scene is what opens the
    // mics, and each member's own DCA is told, at its own address.
    await openScenesView(page)
    await editScenes(page)
    await page.locator('.scenes-add').click()
    const applied = page.locator('.matrix-ensemble-row').first().locator('.matrix-cell').first()
    await applied.click()
    await expect(applied).toHaveAttribute('data-applied', 'on')

    await page.locator('.matrix-scene:not([data-all-closed]) .matrix-recall').click()
    await expect.poll(() => desk.received.length).toBe(2)
    expect(desk.received[0]).toEqual({ address: '/dca/1/mute', args: [1] })
    expect(desk.received[1]).toEqual({ address: '/dca/2/mute', args: [1] })
  } finally {
    await desk.close()
  }
})

test('the Mic plot tab hands a pack to another performer and logs the swap', async () => {
  await liveRack(page)
  await openShowSettings(page, 'mic-plot')
  const dialog = page.locator('.show-settings-dialog')

  const firstPack = dialog.locator('.plot-pack-row').first()
  const assignment = firstPack.locator('.plot-pack-performer')

  // The demo's first pack belongs to Aldonza; hand it to the second performer.
  const options = await assignment.locator('option').evaluateAll(
    nodes => nodes.map(node => ({ value: (node as HTMLOptionElement).value, label: node.textContent }))
  )
  const second = options.filter(option => option.value !== '')[1]
  await assignment.selectOption(second.value)

  // The record is visible where it was made, and the run log has it for the timeline.
  await expect(dialog.locator('.plot-swaps')).toContainText('→')
  await dialog.locator('.show-settings-done').click()
  await page.locator('.btn-log').click()
  await expect(page.locator('.log-panel')).toContainText('Swap: Pack 1')
})

test('Escape and the ✕ close it, and a click behind it does not', async () => {
  await openShowSettings(page)
  const dialog = page.getByRole('dialog', { name: 'Show Settings' })

  // Half-typed is a state this dialog is in, so dismissing it is deliberate: a click on
  // the dimmed page behind it is not one.
  await page.locator('.show-settings-overlay').click({ position: { x: 5, y: 5 } })
  await expect(dialog).toBeVisible()

  // Escape closes it from wherever focus is inside.
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)

  // And so does the ✕ in its header.
  await openShowSettings(page, 'mic-plot')
  await expect(dialog).toBeVisible()
  await page.locator('.show-settings-close').click()
  await expect(dialog).toHaveCount(0)
})
