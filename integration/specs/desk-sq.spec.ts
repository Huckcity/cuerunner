// Cuerunner and an SQ: the app drives the desk's own MIDI, and the desk's own scene recall
// comes back to the app as a trigger.
//
// The counterparts are two peers, one per service the desk exposes. `integration/peers/desk.ts`
// models the MIDI service on 51325, written from "SQ MIDI Protocol" (Issue 5 and the V1.6
// article), and `integration/peers/sqNative.ts` models the desk's own control service on 51326,
// whose frames were measured from an SQ-6 rather than published
// (`integration/fixtures/vendor/sq6-native-apply-2026-09-22.json`). What is asserted is the wire
// and the desk's own state, never the app's account of itself: the point of a peer is that it
// can disagree.
//
// A recall writes two facts on two links, and each is read the way its own link is read. The
// mic's mute is on the desk link: page 00 — an SQ's input mutes — at the channel's own number
// from zero, because a DCA is a control group and closing one is not how a mic is silenced
// (AD-26). The membership is on the desk's own control service: `f7 07 07 1d <ch-1> <dca-1>
// 01|00 00` and the channel's own flag after it, decoded by that peer into a record this spec
// matches against the capture's own bytes. Both halves are asserted in one case, because a
// recall is one act — and the show this lane opens is the capture's own show, inputs 1 and 3 on
// DCA 1 and inputs 8 and 9 on DCA 4, so the four pairs it writes are the four the capture
// measured.
//
// What the desk's own answer says is still unmeasured: the capture holds no frame in which the
// desk reports a membership, so the peer says nothing about one, and the claim stays where the
// record leaves it until a desk run (AD-24, INTEGRATION-HARNESS.md §6, §11 decision 6).
//
// The cases run in order and each leaves the mics somewhere, which the next one needs: a
// recall that changes nothing sends nothing, and an assertion about the wire would then be
// about the app's bookkeeping instead of about the desk. Leaving them at: 1 open — the four the
// capture places, and the five the scene names nowhere closed — 2 all nine closed by the
// all-closed column, 3 unmoved (the desk's own recall fires a cue and writes nothing), 4 open
// again, 5 wherever the two recalls that poll it leave them, since the close it attempts first
// is refused by a desk that is not there — which is the point of that case — and 6 open on the
// peer's state, since the last case is the decoder's and primes the desk by hand. An editor who
// adds a case in the middle has to say where it leaves the mics.
import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { startDeskPeer, type DeskMuteMessage, type DeskPeer } from '../peers/desk'
import { readCapture, startSqNativePeer, type SqNativeFlagFrame, type SqNativePairFrame, type SqNativePeer } from '../peers/sqNative'
import { closeApp, launchApp, mintLicense, openFromRecent, openLogPanel, openScenesView, openShowSettings } from '../../e2e/helpers'
import { writeDeskShow } from './deskFixture'
import type { DeskShowFader, DeskShowScene } from './deskFixture'
import { BACK_GROUP, GO_GROUP } from './deskButtonsFixture'
import { openDeskWire, sqMuteGet, sqMuteValue, SQ_INPUT_1 } from './deskReadBack'
// The app's own reading of a show control command, so the text this case expects is what the
// app composes rather than a wording typed here.
import { describeMsc } from '../../src/renderer/src/utils/msc'

/**
 * A loopback alias, and not 127.0.0.1: the desk's ports are the machine's rather than this
 * worker's. The unit job binds 51326/51321/51324 on `0.0.0.0` (`SqNativeEngine.test.ts`), and
 * the E2E lane's MSC show names `127.0.0.1` as its desk, so an app from that lane dialling
 * 51326 would attach to this peer — frames in the very record this file compares exactly. All
 * three jobs run on the same runner, so the lane dials and binds a second loopback address
 * instead, which costs nothing and cannot be reached by anything but this file.
 */
const HOST = '127.0.0.2'

/** The channel the desk is set to, and the one the show is told it is. */
const CHANNEL = 1
/** The first mic on an SQ: the input mutes are page 00, and its own number is 0. */
const MIC_KEY = '00:00'

