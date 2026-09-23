// Show Settings: the desk the show drives, the strips and who is patched to them, the
// ensembles that group the cast, and the mic plot. It is opened from the menu rather than
// from the Scenes view, so that is where the dialog is asserted from; the Scenes view only
// runs what this sets up (`scenes-view.spec.ts`).
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import {
  buildDeskShow,
  closeApp,
  editScenes,
  freePort,
  launchApp,
  listenOsc,
  liveRack,
  mintLicense,
  openLogPanel,
  openScenesView,
  openShowSettings,
  pointDeskAtOsc
} from './helpers'

let app: ElectronApplication
let page: Page

test.beforeEach(async () => {
  ;({ app, page } = await launchApp({ license: mintLicense() }))
})

test.afterEach(async () => {
  await closeApp(app)
})

test('the Cuerunner menu opens Show Settings on its Channels tab', async () => {
  // The application menu carries the same item, but it is Electron's own menu bar and
  // not part of the page; only the window's Cuerunner ▾ menu can be driven from here.
  await page.locator('.toolbar-brand').click()
  const item = page.locator('.file-menu [data-action="show-settings"]')
  await expect(item).toBeVisible()
  await expect(item).toContainText('Show Settings')
  await item.click()

  const dialog = page.getByRole('dialog', { name: 'Show Settings' })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('.show-settings-tab')).toHaveCount(3)
  // A show is set up starting from the console, so that is the tab the dialog lands on —
  // and the console is counted for already: twelve DCAs, one per strip.
  await expect(dialog.locator('.show-settings-tab', { hasText: 'Channels' }))
    .toHaveAttribute('data-active', 'true')
  await expect(dialog.locator('.dca-count-select')).toHaveValue('12')
  await expect(dialog.locator('.dca-row')).toHaveCount(12)
})

test('the desk connection is one place, read back as the addresses it will send', async () => {
  await openShowSettings(page)
  const dialog = page.locator('.show-settings-dialog')

  // Where the desk is the one thing about a show the app cannot know, so a new show points
  // at the local machine, on the port and the pattern most desks take.
  await expect(dialog.locator('.desk-kind')).toHaveValue('osc')
  await expect(dialog.locator('.desk-host')).toHaveValue('127.0.0.1')
  await expect(dialog.locator('.desk-port')).toHaveValue('8000')
  await expect(dialog.locator('.desk-address')).toHaveValue('/dca/{n}/on')
  await expect(dialog.locator('.desk-preview')).toContainText('/dca/1/on')
  await expect(dialog.locator('.desk-preview')).toContainText('/dca/12/on')

  // Moving the desk is typing over three fields, and the read-back is the addresses the
  // show will actually be sent: the pattern is what a DCA's number is turned into.
  const port = freePort()
  await dialog.locator('.desk-host').fill('10.0.0.7')
  await dialog.locator('.desk-host').blur()
  await dialog.locator('.desk-port').fill(String(port))
  await dialog.locator('.desk-port').blur()
  await dialog.locator('.desk-address').fill('/mixer/dca/{n}')
  await dialog.locator('.desk-address').blur()

  await expect(dialog.locator('.desk-host')).toHaveValue('10.0.0.7')
  await expect(dialog.locator('.desk-port')).toHaveValue(String(port))
  await expect(dialog.locator('.desk-address')).toHaveValue('/mixer/dca/{n}')
  await expect(dialog.locator('.desk-preview')).toContainText('/mixer/dca/1')
  await expect(dialog.locator('.desk-preview')).toContainText('/mixer/dca/12')
})

test('the DCA count resizes the faders, and a strip is a name and a number', async () => {
  await openShowSettings(page)
  const dialog = page.locator('.show-settings-dialog')

  // Twelve strips and twelve faders, from the defaults. A strip drives nothing by itself:
  // which fader it rides is the scene's decision, so the row says what it is — a number
  // and a name — and nothing on this tab is a routing.
  await expect(dialog.locator('.channel-row')).toHaveCount(12)
  await expect(dialog.locator('.channel-dca')).toHaveCount(0)
  await expect(dialog.locator('.dca-row').first().locator('.dca-carrying'))
    .toHaveText('nothing is placed on it yet')

  // A desk with two faders gets two rows. The strips stay: a strip is a console input, and
  // what a scene placed on a fader that is gone is a placement no row reads.
  await dialog.locator('.dca-count-select').selectOption('2')
  await expect(dialog.locator('.dca-row')).toHaveCount(2)
  await expect(dialog.locator('.channel-row')).toHaveCount(12)
  await expect(dialog.locator('.channel-row').first().locator('.channel-number')).toHaveText('1')
})

test('a fader carries one desk number, for a desk that counts them differently', async () => {
  test.setTimeout(60_000)
  await openShowSettings(page)
  const dialog = page.locator('.show-settings-dialog')

  // The profile is the MIDI desk's own fact, so the case is run on a desk reached over its
  // socket — and on an SQ, whose DCAs are parameters from zero.
  await dialog.locator('.desk-kind').selectOption('midi-tcp')
  await dialog.locator('.desk-tcp-host').fill('127.0.0.1')
  await dialog.locator('.desk-tcp-host').blur()
  await dialog.locator('.desk-profile').selectOption('sq')
  const override = dialog.locator('.dca-row').first().locator('.dca-override')

  // Empty is the number its place derives, and the placeholder says which: fader 1 is an
  // SQ's parameter 0, and the field is read in the desk's own numbering.
  await expect(override).toHaveValue('')
  await expect(override).toHaveAttribute('placeholder', '0')

  // A show told its desk numbers its faders differently writes the number here.
  await override.fill('3')
  await override.blur()
  await expect(override).toHaveValue('3')

  // A number outside the desk's own DCA block is refused rather than written: 9 would
  // address something else on the desk entirely.
  await override.fill('9')
  await override.blur()
  await expect(override).toHaveAttribute('data-refused', 'true')

  // And clearing it goes back to the number its place makes.
  await override.fill('')
  await override.blur()
  await expect(override).toHaveValue('')
  await dialog.locator('.show-settings-done').click()
})

