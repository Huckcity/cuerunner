// The whole of an SQ show's desk route, with no desk anywhere: the app drives the relay, and the
// relay carries both of the desk's services on to the two peers that stand in for it.
//
// The hardware lane is the only lane with a desk, and it is dispatched by hand — so the route it
// leans on is kept true here, on the lane that runs on every pull request. The show is the
// hardware lane's own shape, two mics and two scenes that hand the one fader between them, and the
// app is given the relay's address: the relay holds the desk's MIDI service and the desk's own
// control service, and the peers behind it are the desk's two models (`../peers/desk.ts` for the
// MIDI service and `../peers/sqNative.ts` for the desk's own). A recall is one act with two halves,
// and each is read where its own link is read: the mic's mute in the desk model's own state and
// record, the membership in the native model's own decoded frames — the pair and flag frames the
// recalled scene's own placement makes, built from the show's channels and faders rather than typed
// here and matched against the codec that wrote them (`src/main/desk/frames.ts`). Two recalls,
// because a recall is a difference: the first places the first mic, the second clears it and places
// the second, and both are read the same way.
//
// What this file does not carry is the desk's own answer about a membership: the capture holds no
// frame in which an SQ reports one, so the native model says nothing about it and the read form
// stays where `INTEGRATION-HARNESS.md` §11 decision 6 leaves it. What it does carry is the wiring
// the hardware lane assumes — a show that names the relay's host reaching a desk's 51326 through
// it — so a manual run with a real desk in front of you only has to confirm the desk's own side.
//
// The two addresses are the point. The relay listens on a loopback alias of this file's own (the
// one the show names), and the desk's models are behind it on a second alias of their own — never
// 127.0.0.1, which is the address this suite keeps clear for the e2e lane's own shows and the unit
// job's fallback — so nothing but the relay can reach them.
import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { startDeskPeer } from '../peers/desk.ts'
import type { DeskMuteMessage, DeskPeer } from '../peers/desk.ts'
import { startSqNativePeer } from '../peers/sqNative.ts'
import type { SqNativeFlagFrame, SqNativePairFrame, SqNativePeer } from '../peers/sqNative.ts'
import { startDeskRelay } from '../deskRelay.ts'
import type { DeskRelay } from '../deskRelay.ts'
import { closeApp, launchApp, mintLicense, openFromRecent, openScenesView } from '../../e2e/helpers'
import { writeDeskShow, DCA_ID, membershipFrames } from './deskFixture'
import type { DeskShowFader, DeskShowScene } from './deskFixture'
import { createFrameReader } from '../../src/main/desk/frames'

/** The address the show names: the relay, on a loopback alias no other lane binds. */
const HOST = '127.0.0.9'
/**
 * Where the desk's two models are, behind the relay — an alias of their own, and not 127.0.0.1:
 * the app dials the desk's own numbers on whatever host a show names, and 127.0.0.1 is the address
 * this suite keeps clear (the e2e lane's own shows name it, and the unit job falls back to it), so
 * models bound there could answer a client that was not the relay's. The relay dials the desk on
 * the numbers the carriage took — the desk's own — so the models hold those fixed ports here rather
 * than ephemeral ones, and the app never reaches them: it was given the relay's address.
 */
const DESK = '127.0.0.10'

/** The channel the desk is set to, and the one the show is told it is. */
const CHANNEL = 1

/**
 * The show this lane opens, in the hardware lane's own shape: two mics and one fader, and two
 * scenes that hand the fader from one mic to the other. A channel's place in the list is its input
 * number, so `ch-1` is input 1 and an SQ's input 1 answers at page 00, note 0; the fader's number
 * is the one its place derives. The expectation below is built from these rather than typed,
 * because what the models' records are checked against is this show's own placement.
 */
const CHANNELS = ['Ruth', 'Ada']
const FADERS: DeskShowFader[] = [{ id: DCA_ID, label: 'DCA 1', deskNumber: null }]
const OPENING: DeskShowScene = { id: 's-1', name: 'Wedding', places: { [DCA_ID]: ['ch-1'] } }
const CLOSING: DeskShowScene = { id: 's-2', name: 'Interval', places: { [DCA_ID]: ['ch-2'] } }
/** Where the show stands before its first recall: no fader carries anybody. */
const NOTHING_PLACED: DeskShowScene = { id: 'none', name: 'nothing recalled', places: {} }