/**
 * The show this lane opens is the capture's own show: nine controlled channels — their place in
 * the list is their input number — with inputs 1 and 3 on DCA 1 and inputs 8 and 9 on DCA 4, so
 * a recall writes the four pairs the capture measured and closes the five channels the scene
 * names nowhere. The second fader is the desk's DCA 4, which an SQ numbers from zero, so the
 * show's own number for it is 3.
 */
const CHANNELS = ['Ruth', 'Ada', 'Kit', 'Nell', 'Sam', 'Jo', 'Max', 'Ivy', 'Ted']
const FADERS: DeskShowFader[] = [
  { id: 'dca-1', label: 'DCA 1', deskNumber: null },
  { id: 'dca-4', label: 'DCA 4', deskNumber: 3 }
]
const SCENES: DeskShowScene[] = [
  { id: 's-1', name: 'Wedding', places: { 'dca-1': ['ch-1', 'ch-3'], 'dca-4': ['ch-8', 'ch-9'] } }
]
/**
 * The capture's own four assignments, read out of it rather than typed here: the frames its
 * `1d` form places, and the input and fader each of those frames' own bytes names. A byte form
 * that moved fails this lane, which is the point of a lane that runs on every pull request.
 */
const capture = readCapture()
const placed = capture.exchanges.filter(
  exchange => exchange.direction === 'to-desk' && exchange.bytes.startsWith('f707071d') && exchange.bytes.endsWith('0100')
)
const placedPairs = placed.map(exchange => ({
  channel: Number.parseInt(exchange.bytes.slice(8, 10), 16) + 1,
  dca: Number.parseInt(exchange.bytes.slice(10, 12), 16) + 1
}))

let app: ElectronApplication
let page: Page
let userDataDir: string
let peer: DeskPeer
let native: SqNativePeer

/** The desk's own record of the first mic's mute. */
function micMute(): { on: boolean; label: string } | undefined {
  return peer.state.mutes[MIC_KEY]
}

/** The membership frames a peer has read: one pair per (input, fader), in arrival order. */
function assignments(peer: SqNativePeer): SqNativePairFrame[] {
  return peer.received.filter((frame): frame is SqNativePairFrame => frame.kind === 'pair')
}

/** The per-channel flags a peer has read, which follow the pairs. */
function flags(peer: SqNativePeer): SqNativeFlagFrame[] {
  return peer.received.filter((frame): frame is SqNativeFlagFrame => frame.kind === 'flag')
}

/** The mutes a peer of the desk link has read, which is the half this lane reads on 51325. */
function mutes(peer: DeskPeer): DeskMuteMessage[] {
  return peer.received.filter((message): message is DeskMuteMessage => message.kind === 'mute')
}

/**
 * Whether the peers and the app came up. A run that could not take the desk's ports stops in
 * `beforeAll` and reports the file skipped; the teardown closes what started, and a `TypeError`
 * there would be reported instead of the sentence naming what holds them.
 */
let running = false

test.beforeAll(async () => {
  peer = await startDeskPeer({ host: HOST, profile: 'sq', midiChannel: CHANNEL })
  try {
    native = await startSqNativePeer({ host: HOST })
  } catch (error) {
    // Somebody else is on the desk's ports — another job's app, an app left running, a process
    // started by hand. This file's case is about frames it compares to the capture exactly, so
    // a port it cannot hold is a lane that did not run rather than a lane that failed: what
    // started is closed, and the run reports skipped with the sentence below (AD-24).
    await peer.close()
    test.skip(
      true,
      `${(error as Error).message}\n\n` +
        'The SQ’s own control service is the desk’s, on fixed ports, and the app dials 51326 ' +
        `for any SQ show — this lane stands in for that service on ${HOST}, so nothing else may ` +
        'hold them (51326 TCP, 51321 TCP where `BYE.` goes, 51324 UDP). A desk on the network ' +
        'is not this port on loopback, and another lane’s app is not this file’s desk.'
    )
    return
  }
  const show = writeDeskShow({
    host: HOST,
    port: peer.port,
    channel: CHANNEL,
    profile: 'sq',
    channels: CHANNELS,
    faders: FADERS,
    scenes: SCENES
  })
  ;({ app, page, userDataDir } = await launchApp({ license: mintLicense() }))
  await openFromRecent(page, userDataDir, show)
  await openScenesView(page)
  running = true
})

