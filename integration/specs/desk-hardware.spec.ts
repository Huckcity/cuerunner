// The hardware lane: the desk conversation against a real SQ or Avantis on the network, and
// the one case no peer here can carry — a console on a MIDI cable transmitting MIDI Show
// Control (INTEGRATION-HARNESS.md §3, G2).
//
// Nothing in this file is scheduled and nothing in it is claimed until a run happens. It
// skips itself unless `DESK_HOST` names a desk and `DESK_PROFILE` says which range is at that
// address, and the console case skips unless `MSC_HOST` names the MIDI input port a console's
// cable appears as here. Two of the cases need somebody at the desk while the run is going — a
// key press, and a GO at the console: both are events rather than settings — and their failure
// message is the instruction. Whoever dispatches a run is standing in front of the desk; that
// is what "on demand only, wherever a desk is" means.
//
// What is asserted is the desk's own reply, read on this spec's own socket (`deskReadBack.ts`:
// an SQ answers a get with the parameter's current value in the NRPN form that sets it — asked
// at the input's own page, which is the fact a recall writes — and an Avantis answers a name
// get in its own SysEx header, the only read-back it publishes). That socket reaches the desk
// through the relay (`../deskRelay.ts`), because the desk's MIDI service serves one connection
// at a time — measured on an SQ-6, firmware 1.6.1: a second connection is accepted and reset
// before it can send anything (`INTEGRATION-HARNESS.md` §6) — and this lane needs two: the app
// that drives the desk, and this spec that asks it for its own value. Where an SQ is named, the
// relay carries the desk's own control service as well — the session on 51326, the leave channel
// on 51321 and the keepalive datagrams on 51324, the three ports the app dials on the show's desk
// host — so the membership half of a recall now leaves this runner on the route it is written to,
// and the relay's own record of that route is what the case about a fader's membership reads: the
// pair and flag frames the recalled scene's own placement makes, decoded with the app's codec
// (`src/main/desk/frames.ts`). What stays unreadable here is the desk's own answer for an
// assignment — an SQ publishes no read for one and the capture holds no such frame — so what the
// desk made of those bytes is still the operator's to look at, and the case says so. The app's log
// is read for the two things only the app can say — that a key press moved the show, and that the
// console's command fired the cue that answers it — and the desk's or the console's own device is
// named in the line it fired from. Nothing here reads the app's account of what it sent.
//
// The lane has run once — 2026-09-26, run `36260514612`, against the SQ-6 of §6: four of its five
// cases passed and the console case reported skipped for want of a cable — so what those cases
// check is measured rather than assumed. What no run has carried is the route this change added:
// the relay's `native` carriage has not been in front of a desk, so an SQ's own reading of a
// membership stays where the record leaves it, and §11 of the harness records where each claim
// stands.
import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { closeApp, launchApp, mintLicense, openFromRecent, openLogPanel, openScenesView } from '../../e2e/helpers'
import { startDeskRelay } from '../deskRelay.ts'
import type { DeskRelay } from '../deskRelay.ts'
import { writeDeskShow, DCA_ID, membershipFrames } from './deskFixture'
import type { DeskShowFader, DeskShowScene } from './deskFixture'
import { BACK_GROUP, GO_GROUP } from './deskButtonsFixture'
// The app's own codec, so what this lane reads out of the relay's record is what the app wrote
// on that route rather than a second reading of it.
import { createFrameReader, helloFrame } from '../../src/main/desk/frames'
import {
  avantisInputNameGet,
  DESK_ANSWER_MS,
  isAvantisNameReply,
  openDeskWire,
  sqMuteGet,
  sqMuteValue,
  SQ_INPUT_1,
  SQ_INPUT_2,
  type DeskWire,
  type SqAddress
} from './deskReadBack'
// The app's own vocabulary for a show control command and the values it takes, so what this
// lane expects a console to send is the same list the trigger matches against.
import { describeMsc, MSC_COMMANDS, MSC_FORMATS } from '../../src/renderer/src/utils/msc'
import type { DeskProfile } from '../../src/shared/show'