test('the defaults take a show nobody wired to a desk of its own', async () => {
  test.setTimeout(60_000)
  const desk = await listenOsc(freePort())

  try {
    // Nothing here but the desk's own address, and one scene placing the first strip on
    // the first fader: everything else is what the defaults do.
    await liveRack(page)
    await pointDeskAtOsc(page, desk.port)
    await page.locator('.show-settings-done').click()
    await openScenesView(page)
    await editScenes(page)
    await page.locator('.scenes-add').click()
    await page.locator('.matrix-row').first().locator('.matrix-cell').first()
      .locator('.matrix-place').selectOption({ label: 'Ch 1' })
    await page.locator('.matrix-scene:not([data-all-closed]) .matrix-recall').click()

    // The desk has not been told anything yet, so the first recall says the whole show:
    // the strip the scene places is open and the eleven it says nothing about are closed,
    // each by its own number, at the address that number makes.
    await expect.poll(() => desk.received.length).toBe(12)
    expect(desk.received.map(message => message.address)).toEqual(
      Array.from({ length: 12 }, (_, index) => `/dca/${index + 1}/on`)
    )
    expect(desk.received.map(message => message.args[0])).toEqual([1, ...Array(11).fill(0)])

    // Now the desk is where the show says it is: the same recall has nothing left to say.
    await page.locator('.matrix-scene:not([data-all-closed]) .matrix-recall').click()
    await page.waitForTimeout(300)
    expect(desk.received).toHaveLength(12)
    // The gap is reported every time a placement moves, and this desk has no assignment
    // to write: an OSC desk mutes by number and takes nothing else.
    await openLogPanel(page)
    await expect(page.locator('.log-panel')).toContainText('OSC takes no assignment')
  } finally {
    await desk.close()
  }
})

test('a show with no desk sends nothing, however the scene moves', async () => {
  test.setTimeout(60_000)
  const desk = await listenOsc(freePort())

  try {
    await buildDeskShow(page, desk.port)

    // Until it is told otherwise, this show drives the test's listener: the whole show, the
    // placed strip open and the rest closed.
    await page.locator('.matrix-scene:not([data-all-closed]) .matrix-recall').click()
    await expect.poll(() => desk.received.length).toBe(12)
    expect(desk.received[0]).toEqual({ address: '/dca/1/on', args: [1] })

    // A show pointed at no desk says so under the desk connection, and a recall of the
    // all-closed column — which would close the fader — puts nothing on the wire at all.
    await openShowSettings(page)
    const dialog = page.locator('.show-settings-dialog')
    await dialog.locator('.desk-kind').selectOption('none')
    await expect(dialog.locator('.desk-hint')).toContainText('Nothing is sent')
    await dialog.locator('.show-settings-done').click()

    await page.locator('.matrix-scene[data-all-closed] .matrix-recall').click()
    await expect(page.locator('.matrix-scene[data-all-closed]'))
      .toHaveAttribute('data-current', 'true')

    // Long enough for a datagram that was never sent to not arrive.
    await page.waitForTimeout(300)
    expect(desk.received).toHaveLength(12)
  } finally {
    await desk.close()
  }
})

test('an ensemble built in the Cast tab rides every member when a scene applies it to a row', async () => {
  test.setTimeout(60_000)
  const desk = await listenOsc(freePort())

  try {
    await buildDeskShow(page, desk.port)

    // The two performers are put in one ensemble by name, from its own member list: an
    // ensemble is two mics moving together, and it is built where the cast is.
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
    await expect(ensemble.locator('.ensemble-count')).toHaveText('2 members')
    await settings.locator('.show-settings-done').click()

    // The ensemble routes nothing itself: applying it to a row is what puts both members'
    // strips on that fader, and the row names the ensemble and the members it carries.
    const cell = page.locator('.matrix-row').first().locator('.matrix-cell').first()
    await cell.locator('.matrix-ensemble-add').selectOption({ label: 'Ensemble 1' })
    const applied = cell.locator('.matrix-ensemble')
    await expect(applied).toHaveAttribute('data-applied', 'on')
    await expect(cell.locator('.matrix-channel')).toHaveCount(2)

    // A recall writes each member's mic by its own number, at the address that number
    // makes: the two the ensemble places are open and the ten the scene says nothing about
    // are closed.
    await page.locator('.matrix-scene:not([data-all-closed]) .matrix-recall').click()
    await expect.poll(() => desk.received.length).toBe(12)
    expect(desk.received[0]).toEqual({ address: '/dca/1/on', args: [1] })
    expect(desk.received[1]).toEqual({ address: '/dca/2/on', args: [1] })
    expect(desk.received.slice(2).map(message => message.args[0])).toEqual(Array(10).fill(0))
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
