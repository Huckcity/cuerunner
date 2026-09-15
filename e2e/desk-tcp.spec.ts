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
    'Sends note 1 … 12 to 10.0.0.5:51325, on and off'
  )

  await settings.locator('.show-settings-done').click()
})

test('a show written before the desk had a socket opens on the port the desks use', async () => {
  // The file is what an operator's workspace looks like after the upgrade: a desk pointed
  // over the network, and no MIDI-over-TCP port, because the field did not exist when it
  // was saved.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'winslab-desk-tcp-'))
  const showPath = path.join(root, 'Socket Show.wlab')
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

  await openShowSettings(page)
  const settings = page.locator('.show-settings-dialog')
  await expect(settings.locator('.desk-tcp-host')).toHaveValue('10.0.0.5')
  await expect(settings.locator('.desk-tcp-port')).toHaveValue('51325')
  await settings.locator('.show-settings-done').click()

  // Saved, the port is the show's own rather than a value this build filled in on the way
  // through — the next file carries it.
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu button[data-action="save"]').click()
  await expect(page.locator('.workspace-name')).not.toContainText('●')

  const saved = JSON.parse(fs.readFileSync(showPath, 'utf-8')) as {
    showSettings: { desk: { host: string; tcpPort: number } }
  }
  expect(saved.showSettings.desk).toMatchObject({ host: '10.0.0.5', tcpPort: 51325 })
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
