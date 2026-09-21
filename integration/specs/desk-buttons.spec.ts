// Running a show's scenes from the desk's own buttons.
//
// A console reports a key press only when the key has been assigned to a console function —
// which is why a show's GO and BACK keys are spare mute groups: the group is assigned to a key
// at the desk, the key toggles it, and the desk transmits the mute message the group would have
// sent if a hand had muted it. The operator sets four fields and touches nothing else.
//
// A key that latches is not what every press means, so the same show names two MIDI notes
// beside its groups: an SQ's soft key set to MIDI Note transmits note on at 7F while it is held
// and note off at 00 when it is let go, so that press steps the show once and leaves nothing
// lit at the desk. Both routes run the one show, and a note writes nothing back — a latch is
// the desk's to own.
//
// What is asserted is the *desk* moving — the mute the peer records, and the desk's own state —
// from messages it sends the way a hand on the surface sends them, never from the app's account
// of itself. The app's own DCA messages are the other half of the cases: they are page 02, and
// a show that read them as a key press would run itself on every scene recall.
import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { startDeskPeer, type DeskPeer } from '../peers/desk'
import { closeApp, launchApp, mintLicense, openFromRecent, openLogPanel } from '../../e2e/helpers'
import { BACK_GROUP, BACK_NOTE, CHANNEL, GO_GROUP, GO_NOTE, writeDeskButtonsShow } from './deskButtonsFixture'

/** The SQ's mute-group page: page 04, parameter <group - 1>, absolute form. */
const MUTE_GROUP_PAGE = 0x04
/** DCA 1's own mute, as the peer keys it: page 02, parameter 0. */
const DCA_KEY = '02:00'

let app: ElectronApplication
let page: Page
let userDataDir: string
let peer: DeskPeer

/**
 * A hand on one of the desk's keys: the desk transmits the group's mute, toggling it.
 * `on` is the state the group lands in, which is what a press alternates.
 */
function pressKey(group: number, on: boolean): void {
  peer.setMute(CHANNEL, group - 1, on, MUTE_GROUP_PAGE)
}

/** The desk's own record of DCA 1's mute, which a scene recall moves. */
function dcaMute(): boolean | undefined {
  return peer.state.mutes[DCA_KEY]?.on
}

/** The lines a scene recall wrote, which name the button that caused it. */
function recalls(from: string): Promise<number> {
  return page.locator('.log-panel .log-row', { hasText: from }).count()
}

test.beforeAll(async () => {
  peer = await startDeskPeer({ profile: 'sq', midiChannel: CHANNEL, connectBurst: true })
  // The desk is already sitting with the GO group muted when the app arrives — a room that
  // was left that way — so its report at connect is a state and not a press.
  peer.setMute(CHANNEL, GO_GROUP - 1, true, MUTE_GROUP_PAGE)
  const show = writeDeskButtonsShow({ port: peer.port })
  ;({ app, page, userDataDir } = await launchApp({ license: mintLicense() }))
  await openFromRecent(page, userDataDir, show)
  await openLogPanel(page)
})

test.afterAll(async () => {
  await closeApp(app)
  await peer.close()
})

test('the desk reporting its own state does not run the show', async () => {
  // The desk reports where its groups stand as soon as a client connects, and the GO group is
  // muted in this room: without priming, that report would read as a key press and recall a
  // scene the moment the show opened. What says the report arrived is the monitor's own line
  // for it — the peer answers a get without recording one, so an assertion about the app's
  // question would be an assertion about something the desk does not keep.
  await expect.poll(async () =>
    page.locator('.log-panel .log-row.log-event[data-kind="midi"]').count()
  ).toBeGreaterThan(0)

  await page.waitForTimeout(400)
  expect(await recalls('Desk GO')).toBe(0)
  expect(await recalls('Desk BACK')).toBe(0)
  // Nothing has been sent to the desk either: a recall is the app's own messages, and this
  // show has not recalled anything.
  expect(dcaMute()).toBeUndefined()
})

test('the desk’s GO key recalls the next scene, and the desk moves with it', async () => {
  // The group is muted at the desk, so the operator's press takes it off — the first scene is
  // still what a GO from the top of the list means. This group was primed by the desk's report;
  // the BACK key in the next case is the one the report never mentions, so that press is what
  // proves the app's own question was answered.
  pressKey(GO_GROUP, false)

  await expect(page.locator('.log-panel .log-row', { hasText: 'Desk GO' }))
    .toContainText('Scene "Wedding"')
  // The desk is where the scene says: DCA 1 open, which is the app's own message and not a
  // key press — the next GO is what moves the show on.
  await expect.poll(dcaMute).toBe(true)
})