/** The desk, as `host:port`: an SQ or an Avantis on a network the runner can reach. */
const DESK = process.env.DESK_HOST || undefined
/** Which range is at that address — the profile decides every number the show sends. */
const PROFILE: DeskProfile | undefined =
  process.env.DESK_PROFILE === 'sq' || process.env.DESK_PROFILE === 'avantis'
    ? process.env.DESK_PROFILE
    : undefined
/** The desk's own MIDI channel, 1–16 as its Utility screen shows it. */
const CHANNEL = Number(process.env.DESK_MIDI_CHANNEL || (PROFILE === 'avantis' ? 12 : 1))
/**
 * The MIDI input port a console that transmits MIDI Show Control appears as on this machine.
 * A cable is the only way a console's command reaches this app: MSC goes over MIDI, and the
 * desk's own socket carries the desk's protocol rather than a console's.
 */
const MSC_PORT = process.env.MSC_HOST || undefined
/**
 * What the console transmits: its device ID, its format, its command and the cue it names.
 * Every one of those is a setting on the console and every one of them is part of what a show
 * control trigger matches, so a console set to something else fires nothing — the run is what
 * tells the show what to expect. The defaults are the specification's all-call device ID and
 * all-types format, which is what a console nobody has addressed sends.
 */
const SAID_FORMAT = process.env.MSC_FORMAT || undefined
const SAID_COMMAND = process.env.MSC_COMMAND || undefined
const MSC_FORMAT = MSC_FORMATS.find((format) => format === SAID_FORMAT) ?? 'all'
const MSC_COMMAND = MSC_COMMANDS.find((command) => command === SAID_COMMAND) ?? 'go'
const MSC_DEVICE_ID = Number(process.env.MSC_DEVICE_ID || 0x7f)
const MSC_CUE = process.env.MSC_CUE ?? ''
const MSC_CUE_LIST = process.env.MSC_CUE_LIST ?? ''

/** Where the desk is, split once: this spec's own socket and the show both need it. */
const [deskHost, deskPortSaid] = (DESK ?? '127.0.0.1:0').split(':')
const deskPort = Number(deskPortSaid)
/** Whether the address this run named is one two sockets can be pointed at. */
const deskAddressUsable = (): boolean =>
  deskHost !== '' && Number.isInteger(deskPort) && deskPort > 0 && deskPort <= 65535
/** The address the messages below name back: what the run said, and the ranges' own port when it did not name one. */
const deskAddress = deskAddressUsable() ? `${deskHost}:${deskPortSaid}` : (DESK ?? 'no desk')
const deskPortNamed = deskAddressUsable() ? deskPortSaid : '51325 (the port both ranges serve their MIDI on)'

/**
 * What is wrong with the environment this run was given, in the order it is worth fixing.
 * A run that names a desk, a channel or a console setting the harness cannot make sense of is
 * told so before it drives anything, rather than through a socket error or a timeout minutes
 * later — and the checklist below says what to do about it.
 */
const MISADDRESSED: string[] = [
  ...(deskAddressUsable()
    ? []
    : [`DESK_HOST is "${DESK}", which is not host:port — an SQ and an Avantis both serve their MIDI on 51325`]),
  ...(Number.isInteger(CHANNEL) && CHANNEL >= 1 && CHANNEL <= 16
    ? []
    : [`DESK_MIDI_CHANNEL is "${process.env.DESK_MIDI_CHANNEL}", which is not a channel 1–16`]),
  ...(SAID_FORMAT === undefined || MSC_FORMATS.some((format) => format === SAID_FORMAT)
    ? []
    : [`MSC_FORMAT is "${SAID_FORMAT}", which is not one of ${MSC_FORMATS.join(', ')}`]),
  ...(SAID_COMMAND === undefined || MSC_COMMANDS.some((command) => command === SAID_COMMAND)
    ? []
    : [`MSC_COMMAND is "${SAID_COMMAND}", which is not one of ${MSC_COMMANDS.join(', ')}`]),
  ...(Number.isInteger(MSC_DEVICE_ID) && MSC_DEVICE_ID >= 0 && MSC_DEVICE_ID <= 127
    ? []
    : [`MSC_DEVICE_ID is "${process.env.MSC_DEVICE_ID}", which is not a device ID 0–127`])
]