/** The scene selectors the two recalls are made with, by id rather than by "not all closed". */
const OPENING_SCENE = `.matrix-scene[data-scene-id="${OPENING.id}"] .matrix-recall`
const CLOSING_SCENE = `.matrix-scene[data-scene-id="${CLOSING.id}"] .matrix-recall`

let app: ElectronApplication
let page: Page
let userDataDir: string
let peer: DeskPeer
let native: SqNativePeer
let relay: DeskRelay

/** The membership frames a peer has read, in arrival order: the pairs and the flags together. */
function membership(peer: SqNativePeer): Array<SqNativePairFrame | SqNativeFlagFrame> {
  return peer.received.filter(
    (frame): frame is SqNativePairFrame | SqNativeFlagFrame => frame.kind === 'pair' || frame.kind === 'flag'
  )
}

/** The mutes a peer of the desk link has read, which is the half this lane reads on 51325. */
function mutes(peer: DeskPeer): DeskMuteMessage[] {
  return peer.received.filter((message): message is DeskMuteMessage => message.kind === 'mute')
}

/** A desk's own record of one input's mute, by the show's own channel place: page 00, the note from zero. */
function deskMuteOf(channel: number): { on: boolean; label: string } | undefined {
  return peer.state.mutes[`00:${(channel - 1).toString(16).padStart(2, '0')}`]
}

/** One frame's bytes as the wire carries them, so what arrived can be read against the codec. */
function sound(bytes: number[]): string {
  return Buffer.from(bytes).toString('hex')
}

/**
 * The eight-byte frames a stretch of the relay's own record holds, in order — the pairs and flags
 * the app wrote on 51326, read with the app's own reader so a ring cut in the middle of a frame is
 * resynced rather than guessed at. This is the record the hardware lane's membership assertion
 * reads with no model behind it, which is why the same bytes are held to here.
 */
function framesWritten(bytes: number[]): number[][] {
  return createFrameReader()
    .push(bytes)
    .filter(frame => frame[0] === 0xf7 && frame.length === 8)
}

/**
 * Whether a start failed because somebody else holds a port, which is a lane that did not run — or
 * for any other reason, which is this file's own defect and has to fail the run rather than hide
 * behind a skip. The peers report the socket's own `EADDRINUSE`, and the relay reports the same
 * fact as its `cannot listen on` sentence.
 */
function portHeld(error: unknown): boolean {
  const said = error instanceof Error ? error.message : String(error)
  return said.includes('EADDRINUSE') || said.includes('cannot listen on')
}

/**
 * Whether the peers, the relay and the app came up. A run that could not take the ports either end
 * needs stops in `beforeAll` and reports the file skipped; the teardown closes what started, and a
 * `TypeError` there would be reported instead of the sentence naming what holds them.
 */
let running = false

test.beforeAll(async () => {
  peer = await startDeskPeer({ host: DESK, profile: 'sq', midiChannel: CHANNEL })
  try {
    native = await startSqNativePeer({ host: DESK })
  } catch (error) {
    await peer.close()
    if (!portHeld(error)) throw error
    test.skip(
      true,
      `${(error as Error).message}\n\n` +
        'The desk’s own control service is the desk’s, on fixed ports, and the app dials 51326 ' +
        `for any SQ show. This lane stands in for that desk on ${DESK}, so nothing else may hold ` +
        'its three ports (51326 TCP, 51321 TCP where `BYE.` goes, 51324 UDP) — and the same three ' +
        `on ${HOST} belong to the relay below.`
    )
    return
  }
  try {
    relay = await startDeskRelay({ desk: { host: DESK, port: peer.port }, host: HOST, native: true })
  } catch (error) {
    await peer.close()
    await native.close()
    if (!portHeld(error)) throw error
    test.skip(
      true,
      `${(error as Error).message}\n\n` +
        `The relay needs the desk’s own three ports on ${HOST} (51326 TCP, 51321 TCP, 51324 UDP) ` +
        `and the desk at ${DESK}: another job’s app, an app left running or a process started by ` +
        'hand holding one of them is a lane that did not run rather than one that failed.'
    )
    return
  }

  const show = writeDeskShow({
    host: HOST,
    port: relay.port,
    channel: CHANNEL,
    profile: 'sq',
    channels: CHANNELS,
    faders: FADERS,
    scenes: [OPENING, CLOSING]
  })
  ;({ app, page, userDataDir } = await launchApp({ license: mintLicense() }))
  await openFromRecent(page, userDataDir, show)
  await openScenesView(page)
  running = true
})