test('the next GO moves on, and BACK stands the show back', async () => {
  pressKey(GO_GROUP, true)
  await expect(page.locator('.log-panel .log-row', { hasText: 'Scene "Interval"' }))
    .toContainText('Desk GO')
  await expect.poll(dcaMute).toBe(false)

  // The desk's other key walks the same list backwards, and the scene it lands on is recalled.
  pressKey(BACK_GROUP, true)
  await expect(page.locator('.log-panel .log-row', { hasText: 'Desk BACK' }))
    .toContainText('Scene "Wedding"')
  await expect.poll(dcaMute).toBe(true)
})

test('a scene message the app sent itself is not a key press', async () => {
  // The recall above sent DCA 1 open on page 02, and the desk reports what it was told. That
  // is the app's own message coming back: reading it as a button would make the show run itself.
  const before = await recalls('Desk GO')

  peer.emit([0xb0, 0x63, 0x02, 0xb0, 0x62, 0x00, 0xb0, 0x06, 0x00, 0xb0, 0x26, 0x00])

  await page.waitForTimeout(400)
  expect(await recalls('Desk GO')).toBe(before)
})

test('a group nobody assigned does nothing', async () => {
  const before = await recalls('Desk GO') + await recalls('Desk BACK')

  pressKey(7, true)

  await page.waitForTimeout(400)
  expect(await recalls('Desk GO') + await recalls('Desk BACK')).toBe(before)
})

test('the same state arriving twice is one step, not two', async () => {
  // A desk with two sends, or a message repeated on the wire: the second says nothing the
  // first did not, so the show stands where the first press left it.
  const before = await recalls('Desk GO')

  pressKey(GO_GROUP, false)
  pressKey(GO_GROUP, false)

  await expect.poll(() => recalls('Desk GO')).toBe(before + 1)
  await page.waitForTimeout(400)
  expect(await recalls('Desk GO')).toBe(before + 1)
})

test('a soft key on the BACK note stands the show back, and the release does nothing', async () => {
  // The same walk from the desk's other kind of button: a soft key set to MIDI Note
  // transmits note on at 7F while it is held and note off at 00 when it is let go. The
  // show is on the last scene, so this is a step rather than a refusal — and the press is
  // sent on its own so the release can be shown to be silent rather than assumed.
  const before = await recalls('Desk BACK')
  const writesBefore = peer.received.length

  peer.emit([0x90, BACK_NOTE, 0x7f])

  await expect(page.locator('.log-panel .log-row', { hasText: 'Desk BACK' }).last())
    .toContainText('Scene "Wedding"')
  // The desk is where the scene says, which is the app's own DCA message — the note press
  // writes nothing to the desk's own groups, so no latch is set and none has to be cleared.
  await expect.poll(dcaMute).toBe(true)

  // The hand comes off: the release is half of the same event, so it adds no line of its own.
  peer.emit([0x80, BACK_NOTE, 0x00])
  await page.waitForTimeout(400)
  expect(await recalls('Desk BACK')).toBe(before + 1)
  expect(peer.received.slice(writesBefore)
    .filter(message => message.kind === 'mute' && message.page === MUTE_GROUP_PAGE)).toEqual([])
})

test('a soft key on the GO note moves the show on', async () => {
  const before = await recalls('Desk GO')

  peer.pressSoftKey(1)

  await expect(page.locator('.log-panel .log-row', { hasText: 'Desk GO' }).last())
    .toContainText('Scene "Interval"')
  await expect.poll(dcaMute).toBe(false)
  await expect.poll(() => recalls('Desk GO')).toBe(before + 1)
})

test('a note held down is one press, not a repeat', async () => {
  // A key that is held repeats its note-on; the desk transmits on every one of them, and
  // the show must not walk two scenes on one press. The show is on the last scene, so this
  // BACK is a step to the first — and a second press there would have nowhere to go, which
  // it would say in a line of its own rather than quietly.
  const before = await recalls('Desk BACK')

  peer.emit([0x90, BACK_NOTE, 0x7f])
  peer.emit([0x90, BACK_NOTE, 0x7f])

  await expect(page.locator('.log-panel .log-row', { hasText: 'Desk BACK' }).last())
    .toContainText('Scene "Wedding"')
  await page.waitForTimeout(400)
  expect(await recalls('Desk BACK')).toBe(before + 1)

  peer.emit([0x80, BACK_NOTE, 0x00])
})

test('a note nobody assigned is silent', async () => {
  // A soft key set to another number, a note some other program on the wire sends: the
  // reader reports it like any MIDI message, and the show has no action for it.
  const before = await recalls('Desk GO') + await recalls('Desk BACK')

  peer.emit([0x90, GO_NOTE + 8, 0x7f])

  await page.waitForTimeout(400)
  expect(await recalls('Desk GO') + await recalls('Desk BACK')).toBe(before)
})