test.afterAll(async () => {
  if (!running) return
  await closeApp(app)
  await peer.close()
  await native.close()
})

test('a recall writes the capture’s own membership, and both fader ranges’ mics follow it', async () => {
  await page.locator('.matrix-scene:not([data-all-closed]) .matrix-recall').click()

  // The membership half, on the desk's own control service: the four pairs the capture places,
  // decoded by that peer out of the app's own bytes and matched against the capture's. The
  // session comes first — the app opens the measured one before it writes anything on it — and
  // the pair each channel is placed by is followed by that channel's own flag.
  await expect.poll(() => assignments(native).length).toBe(placed.length)
  expect(assignments(native).map(frame => ({ channel: frame.channel, dca: frame.dca, placed: frame.placed })))
    .toEqual(placedPairs.map(pair => ({ ...pair, placed: true })))
  expect(assignments(native).map(frame => Buffer.from(frame.bytes).toString('hex')))
    .toEqual(placed.map(exchange => exchange.bytes))
  expect(native.received.filter(frame => frame.kind === 'pair' || frame.kind === 'flag').map(frame => frame.kind))
    .toEqual(['pair', 'flag', 'pair', 'flag', 'pair', 'flag', 'pair', 'flag'])
  expect(flags(native).map(frame => ({ channel: frame.channel, rides: frame.rides })))
    .toEqual(placedPairs.map(pair => ({ channel: pair.channel, rides: true })))
  // The session the lane now sees, rather than the log line a session that could not come up
  // used to leave behind: the app opens the measured session on this socket before it writes
  // anything on it — the hello, the identify, the descriptor, the settle, the push and its two
  // followers as the capture's own wire orders them, and the session's `f7 02 02 20 …` between
  // the ping and the settle, which this peer reads raw rather than guesses at — the peer
  // answered the first frame of it, and nothing but the session's own traffic precedes the
  // first membership frame.
  expect(native.received.slice(0, 9).map(frame => frame.kind)).toEqual([
    'session',
    'session',
    'session',
    'session',
    'session',
    'session',
    'session',
    'raw',
    'session'
  ])
  const firstPair = native.received.findIndex(frame => frame.kind === 'pair')
  expect(firstPair).toBeGreaterThanOrEqual(9)
  expect(native.received.slice(9, firstPair).every(frame => frame.kind === 'session')).toBe(true)
  expect(native.sent.length).toBeGreaterThanOrEqual(1)

  // And the session kept alive the way §6 measures it: the app's datagram arrives on the
  // desk's own port, and the peer witnesses it as arrival and width alone — the capture holds
  // no datagram at all, so what the desk makes of its body is nothing this lane can read.
  await expect.poll(() => native.keepalives.length, { timeout: 5_000 }).toBeGreaterThan(0)
  expect(native.keepalives.every(datagram => datagram.length === 8)).toBe(true)

  // The other half, on the desk link: the four mics the scene places are open — fine byte 00,
  // which is this desk's unmuted — and the five it names nowhere are closed, one write each,
  // in the scene's own order: the first fader's channels, then the second's, then the rest of
  // the controlled set.
  await expect.poll(() => mutes(peer).length).toBe(CHANNELS.length)
  expect(mutes(peer).map(message => ({ page: message.page, note: message.note, on: message.on })))
    .toEqual([
      { page: 0x00, note: 0x00, on: false },
      { page: 0x00, note: 0x02, on: false },
      { page: 0x00, note: 0x07, on: false },
      { page: 0x00, note: 0x08, on: false },
      { page: 0x00, note: 0x01, on: true },
      { page: 0x00, note: 0x03, on: true },
      { page: 0x00, note: 0x04, on: true },
      { page: 0x00, note: 0x05, on: true },
      { page: 0x00, note: 0x06, on: true }
    ])
  // The sequence is the one the document writes: select parameter 0 of page 00 — the first
  // input's own mute — then set it, `B0 63 00 B0 62 00 B0 06 00 B0 26 00`. It is not page 02,
  // which is where a DCA's mute lives and which this app no longer writes at all, and it is not
  // the note-on the app's own arrangement would have sent, which an SQ reads as soft-key
  // traffic and ignores.
  expect(mutes(peer)[0].bytes).toEqual([0xb0, 0x63, 0x00, 0xb0, 0x62, 0x00, 0xb0, 0x06, 0x00, 0xb0, 0x26, 0x00])
  expect(mutes(peer)[1].bytes).toEqual([0xb0, 0x63, 0x00, 0xb0, 0x62, 0x02, 0xb0, 0x06, 0x00, 0xb0, 0x26, 0x00])
  // And the desk's own state moved with the first of them.
  await expect.poll(() => micMute()?.on).toBe(false)
  expect(micMute()?.label).toBe('Ip1')

  // Nothing outside the controlled set, on either record: nine channels is this show's whole
  // set, so no mute names an input past the ninth, every mute is an input's own (page 00 — a
  // DCA is never silenced by a recall, AD-26), and every membership frame names one of the four
  // pairs the capture places.
  expect(mutes(peer).every(message => message.page === 0x00 && message.note < CHANNELS.length)).toBe(true)
  expect(mutes(peer).filter(message => message.page === 0x02)).toEqual([])
  expect(assignments(native).every(frame =>
    frame.channel >= 1 && frame.channel <= CHANNELS.length &&
    placedPairs.some(pair => pair.channel === frame.channel && pair.dca === frame.dca)
  )).toBe(true)
})

