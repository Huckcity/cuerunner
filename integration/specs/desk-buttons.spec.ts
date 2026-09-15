// Running a show from the desk's own buttons.
//
// A console reports a key press only when the key has been assigned to a console function —
// which is why a show's transport buttons are mute groups: the group is assigned to a key at
// the desk, the key toggles it, and the desk transmits the mute message the group would have
// sent if a hand had muted it. The operator sets two fields and touches nothing else.
//
// What is asserted is the show moving — the cue that started, and where the selection stands
// — from messages the peer sends the way a hand on the surface sends them, never from the
// app's account of itself.
import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { startDeskPeer, type DeskPeer } from '../peers/desk'
import { closeApp, launchApp, mintLicense, openFromRecent, openLogPanel } from '../../e2e/helpers'
import { BACK_GROUP, GO_GROUP, writeDeskButtonsShow } from './deskButtonsFixture'

/** The channel the desk is set to, and the one the show is told it is. */
const CHANNEL = 1
/** The SQ's mute-group page: page 04, parameter <group - 1>, fine byte on or off. */
const MUTE_GROUP_PAGE = 0x04

let app: ElectronApplication
let page: Page
let userDataDir: string
let peer: DeskPeer

/**
 * A hand on one of the desk's keys: the desk transmits the group's mute, and which half of
 * the toggle it landed on is the desk's business rather than the show's.
 */
function pressKey(group: number): void {
  peer.setMute(CHANNEL, group - 1, true, MUTE_GROUP_PAGE)
}

/** How many cues the show has started, as the log shows them. */
function starts(): Promise<number> {
  return page.locator('.log-panel .log-row', { hasText: 'started' }).count()
}

/** How many times one cue has started, by the line that names it. */
function startsOf(cue: string): Promise<number> {
  return page.locator('.log-panel .log-row', { hasText: cue }).filter({ hasText: 'started' }).count()
}

/** The row the next GO would fire. */
function standingOn(): Promise<string> {
  return page.locator('.cue-row[data-selected="true"]').innerText()
}

/**
 * Past the show's firing window.
 *
 * The cases press the *same* key, and the window is the show's: a press a few milliseconds
 * after the case above would be refused for the right reason and the count below would say
 * nothing about what this case is testing.
 */
function pastTheWindow(): Promise<void> {
  return page.waitForTimeout(400)
}

test.beforeAll(async () => {
  peer = await startDeskPeer({ profile: 'sq', midiChannel: CHANNEL })
  const show = writeDeskButtonsShow({ port: peer.port, channel: CHANNEL })
  ;({ app, page, userDataDir } = await launchApp({ license: mintLicense() }))
  await openFromRecent(page, userDataDir, show)
  await openLogPanel(page)
})

test.afterAll(async () => {
  await closeApp(app)
  await peer.close()
})

test('the desk’s GO key fires the cue the show is standing on', async () => {
  // The show opens standing on its first cue, and the key is the mute group the file
  // assigned — nothing is pressed in the window.
  await expect.poll(standingOn).toContain('One')

  pressKey(GO_GROUP)

  await expect(page.locator('.log-panel .log-row', { hasText: '1 · One' }))
    .toContainText('started')
  // And the show has moved on, which is what makes it a GO rather than a one-off.
  await expect.poll(standingOn).toContain('Two')
})

test('the desk’s BACK key stands the show back one cue', async () => {
  await pastTheWindow()
  pressKey(BACK_GROUP)

  await expect(page.locator('.log-panel .log-row', { hasText: 'stood back' }))
    .toContainText('1 · One')
  await expect.poll(standingOn).toContain('One')

  // Back is not a re-fire: the cue stands ready, and the GO key is what plays it again.
  await pastTheWindow()
  pressKey(GO_GROUP)
  await expect.poll(async () => startsOf('1 · One')).toBe(2)
})

test('a key that bounces steps the show once', async () => {
  await pastTheWindow()
  const before = await starts()

  pressKey(GO_GROUP)
  pressKey(GO_GROUP)

  await expect.poll(starts).toBe(before + 1)
  // Past the window again, so a second step would have arrived by now.
  await pastTheWindow()
  expect(await starts()).toBe(before + 1)
})

test('a DCA mute is not a button, so the show does not run when the desk moves', async () => {
  // The app drives DCAs itself and the desk may echo what it was told: page 02 is a fader
  // moving, and a show that read it as a key press would run itself on every scene recall.
  await pastTheWindow()
  const before = await starts()

  peer.setMute(CHANNEL, 0, true, 0x02)

  await page.waitForTimeout(400)
  expect(await starts()).toBe(before)
})

test('a group nobody assigned does nothing', async () => {
  await pastTheWindow()
  const before = await starts()

  pressKey(7)

  await page.waitForTimeout(400)
  expect(await starts()).toBe(before)
})
