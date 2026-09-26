// Cuerunner and an Avantis: the same conversation as the SQ spec, on a desk whose protocol
// is a different document with different tables — which is the whole reason the two are
// separate specs and separate profiles.
//
// The desk side is `integration/peers/desk.ts`, written from "Avantis MIDI TCP/IP Protocol"
// (V2.0+). Its inputs answer on the desk's own MIDI channel, the note naming which one — a
// mic's mute is therefore a note-on whose velocity says which half of the pair it is (7F on,
// 3F off) and a velocity of 00 ending it — and a DCA assignment is NRPN 40 on that same
// channel, whose parameter MSB names the input and whose value carries `40 + the fader's
// place` into the DCA and the place alone out of it. The block four channels above the desk's
// own is its DCAs and its mute groups, which this app writes no message to at all: a mic is
// an input (AD-26). What is asserted is the wire and the desk's own state, so what the app
// sends is judged by the desk that receives it.
//
// This is also the only lane where both facts of a recall are on the same link, so both are
// read off one wire here — the assignment first, then the mic's mute. An SQ's membership is
// not on this link at all: it goes over the desk's own control service on 51326, which has a
// peer of its own, started by the SQ lane (Story 11.5), and no desk run has answered it.
//
// The cases run in order and leave the mic open, closed, closed and open again: the state each
// recall writes, which is what makes the next one a change that sends. The last case changes
// the show's desk for good and is therefore last, and it is also the one that says what a
// channel too high for the desk's *group* block does and does not cost: the assignment and the
// mic's mute still go, on the desk's own channel, because the block the address cannot reach is
// the buttons' and not the inputs'.
import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { startDeskPeer, type DeskPeer } from '../peers/desk'
import { closeApp, launchApp, mintLicense, openFromRecent, openLogPanel, openScenesView, openShowSettings } from '../../e2e/helpers'
import { DESK_HOST, writeDeskShow } from './deskFixture'

/** The desk's own channel, 12 — its default — which is what the show is told. */
const DESK_CHANNEL = 12
/**
 * The nibble the desk's own channel is on the wire, which is where every fact about a mic
 * answers: inputs are `CH 00`–`5F` on `N`, and DCA assignments are NRPN 40 on `N` too.
 */
const MIC_CHANNEL = DESK_CHANNEL - 1
/** Input 1's own note, which is the mic's number on the desk and the show's one channel. */
const MIC_NOTE = 0x00
/** The status byte every controller message on the desk's own channel carries. */
const CC = 0xb0 | MIC_CHANNEL
/** The same, for the note pair a mute is: 9N at the velocity, 9N at 00 to end it. */
const NOTE_ON = 0x90 | MIC_CHANNEL
/** The desk's own key for the mic's mute: the channel's nibble, then the input's own note. */
const MIC_KEY = `${MIC_CHANNEL.toString(16).padStart(2, '0')}:${MIC_NOTE.toString(16).padStart(2, '0')}`
/** NRPN 40 assigns a channel to a DCA; the value carries `40 + the fader's place`. */
const ASSIGN_PARAM = 0x40
/**
 * The nibble the last case's desk is on: the show is told 13, which is one channel higher than
 * the group block MIDI has room for, and a mic still answers on it.
 */
const MOVED_CHANNEL = 13 - 1

let app: ElectronApplication
let page: Page
let userDataDir: string
let peer: DeskPeer

/** The desk's own record of the mic's mute, at the strip's own note on the desk's channel. */
function micMute(): { on: boolean; label: string } | undefined {
  return peer.state.mutes[MIC_KEY]
}

test.beforeAll(async () => {
  peer = await startDeskPeer({ host: DESK_HOST, profile: 'avantis', midiChannel: DESK_CHANNEL })
  const show = writeDeskShow({ port: peer.port, channel: DESK_CHANNEL, profile: 'avantis' })
  ;({ app, page, userDataDir } = await launchApp({ license: mintLicense() }))
  await openFromRecent(page, userDataDir, show)
  await openScenesView(page)
})

test.afterAll(async () => {
  await closeApp(app)
  await peer.close()
})