test.skip(
  DESK === undefined || PROFILE === undefined,
  DESK === undefined
    ? 'no desk named — set DESK_HOST=host:port for a real SQ or Avantis this machine can reach'
    : `DESK_PROFILE is "${process.env.DESK_PROFILE}", which is neither sq nor avantis — set it to the range at ${deskAddress}`
)

/**
 * What has to be true at the desk before any of this can pass, and none of it can be set
 * from here: the desk's MIDI-over-TCP service, its channel and its address are all settings
 * on the desk. Whoever reads this is standing in front of it.
 */
function checklist(): string {
  return [
    `Nothing answered at ${deskAddress} — every one of these is a desk setting:`,
    '  1. The desk is on a network this machine is on, and nothing else is holding its MIDI socket.',
    `  2. MIDI over TCP is on: an SQ and an Avantis both serve it on 51325, so ${deskPortNamed} is the desk's own port.`,
    `  3. Its MIDI channel is ${CHANNEL} (Utility > General > MIDI on an SQ), which is what the show is told.`,
    '  4. On an SQ, NRPN RX/TX is on — its mutes, and this spec’s get, are NRPN.',
    '  5. Nothing else holds the desk’s MIDI socket: it serves one connection at a time, and this run’s relay is it — the app and this spec both reach the desk through it (`../deskRelay.ts`).',
    '  6. This machine can open a TCP connection to the desk (no firewall in the way).',
    ...(PROFILE === 'sq'
      ? [
          '  7. On an SQ, the desk’s own control service answers as well: this run’s relay dials 51326 for',
          '     the session and 51321 for the leave channel, and sends the keepalive datagrams to 51324 —',
          '     all of them on the desk’s own address, and all of them what a recall’s membership needs.'
        ]
      : []),
    `The reply this spec waits for is the read-back §6 of INTEGRATION-HARNESS.md documents${
      PROFILE === 'sq' ? ' — select the parameter, then the increment message carrying 7F.' : ' — a name get, answered in the range’s own header.'}`,
    'INTEGRATION-HARNESS.md §10 M3 has the milestone; §11 records the decision that built this lane.'
  ].join('\n')
}

/**
 * The question this spec asks the desk, for the fact every case is about. What a recall writes
 * here is the mic's own mute, so an SQ is asked for the parameter the app writes — page 00 at
 * the input's own number — and an Avantis is asked for that input's name, which is the only
 * read-back its document publishes: a mute get is an SQ's, and no range answers for an
 * assignment at all (INTEGRATION-HARNESS.md §6 records it as unmeasured).
 */
function readBack(): number[] {
  return PROFILE === 'avantis' ? avantisInputNameGet(CHANNEL) : sqMuteGet(CHANNEL, SQ_INPUT_1)
}

/**
 * The show's two scenes as the fixture writes them: the first places the first mic on the one fader
 * — so a recall of it opens that mic — and the second hands the fader to the show's other mic,
 * which is what the opening and the close of the case about a fader's membership are. They are
 * named by id rather than by "the scene that is not all closed", because this show has two scenes
 * the desk's own keys walk between.
 */
const OPENING_SCENE = '.matrix-scene[data-scene-id="s-1"] .matrix-recall'
const CLOSING_SCENE = '.matrix-scene[data-scene-id="s-2"] .matrix-recall'

/**
 * The show itself: two mics and two scenes that hand the one fader between them. A channel's
 * place in this list is its input number, so `ch-1` is input 1, and the fader's number is the one
 * its place derives — and the membership expectation below is built from these rather than typed,
 * because what the relay's record is checked against is this show's own placement.
 */
const CHANNELS = ['Ruth', 'Ada']
const FADERS: DeskShowFader[] = [{ id: DCA_ID, label: 'DCA 1', deskNumber: null }]
const OPENING: DeskShowScene = { id: 's-1', name: 'Wedding', places: { [DCA_ID]: ['ch-1'] } }
const CLOSING: DeskShowScene = { id: 's-2', name: 'Interval', places: { [DCA_ID]: ['ch-2'] } }

