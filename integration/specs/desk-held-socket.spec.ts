// Cuerunner pointed at a desk whose MIDI port somebody else already holds.
//
// The desk's own rule, measured on an SQ-6 (INTEGRATION-HARNESS.md §6): its MIDI service
// serves one connection, accepting a second and resetting it at once. What the app sees is
// therefore not a dial nothing answered but a connection that came up and was taken — two
// different sentences for the operator, and only one of them sends them to check an address.
// The desk peer models the rule under `singleClient`, and this is the lane that drives the
// *app* against it: `harness-desk-relay.spec.ts` holds the rule at the wire level and never
// launches Cuerunner, and `MidiTcpEngine.test.ts` holds the sentence against a local socket
// that resets every connection rather than the second one.
//
// The second half is the recovery, which is what a held desk makes interesting: the desk
// refuses a client only while something holds it, so the moment the holder lets go the link
// has to re-dial on its own — nobody touches the show — and a later recall has to land.
import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { createConnection } from 'node:net'
import type { Socket } from 'node:net'
import { once } from 'node:events'
import { startDeskPeer, type DeskPeer } from '../peers/desk'
import { closeApp, launchApp, mintLicense, openFromRecent, openLogPanel, openScenesView } from '../../e2e/helpers'
import { writeDeskShow } from './deskFixture'

/** The channel the desk is set to, and the one the show is told it is. */
const CHANNEL = 1
/** The one mic's own mute, as the peer keys it: the input page 00 at the channel's own number. */
const MIC_KEY = '00:00'
/** The link's own sentence for a connection the desk took and then ended. */
const RESET_SENTENCE = 'accepted the connection and then reset it'
/** The beat between two recalls at the held desk, so each answer lands before the next. */
const RECALL_ANSWER_MS = 700
/** How long the link's own report, and the held half, are given. */
const LINK_REPORT_MS = 5000
/** How long the link is given to re-dial once the holder has gone. */
const RECONNECT_MS = 15_000

let app: ElectronApplication
let page: Page
let userDataDir: string
let peer: DeskPeer
/** Whatever is on the desk before the app is: a tablet, another app, a colleague's laptop. */
let holder: Socket

test.beforeAll(async () => {
  peer = await startDeskPeer({ profile: 'sq', midiChannel: CHANNEL, singleClient: true })
  // Connected before the app exists, because the app dials the moment the show loads: a
  // holder attached any later would be the second client, and would be the one reset.
  holder = createConnection({ host: '127.0.0.1', port: peer.port })
  await once(holder, 'connect')
  const show = writeDeskShow({ port: peer.port, channel: CHANNEL, profile: 'sq' })
  ;({ app, page, userDataDir } = await launchApp({ license: mintLicense() }))
  await openFromRecent(page, userDataDir, show)
  await openScenesView(page)
})

test.afterAll(async () => {
  holder.destroy()
  await closeApp(app)
  await peer.close()
})

test('a recall at a held desk names the taken connection, and lands once the holder lets go', async () => {
  await openLogPanel(page)
  const log = page.locator('.log-panel')
  const desk = `127.0.0.1:${peer.port}`

  // The link's own report of the connection, read before anything is recalled: the desk took
  // it and then reset it, so the recall below is made at a desk the app already knows it is
  // not talking to.
  await expect(log).toContainText(`${desk}: the connection was taken or reset`, {
    timeout: LINK_REPORT_MS
  })

  // The two scenes, asked for in turn: they are each other's opposite state, so whichever way
  // a recall left the show's own desk state, the next one is a change and sends.
  const recalls = [
    page.locator('.matrix-scene:not([data-all-closed]) .matrix-recall'),
    page.locator('.matrix-scene[data-all-closed] .matrix-recall')
  ]

  // The recall at the held desk, repeated until the link's own sentence is what it says.
  //
  // What the engine answers is not fixed by the state of the show: the desk's reset lands
  // either side of this client reading its own connection event, and on the far side the
  // queued recall is written into a socket the desk has already reset — a write that succeeds
  // locally, so `send` answers ok and the show remembers a scene the desk never heard. That
  // was 1 of 15 attempts measured on this workstation's loopback, and it is a fact about the
  // engine rather than about this lane, so the lane recalls again from the same state instead
  // of asserting about the attempt. The sentence it is about is asserted once it appears, and
  // the address is never blamed on any of them.
  let attempt = 0
  await expect.poll(async () => {
    await recalls[attempt++ % recalls.length].click()
    return (await log.innerText()).includes(RESET_SENTENCE)
  }, {
    timeout: LINK_REPORT_MS,
    intervals: [RECALL_ANSWER_MS],
    message: `a recall at the held desk never said the connection was taken (${desk})`
  }).toBe(true)
  await expect(log, 'the address is not what is wrong here').not.toContainText('did not answer')

  // Held, so nothing arrived: the desk reads nothing off a connection it is about to reset.
  expect(peer.received).toEqual([])

  // The holder lets go. Nothing is touched in the app: the link dials again within its own
  // retry window — the app's own row says the desk is back, one more than the held half saw —
  // and the desk's own client list says who is attached, so what follows is a recall on the
  // link the app brought back rather than on a dial the click started.
  const online = log.locator('.log-event[data-kind="device"]', { hasText: `${desk} online` })
  const reported = await online.count()
  holder.destroy()
  await expect.poll(() => online.count(), {
    timeout: RECONNECT_MS,
    message: 'the link never reported the desk back after the holder let go'
  }).toBeGreaterThan(reported)
  await expect.poll(() => peer.clients, {
    timeout: RECONNECT_MS,
    message: 'the desk never had the app attached again'
  }).toBe(1)

  // Both columns are recalled, in turn: a recall only sends a change, and which one the app's
  // own record makes a change is whatever the refused attempts left it as — so asking for both
  // is what keeps this about the link the app brought back rather than about the bookkeeping.
  // The first scene is asked for last, so the state the desk ends in is the one asserted below.
  await recalls[1].click()
  await recalls[0].click()
  await expect.poll(() => peer.received.length, { timeout: RECONNECT_MS }).toBeGreaterThan(0)

  // What landed is the recall the show asked for, read on the desk's own state rather than
  // on the app's account of itself: the scene places the mic, so the desk has it open — which
  // is the mute written at the channel's own page, not a DCA's.
  await expect.poll(() => peer.state.mutes[MIC_KEY]?.on).toBe(false)
})
