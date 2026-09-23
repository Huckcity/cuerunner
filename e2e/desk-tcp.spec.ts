// The desk a show drives over its own MIDI socket — an SQ or an Avantis on 51325.
//
// What this lane holds is the surface and the app's own account of the connection: the row
// in Show Settings, a show read back from a file written before the kind existed, and what
// the operator is told when nobody is at the other end. What goes on the wire is the
// integration harness's job (`integration/specs/desk-*.spec.ts`), which has a desk to say
// so and a peer that answers.
import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import fs from 'fs'
import net from 'net'
import os from 'os'
import path from 'path'
import { buildDeskShow, closeApp, launchApp, mintLicense, openFromRecent, openShowSettings, pointDeskAtTcp } from './helpers'

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  ;({ app, page } = await launchApp({ license: mintLicense() }))
})

test.afterAll(async () => {
  await closeApp(app)
})

/** A port with nothing behind it, which is what a desk that is switched off looks like. */
async function deadPort(): Promise<number> {
  const server = net.createServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  const { port } = address
  await new Promise<void>(resolve => server.close(() => resolve()))
  return port
}

test('the desk row takes an address and reads back what the show would send', async () => {
  // A profile change re-reads every row of the tab and restarts the desk's services;
  // the default 20 s is the wrong budget for a case that walks the whole dialog.
  test.setTimeout(60_000)
  await openShowSettings(page)
  const settings = page.locator('.show-settings-dialog')

  await settings.locator('.desk-kind').selectOption('midi-tcp')
  // A new show's desk is the local machine, and the port is the one both ranges serve
  // their MIDI on — the two things an operator should not have to look up.
  await expect(settings.locator('.desk-tcp-port')).toHaveValue('51325')

  // An address nobody typed is a desk nobody can reach, and the row says that rather
  // than previewing a send that cannot happen.
  await settings.locator('.desk-tcp-host').fill('')
  await settings.locator('.desk-tcp-host').blur()
  await expect(settings.locator('.desk-gap')).toHaveText('No desk address.')

  await settings.locator('.desk-tcp-host').fill('10.0.0.5')
  await settings.locator('.desk-tcp-host').blur()
  await expect(settings.locator('.desk-preview')).toHaveText(
    'Sends note 1 … 12 to 10.0.0.5:51325, on and off — a recall writes 12 channel mutes ' +
    'and takes no assignment'
  )

  await settings.locator('.show-settings-done').click()
})

test('the desk row takes the desk’s own name, and reads back what that desk is sent', async () => {
  // A profile change re-reads every row of the tab and restarts the desk's services;
  // the default 20 s is the wrong budget for a case that walks the whole dialog.
  test.setTimeout(60_000)
  await openShowSettings(page)
  const settings = page.locator('.show-settings-dialog')

  // The same show, three desks. What changes is the arrangement the desk takes, which is
  // the difference between a recall that moves it and one it ignores — so the row says
  // which arrangement is in force rather than leaving it to the wire.
  // An SQ: the mic's mute on this link, and the membership over the desk's own control
  // service — which no peer in *this* lane stands in for, and which those specs read as the
  // row's own read-back of the route rather than as anything on the wire.
  await settings.locator('.desk-profile').selectOption('sq')
  // The channel the desk's own messages are set to is the channel the field above says, so
  // the read-back is asserted by the halves that do not move with it.
  await expect(settings.locator('.desk-preview')).toContainText(
    'Sends an SQ’s channel mutes — NRPN page 00 on channel')
  await expect(settings.locator('.desk-preview')).toContainText(
    'and its assignment over the desk’s own control service — a recall writes 12 channels ' +
    'and nothing else; the desk has 8, so 4 of the show’s DCAs are not sent')

  await settings.locator('.desk-profile').selectOption('avantis')
  await expect(settings.locator('.desk-preview')).toContainText(
    'Sends an Avantis’s channel mutes — note-on, 7F on and 3F off, on channel')
  await expect(settings.locator('.desk-preview')).toContainText(
    'and its assignment as NRPN 40 on the same channel — a recall writes 12 channels and ' +
    'nothing else')

  await settings.locator('.desk-profile').selectOption('note')
  await expect(settings.locator('.desk-preview')).toHaveText(
    'Sends note 1 … 12 to 10.0.0.5:51325, on and off — a recall writes 12 channel mutes ' +
    'and takes no assignment'
  )

  await settings.locator('.show-settings-done').click()
})