let app: ElectronApplication
let page: Page
let userDataDir: string
let wire: DeskWire
let relay: DeskRelay | undefined

/** What the desk's own value says about one input, or null when it has not answered in time. */
async function inputValue(address: SqAddress): Promise<boolean | null> {
  const answer = await wire.ask(sqMuteGet(CHANNEL, address))
  return answer === null ? null : sqMuteValue(answer, address)
}

/**
 * The eight-byte frames a stretch of the relay's record holds, in order — the pairs and flags, with
 * the session's own `f7 02 …` among them where the stretch reaches back that far, which the reader
 * keeps whole even where the ring cut the byte before it.
 */
function membershipWritten(bytes: number[]): number[][] {
  return createFrameReader()
    .push(bytes)
    .filter(frame => frame[0] === 0xf7 && frame.length === 8)
}

/**
 * The failure message of the case about a scene's mics: a walkthrough, because two of the
 * things a recall writes are outside every socket this lane has — the desk's own read of an
 * assignment, and the desk's I/O patch.
 */
const MIC_WALKTHROUGH = [
  'The desk’s own value for a mic disagreed with the scene, or did not come. Two things this',
  'lane cannot read, and neither is a setting here:',
  '  1. The desk’s own answer for an assignment. Which input rides which fader is written on',
  '     the desk’s own control service on 51326, and this lane now carries that route through',
  '     its relay: the frames the recalls wrote are read out of the relay’s own record, and the',
  '     case fails when they are not written at all. What the desk made of them is still the',
  '     desk’s: an SQ publishes no read for an assignment and the capture holds no such frame,',
  '     so the fader has to be looked at by hand — at the desk, DCA 1 should carry input 1 after',
  '     the first recall and input 2 after the second, with the fader’s own position where the',
  '     operator left it, because a recall moves a membership and never a level.',
  '  2. The I/O patch. Nothing this app writes patches a desk. The two mics this case is about',
  '     have to be patched to input 1 and input 2 as the show’s channels are, and left where the',
  '     run’s operator left them: a mic patched elsewhere answers at another input, and every',
  '     value below is the desk’s own answer at the input the show’s channel is.'
].join('\n')

test.beforeAll(async () => {
  if (DESK === undefined || PROFILE === undefined) return
  if (MISADDRESSED.length > 0) {
    throw new Error(`This run cannot drive a desk as it stands:\n  ${MISADDRESSED.join('\n  ')}\n\n${checklist()}`)
  }
  try {
    // The desk's MIDI service takes one client, and both of this lane's clients have to share
    // it: the relay holds the desk, and the show below and this spec's own wire connect here.
    // An SQ dials the desk's own control service on the same host as well — 51326, the leave
    // channel 51321 and the keepalive datagrams 51324 — so the relay carries that route too: it
    // is where a recall's membership is written, and an Avantis's assignment goes over the desk
    // link instead, which is why the carriage is asked for on the range that has that route.
    relay = await startDeskRelay({
      desk: { host: deskHost, port: deskPort },
      native: PROFILE === 'sq'
    })
    wire = await openDeskWire(relay.host, relay.port)
  } catch (error) {
    // Two different failures read the same way unless they are told apart: a desk that does not
    // answer is a desk setting, and a port this machine already holds is not — the carriage takes
    // the desk's own numbers at the relay's host, so a `cannot listen on` here is a process, not a
    // desk.
    const said = (error as Error).message
    throw new Error(
      said.includes('cannot listen on')
        ? `${said}\n\n` +
            'The carriage takes the desk’s own numbers — 51326 TCP, 51321 TCP and 51324 UDP — at ' +
            'the address the show is pointed at, so nothing else on this machine may hold them: ' +
            'another job’s app, an app left running, or a process started by hand.'
        : `${said}\n\n${checklist()}`
    )
  }
  const show = writeDeskShow({
    kind: 'midi-tcp',
    host: relay.host,
    port: relay.port,
    channel: CHANNEL,
    profile: PROFILE,
    channels: CHANNELS,
    faders: FADERS,
    scenes: [OPENING, CLOSING],
    buttons: { go: GO_GROUP, back: BACK_GROUP },
    ...(MSC_PORT === undefined ? {} : {
      msc: {
        port: MSC_PORT,
        deviceId: MSC_DEVICE_ID,
        format: MSC_FORMAT,
        command: MSC_COMMAND,
        cueNumber: MSC_CUE,
        cueList: MSC_CUE_LIST
      }
    })
  })
  ;({ app, page, userDataDir } = await launchApp({ license: mintLicense() }))
  await openFromRecent(page, userDataDir, show)
  await openScenesView(page)
})

