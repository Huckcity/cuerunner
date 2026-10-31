// The A&H lane: the desk path operators actually take — A&H MIDI Control's virtual port,
// bridged to a desk's own TCP endpoint — with this spec's peer standing in for the desk.
//
// Nothing here runs by itself, and nothing here is claimed until a run happens. The file skips
// unless `AH_MIDI_PORT` names the virtual port MIDI Control creates on this machine: the name
// depends on the installation, so it is read from the environment rather than guessed. The
// counterpart is `integration/peers/desk.ts`, listening at `AH_DESK_TARGET` — the address MIDI
// Control has to be pointed at by hand, because the bridge dials what its operator typed once.
// What is asserted is the peer's wire view and the peer's own state, the way the desk specs
// assert them — the whole of what a recall writes on this profile, which is the mic's own mute
// and, on an Avantis, the assignment too — and the app's log is read for the one thing only the
// app can say (that its trigger fired), with the port it fired from named in the line.
//
// This is the only lane that measures the bridge at all — that MIDI Control hands an
// application's bytes to a socket, and a desk's answers back the other way. INTEGRATION-HARNESS.md
// §11 records the bridge as an expectation until a run says otherwise, and §9 is the walkthrough
// for provisioning the machine it runs on.
import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { startDeskPeer, type DeskPeer } from '../peers/desk'
import { closeApp, launchApp, openFromRecent, openLogPanel, openScenesView } from '../../e2e/helpers'
import { writeDeskShow } from './deskFixture'
import type { DeskProfile } from '../../src/shared/show'

/**
 * The virtual port A&H MIDI Control creates on this machine, as this machine's MIDI port list
 * names it. The app sends to it by name and listens on it by name: one port, both directions,
 * which is what the bridge is.
 */
const MIDI_PORT = process.env.AH_MIDI_PORT || undefined
/** Where the peer serves — the address MIDI Control was configured to bridge the port to. */
const TARGET = process.env.AH_DESK_TARGET || '127.0.0.1:51325'
const [targetHost, targetPortSaid] = TARGET.split(':')
const targetPort = Number(targetPortSaid)
/** The range being stood in for, which is what the show is told its desk is. */
const SAID_PROFILE = process.env.AH_PROFILE
const PROFILE: DeskProfile = SAID_PROFILE === 'avantis' ? 'avantis' : 'sq'
/** The channel the desk is set to: blank takes the range's own default. */
const SAID_CHANNEL = process.env.AH_MIDI_CHANNEL || undefined
const CHANNEL = SAID_CHANNEL === undefined ? (PROFILE === 'avantis' ? 12 : 1) : Number(SAID_CHANNEL)
/**
 * The status bytes every message about the one mic carries: the desk's own MIDI channel,
 * which is where both ranges answer for an input — `CH 00` on `N` for an Avantis, page 00's
 * parameter 0 for an SQ. The block four channels above is a DCA/mute-group block, and no
 * recall writes one.
 */
const CC = 0xb0 | ((CHANNEL - 1) & 0x0f)
const NOTE_ON = 0x90 | ((CHANNEL - 1) & 0x0f)
/** The one mic's own number in the controlled set, from zero: the show has one channel. */
const MIC_INDEX = 0x00
/**
 * The peer's own key for that mic's mute: an SQ keys a parameter as `page:lsb` — page 00's
 * parameter 0, the first input — and an Avantis keys a note as `channel:note`, where the mic
 * answers on the desk's own channel. The label beside it is the desk's own reference table.
 */
const MIC_KEY = PROFILE === 'sq'
  ? '00:00'
  : `${(CHANNEL - 1).toString(16).padStart(2, '0')}:00`
const MIC_LABEL = PROFILE === 'sq' ? 'Ip1' : 'Input 1'
/** DCA 1's place in the show's own list, which is what an Avantis's assignment carries. */
const PLACE = 0x00
/** NRPN 40 assigns a channel to a DCA; the value carries `40 + the fader's place`. */
const ASSIGN_PARAM = 0x40

