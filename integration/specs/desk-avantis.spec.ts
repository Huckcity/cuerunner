// WinsLab and an Avantis: the same conversation as the SQ spec, on a desk whose protocol
// is a different document with different tables — which is the whole reason the two are
// separate specs and separate profiles.
//
// The desk side is `integration/peers/desk.ts`, written from "Avantis MIDI TCP/IP Protocol"
// (V2.0+): base MIDI channel N, DCAs on N+4 at notes 36–45, mutes as Note On with a
// velocity that says which half of the pair it is.
import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { startDeskPeer, type DeskPeer } from '../peers/desk'
import { closeApp, launchApp, mintLicense, openFromRecent, openLogPanel, openScenesView } from '../../e2e/helpers'
import { writeDeskShow } from './deskFixture'

/** The channel an Avantis addresses its DCAs on when the base channel is 12: N+4. */
const DCA_CHANNEL = 16
/** DCA 1, per the document's channel map: base channel + 4, notes 36–45. */
const DCA_NOTE = 36

let app: ElectronApplication
let page: Page
let userDataDir: string
let peer: DeskPeer

/** The desk's own record of the DCA's mute, keyed by channel and note. */
function dcaMute(): { on: boolean } | undefined {
  return Object.entries(peer.state.mutes)
    .filter(([key]) => key.endsWith(`:${DCA_NOTE.toString(16).padStart(2, '0')}`))
    .map(([, mute]) => mute)[0]
}

test.beforeAll(async () => {
  peer = await startDeskPeer({ profile: 'avantis', midiChannel: DCA_CHANNEL })
  const show = writeDeskShow({ port: peer.port, channel: DCA_CHANNEL, dcaNote: DCA_NOTE })
  ;({ app, page, userDataDir } = await launchApp({ license: mintLicense() }))
  await openFromRecent(page, userDataDir, show)
  await openScenesView(page)
})

test.afterAll(async () => {
  await closeApp(app)
  await peer.close()
})

test('a scene recall mutes the DCA, which is what a note at that velocity means here', async () => {
  await page.locator('.matrix-scene:not([data-all-closed]) .matrix-recall').click()

  await expect.poll(() => peer.received.length).toBeGreaterThan(0)
  // 0x9F | channel 15 → channel 16, note 0x24 = DCA 1, velocity 0x7F = mute on.
  expect(peer.received[0]).toMatchObject({
    kind: 'mute',
    on: true,
    bytes: [0x9f, 0x24, 0x7f]
  })
  await expect.poll(() => dcaMute()?.on).toBe(true)
})

test('the close half is a note-off, which an Avantis ignores', async () => {
  await page.locator('.matrix-scene[data-all-closed] .matrix-recall').click()

  // The app closes the DCA with a note-off — and the desk's document is explicit that a
  // received velocity of zero and a note-off are both ignored: its OFF is a Note On at
  // velocity 01–3F. So the bytes arrive and the desk does not move. This is the finding the
  // harness exists to make visible (INTEGRATION-HARNESS.md §7): the app's DCA model is
  // generic, the desk's is not, and the fix is a desk profile (roadmap B4) rather than
  // anything the transport should have decided alone. The assertion is on the desk's
  // documented behaviour, not on the app being right.
  await expect.poll(() => peer.received.some(message => message.bytes[0] === 0x8f)).toBe(true)
  expect(dcaMute()?.on).toBe(true)
})

test('the desk’s own scene recall fires the cue that answers to it', async () => {
  peer.recallScene(7)

  await openLogPanel(page)
  await expect(page.locator('.log-panel')).toContainText('Triggered by MIDI')
  await expect(page.locator('.log-panel')).toContainText(`127.0.0.1:${peer.port}`)
})
