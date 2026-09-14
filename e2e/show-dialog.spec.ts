// The Show panel: performers, the ensembles that group them, and the desk groups those
// ensembles — or a performer alone — drive. This is what a scene recall actually sends,
// so the test owns a UDP port and asserts what left the app on the wire.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import {
  closeApp,
  editScenes,
  freePort,
  launchApp,
  liveRack,
  listenOsc,
  mintLicense,
  openScenesView,
  openShowDialog
} from './helpers'

let app: ElectronApplication
let page: Page

test.beforeEach(async () => {
  ;({ app, page } = await launchApp({ license: mintLicense() }))
})

test.afterEach(async () => {
  await closeApp(app)
})

/** Points a desk group at the test's own OSC listener. */
async function wireGroup(group: ReturnType<Page['locator']>, port: number, address: string): Promise<void> {
  await group.locator('.group-delivery').selectOption('osc')
  await group.locator('.group-host').fill('127.0.0.1')
  await group.locator('.group-osc-port').fill(String(port))
  await group.locator('.group-osc-port').blur()
  await group.locator('.group-address').fill(address)
  await group.locator('.group-address').blur()
}

test('an ensemble drives one shared group for every member', async () => {
  test.setTimeout(60_000)
  const desk = await listenOsc(freePort())

  try {
    await liveRack(page)
    await openScenesView(page)
    await editScenes(page)
    await openShowDialog(page)
    const show = page.locator('.show-dialog')

    await show.locator('.group-add').click()
    await wireGroup(show.locator('.group-row').first(), desk.port, '/dca/1/mute')

    await show.locator('.ensemble-add').click()
    const ensemble = show.locator('.ensemble-row').first()
    await ensemble.locator('.ensemble-group').selectOption({ label: 'DCA 1' })

    // Two performers into the ensemble, picked from its own member list.
    const performerRows = show.locator('.performer-row')
    const first = await performerRows.nth(0).locator('.performer-name').inputValue()
    const second = await performerRows.nth(1).locator('.performer-name').inputValue()
    await ensemble.locator('.member-add').selectOption({ label: first })
    await ensemble.locator('.member-add').selectOption({ label: second })
    await expect(ensemble.locator('.member-chip')).toHaveCount(2)

    await show.locator('.show-close').click()

    // Open only the second performer's mic; the shared group still has to open, since
    // an ensemble is live whenever any one of its members is.
    await page.locator('.scenes-add').click()
    await page.locator('.matrix-row').nth(1).locator('.matrix-cell').first().click()
    await page.locator('.matrix-recall').first().click()

    await expect.poll(() => desk.received.length).toBe(1)
    expect(desk.received[0]).toEqual({ address: '/dca/1/mute', args: [1] })
  } finally {
    await desk.close()
  }
})

test("a performer's own group overrides their ensemble's", async () => {
  test.setTimeout(60_000)
  const desk = await listenOsc(freePort())

  try {
    await liveRack(page)
    await openScenesView(page)
    await editScenes(page)
    await openShowDialog(page)
    const show = page.locator('.show-dialog')

    // One group for the ensemble, a second for the principal who overrides it.
    await show.locator('.group-add').click()
    await show.locator('.group-add').click()
    const ensembleGroup = show.locator('.group-row').nth(0)
    const principalGroup = show.locator('.group-row').nth(1)
    await wireGroup(ensembleGroup, desk.port, '/dca/1/mute')
    await wireGroup(principalGroup, desk.port, '/dca/2/mute')

    await show.locator('.ensemble-add').click()
    const ensemble = show.locator('.ensemble-row').first()
    await ensemble.locator('.ensemble-group').selectOption({ label: 'DCA 1' })

    const principal = show.locator('.performer-row').first()
    const principalName = await principal.locator('.performer-name').inputValue()
    await ensemble.locator('.member-add').selectOption({ label: principalName })

    // The override: the principal's own group, on top of the ensemble they just joined.
    await principal.locator('.performer-group').selectOption({ label: 'DCA 2' })

    await show.locator('.show-close').click()

    await page.locator('.scenes-add').click()
    await page.locator('.matrix-row').first().locator('.matrix-cell').first().click()
    await page.locator('.matrix-recall').first().click()

    // Only the principal's own group hears it — the ensemble's is left alone entirely,
    // since nothing routed to it changed.
    await expect.poll(() => desk.received.length).toBe(1)
    expect(desk.received[0]).toEqual({ address: '/dca/2/mute', args: [1] })
  } finally {
    await desk.close()
  }
})