test('the close is the same frames cleared, and the mics of both ranges come down', async () => {
  const pairsBefore = assignments(native).length
  const flagsBefore = flags(native).length
  const mutesBefore = mutes(peer).length
  await page.locator('.matrix-scene[data-all-closed] .matrix-recall').click()

  // The half that never worked before the profile: the app used to close a DCA with a note-off,
  // which is not a mute to an SQ at all. The mic is closed with the desk's own form and the
  // other fine byte, and the desk's own state is what says so.
  await expect.poll(() => mutes(peer).length).toBe(mutesBefore + placed.length)
  expect(mutes(peer).slice(mutesBefore).map(message => ({ note: message.note, on: message.on })))
    .toEqual(placedPairs.map(pair => ({ note: pair.channel - 1, on: true })))
  expect(mutes(peer)[mutesBefore].bytes)
    .toEqual([0xb0, 0x63, 0x00, 0xb0, 0x62, 0x00, 0xb0, 0x06, 0x00, 0xb0, 0x26, 0x01])
  await expect.poll(() => micMute()?.on).toBe(true)

  // And the membership comes with it: the same four pairs written `00 00`, each followed by its
  // channel's flag — which now says the channel rides no fader at all, the polarity the capture
  // fixes from its own pairing.
  await expect.poll(() => assignments(native).length).toBe(pairsBefore + placed.length)
  expect(assignments(native).slice(pairsBefore).map(frame => ({ channel: frame.channel, dca: frame.dca, placed: frame.placed })))
    .toEqual(placedPairs.map(pair => ({ ...pair, placed: false })))
  expect(flags(native).slice(flagsBefore).map(frame => ({ channel: frame.channel, rides: frame.rides })))
    .toEqual(placedPairs.map(pair => ({ channel: pair.channel, rides: false })))
})

test('the desk’s own scene recall fires the cue that answers to it', async () => {
  // Somebody recalls scene 7 at the desk. The desk transmits bank select + program change
  // on the base channel, and the show has a cue that answers to program 6.
  peer.recallScene(7)

  await openLogPanel(page)
  await expect(page.locator('.log-panel')).toContainText('Triggered by MIDI')
  await expect(page.locator('.log-panel')).toContainText(`${HOST}:${peer.port}`)
})

