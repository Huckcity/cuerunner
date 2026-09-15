// WinsLab and a sound desk: the show tells the desk's cue list to GO, and the desk's own
// button fires a cue in the show.
//
// The counterpart is `integration/peers/desk.ts`, whose SQ profile reads the specification's
// commands because that range's document says its cue list answers them ("SQ MIDI Protocol",
// firmware V1.6). What is asserted is the desk's view of the wire and the desk's own state,
// never the app's account of itself.
//
// Two things this lane deliberately does *not* hold, because neither is true of the desks:
//
//  - **The desk does not transmit MSC.** Nothing in the SQ's document says it sends a
//    command of its own, and neither range has a GO key: MSC is what the desk is *told*.
//    What a show listens to instead is a control somebody assigned at the desk — a soft key
//    set to "MIDI note On/Off" transmits on a press ("the SQ does not send note on/off
//    messages when a Soft Key is pressed unless the Soft Key is set to a MIDI note on/off
//    function"), and a mute key transmits its mute. The soft key is the case below.
//  - **A mute key is not reachable yet.** Its message is the NRPN sequence the desk's own
//    mutes are, and no trigger kind reads one; `INTEGRATION-HARNESS.md` §7 says so rather
//    than leaving a reader to find out on the night.
import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { startDeskPeer, type DeskPeer } from '../peers/desk'
import { closeApp, launchApp, mintLicense, openFromRecent, openLogPanel } from '../../e2e/helpers'
import { SOFT_KEY, writeMscShow } from './mscFixture'

/** The cue the show names on the desk's list. */
const CUE = '12'

let app: ElectronApplication
let page: Page
let userDataDir: string
let peer: DeskPeer

/** How many firings the desk's button has caused, as the log shows them. */
function firings(): Promise<number> {
  return page.locator('.log-panel .log-row', { hasText: 'Triggered by MIDI' }).count()
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
  // And the desk's own list is standing where it was told to: what a cue list does with a
  // GO that names a cue.
  await expect.poll(() => peer.state.cue).toBe(CUE)
})

test('a soft key assigned at the desk fires the cue that answers to it', async () => {
  peer.pressSoftKey(SOFT_KEY)

  await openLogPanel(page)
  await expect(page.locator('.log-panel'))
    .toContainText(`Triggered by MIDI noteOn note ${0x30 + SOFT_KEY - 1} on ch1 from "127.0.0.1:${peer.port}"`)
})

test('a key pressed twice in one breath fires once', async () => {
  await openLogPanel(page)
  // Past the press above: this case is about two presses inside one window, not about the
  // one before them — a first press inside that window would be refused for the right
  // reason and the count below would say nothing.
  await page.waitForTimeout(400)
  const before = await firings()

  peer.pressSoftKey(SOFT_KEY)
  peer.pressSoftKey(SOFT_KEY)

  await expect.poll(firings).toBe(before + 1)
  // Past the show's firing window, so a second firing would have arrived by now: this is
  // what makes the count above a statement about the guard rather than about timing.
  await page.waitForTimeout(400)
  expect(await firings()).toBe(before + 1)
})

test('a key nobody assigned sends nothing, so nothing fires', async () => {
  await openLogPanel(page)
  const before = await firings()

  // A soft key set to a function — a mute group, say — does not send a note; the peer's
  // SQ sends notes for its keys the way a desk that was set up to does. Key 8 is not the
  // one this show listens to, and the show says nothing about it.
  peer.pressSoftKey(8)

  await page.waitForTimeout(400)
  expect(await firings()).toBe(before)
})
