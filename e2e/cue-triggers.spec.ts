// Triggers: a cue that answers to a message from a desk rather than to GO. The path
// exercised here is the whole one — a datagram arrives, lands on the bus, reaches the
// renderer, and the cue's own work actually happens.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { addCueFromMoreMenu, closeApp, launchApp, oscPortOfItsOwn, sendOsc, startServer, type TestServer } from './helpers'

let app: ElectronApplication
let page: Page
let server: TestServer | undefined
let port: number

test.beforeEach(async () => {
  ;({ app, page } = await launchApp())
  // A message that does nothing proves nothing if it went to another app in the run.
  port = await oscPortOfItsOwn(page)
})

test.afterEach(async () => {
  await closeApp(app)
  await server?.close()
  server = undefined
})

/** A network cue aimed at the test server: the request that lands is proof it ran. */
async function networkCueTo(baseUrl: string): Promise<void> {
  await addCueFromMoreMenu(page, 'Network')
  await page.locator('.inspector-tab', { hasText: 'Network' }).click()
  await page.locator('.field-row').filter({ hasText: 'URL' }).locator('input')
    .fill(`${baseUrl}/triggered`)
  await page.locator('.inspector-tab', { hasText: 'Triggers' }).click()
}

async function addOscTrigger(address: string): Promise<void> {
  await page.locator('#trigger-osc-address').fill(address)
  await page.locator('.trigger-section[data-kind="osc"] .trigger-add').click()
  await expect(page.locator('.trigger-row[data-kind="osc"]')).toContainText(address)
}

function hits(): number {
  return server?.hits.length ?? 0
}

test('a cue fires when the message it answers to arrives', async () => {
  server = await startServer()
  await networkCueTo(server.baseUrl)
  await addOscTrigger('/eos/cue/12/fire')

  // Writing a trigger is not firing one.
  expect(hits()).toBe(0)

  await sendOsc(port, '/eos/cue/12/fire')

  await expect.poll(hits).toBe(1)
  expect(server?.hits[0].url).toBe('/triggered')

  // The log says what fired it, so a triggered cue reads differently from a GO.
  await page.locator('.btn-log').click()
  await expect(page.locator('.log-panel')).toContainText('Triggered by OSC /eos/cue/12/fire')
})

test('removing the trigger stops the cue answering to it', async () => {
  server = await startServer()
  await networkCueTo(server.baseUrl)
  await addOscTrigger('/eos/cue/12/fire')

  await page.locator('.trigger-row[data-kind="osc"] .trigger-remove').click()
  await expect(page.locator('.trigger-row')).toHaveCount(0)

  await sendOsc(port, '/eos/cue/12/fire')
  // Long enough for the datagram to have arrived and been ignored.
  await page.waitForTimeout(500)

  expect(hits()).toBe(0)
})

test('a message nothing answers to leaves the cue alone', async () => {
  server = await startServer()
  await networkCueTo(server.baseUrl)
  await addOscTrigger('/eos/cue/12/fire')

  await sendOsc(port, '/eos/cue/13/fire')
  await page.waitForTimeout(500)

  expect(hits()).toBe(0)
})
