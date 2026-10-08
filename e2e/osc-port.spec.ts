// The OSC port is the show's alone. A port another program holds — even one that shares with
// address reuse, as QLab's listener does — is refused and said in Settings and in the log, and
// a port this show holds cannot be joined by such a program.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { createSocket, type Socket } from 'node:dgram'
import { closeApp, launchApp, oscPortOfItsOwn } from './helpers'

let app: ElectronApplication
let page: Page
const held: Socket[] = []

test.beforeEach(async () => {
  ;({ app, page } = await launchApp())
})

test.afterEach(async () => {
  for (const socket of held.splice(0)) socket.close()
  await closeApp(app)
})

/** Binds a port the way a listener that shares ports does, and answers whether it got it. */
function bindSharing(port: number): Promise<{ socket: Socket; error: string | null }> {
  const socket = createSocket({ type: 'udp4', reuseAddr: true })
  held.push(socket)
  return new Promise(resolve => {
    socket.once('error', error => resolve({ socket, error: (error as NodeJS.ErrnoException).code ?? error.message }))
    socket.once('listening', () => resolve({ socket, error: null }))
    socket.bind(port, '0.0.0.0')
  })
}

async function networkSettings() {
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu [data-action="settings"]').click()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await dialog.getByRole('button', { name: 'Network', exact: true }).click()
  return dialog
}

test('a port another program shares is refused, and the Settings status and the log say why', async () => {
  // Bound with reuse, the way QLab and other listeners do — the case the old listener joined in silence.
  const { socket, error } = await bindSharing(0)
  expect(error).toBeNull()
  const port = socket.address().port

  const dialog = await networkSettings()
  await dialog.locator('#settings-osc-port').fill(String(port))
  await dialog.locator('#settings-osc-port').blur()
  const status = dialog.locator('.settings-service[data-service="osc-in"]')
  await expect(status).toHaveAttribute('data-state', 'degraded')
  await expect(status).toContainText(`port ${port} is in use by another program`)
  // The platform's own code for a port held by another socket: EADDRINUSE, or WSAEACCES on
  // Windows — the sentence before it is the same either way.
  await expect(status).toContainText(/\((EADDRINUSE|EACCES)\)/)
  await dialog.getByRole('button', { name: 'Close' }).click()

  await page.locator('.btn-log').click()
  await expect(page.locator('.log-panel')).toContainText(new RegExp(
    `OSC input: port ${port} is in use by another program \\(QLab, another Cuerunner, a bridge\\) — ` +
    'this show cannot hear OSC there until it is let go or the port is changed \\((EADDRINUSE|EACCES)\\)'
  ))
})

test('a port this show holds cannot be joined by a program that shares ports', async () => {
  const port = await oscPortOfItsOwn(page)
  const { error } = await bindSharing(port)
  // Refused: EADDRINUSE, or on Windows WSAEACCES, which is what a bind with SO_REUSEADDR gets
  // on a port held with SO_EXCLUSIVEADDRUSE.
  expect(error).toBe(process.platform === 'win32' ? 'EACCES' : 'EADDRINUSE')
  // And this show is still the one listening on it.
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu [data-action="settings"]').click()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await dialog.getByRole('button', { name: 'Network', exact: true }).click()
  await expect(dialog.locator('.settings-service[data-service="osc-in"]')).toContainText(`listening on port ${port}`)
})
