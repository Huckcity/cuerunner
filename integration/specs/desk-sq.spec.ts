// Cuerunner and an SQ: the app drives the desk's DCAs over the desk's own MIDI socket, and
// the desk's own scene recall comes back to the app as a trigger.
//
// The counterpart is `integration/peers/desk.ts`, written from "SQ MIDI Protocol" (Issue 5
// and the V1.6 article). What is asserted is the wire and the desk's own state, never the
// app's account of itself: the point of a peer is that it can disagree. The app names the
// desk in Show Settings — the profile — and what arrives is what the document says an SQ
// takes, so the desk's own mute state moving is the assertion that the profile is right.
//
// The cases run in order and each leaves DCA 1 somewhere, which the next one needs: a
// recall that changes nothing sends nothing, and an assertion about the wire would then be
// about the app's bookkeeping instead of about the desk. Leaving it at: 1 open, 2 closed,
// 3 closed (the desk's own recall moves no DCA), 4 open again, 5 open as far as the app
// knows — the close it attempts is refused by a desk that is not there, which is the point
// of that case. An editor who adds a case in the middle has to say where it leaves the DCA.
import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { startDeskPeer, type DeskPeer } from '../peers/desk'
import { closeApp, launchApp, mintLicense, openFromRecent, openLogPanel, openScenesView, openShowSettings } from '../../e2e/helpers'
import { writeDeskShow } from './deskFixture'
import { BACK_GROUP, GO_GROUP } from './deskButtonsFixture'
import { openDeskWire, sqDcaGet, sqMuteValue } from './deskReadBack'
// The app's own reading of a show control command, so the text this case expects is what the
// app composes rather than a wording typed here.
import { describeMsc } from '../../src/renderer/src/utils/msc'

/** The channel the desk is set to, and the one the show is told it is. */
const CHANNEL = 1
/** DCA 1 on an SQ: parameter 0 of NRPN page 02, which is where the reference table puts it. */
const DCA_KEY = '02:00'

let app: ElectronApplication
let page: Page
let userDataDir: string
let peer: DeskPeer

/** The desk's own record of DCA 1's mute. */
function dcaMute(): { on: boolean; label: string } | undefined {
  return peer.state.mutes[DCA_KEY]
}

test.beforeAll(async () => {
  peer = await startDeskPeer({ profile: 'sq', midiChannel: CHANNEL })
  const show = writeDeskShow({ port: peer.port, channel: CHANNEL, profile: 'sq' })
  ;({ app, page, userDataDir } = await launchApp({ license: mintLicense() }))
  await openFromRecent(page, userDataDir, show)
  await openScenesView(page)
})

test.afterAll(async () => {
  await closeApp(app)
  await peer.close()
})

test('a scene recall reaches the desk as the NRPN mute it takes, and the desk moves', async () => {
  await page.locator('.matrix-scene:not([data-all-closed]) .matrix-recall').click()

  await expect.poll(() => peer.received.length).toBeGreaterThan(0)
  // The sequence is the one the document writes: select parameter 0 of page 02, then set
  // it — `B0 63 02 B0 62 00 B0 06 00 B0 26 01` — not the note-on the app's own
  // arrangement would have sent, which an SQ reads as soft-key traffic and ignores.
  expect(peer.received[0].bytes).toEqual([0xb0, 0x63, 0x02, 0xb0, 0x62, 0x00, 0xb0, 0x06, 0x00, 0xb0, 0x26, 0x01])
  await expect.poll(() => dcaMute()?.on).toBe(true)
  expect(dcaMute()?.label).toBe('DCA1')
})

test('the close is the same sequence with the fine byte at zero, and the desk comes back down', async () => {
  await page.locator('.matrix-scene[data-all-closed] .matrix-recall').click()

  // The half that never worked before the profile: the app used to close with a note-off,
  // which is not a mute to an SQ at all.
  await expect.poll(() => dcaMute()?.on).toBe(false)
})

test('the desk’s own scene recall fires the cue that answers to it', async () => {
  // Somebody recalls scene 7 at the desk. The desk transmits bank select + program change
  // on the base channel, and the show has a cue that answers to program 6.
  peer.recallScene(7)

  await openLogPanel(page)
  await expect(page.locator('.log-panel')).toContainText('Triggered by MIDI')
  await expect(page.locator('.log-panel')).toContainText(`127.0.0.1:${peer.port}`)
})

test('survives the burst an SQ sends the moment a client connects', async () => {
  // SQ units are reported to send traffic as soon as a connection is accepted. It is not an
  // answer to anything the app asked, and it must not put the link out of step.
  peer.emitConnectBurst()
  const before = peer.received.length

  // The DCA was closed by the case above, so this recall is a change and has somewhere to
  // go — which is what makes the assertion about the burst rather than about the app
  // deciding there was nothing to send.
  await page.locator('.matrix-scene:not([data-all-closed]) .matrix-recall').click()

  await expect.poll(() => peer.received.length).toBeGreaterThan(before)
  // What arrived after the burst is the whole open, not a fragment of it mistaken for one.
  expect(peer.received[peer.received.length - 1]).toMatchObject({ kind: 'mute', on: true })
})