test('the desk’s own buttons are assigned by mute group, and only on a desk that has them', async () => {
  // A profile change re-reads every row of the tab and restarts the desk's services;
  // the default 20 s is the wrong budget for a case that walks the whole dialog.
  test.setTimeout(60_000)
  await openShowSettings(page)
  const settings = page.locator('.show-settings-dialog')

  // The desk this show drives takes a note on and a note off and has no mute groups, so
  // there is nothing to assign a button to and the row is not drawn at all.
  await expect(settings.locator('.desk-buttons')).toHaveCount(0)

  // An SQ is told which of its mute groups the operator's keys are. Nothing else is set up
  // anywhere: the group is assigned to a key at the desk, and the message the key makes the
  // desk send is what the show listens to.
  await settings.locator('.desk-profile').selectOption('sq')
  await expect(settings.locator('.desk-button-go')).toHaveValue('')
  await expect(settings.locator('.desk-button-back')).toHaveValue('')

  await settings.locator('.desk-button-go').selectOption('5')
  await settings.locator('.desk-button-back').selectOption('6')
  await expect(settings.locator('.desk-button-go')).toHaveValue('5')
  await expect(settings.locator('.desk-button-back')).toHaveValue('6')
  // What the keys move, where the operator assigns them: the scenes, in the order the Scenes
  // view shows them.
  await expect(settings.locator('.desk-hint'))
    .toHaveText('GO recalls the next scene, BACK the one before it, in the order the Scenes view shows them.')

  // One group cannot be both: the row says so rather than leaving a show that steps forward
  // and back on the same press.
  await settings.locator('.desk-button-back').selectOption('5')
  await expect(settings.locator('.desk-gap')).toHaveText('One mute group cannot be both buttons.')

  await settings.locator('.desk-button-back').selectOption('6')
  await settings.locator('.desk-profile').selectOption('note')
  await expect(settings.locator('.desk-buttons')).toHaveCount(0)
  await settings.locator('.show-settings-done').click()
})

test('the desk’s own note keys are assigned beside the groups, on the desk that sends them', async () => {
  // A profile change re-reads every row of the tab and restarts the desk's services;
  // the default 20 s is the wrong budget for a case that walks the whole dialog.
  test.setTimeout(60_000)
  await openShowSettings(page)
  const settings = page.locator('.show-settings-dialog')

  // The desk this show drives takes a note on and a note off of its own accord, so a note
  // read off it could be the app's own DCA mute: there is nothing to assign, and the row is
  // not drawn.
  await expect(settings.locator('.desk-notes')).toHaveCount(0)

  // An SQ's soft key set to MIDI Note transmits while it is held, which is a button that
  // does not latch. What to assign at the desk and which route to choose are said where the
  // operator is looking: the path is in the hint, the SQ's own note range in the field.
  await settings.locator('.desk-profile').selectOption('sq')
  await expect(settings.locator('.desk-note-go')).toHaveValue('')
  await expect(settings.locator('.desk-note-back')).toHaveValue('')
  await expect(settings.locator('.desk-note-go'))
    .toHaveAttribute('title', /Setup → Surface → Soft Controls → MIDI Note/)
  await expect(settings.locator('.desk-note-hint')).toHaveText(
    'Set the key in Setup → Surface → Soft Controls → MIDI Note for a key that does not stay lit; ' +
    'a mute group is for one that should.'
  )

  // The number is the desk's own setting — an SQ's soft keys send 48–63 — so the field
  // takes the whole range and the write is witnessed by the field itself.
  await settings.locator('.desk-note-go').fill('48')
  await settings.locator('.desk-note-go').blur()
  await expect(settings.locator('.desk-note-go')).toHaveAttribute('data-saved', 'true')
  await expect(settings.locator('.desk-note-go')).toHaveValue('48')

  await settings.locator('.desk-note-back').fill('49')
  await settings.locator('.desk-note-back').blur()
  await expect(settings.locator('.desk-note-back')).toHaveValue('49')

  // Written beside the groups rather than over them: the two routes share one row of fields
  // and one show, so what the groups were is what they still are.
  await expect(settings.locator('.desk-button-go')).toHaveValue('5')
  await expect(settings.locator('.desk-button-back')).toHaveValue('6')

  // One note cannot be both: the row says so rather than leaving a show that steps forward
  // and back on the same press.
  await settings.locator('.desk-note-back').fill('48')
  await settings.locator('.desk-note-back').blur()
  await expect(settings.locator('.desk-gap')).toHaveText('One note cannot be both buttons.')

  // A number outside the MIDI range is refused by the field rather than written, as a port
  // or a DCA number is; the show keeps the value it had.
  await settings.locator('.desk-note-go').fill('128')
  await settings.locator('.desk-note-go').blur()
  await expect(settings.locator('.desk-note-go')).toHaveAttribute('data-refused', 'true')
  await expect(settings.locator('.desk-note-go')).toHaveValue('128')

  // A desk whose own mute groups are notes keeps the group row only — the route is not
  // offered where the app's own DCA mutes are notes and a read could be its own echo — and
  // the refusal goes with it, rather than standing over fields that are no longer drawn.
  await settings.locator('.desk-profile').selectOption('avantis')
  await expect(settings.locator('.desk-notes')).toHaveCount(0)
  await expect(settings.locator('.desk-gap')).toHaveCount(0)
  await settings.locator('.desk-profile').selectOption('note')
  await expect(settings.locator('.desk-notes')).toHaveCount(0)
  await expect(settings.locator('.desk-gap')).toHaveCount(0)
  await settings.locator('.show-settings-done').click()
})