test('survives the burst an SQ sends the moment a client connects', async () => {
  // SQ units are reported to send traffic as soon as a connection is accepted. It is not an
  // answer to anything the app asked, and it must not put the link out of step.
  peer.emitConnectBurst()
  const before = mutes(peer).length

  // The mics were closed by the case above, so this recall is a change and has somewhere to
  // go — which is what makes the assertion about the burst rather than about the app
  // deciding there was nothing to send.
  await page.locator('.matrix-scene:not([data-all-closed]) .matrix-recall').click()

  await expect.poll(() => mutes(peer).length).toBe(before + placedPairs.length)
  // What arrived after the burst is the whole open, not a fragment of it mistaken for one: the
  // scene's four mics, in the scene's own order, and nothing else.
  expect(mutes(peer).slice(before).map(message => ({ page: message.page, note: message.note, on: message.on })))
    .toEqual(placedPairs.map(pair => ({ page: 0x00, note: pair.channel - 1, on: false })))
})

test('a desk that goes away is reported, and the next recall reaches it when it is back', async () => {
  await peer.close()
  await openLogPanel(page)

  // The app finds out on its own, and says so where the operator is already looking: the
  // desk's row turns offline. Waiting for that is what makes the next assertion honest —
  // a write into a socket the far end has closed still succeeds, because that is TCP, so
  // the recall below only means something once the link is known to be gone.
  await expect(page.locator('.log-panel')).toContainText(`${HOST}:${peer.port}`)
  await expect(page.locator('.log-panel')).toContainText('offline')

  // A recall at a desk that is not there is a failure the operator reads, not a cue that
  // hangs: the show carries on. The mic is open from the case above, so this closes it.
  await page.locator('.matrix-scene[data-all-closed] .matrix-recall').click()
  await expect(page.locator('.log-panel')).toContainText('Could not reach the desk')

  // The desk comes back on the same address. Nothing is touched in the app: the link dials
  // again on its own, which is what makes a desk that reboots mid-show survivable. Both
  // recalls are tried because the show's own state is whatever the failed one left it as,
  // and one of the two is a change either way.
  peer = await startDeskPeer({ host: HOST, profile: 'sq', midiChannel: CHANNEL, port: peer.port })
  await expect.poll(async () => {
    await page.locator('.matrix-scene[data-all-closed] .matrix-recall').click()
    await page.locator('.matrix-scene:not([data-all-closed]) .matrix-recall').click()
    return peer.received.length
  }, { timeout: 15_000 }).toBeGreaterThan(0)
})

test('the desk answers a get, and its own answer reads back as the value it holds', async () => {
  // The decode the hardware lane leans on, held where a lane that runs on every pull request
  // can answer it: the get is the one §3.7 of the SQ document describes, asked at the address
  // the recall writes — page 00, the input's own number — and what it is read back against is
  // the peer's own state, so a decoder that drifts from the document fails here rather than on
  // the one lane that needs a desk in the room.
  const wire = await openDeskWire(HOST, peer.port)
  try {
    peer.setMute(CHANNEL - 1, 0, true, 0x00)
    const open = await wire.ask(sqMuteGet(CHANNEL, SQ_INPUT_1))
    expect(open, 'the peer said nothing to a get').not.toBeNull()
    expect(sqMuteValue(open ?? [], SQ_INPUT_1)).toBe(true)

    peer.setMute(CHANNEL - 1, 0, false, 0x00)
    const closed = await wire.ask(sqMuteGet(CHANNEL, SQ_INPUT_1))
    expect(closed, 'the peer said nothing to a get').not.toBeNull()
    expect(sqMuteValue(closed ?? [], SQ_INPUT_1)).toBe(false)
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
      host: HOST,
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
    // The file assigns no notes — the mute groups are the route this show uses — and every
    // field the show declares is in it, so an unassigned note reads back empty rather than
    // as a value, and the "both buttons" line stays off two fields nobody set.
    await expect(settings.locator('.desk-note-go')).toHaveValue('')
    await expect(settings.locator('.desk-note-back')).toHaveValue('')
    await expect(settings.locator('.desk-gap')).toHaveCount(0)
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
