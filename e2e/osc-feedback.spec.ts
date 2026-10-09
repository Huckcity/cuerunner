// OSC feedback, read by a test client on a port of its own: a QLab-style query answered on
// /reply, a subscriber told the playhead and what runs, and the show's own destination pushed
// to once Settings names it.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { createSocket, type Socket } from 'node:dgram'
import { closeApp, decodeOscMessage, encodeOscMessage, launchApp, oscPortOfItsOwn, toolbarCueBtn, type OscMessage } from './helpers'

let app: ElectronApplication
let page: Page
let port: number
let client: Socket
let received: OscMessage[]

test.beforeEach(async () => {
  ;({ app, page } = await launchApp())
  port = await oscPortOfItsOwn(page)
  received = []
  client = createSocket('udp4')
  client.on('message', buffer => received.push(decodeOscMessage(buffer)))
  // Port 0: the system's choice, so nothing else in the run is listening here.
  await new Promise<void>(resolve => client.bind(0, '127.0.0.1', resolve))
})

test.afterEach(async () => {
  client.close()
  await closeApp(app)
})

function send(address: string, ...args: Array<number | string>): Promise<void> {
  return new Promise((resolve, reject) => {
    client.send(encodeOscMessage(address, ...args), port, '127.0.0.1', error => (error ? reject(error) : resolve()))
  })
}

const last = (address: string): OscMessage | undefined => [...received].reverse().find(message => message.address === address)

/** Two waits, standing on the first. */
async function twoWaits(): Promise<void> {
  await toolbarCueBtn(page, 'Wait').click()
  await toolbarCueBtn(page, 'Wait').click()
  await page.locator('.cue-row').first().click()
  await expect(page.locator('.cue-row').first()).toHaveAttribute('data-selected', 'true')
}

test('a QLab remote’s query is answered on /reply, to the port it asked from', async () => {
  await twoWaits()
  // The window publishes its state as it changes, a moment behind the click: a reply asked
  // for in that moment names the cue added last. Ask until the reply names the selection.
  await expect.poll(async () => {
    await send('/cue/selected/number')
    const reply = last('/reply/cue/selected/number')
    return reply ? (JSON.parse(String(reply.args[0])) as { data?: unknown }).data : null
  }).toBe('1')
  const body = JSON.parse(String(last('/reply/cue/selected/number')!.args[0]))
  expect(body).toMatchObject({ address: '/cue/selected/number', status: 'ok', data: '1' })
  expect(typeof body.workspace_id).toBe('string')

  // A query fires nothing, and is not a line in the log.
  await expect(page.locator('.cue-row[data-running="true"]')).toHaveCount(0)
})

test('a subscriber is told where the playhead stands, what runs, and how far it has got', async () => {
  await twoWaits()
  await expect.poll(async () => {
    await send('/cuerunner/feedback/subscribe')
    return last('/cuerunner/playhead/number')?.args[0] ?? null
  }).toBe('1')

  await page.keyboard.press('Space')
  await expect.poll(() => last('/cuerunner/running/count')?.args[0]).toBe(1)
  await expect.poll(() => last('/cuerunner/running/0/number')?.args[0]).toBe('1')
  await expect.poll(() => last('/cuerunner/playhead/number')?.args[0]).toBe('2')
  // Progress follows, at the show's rate.
  await expect.poll(() => received.filter(message => message.address === '/cuerunner/running/0/progress').length).toBeGreaterThan(2)
})

test('the destination Settings names is pushed to without asking', async () => {
  await twoWaits()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu [data-action="settings"]').click()
  await dialog.getByRole('button', { name: 'Network', exact: true }).click()
  await dialog.locator('#settings-osc-feedback-port').fill(String(client.address().port))
  await dialog.locator('#settings-osc-feedback-port').blur()
  await dialog.locator('#settings-osc-feedback').check()
  await expect(dialog.locator('.settings-service[data-service="osc-in"]')).toContainText(`listening on port ${port}`)
  await dialog.getByRole('button', { name: 'Close' }).click()

  await page.locator('.cue-row').first().click()
  await page.keyboard.press('Space')
  await expect.poll(() => last('/cuerunner/running/0/name')?.args[0]).toBe('Wait')
})
