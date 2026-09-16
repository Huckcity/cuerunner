// MIDI Show Control: a cue that tells the console at the other end of the room to go, and
// a trigger that lets that console's own go fire a cue here.
//
// What this lane holds is the surface and the app's account of itself: the fields a new
// cue is born with, which of them the command in it takes, and what the operator is told
// when the show's desk is one that cannot carry the message. What goes on the wire is the
// integration harness's job (`integration/specs/msc.spec.ts`), which has a desk to say so
// and a peer that answers.
import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  addCueFromMoreMenu,
  closeApp,
  launchApp,
  mintLicense,
  openFromRecent,
  openLogPanel
} from './helpers'

let app: ElectronApplication
let page: Page
let root: string

/** The desk's own socket: the port an SQ and an Avantis serve MIDI over TCP on. */
const DESK_PORT = 51325
/** The cue the show names on the desk's list — the one it sends to, and the one it hears. */
const CUE = '12'

test.beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'winslab-msc-'))
  // No license: the show control cue is the free half of the app, and this launch is what
  // says so by using it. The Triggers tab the last case reads is the licensed one, so
  // that case starts its own instance with a key of its own.
  ;({ app, page } = await launchApp())
})

test.afterAll(async () => {
  await closeApp(app)
  fs.rmSync(root, { recursive: true, force: true })
})

/** One row of the inspector's fields, by the label the operator reads it under. */
function field(label: string) {
  return page.locator('.field-row').filter({ has: page.locator('label', { hasText: label }) })
}

/** Opens one of the selected cue's inspector tabs, the way an operator does. */
async function openTab(name: string): Promise<void> {
  await page.locator('.inspector-tab', { hasText: name }).click()
}

/**
 * A show whose desk is on its own socket and whose second cue answers that desk's own go.
 *
 * Written as a workspace file rather than typed into the view, for the same reason the
 * integration harness writes one: what the trigger names is the desk's socket as
 * "host:port", which no form types, and what this case is about is the file being read
 * back rather than the setting being made.
 */
function writeTriggerShow(): string {
  const showPath = path.join(root, 'Show Control Triggers.wlab')
  fs.writeFileSync(showPath, `${JSON.stringify({
    version: 1,
    id: 'w-msc-e2e',
    name: 'Show Control Triggers',
    createdAt: '2026-01-01T00:00:00.000Z',
    audioSettings: { outputDeviceId: 'default' },
    midiSettings: { outputPortName: '' },
    showSettings: {
      desk: {
        kind: 'midi-tcp',
        profile: 'sq',
        midiPort: '',
        midiChannel: 1,
        host: '127.0.0.1',
        port: 8000,
        tcpPort: DESK_PORT,
        address: '/dca/{n}/on'
      }
    },
    cues: [
      {
        id: 'm-1',
        number: '1',
        name: 'LX Go',
        type: 'msc',
        colorLabel: 'none',
        parentId: null,
        preWait: 0,
        postWait: 0,
        timelineOffset: 0,
        duration: 0,
        advance: 'none',
        isArmed: true,
        notes: '',
        command: 'go',
        format: 'all',
        deviceId: 127,
        cueNumber: CUE,
        cueList: '',
        destination: 'desk',
        portName: ''
      },
      {
        id: 'w-1',
        number: '2',
        name: 'Desk called a cue',
        type: 'wait',
        colorLabel: 'none',
        parentId: null,
        preWait: 0,
        postWait: 0,
        timelineOffset: 0,
        duration: 200,
        advance: 'none',
        isArmed: true,
        notes: '',
        triggers: [
          {
            // The desk's own socket, reported the way the desk service names it.
            id: 't-msc',
            kind: 'msc',
            device: `127.0.0.1:${DESK_PORT}`,
            deviceId: 127,
            format: 'all',
            command: 'go',
            cueNumber: CUE,
            cueList: ''
          }
        ]
      }
    ]
  }, null, 2)}\n`)

  return showPath
}

