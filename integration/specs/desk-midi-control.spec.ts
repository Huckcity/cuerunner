// The A&H lane: the desk path operators actually take — A&H MIDI Control's virtual port,
// bridged to a desk's own TCP endpoint — with this spec's peer standing in for the desk.
//
// Nothing here runs by itself, and nothing here is claimed until a run happens. The file skips
// unless `AH_MIDI_PORT` names the virtual port MIDI Control creates on this machine: the name
// depends on the installation, so it is read from the environment rather than guessed. The
// counterpart is `integration/peers/desk.ts`, listening at `AH_DESK_TARGET` — the address MIDI
// Control has to be pointed at by hand, because the bridge dials what its operator typed once.
// What is asserted is the peer's wire view and the peer's own state, the way the desk specs
// assert them; the app's log is read for the one thing only the app can say (that its trigger
// fired) and the port it fired from is named in the line.
//
// This is the only lane that measures the bridge at all — that MIDI Control hands an
// application's bytes to a socket, and a desk's answers back the other way. INTEGRATION-HARNESS.md
// §11 records the bridge as an expectation until a run says otherwise, and §9 is the walkthrough
// for provisioning the machine it runs on.
import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { startDeskPeer, type DeskPeer } from '../peers/desk'
import { closeApp, launchApp, mintLicense, openFromRecent, openLogPanel, openScenesView } from '../../e2e/helpers'
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
/** DCA 1, as the peer keys it: the SQ's page and parameter, the Avantis's channel and note. */
const DCA_KEY = PROFILE === 'sq' ? '02:00' : `${(CHANNEL + 3).toString(16).padStart(2, '0')}:36`
/** What the peer calls that DCA: each range names its own, which is why this follows the profile. */
const DCA_LABEL = PROFILE === 'sq' ? 'DCA1' : 'DCA 1'

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

/** The desk's own record of DCA 1's mute, which is the desk speaking rather than the app. */
function dcaMute(): { on: boolean; label: string } | undefined {
  return peer.state.mutes[DCA_KEY]
}

/** The opening message this profile takes for DCA 1, as its document writes it. */
function openBytes(): number[] {
  if (PROFILE === 'avantis') return [0x90 | ((CHANNEL + 3) & 0x0f), 0x36, 0x7f]
  const cc = 0xb0 | ((CHANNEL - 1) & 0x0f)
  return [cc, 0x63, 0x02, cc, 0x62, 0x00, cc, 0x06, 0x00, cc, 0x26, 0x01]
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
  ;({ app, page, userDataDir } = await launchApp({ license: mintLicense() }))
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
  expect(peer.received[0].bytes).toEqual(openBytes())
  await expect.poll(() => dcaMute()?.on, { timeout: 10_000 }).toBe(true)
  expect(dcaMute()?.label).toBe(DCA_LABEL)
})

test('the close is the same message with the other value, and the desk comes back down', { tag: '@ah' }, async () => {
  await page.locator('.matrix-scene[data-all-closed] .matrix-recall').click()

  // The half that never worked before the profile: the app used to close with a note-off,
  // which is not a mute to either range.
  await expect.poll(() => dcaMute()?.on, { timeout: 10_000 }).toBe(false)
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