test.skip(
  MIDI_PORT === undefined,
  'no MIDI Control port named — set AH_MIDI_PORT to the virtual port A&H MIDI Control creates on this machine'
)

/**
 * What is wrong with the environment this run was given: a target that is not `host:port`, a
 * profile or a channel the app cannot be told are all worth saying before a socket is opened,
 * and the bridge checklist below says what the machine itself has to look like.
 */
const MISADDRESSED: string[] = [
  ...(targetHost !== '' && Number.isInteger(targetPort) && targetPort > 0 && targetPort <= 65535
    ? []
    : [`AH_DESK_TARGET is "${TARGET}", which is not host:port`]),
  ...(SAID_PROFILE === undefined || SAID_PROFILE === 'sq' || SAID_PROFILE === 'avantis'
    ? []
    : [`AH_PROFILE is "${SAID_PROFILE}", which is neither sq nor avantis`]),
  ...(Number.isInteger(CHANNEL) && CHANNEL >= 1 && CHANNEL <= 16
    ? []
    : [`AH_MIDI_CHANNEL is "${SAID_CHANNEL}", which is not a channel 1–16`])
]

/**
 * What has to be true on this machine before any of this can pass, and none of it can be set
 * from here: MIDI Control owns the virtual port, and the address the bridge dials is typed
 * into its own window once.
 */
function bridge(): string {
  return [
    `Nothing reached the desk at ${TARGET} — every one of these is a machine setting:`,
    '  1. A&H MIDI Control is installed and running on this runner: it creates the virtual port',
    '     while it runs, and it is a Windows/macOS application.',
    `  2. Its virtual port is named "${MIDI_PORT}" — that is what this run was told, and what the`,
    '     show’s desk is set to.',
    `  3. MIDI Control is bridged to the desk at ${TARGET}, which is this spec’s peer: it stands`,
    '     in for the desk, so the bridge has to be pointed at it.',
    '  4. Nothing else holds that address, and the show’s desk is the port rather than a socket.',
    '  5. The port is both directions: the app listens on the same name for the desk’s answers,',
    '     so a virtual port that exists only as an output would leave the desk half of this',
    '     conversation unheard — a finding about MIDI Control rather than about the app.',
    `This run told the show its desk is an ${PROFILE} on MIDI channel ${CHANNEL}, which is the`,
    'range the peer is standing in for.',
    'INTEGRATION-HARNESS.md §9 is the walkthrough; §11 records the bridge as an expectation',
    'until a run says otherwise.'
  ].join('\n')
}

let app: ElectronApplication
let page: Page
let userDataDir: string
let peer: DeskPeer

/** The desk's own record of the one mic's mute, which is the desk speaking rather than the app. */
function micMute(): { on: boolean; label: string } | undefined {
  return peer.state.mutes[MIC_KEY]
}

/**
 * The mic's mute as the profile takes it: an SQ's NRPN page 00 at the input's own number, an
 * Avantis's note pair whose velocity says which half it is — 3F off, 7F on, and 00 ending it.
 */
function micMuteMessages(closed: boolean): number[][] {
  if (PROFILE === 'avantis') {
    return [
      [NOTE_ON, MIC_INDEX, closed ? 0x7f : 0x3f],
      [NOTE_ON, MIC_INDEX, 0x00]
    ]
  }
  return [[CC, 0x63, 0x00, CC, 0x62, MIC_INDEX, CC, 0x06, 0x00, CC, 0x26, closed ? 0x01 : 0x00]]
}

/**
 * The whole of what a recall writes on this link, in the order it writes it. An Avantis is
 * told its assignment here as well — NRPN 40, whose parameter's MSB names the input and whose
 * value carries `40 + the fader's place` in and the place alone out — and an SQ is not: its
 * membership needs the desk's own control service on the TCP port, which a MIDI port cannot be,
 * so this lane carries the mic's mute alone for it.
 */
