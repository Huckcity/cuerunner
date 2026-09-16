// Cuerunner and an Avantis: the same conversation as the SQ spec, on a desk whose protocol
// is a different document with different tables — which is the whole reason the two are
// separate specs and separate profiles.
//
// The desk side is `integration/peers/desk.ts`, written from "Avantis MIDI TCP/IP Protocol"
// (V2.0+): base MIDI channel N, DCAs on N+4 at notes 36–45 hex, mutes as a note-on whose
// velocity says which half of the pair it is. What is asserted is the wire and the desk's
// own state, so what the app sends is judged by the desk that receives it.
//
// The cases run in order and leave DCA 1 open, closed, closed: the last one needs a change
// to exist before it can be refused, which is what the close before it leaves behind.
import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { startDeskPeer, type DeskPeer } from '../peers/desk'
import { closeApp, launchApp, mintLicense, openFromRecent, openLogPanel, openScenesView, openShowSettings } from '../../e2e/helpers'
import { writeDeskShow } from './deskFixture'

/** The desk's own channel, 12 — its default — which is what the show is told. */
const DESK_CHANNEL = 12
/** DCA 1, per the document's channel map: base channel + 4 — channel 16 — at notes 36–45 hex. */
const DCA_NOTE = 0x36
/** The desk's own key for that fader: the channel nibble (15, which is channel 16) and the CH note. */
const DCA_KEY = '0f:36'

let app: ElectronApplication
let page: Page
let userDataDir: string
let peer: DeskPeer

/** The desk's own record of DCA 1's mute. */
function dcaMute(): { on: boolean; label: string } | undefined {
  return peer.state.mutes[DCA_KEY]
}

test.beforeAll(async () => {
  peer = await startDeskPeer({ profile: 'avantis', midiChannel: DESK_CHANNEL })
  const show = writeDeskShow({ port: peer.port, channel: DESK_CHANNEL, profile: 'avantis' })
  ;({ app, page, userDataDir } = await launchApp({ license: mintLicense() }))
  await openFromRecent(page, userDataDir, show)
  await openScenesView(page)
})

test.afterAll(async () => {
  await closeApp(app)
  await peer.close()
})

test('a scene recall mutes the DCA, four channels above the desk’s own', async () => {
  await page.locator('.matrix-scene:not([data-all-closed]) .matrix-recall').click()

  await expect.poll(() => peer.received.length).toBeGreaterThan(0)
  // The show is told the desk's channel is 12; the desk answers for DCA 1 on 16 at note
  // 0x36, which is the profile's arithmetic and not the operator's. Velocity 0x7F is on.
  expect(peer.received[0]).toMatchObject({
    kind: 'mute',
    on: true,
    bytes: [0x9f, DCA_NOTE, 0x7f]
  })
  await expect.poll(() => dcaMute()?.on).toBe(true)
  expect(dcaMute()?.label).toBe('DCA 1')
  // The document's mute is the pair: the note at the velocity, then velocity 00 to end it.
  expect(peer.received[1]).toMatchObject({ kind: 'raw', bytes: [0x9f, DCA_NOTE, 0x00] })
})

test('the close is a note-on at velocity 3F, which is the OFF this desk has', async () => {
  await page.locator('.matrix-scene[data-all-closed] .matrix-recall').click()

  // The half that never worked before the profile: the app used to close with a note-off,
  // which the Avantis document says is ignored outright, so the DCA stayed open on the
  // desk while the app believed it had closed it.
  await expect.poll(() => peer.received.some(entry => entry.bytes[0] === 0x9f && entry.bytes[2] === 0x3f))
    .toBe(true)
  await expect.poll(() => dcaMute()?.on).toBe(false)
})

test('the desk’s own scene recall fires the cue that answers to it', async () => {
  peer.recallScene(7)

  await openLogPanel(page)
  await expect(page.locator('.log-panel')).toContainText('Triggered by MIDI')
  await expect(page.locator('.log-panel')).toContainText(`127.0.0.1:${peer.port}`)
})

test('a show told a channel its DCAs do not answer on says so instead of sending', async () => {
  // 13 + 4 is channel 17, which MIDI does not have. The row says so before the night, and
  // a recall reports the refusal rather than wrapping into the desk's mute groups. This is
  // the last case in the file because it changes the show's desk for good.
  await openShowSettings(page)
  const settings = page.locator('.show-settings-dialog')
  await settings.locator('.desk-tcp-channel').fill('13')
  await settings.locator('.desk-tcp-channel').blur()
  await expect(settings.locator('.desk-gap'))
    .toHaveText('An Avantis answers four channels above its own, so its MIDI channel is 12 or lower.')
  await settings.locator('.show-settings-done').click()

  const before = peer.received.length
  await page.locator('.matrix-scene:not([data-all-closed]) .matrix-recall').click()

  await openLogPanel(page)
  await expect(page.locator('.log-panel')).toContainText('Cannot be told to this desk')
  expect(peer.received.length).toBe(before)
})
