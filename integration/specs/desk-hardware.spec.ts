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
// an SQ answers a get with the parameter's current value in the NRPN form that sets it, an
// Avantis answers a name get in its own SysEx header). That socket reaches the desk through the
// relay (`../deskRelay.ts`), because the desk's MIDI service serves one connection at a time —
// measured on an SQ-6, firmware 1.6.1: a second connection is accepted and reset before it can
// send anything (`INTEGRATION-HARNESS.md` §6) — and this lane needs two: the app that drives the
// desk, and this spec that asks it for its own value. The app's log is read for the two things
// only the app can say — that a key press moved the show, and that the console's command fired
// the cue that answers it — and the desk's or the console's own device is named in the line it
// fired from. Nothing here reads the app's account of what it sent.
//
// Until a run happens, the peer's model of the desk, the vendor lane's "MIDI bytes are MIDI
// bytes" assumption and the message a real key press sends stay unproven, and §11 of the
// harness records that this lane is where they are checked — not that they have been.
import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { closeApp, launchApp, mintLicense, openFromRecent, openLogPanel, openScenesView } from '../../e2e/helpers'
import { startDeskRelay } from '../deskRelay.ts'
import type { DeskRelay } from '../deskRelay.ts'
import { writeDeskShow } from './deskFixture'
import { BACK_GROUP, GO_GROUP } from './deskButtonsFixture'
import {
  avantisDcaNameGet,
  DESK_ANSWER_MS,
  isAvantisNameReply,
  openDeskWire,
  sqDcaGet,
  sqMuteValue,
  type DeskWire
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
    `The reply this spec waits for is the read-back §6 of INTEGRATION-HARNESS.md documents${
      PROFILE === 'sq' ? ' — select the parameter, then the increment message carrying 7F.' : ' — a name get, answered in the range’s own header.'}`,
    'INTEGRATION-HARNESS.md §10 M3 has the milestone; §11 records the decision that built this lane.'
  ].join('\n')
}

/** The question this spec asks the desk, for the parameter every case is about. */
function readBack(): number[] {
  return PROFILE === 'avantis' ? avantisDcaNameGet(CHANNEL) : sqDcaGet(CHANNEL)
}

/**
 * The show's two scenes as the fixture writes them: the first opens DCA 1, the second opens
 * nobody — so a recall is the open and a recall of the other is the close. They are named by
 * id rather than by "the scene that is not all closed", because this show has two scenes the
 * desk's own keys walk between.
 */
const OPENING_SCENE = '.matrix-scene[data-scene-id="s-1"] .matrix-recall'
const CLOSING_SCENE = '.matrix-scene[data-scene-id="s-2"] .matrix-recall'

let app: ElectronApplication
let page: Page
let userDataDir: string
let wire: DeskWire
let relay: DeskRelay | undefined

/** What the desk's own value says about DCA 1, or null when it has not answered in time. */
async function dcaValue(): Promise<boolean | null> {
  const answer = await wire.ask(sqDcaGet(CHANNEL))
  return answer === null ? null : sqMuteValue(answer)
}

test.beforeAll(async () => {
  if (DESK === undefined || PROFILE === undefined) return
  if (MISADDRESSED.length > 0) {
    throw new Error(`This run cannot drive a desk as it stands:\n  ${MISADDRESSED.join('\n  ')}\n\n${checklist()}`)
  }
  try {
    // The desk's MIDI service takes one client, and both of this lane's clients have to share
    // it: the relay holds the desk, and the show below and this spec's own wire connect here.
    relay = await startDeskRelay({ desk: { host: deskHost, port: deskPort } })
    wire = await openDeskWire(relay.host, relay.port)
  } catch (error) {
    throw new Error(`${(error as Error).message}\n\n${checklist()}`)
  }
  const show = writeDeskShow({
    kind: 'midi-tcp',
    host: relay.host,
    port: relay.port,
    channel: CHANNEL,
    profile: PROFILE,
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
  // arithmetic that addresses DCA 1 are right — everything after this would otherwise fail
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
    sqMuteValue(answer),
    `the desk answered, but not in the value form the SQ document describes ("Getting values"): ${shown}\n\n` +
    'The peer’s model of that reply is the assumption this lane exists to measure (INTEGRATION-HARNESS.md §6).'
  ).not.toBeNull()
})

test('a scene recall moves the desk, and the desk’s own value says so', { tag: '@hardware' }, async () => {
  test.skip(
    PROFILE !== 'sq',
    'an Avantis publishes no read-back for a mute, so the desk’s own value is only readable on an SQ — the name reply above is what that range gives'
  )

  // The scene opens DCA 1 — the recall the peer lane asserts on the peer's own state. Here
  // the desk is the one speaking: the get is the desk's own answer about where the parameter
  // stands, and the poll asks again until it says so.
  await page.locator(OPENING_SCENE).click()
  await expect.poll(dcaValue, { timeout: 10_000 }).toBe(true)

  // And the half that never worked before the profile: the close is the same sequence with
  // the fine byte at zero, and the desk says so.
  await page.locator(CLOSING_SCENE).click()
  await expect.poll(dcaValue, { timeout: 10_000 }).toBe(false)
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
    await expect.poll(dcaValue, { timeout: 10_000 }).toBe(true)
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

  // The desk moved with the show: the second scene closes DCA 1, the app's own message for it
  // lands at the desk, and the desk's own value is what says so. On an Avantis the log line
  // above is all this case carries — its document has no read-back to ask.
  if (PROFILE === 'sq') {
    await expect.poll(dcaValue, { timeout: 10_000 }).toBe(false)
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