test('a new Show Control cue is born addressed to whoever is listening', async () => {
  await addCueFromMoreMenu(page, 'Show Control')

  // The cue that was just added is the one the inspector is on, and the tab it carries is
  // the one only a show control cue has.
  await expect(page.locator('.inspector-tab')).toHaveText(['Basics', 'Show Control', 'Triggers'])
  await openTab('Show Control')

  // The all-call and the all-types, which is the pair a desk's own document writes for
  // "go, whoever is listening": a cue nobody has addressed yet still reaches the console
  // in the room, and the console says so on its front panel.
  await expect(field('Command').locator('select')).toHaveValue('go')
  await expect(field('Command').locator('select option:checked')).toHaveText('Go')
  await expect(field('For').locator('select')).toHaveValue('all')
  await expect(field('For').locator('select option:checked')).toHaveText('Everything')
  await expect(field('Device').locator('input')).toHaveValue('127')

  // A cue number this app has nothing to check against, so it is a field rather than a
  // picker — and left empty it means the desk's next cue, which is what the field says
  // where the operator leaves it.
  await expect(field('Cue').locator('input')).toHaveValue('')
  await expect(field('Cue').locator('input')).toHaveAttribute('placeholder', 'its next cue')

  // The show's desk is an OSC one, and the read-back below the fields says so while the
  // cue is being set up rather than when GO is pressed. It is the first hint in the tab:
  // the Last Run section under it has a hint of its own, about a different thing.
  await expect(page.locator('.inspector-body .inspector-hint').first()).toHaveText(
    'This show has no desk that takes MIDI. Set one up in Show Settings, or send this cue to a MIDI port instead.'
  )
})

test('a command that carries no cue data is not offered any', async () => {
  const command = field('Command').locator('select')

  // LOAD names a cue the way GO does: the desk is told which of its cues to arm.
  await command.selectOption('load')
  await expect(field('Cue')).toBeVisible()
  await expect(field('List')).toBeVisible()

  // RESET takes none — the specification gives that command no data — so the two fields
  // are not drawn, rather than being drawn and then dropped on the way out.
  await command.selectOption('reset')
  await expect(field('Cue')).toHaveCount(0)
  await expect(field('List')).toHaveCount(0)

  // And back: which fields a cue offers is its command's business, not how far this
  // session happens to have walked, and the cue data itself is still where it was.
  await command.selectOption('go')
  await expect(field('Cue')).toBeVisible()
  await expect(field('List')).toBeVisible()
  await expect(field('Cue').locator('input')).toHaveValue('')
})

test('a cue pointed at a MIDI port is offered the port it goes out on', async () => {
  const send = field('Send').locator('select')

  // A show has already been pointed at a desk, so that is where a new cue's command goes
  // until the operator says the console is on a cable of this machine's instead.
  await expect(send).toHaveValue('desk')
  await expect(field('Port')).toHaveCount(0)

  await send.selectOption('port')
  await expect(field('Port')).toBeVisible()
  // The row is the choice made visible, and the read-back says where the command goes now
  // — the first hint in the tab, as the Last Run section below has one of its own.
  await expect(page.locator('.inspector-body .inspector-hint').first()).toHaveText(
    'Sent on this machine’s MIDI, like any other MIDI cue.'
  )

  await send.selectOption('desk')
  await expect(field('Port')).toHaveCount(0)
})

test('a command at a desk that cannot take it says so in the log', async () => {
  // The desk this show drives is an OSC one, and an address is not a MIDI message: there
  // is no honest way to put a show control command on that connection, and a run that
  // reported a send it did not make would be the operator's problem at the worst moment.
  await page.locator('.cue-row').first().click()
  await page.keyboard.press('Space')

  await openLogPanel(page)
  const refusal = page.locator('.log-panel .log-row[data-level="error"]', {
    hasText: 'the show’s desk is driven over OSC, which does not carry MIDI Show Control'
  })
  await expect(refusal).toHaveCount(1)
  // The line names the cue that refused, so it reads as this cue's and not as the show
  // saying something in general.
  await expect(refusal).toContainText('Show Control')

  // And the cue's own readout says the same, rather than the run having gone quietly. GO
  // hands the selection on and there is no cue after this one to hand it to, so the cue
  // is picked up again to read it.
  await page.locator('.cue-row').first().click()
  await openTab('Show Control')
  await expect(page.locator('.last-run-badge')).toHaveText('failed')
})

test('a show file’s own Show Control trigger reads back in the Triggers tab', async () => {
  const showPath = writeTriggerShow()
  const userDataDir = path.join(root, 'userdata')
  fs.mkdirSync(userDataDir, { recursive: true })

  // A fresh instance with a fresh profile: the trigger has to be the file's, not
  // something this machine learned by watching the desk earlier in the run.
  await closeApp(app)
  ;({ app, page } = await launchApp({ license: mintLicense(), userDataDir }))
  await openFromRecent(page, userDataDir, showPath)

  // The cue the desk's own go answers to, rather than the cue that tells the desk to go.
  await page.locator('.cue-row', { hasText: 'Desk called a cue' }).click()
  await openTab('Triggers')

  // What the trigger reads as: the command it answers, the cue it names, and the address
  // it arrived from — the desk's own socket, as the desk service names it.
  await expect(page.locator('.trigger-row[data-kind="msc"] .trigger-text'))
    .toHaveText(`Show Control Go cue ${CUE} from "127.0.0.1:${DESK_PORT}"`)
})