test('a desk that goes away is reported, and the next recall reaches it when it is back', async () => {
  await peer.close()
  await openLogPanel(page)

  // The app finds out on its own, and says so where the operator is already looking: the
  // desk's row turns offline. Waiting for that is what makes the next assertion honest —
  // a write into a socket the far end has closed still succeeds, because that is TCP, so
  // the recall below only means something once the link is known to be gone.
  await expect(page.locator('.log-panel')).toContainText(`127.0.0.1:${peer.port}`)
  await expect(page.locator('.log-panel')).toContainText('offline')

  // A recall at a desk that is not there is a failure the operator reads, not a cue that
  // hangs: the show carries on. The DCA is open from the case above, so this closes it.
  await page.locator('.matrix-scene[data-all-closed] .matrix-recall').click()
  await expect(page.locator('.log-panel')).toContainText('Could not reach the desk')

  // The desk comes back on the same address. Nothing is touched in the app: the link dials
  // again on its own, which is what makes a desk that reboots mid-show survivable. Both
  // recalls are tried because the show's own state is whatever the failed one left it as,
  // and one of the two is a change either way.
  peer = await startDeskPeer({ profile: 'sq', midiChannel: CHANNEL, port: peer.port })
  await expect.poll(async () => {
    await page.locator('.matrix-scene[data-all-closed] .matrix-recall').click()
    await page.locator('.matrix-scene:not([data-all-closed]) .matrix-recall').click()
    return peer.received.length
  }, { timeout: 15_000 }).toBeGreaterThan(0)
})

test('the desk answers a get, and its own answer reads back as the value it holds', async () => {
  // The decode the hardware lane leans on, held where a lane that runs on every pull request
  // can answer it: the get is the one §3.7 of the SQ document describes, and what it is read
  // back against is the peer's own state — so a decoder that drifts from the document fails
  // here rather than on the one lane that needs a desk in the room.
  const wire = await openDeskWire('127.0.0.1', peer.port)
  try {
    peer.setMute(CHANNEL, 0, true, 0x02)
    const open = await wire.ask(sqDcaGet(CHANNEL))
    expect(open, 'the peer said nothing to a get').not.toBeNull()
    expect(sqMuteValue(open ?? [])).toBe(true)

    peer.setMute(CHANNEL, 0, false, 0x02)
    const closed = await wire.ask(sqDcaGet(CHANNEL))
    expect(closed, 'the peer said nothing to a get').not.toBeNull()
    expect(sqMuteValue(closed ?? [])).toBe(false)
  } finally {
    wire.close()
  }
})

/**
 * The show file the fixture writes, read back by the app.
 *
 * The hardware lane's show names a desk, carries the desk's own keys and can carry a console's
 * cable — and none of that runs on a machine without a desk. The shapes are held here instead:
 * the app has to read the buttons the file names and the extra cue that answers a console, or
 * the lane that needs a desk would be the first to find out (INTEGRATION-HARNESS.md §10 M3).
 */
test.describe('the show the fixture writes', () => {
  const CONSOLE_PORT = 'Console Cable Test'
  /** What the file says the console transmits — the trigger reads it back field for field. */
  const CONSOLE_COMMAND = {
    deviceId: 1,
    format: 'lighting',
    command: 'go',
    cueNumber: '12',
    cueList: '2'
  } as const

  test.beforeAll(async () => {
    // This case needs a show of its own, and the instance above is done with its one.
    await closeApp(app)
    const show = writeDeskShow({
      port: peer.port,
      channel: CHANNEL,
      profile: 'sq',
      buttons: { go: GO_GROUP, back: BACK_GROUP },
      msc: { port: CONSOLE_PORT, ...CONSOLE_COMMAND }
    })
    ;({ app, page, userDataDir } = await launchApp({ license: mintLicense() }))
    await openFromRecent(page, userDataDir, show)
  })

  test('the desk’s keys and the console’s cue are in the show the app opens', async () => {
    // The groups the file names are the show's own fields, so they read back where an
    // operator sets them.
    await openShowSettings(page, 'channels')
    const settings = page.locator('.show-settings-dialog')
    await expect(settings.locator('.desk-button-go')).toHaveValue(String(GO_GROUP))
    await expect(settings.locator('.desk-button-back')).toHaveValue(String(BACK_GROUP))
    await settings.locator('.show-settings-done').click()

    // And the cue that answers the console is there, armed, carrying the command's own
    // fields: every one of them is identity, so what the file says is what a console has to
    // send for the cue to fire. The text is the app's own reading of the command, so a
    // wording the app changes does not have to be chased here.
    await expect(page.locator('.cue-row')).toHaveCount(2)
    await expect(page.locator('.cue-row').nth(1)).toHaveAttribute('data-armed', 'true')
    await page.locator('.cue-row').nth(1).click()
    await page.locator('.inspector-tab', { hasText: 'Triggers' }).click()
    await expect(page.locator('.trigger-row[data-kind="msc"] .trigger-text'))
      .toHaveText(`Show Control ${describeMsc(CONSOLE_COMMAND)} from "${CONSOLE_PORT}"`)
  })
})