function recallMessages(closed: boolean): number[][] {
  if (PROFILE !== 'avantis') return micMuteMessages(closed)
  return [
    [CC, 0x63, MIC_INDEX, CC, 0x62, ASSIGN_PARAM, CC, 0x06, closed ? PLACE : ASSIGN_PARAM + PLACE],
    ...micMuteMessages(closed)
  ]
}

test.beforeAll(async () => {
  if (MIDI_PORT === undefined) return
  if (MISADDRESSED.length > 0) {
    throw new Error(`This run cannot drive a desk as it stands:\n  ${MISADDRESSED.join('\n  ')}\n\n${bridge()}`)
  }
  // The peer takes the address MIDI Control dials, so the bridge is pointed at a desk that is
  // standing in for a desk — which is exactly the claim nobody has measured yet.
  peer = await startDeskPeer({ profile: PROFILE, midiChannel: CHANNEL, port: targetPort, host: targetHost })
  // The show drives its desk through the port rather than a socket, which is the route an
  // operator with MIDI Control takes, and listens on the same port for the desk's answers.
  const show = writeDeskShow({
    kind: 'midi',
    midiPort: MIDI_PORT,
    channel: CHANNEL,
    profile: PROFILE
  })
  ;({ app, page, userDataDir } = await launchApp())
  await openFromRecent(page, userDataDir, show)
  // The show has to be in before anything else is fair: the cue row is the app saying so.
  await expect(page.locator('.cue-row')).toHaveCount(1)
  await openScenesView(page)
})

test.afterAll(async () => {
  await closeApp(app)
  await peer?.close()
})

test('a scene recall reaches the desk through the virtual port, as the bytes it takes', { tag: '@ah' }, async () => {
  await page.locator('.matrix-scene:not([data-all-closed]) .matrix-recall').click()

  try {
    await expect.poll(() => peer.received.length, { timeout: 10_000 }).toBeGreaterThan(0)
  } catch (error) {
    throw new Error(`${(error as Error).message}\n\n${bridge()}`)
  }

  // Through the bridge the bytes are the same bytes the desk's own socket carries: what MIDI
  // Control passes is what it was given, and this is the assertion that says whether it does.
  // The scene places the mic, so what it writes is the mic's mute *open*, and on an Avantis
  // the assignment that put it on the fader comes first.
  await expect.poll(() => peer.received.length, { timeout: 10_000 })
    .toBe(recallMessages(false).length)
  expect(peer.received.map(message => message.bytes)).toEqual(recallMessages(false))
  await expect.poll(() => micMute()?.on, { timeout: 10_000 }).toBe(false)
  expect(micMute()?.label).toBe(MIC_LABEL)
})

test('the close is the same messages with the other value, and the desk comes back down', { tag: '@ah' }, async () => {
  const before = peer.received.length
  await page.locator('.matrix-scene[data-all-closed] .matrix-recall').click()

  // The half that never worked before the profile: the app used to close with a note-off, and
  // neither range reads one as a mute. The close is the same messages with the other value.
  await expect.poll(() => peer.received.length, { timeout: 10_000 })
    .toBe(before + recallMessages(true).length)
  expect(peer.received.slice(before).map(message => message.bytes)).toEqual(recallMessages(true))
  await expect.poll(() => micMute()?.on, { timeout: 10_000 }).toBe(true)
})

test('the desk’s own scene recall comes back through the bridge and fires the cue', { tag: '@ah' }, async () => {
  // The other direction, which is half the reason the virtual port exists: an operator's
  // hand on the desk is heard by the app through the same bridge. Nothing here can press
  // anything at the desk, so the wait is the case's own and its failure is the checklist.
  test.setTimeout(60_000)
  peer.recallScene(7)

  await openLogPanel(page)
  try {
    await expect(page.locator('.log-panel')).toContainText('Triggered by MIDI', { timeout: 20_000 })
    await expect(page.locator('.log-panel')).toContainText(`"${MIDI_PORT}"`)
  } catch (error) {
    throw new Error(`${(error as Error).message}\n\n${bridge()}`)
  }
})
