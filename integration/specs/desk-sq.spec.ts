// WinsLab and an SQ: the app drives the desk's DCAs over the desk's own MIDI socket, and
// the desk's own scene recall comes back to the app as a trigger.
//
// The counterpart is `integration/peers/desk.ts`, written from "SQ MIDI Protocol" (Issue 5
// and the V1.6 article). What is asserted is the wire and the desk's own state, never the
// app's account of itself: the point of a peer is that it can disagree.
import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { startDeskPeer, type DeskPeer } from '../peers/desk'
import { closeApp, launchApp, mintLicense, openFromRecent, openLogPanel, openScenesView } from '../../e2e/helpers'
import { writeDeskShow } from './deskFixture'

let app: ElectronApplication
let page: Page
let userDataDir: string
let peer: DeskPeer

test.beforeAll(async () => {
  peer = await startDeskPeer({ profile: 'sq', midiChannel: 1 })
  const show = writeDeskShow({ port: peer.port, channel: 1, dcaNote: 1 })
  ;({ app, page, userDataDir } = await launchApp({ license: mintLicense() }))
  await openFromRecent(page, userDataDir, show)
  await openScenesView(page)
})

test.afterAll(async () => {
  await closeApp(app)
  await peer.close()
})

test('a scene recall reaches the desk over its own socket', async () => {
  await page.locator('.matrix-scene:not([data-all-closed]) .matrix-recall').click()

  await expect.poll(() => peer.received.length).toBeGreaterThan(0)
  // The app's DCA model: DCA 1 is note 1 on the show's channel, and the scene that opens
  // it sends that note down the socket at velocity.
  expect(peer.received[0].bytes).toEqual([0x90, 0x01, 0x7f])

  // The bytes are the whole of what an SQ can make of them, and that is the finding: note 1
  // is below the desk's soft-key range (which starts at C3), and a DCA's mute is NRPN —
  // `B0 63 MB B0 62 LB B0 06 00 B0 26 01` — not a note. So the app's generic DCA model
  // opens nothing on a real SQ, and this peer says so by recording the message as raw
  // traffic rather than by quietly agreeing. A peer that agreed would have hidden it; the
  // fix is a desk profile that speaks each desk's own semantics (roadmap B4), not a
  // different transport. INTEGRATION-HARNESS.md §7 is where that is written down.
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

  await page.locator('.matrix-scene[data-all-closed] .matrix-recall').click()

  await expect.poll(() => peer.received.length).toBeGreaterThan(before)
  // The last thing the desk heard is the close the all-closed scene sends — a note-off for
  // DCA 1 — which arrived after the burst rather than being lost in its tail: the link is
  // still in step with the app.
  expect(peer.received[peer.received.length - 1].bytes).toEqual([0x80, 0x01, 0x00])
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
  // hangs: the show carries on.
  await page.locator('.matrix-scene:not([data-all-closed]) .matrix-recall').click()
  await expect(page.locator('.log-panel')).toContainText('Could not reach the desk')

  // The desk comes back on the same address. Nothing is touched in the app: the link dials
  // again on its own, which is what makes a desk that reboots mid-show survivable.
  peer = await startDeskPeer({ profile: 'sq', midiChannel: 1, port: peer.port })
  await expect.poll(async () => {
    await page.locator('.matrix-scene:not([data-all-closed]) .matrix-recall').click()
    return peer.received.length
  }, { timeout: 15_000 }).toBeGreaterThan(0)
})