test('a recall writes the membership first and then the mic’s mute, both on the desk’s own channel', async () => {
  await page.locator('.matrix-scene:not([data-all-closed]) .matrix-recall').click()

  await expect.poll(() => peer.received.length).toBeGreaterThan(0)
  // The assignment, as the document writes it: the parameter's MSB names the input — 0, this
  // show's one channel — the assignment is NRPN 40, and `40 + place 0` is that fader's DCA 1.
  // The peer decodes NRPN 40 into the fader it names, so the assertion is the desk's own
  // reading of the frames rather than the bytes being the only witness.
  expect(peer.received[0]).toMatchObject({
    kind: 'assign',
    channel: MIC_CHANNEL,
    parameter: ASSIGN_PARAM,
    on: true,
    label: 'DCA 1'
  })
  expect(peer.received[0].bytes)
    .toEqual([CC, 0x63, MIC_NOTE, CC, 0x62, ASSIGN_PARAM, CC, 0x06, ASSIGN_PARAM])

  // Then the mic's own mute. The scene places the channel, so the mic is open: velocity 3F is
  // this desk's OFF — 01–3F and not a note-off, which it ignores outright — and velocity 00
  // ends the pair. The desk's own state is what says the mic moved.
  expect(peer.received[1]).toMatchObject({
    kind: 'mute',
    channel: MIC_CHANNEL,
    note: MIC_NOTE,
    on: false,
    label: 'Input 1'
  })
  expect(peer.received[2]).toMatchObject({ kind: 'raw', bytes: [NOTE_ON, MIC_NOTE, 0x00] })
  await expect.poll(() => micMute()?.on).toBe(false)
  expect(micMute()?.label).toBe('Input 1')
})

test('the close clears the membership and is a note-on at velocity 7F, which is the ON this desk has', async () => {
  await page.locator('.matrix-scene[data-all-closed] .matrix-recall').click()

  // The clear is the same three controllers with the place alone as the value, and the mic
  // is closed with velocity 7F. The half that never worked before the profile: the app used
  // to close with a note-off, which the Avantis document says is ignored outright, so the
  // desk stayed open while the app believed it had closed it.
  await expect.poll(() => peer.received.length).toBeGreaterThan(3)
  expect(peer.received[3]).toMatchObject({
    kind: 'assign',
    channel: MIC_CHANNEL,
    parameter: ASSIGN_PARAM,
    value: 0x00,
    on: false,
    label: 'DCA 1'
  })
  expect(peer.received[3].bytes)
    .toEqual([CC, 0x63, MIC_NOTE, CC, 0x62, ASSIGN_PARAM, CC, 0x06, 0x00])
  expect(peer.received[4]).toMatchObject({ kind: 'mute', channel: MIC_CHANNEL, note: MIC_NOTE, on: true })
  await expect.poll(() => micMute()?.on).toBe(true)
})

test('the desk’s own scene recall fires the cue that answers to it', async () => {
  peer.recallScene(7)

  await openLogPanel(page)
  await expect(page.locator('.log-panel')).toContainText('Triggered by MIDI')
  await expect(page.locator('.log-panel')).toContainText(`${DESK_HOST}:${peer.port}`)
})

test('a channel too high for the desk’s group block is named in the settings, and the recall still goes', async () => {
  // 13 + 4 is channel 17, which MIDI does not have. That block is where an Avantis's DCAs and
  // its mute groups answer, so its buttons are what this show cannot read — and the row says so
  // before the night rather than previewing buttons nothing could arrive on. What is *not* out
  // of reach is the recall: a mic is an input, and every range addresses its inputs on the
  // desk's own channel, so both facts are still written. This is the last case in the file
  // because it changes the show's desk for good.
  await openShowSettings(page)
  const settings = page.locator('.show-settings-dialog')
  await settings.locator('.desk-tcp-channel').fill('13')
  await settings.locator('.desk-tcp-channel').blur()
  await expect(settings.locator('.desk-gap'))
    .toHaveText('An Avantis reads its GO and BACK keys four channels above its own — past what MIDI has from channel 13 — so the desk cannot run the show from its keys, but a recall still sends.')
  await settings.locator('.show-settings-done').click()

  const before = peer.received.length
  await page.locator('.matrix-scene:not([data-all-closed]) .matrix-recall').click()

  // The desk the show now names is on 13 — nibble 0c — and every fact about a mic carries it.
  // Nothing is addressed at 17, which is what a show that still wrote the DCA/mute-group block
  // would send and what no MIDI channel can carry.
  await expect.poll(() => peer.received.length).toBeGreaterThan(before)
  const arrived = peer.received.slice(before)
    .filter(message => message.kind === 'mute' || message.kind === 'assign')
  expect(arrived.map(message => message.channel)).toEqual([MOVED_CHANNEL, MOVED_CHANNEL])
  expect(arrived.map(message => message.kind)).toEqual(['assign', 'mute'])
  expect(arrived[0]).toMatchObject({ parameter: ASSIGN_PARAM, on: true, label: 'DCA 1' })
  expect(arrived[1]).toMatchObject({ note: MIC_NOTE, on: false })
})