test('a show whose settings carry one section and not the rest is refused, and says which', async () => {
  // A file written before the show's settings had every section this build declares — a
  // desk and nothing else. The load refuses it, naming the file and the section it is
  // missing, rather than filling the others in and handing the window a show nobody wrote.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cuerunner-desk-tcp-'))
  const showPath = path.join(root, 'Socket Show.cuerunner')
  fs.writeFileSync(showPath, `${JSON.stringify({
    version: 1,
    id: 'w-socket',
    name: 'Socket Show',
    createdAt: '2026-01-01T00:00:00.000Z',
    audioSettings: { outputDeviceId: 'default' },
    midiSettings: { outputPortName: '' },
    showSettings: {
      desk: {
        kind: 'midi-tcp',
        midiPort: '',
        midiChannel: 1,
        host: '10.0.0.5',
        port: 8000,
        address: '/dca/{n}/on'
      }
    },
    cues: []
  }, null, 2)}\n`)
  const userDataDir = path.join(root, 'userdata')
  fs.mkdirSync(userDataDir, { recursive: true })

  await closeApp(app)
  ;({ app, page } = await launchApp({ license: mintLicense(), userDataDir }))
  await openFromRecent(page, userDataDir, showPath)

  const notice = page.locator('.app-notice[data-kind="error"]')
  await expect(notice).toBeVisible()
  await expect(notice).toContainText('Could not open')
  // The file, and the fact: the section this build writes that the file has not got.
  await expect(notice).toContainText(showPath)
  await expect(notice).toContainText('settings have no oscIn section')
  // Nothing half-read reached the window: the session is still the show it had.
  await expect(page.locator('.workspace-name-text')).not.toHaveText('Socket Show')
  // The notice goes before the next case drives the same window: it is the operator's to
  // clear, and a bar left up would sit over the desk row the cases below reach for.
  await page.locator('.app-notice-dismiss').click()
  await expect(page.locator('.app-notice')).toHaveCount(0)
})

test('a scene recalled at a desk that is not there says so, and the show carries on', async () => {
  const port = await deadPort()
  await buildDeskShow(page, port, pointDeskAtTcp)

  await page.locator('.matrix-scene:not([data-all-closed]) .matrix-recall').click()

  // The desk was dialled, refused, and the operator is told which address did not answer —
  // with the DCA it was for, because that is the message they would have to chase.
  await page.locator('.btn-log').click()
  await expect(page.locator('.log-panel')).toContainText('Could not reach the desk')
  await expect(page.locator('.log-panel')).toContainText(`127.0.0.1:${port}`)

  // And the show is still a show: a recall after a failed one is answered the same way
  // rather than the app having given up on the desk.
  await page.locator('.matrix-scene:not([data-all-closed]) .matrix-recall').click()
  await expect(page.locator('.log-panel')).toContainText('Could not reach the desk')
})