test.afterAll(async () => {
  await closeApp(app)
  wire?.close()
  await relay?.close()
})

test('the desk answers for itself', { tag: '@hardware' }, async () => {
  // The whole path in the direction that needs no hand: this spec asks the desk something its
  // own document says it answers. An answer means the address, the port, the channel and the
  // address the mic answers at are right — everything after this would otherwise fail
  // obscurely. The shape of the answer is what the peer's model asserts too, so a desk that
  // answers differently is a finding about the peer rather than about the app.
  const answer = await wire.ask(readBack())
  if (answer === null) {
    throw new Error(`The desk said nothing to a get in ${DESK_ANSWER_MS} ms.\n\n${checklist()}`)
  }
  const shown = answer.map((byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join(' ')

  if (PROFILE === 'avantis') {
    expect(
      isAvantisNameReply(answer),
      `the desk answered, but not with the name reply its document gives — the only read-back it publishes: ${shown}`
    ).toBe(true)
    return
  }
  expect(
    sqMuteValue(answer, SQ_INPUT_1),
    `the desk answered, but not in the value form the SQ document describes ("Getting values"): ${shown}\n\n` +
    'The peer’s model of that reply is the assumption this lane exists to measure (INTEGRATION-HARNESS.md §6).'
  ).not.toBeNull()
})

test('a scene recall moves the desk, and the desk’s own value says so', { tag: '@hardware' }, async () => {
  test.skip(
    PROFILE !== 'sq',
    'an Avantis publishes no read-back for a mute, so the desk’s own value is only readable on an SQ — the name reply above is what that range gives'
  )

  // The scene places the mic on the fader, so the recall opens it — and what is asked about is
  // the mic's own mute, on the input's page, because that is the fact a recall writes: a DCA
  // is a control group, and the assignment goes over the desk's own control service on 51326
  // instead, which this lane's relay carries now and which the case about a fader's membership
  // reads the relay's own record of. Here the desk is the one speaking: the get is its own
  // answer about where the parameter stands, and the poll asks again until it says so.
  await page.locator(OPENING_SCENE).click()
  await expect.poll(() => inputValue(SQ_INPUT_1), { timeout: 10_000 }).toBe(false)

  // And the half that never worked before the profile: the mic comes off the fader with the
  // same sequence and the other fine byte, and the desk says so. The scene that takes it off
  // places the show's other mic instead, which the case about a fader's membership is about.
  await page.locator(CLOSING_SCENE).click()
  await expect.poll(() => inputValue(SQ_INPUT_1), { timeout: 10_000 }).toBe(true)
})

test('a key pressed at the desk runs the show, and the desk moves with it', { tag: '@hardware' }, async () => {
  // A hand, not a setting: the desk reports a key only when the key has a function, so the
  // operator assigns a spare mute group to it and the desk transmits the group's mute on the
  // press (INTEGRATION-HARNESS.md §3). Nothing in this file can press it.
  test.setTimeout(150_000)
  const pressed = [
    'Nothing pressed a key at the desk in 90 s. This case needs a hand, the way §9 needs one',
    'to configure a console:',
    `  1. At the desk, assign mute group ${GO_GROUP} to the key the show runs from — a spare group`,
    '     is what a theatre has, because the muting is done with DCAs.',
    '  2. Press it. An SQ answers a get for its groups, so the first press moves the show; an',
    '     Avantis has no published get, so press it a second time to move it.',
    `  The show’s own fields are GO = group ${GO_GROUP}, BACK = group ${BACK_GROUP}; the press moves`,
    '  the show on from the first scene, which is where this case puts it so the walk has somewhere',
    '  to go.',
    '  A run with nobody at the desk cannot carry this case, and says so rather than passing it.'
  ].join('\n')

  // Where the show stands decides what a GO means, and the case above left it at the last
  // scene: recalling the first one is what makes the key's step a scene with a desk message
  // behind it rather than "already at the last scene".
  await page.locator(OPENING_SCENE).click()
  if (PROFILE === 'sq') {
    await expect.poll(() => inputValue(SQ_INPUT_1), { timeout: 10_000 }).toBe(false)
  }

  await openLogPanel(page)
  // The scene the walk lands on *and* the label the key writes, in one row: the recall this
  // case started with names the first scene, and case 2's own recall named the second, so
  // neither would do on its own.
  const keyRow = page.locator('.log-panel .log-row')
    .filter({ hasText: 'Desk GO' })
    .filter({ hasText: 'Scene "Interval"' })
  try {
    await expect(keyRow).toHaveCount(1, { timeout: 90_000 })
  } catch (error) {
    throw new Error(`${(error as Error).message}\n\n${pressed}`)
  }

  // The desk moved with the show: the second scene hands the fader to the show's other mic, so
  // this one's recall closes it, the app's own message for that lands at the desk, and the desk's
  // own value is what says so. On an Avantis the log line above is all this case carries — its
  // document has no read-back for a mute to ask.
  if (PROFILE === 'sq') {
    await expect.poll(() => inputValue(SQ_INPUT_1), { timeout: 10_000 }).toBe(true)
  }
})

test('a console transmitting show control fires the cue that answers it', { tag: '@hardware' }, async () => {
  test.skip(
    MSC_PORT === undefined,
    'no console named — set MSC_HOST to the MIDI input port a console transmitting MIDI Show Control appears as on this machine'
  )
  // The console is on a cable, which is the only home this case has (G2): an SQ and an
  // Avantis do not transmit MSC, and no peer here is a console. Nothing can pre-flight the
  // console — it is a person's cue list — so the failure below is the walkthrough.
  test.setTimeout(150_000)
  const transmit = [
    `Nothing arrived on "${MSC_PORT}" in 120 s. This case needs the console to transmit:`,
    '  1. {MSC Transmit} on, with this machine as its MIDI destination — the cable appears in',
    `     this machine’s MIDI port list, and the show is told to listen on "${MSC_PORT}".`,
    `  2. The console has to be set to the device ID ${MSC_DEVICE_ID}, the format ${MSC_FORMAT} and`,
    `     the command ${MSC_COMMAND}${MSC_CUE === '' ? ' with no cue named' : ` naming cue ${MSC_CUE}`}${
      MSC_CUE_LIST === '' ? '' : ` in list ${MSC_CUE_LIST}`}`,
    '     — every one of those is part of what the show’s trigger matches, and a show control',
    '     trigger compares each field exactly (src/renderer/src/engine/triggers.ts). A console',
    '     left on its own device ID or naming another cue fires nothing, and that is the',
    '     trigger’s identity rule rather than a fault.',
    '  3. Press GO on the console, or let its cue list run the cue that transmits.',
    'INTEGRATION-HARNESS.md §3 G2 and §10 M3 say why this is where an MSC trigger ends to end.'
  ].join('\n')

  // What the app will log when that command arrives: the command as the app reads it — its
  // own name for it, the cue and list it named — and the port it came from. Built from the
  // run's own values, so a console addressed at a cue is not expected to look like a GO.
  const expected = `Triggered by MSC ${describeMsc({
    deviceId: MSC_DEVICE_ID,
    format: MSC_FORMAT,
    command: MSC_COMMAND,
    cueNumber: MSC_CUE,
    cueList: MSC_CUE_LIST
  })} from "${MSC_PORT}"`

  await openLogPanel(page)
  try {
    await expect(page.locator('.log-panel')).toContainText(expected, { timeout: 120_000 })
  } catch (error) {
    throw new Error(`${(error as Error).message}\n\n${transmit}`)
  }
})

test('the mic the scene places is open, and the mic that left is silent', { tag: '@hardware' }, async () => {
  // An SQ's, and only an SQ's: what this case reads is the desk's own mute values, and the
  // value form they come back in is the SQ document's. A run with no desk named has the whole
  // file skipped with its own reason; a run that named another range is told why this case is
  // not its.
  test.skip(
    PROFILE !== 'sq',
    PROFILE === undefined
      ? `this case is an SQ's, and the run named no profile — set DESK_PROFILE=sq for the desk at ${deskAddress}, whose mutes this spec reads back in the SQ document's value form`
      : `DESK_PROFILE is "${process.env.DESK_PROFILE}", which is not sq — this case is an SQ's: it reads the desk's own mute values, and the name reply above is all an Avantis publishes`
  )

  // Two recalls, and the desk's own answer at each end of them: the first scene places the
  // first mic, the second hands the fader to the second. So the first fact is that the mic the
  // scene placed is open — and the mic it did not place is silent — and the second is that the
  // mic which left the fader is silent while the other is open. Every one of the four is the
  // desk speaking, read on this spec's own socket. Beside them stands the other half of the same
  // act, on the route the relay now carries: the membership frames these two recalls wrote, read
  // out of the relay's own record and decoded with the app's codec — measured from where that
  // record stood before the first click, because the cases before this one made recalls of their
  // own and a tail of that shared ring would hold their frames just as well. What the desk then
  // made of them is the one thing still outside every socket here, and the walkthrough says so.
  const before = relay?.native?.toDesk.length ?? 0
  try {
    await page.locator(OPENING_SCENE).click()
    await expect.poll(() => inputValue(SQ_INPUT_1), { timeout: 10_000 }).toBe(false)
    await expect.poll(() => inputValue(SQ_INPUT_2), { timeout: 10_000 }).toBe(true)

    await page.locator(CLOSING_SCENE).click()
    await expect.poll(() => inputValue(SQ_INPUT_1), { timeout: 10_000 }).toBe(true)
    await expect.poll(() => inputValue(SQ_INPUT_2), { timeout: 10_000 }).toBe(false)

    // The membership: the frames these two recalls added to the relay's record, decoded with the
    // app's own codec. A recall that wrote nothing leaves the span empty, and a pair or flag that
    // moved fails the comparison — against what the recalled scenes' own placements make, built
    // from the show's channels and faders rather than typed here. What the desk made of those bytes
    // is the walkthrough's.
    const recalled = [
      ...membershipFrames(CLOSING, OPENING, CHANNELS, FADERS),
      ...membershipFrames(OPENING, CLOSING, CHANNELS, FADERS)
    ]
    const wrote = membershipWritten((relay?.native?.toDesk ?? []).slice(before))
    expect(
      wrote.map(frame => Buffer.from(frame).toString('hex')),
      'the frames the two recalls added to the relay’s record are not the ones the recalled ' +
        `scenes’ own placements make (${recalled.map(frame => Buffer.from(frame).toString('hex')).join(' ')}): ` +
        `${Buffer.from(relay?.native?.toDesk ?? []).toString('hex')}`
    ).toEqual(recalled.map(frame => Buffer.from(frame).toString('hex')))

    // And the session they were written on held through them: the app's own ping — the same hello
    // the session opened with — is the last thing the record holds, so the frames above went out
    // on a live socket rather than into nothing.
    await expect.poll(
      () => {
        const frames = createFrameReader().push(relay?.native?.toDesk ?? [])
        const last = frames[frames.length - 1]
        return last !== undefined && Buffer.from(last).equals(Buffer.from(helloFrame()))
      },
      { timeout: 10_000 }
    ).toBe(true)
    expect(relay?.lost, 'the desk’s own service stayed up through both recalls').toBeNull()
    expect(relay?.native?.fromDesk.length, 'the desk’s own frames arrived on the carried route')
      .toBeGreaterThan(0)
  } catch (error) {
    throw new Error(`${(error as Error).message}\n\n${MIC_WALKTHROUGH}`)
  }
})
