// WinsLab and a desk's cue list over MIDI Show Control: the show tells the desk to GO, and
// the desk's own GO comes back to the show as a trigger.
//
// The counterpart is `integration/peers/desk.ts`, whose SQ profile reads the specification's
// commands because that range's document says its cue list answers them ("SQ MIDI Protocol",
// firmware V1.6). What is asserted is the desk's view of the wire and the desk's own cue
// list, never the app's account of itself.
import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { startDeskPeer, type DeskPeer } from '../peers/desk'
import { closeApp, launchApp, mintLicense, openFromRecent, openLogPanel } from '../../e2e/helpers'
import { writeMscShow } from './mscFixture'

/** The cue the show names on the desk's list. */
const CUE = '12'

let app: ElectronApplication
let page: Page
let userDataDir: string
let peer: DeskPeer

/** How many firings the desk's command has caused, as the log shows them. */
function firings(): Promise<number> {
  return page.locator('.log-panel .log-row', { hasText: 'Triggered by MSC' }).count()
}

test.beforeAll(async () => {
  peer = await startDeskPeer({ profile: 'sq' })
  const show = writeMscShow({ port: peer.port, cue: CUE })
  ;({ app, page, userDataDir } = await launchApp({ license: mintLicense() }))
  await openFromRecent(page, userDataDir, show)
})

test.afterAll(async () => {
  await closeApp(app)
  await peer.close()
})

test('a show control cue reaches the desk as the command it is', async () => {
  await page.locator('.cue-row').first().click()
  await page.keyboard.press('Space')

  await expect.poll(() => peer.received.length).toBeGreaterThan(0)
  // `F0 7F 7F 02 7F 01 31 32 00 F7` — the all-call and the all-types, Go, cue 12 — read by
  // the desk as the command rather than as a run of bytes.
  expect(peer.received[0]).toMatchObject({
    kind: 'msc',
    deviceId: 0x7f,
    format: 0x7f,
    command: 'go',
    cueNumber: CUE,
    cueList: ''
  })
  // And the desk's own list is standing where it was told to: what a console does with a
  // GO that names a cue.
  await expect.poll(() => peer.state.cue).toBe(CUE)
})

test('the desk’s own GO fires the cue that answers to it', async () => {
  peer.pressGo(CUE)

  await openLogPanel(page)
  await expect(page.locator('.log-panel'))
    .toContainText(`Triggered by MSC Go cue ${CUE} from "127.0.0.1:${peer.port}"`)
})

test('a desk that sends its GO twice in one breath fires once', async () => {
  await openLogPanel(page)
  // Past the command the case above sent: this case is about two presses inside one
  // window, not about the one before them — a first press inside that window would be
  // refused for the right reason and the count below would say nothing.
  await page.waitForTimeout(400)
  const before = await firings()

  peer.pressGo(CUE)
  peer.pressGo(CUE)

  await expect.poll(firings).toBe(before + 1)
  // Past the show's firing window, so a second firing would have arrived by now: this is
  // what makes the count above a statement about the guard rather than about timing.
  await page.waitForTimeout(400)
  expect(await firings()).toBe(before + 1)
})