test.afterAll(async () => {
  if (!running) return
  await closeApp(app)
  await relay.close()
  await peer.close()
  await native.close()
})

test('a recall writes its membership over the desk’s own service and its mics over the desk link', async () => {
  // The opening scene places the first mic: one membership, and the mutes of both controlled
  // mics — the one the scene opened and the one it names nowhere. Both halves are asserted in one
  // case because a recall is one act, and both are the models' own records rather than the app's.
  const opened = membershipFrames(NOTHING_PLACED, OPENING, CHANNELS, FADERS)
  const beforeOpening = relay.native!.toDesk.length
  await page.locator(OPENING_SCENE).click()
  await expect.poll(() => membership(native).length).toBe(opened.length)
  expect(membership(native).map(frame => sound(frame.bytes))).toEqual(opened.map(sound))
  expect(membership(native)[0]).toMatchObject({ kind: 'pair', channel: 1, dca: 1, placed: true })
  expect(membership(native)[1]).toMatchObject({ kind: 'flag', channel: 1, rides: true })
  // The same frames as the app wrote them, on the relay's own record of the route — the record the
  // hardware lane's membership assertion reads with no model behind it, measured from where it
  // stood before the click.
  expect(framesWritten(relay.native!.toDesk.slice(beforeOpening)).map(sound)).toEqual(opened.map(sound))

  // The mics, on the desk link: a mute per controlled channel, at page 00 and the input's own
  // number, and the desk model's own state says the scene opened the first and left the second
  // closed — the shape AD-26 requires, and the half a membership is never written for.
  await expect.poll(() => mutes(peer).length).toBe(CHANNELS.length)
  expect(mutes(peer).map(message => ({ page: message.page, note: message.note, on: message.on })))
    .toEqual([
      { page: 0x00, note: 0x00, on: false },
      { page: 0x00, note: 0x01, on: true }
    ])
  await expect.poll(() => deskMuteOf(1)?.on).toBe(false)
  expect(deskMuteOf(2)?.on, 'the mic the scene names nowhere stayed closed').toBe(true)

  // The closing scene hands the fader to the second mic: the first mic's pair cleared and its own
  // flag the other way, then the second's pair placed — a difference rather than a sweep, which is
  // what the show's own placement and what arrived agree about.
  const handed = membershipFrames(OPENING, CLOSING, CHANNELS, FADERS)
  const beforeClosing = relay.native!.toDesk.length
  await page.locator(CLOSING_SCENE).click()
  await expect.poll(() => membership(native).length).toBe(opened.length + handed.length)
  expect(membership(native).slice(opened.length).map(frame => sound(frame.bytes))).toEqual(handed.map(sound))
  expect(framesWritten(relay.native!.toDesk.slice(beforeClosing)).map(sound)).toEqual(handed.map(sound))
  expect(membership(native).slice(opened.length)).toMatchObject([
    { kind: 'pair', channel: 1, dca: 1, placed: false },
    { kind: 'flag', channel: 1, rides: false },
    { kind: 'pair', channel: 2, dca: 1, placed: true },
    { kind: 'flag', channel: 2, rides: true }
  ])
  await expect.poll(() => deskMuteOf(1)?.on).toBe(true)
  await expect.poll(() => deskMuteOf(2)?.on).toBe(false)

  // And the desk's own frames came back the other way through the relay: the session the app
  // opened there is the desk's own conversation, answered on the carried route.
  await expect.poll(() => relay.native!.fromDesk.length).toBeGreaterThan(0)
  expect(relay.lost, 'the carried session held through both recalls').toBeNull()
})
