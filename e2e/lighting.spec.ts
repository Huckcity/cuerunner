// Lighting from the cue list, through the real window and the real main process: the rig is
// patched in the Lighting view, a universe is pointed at a listener this spec holds, a look is
// built on the faders and recorded into a new Light cue, and GO sends it. What the listener reads
// is the sACN packets the app actually put on the loopback, decoded with the same reader a
// receiver uses — not the app's account of itself — and the monitor is held to the same values.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { createSocket, type Socket } from 'node:dgram'
import { closeApp, launchApp } from './helpers'
import { decodeSacnData, type SacnDataPacket } from '../src/main/dmx/packets'

let app: ElectronApplication
let page: Page

test.afterEach(async () => {
  await closeApp(app)
})

/** A receiver on the loopback, bound to a port of its own, keeping every sACN packet it hears. */
async function listen(): Promise<{ socket: Socket; port: number; packets: SacnDataPacket[] }> {
  const socket = createSocket('udp4')
  const packets: SacnDataPacket[] = []
  socket.on('message', message => {
    const packet = decodeSacnData(message)
    if (packet !== null) packets.push(packet)
  })
  await new Promise<void>(resolve => socket.bind(0, '127.0.0.1', () => resolve()))
  return { socket, port: socket.address().port, packets }
}

/** Sets a range input the way a dragged fader does: the value, then the input event React reads. */
async function setFader(page: Page, label: string, value: number): Promise<void> {
  await page.getByLabel(label, { exact: true }).evaluate((input, next) => {
    const element = input as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(element, String(next))
    element.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
}

async function openLighting(page: Page): Promise<void> {
  await page.getByRole('tab', { name: /Lighting/ }).click()
}

async function lightingTab(page: Page, name: string): Promise<void> {
  await page.locator('.lighting-tab', { hasText: name }).click()
}

test('patch, record a Light cue from the faders, GO, and the DMX arrives and shows', async () => {
  const listener = await listen()
  try {
    ;({ app, page } = await launchApp())
    await openLighting(page)

    // Two pars of a built-in type, in the first gaps of universe 1.
    await page.locator('#patch-type').selectOption({ label: 'Dimmer + RGB' })
    await page.locator('#patch-count').fill('2')
    await page.getByRole('button', { name: 'Patch', exact: true }).click()
    const fixtures = page.getByRole('table', { name: 'Fixtures' })
    await expect(fixtures.locator('tbody tr')).toHaveCount(2)
    await expect(fixtures.locator('tr[data-fixture="Dimmer + RGB 2"]')).toContainText('5–8')

    // A third patched over the second is named as a clash before the show finds it, and goes.
    await page.locator('#patch-type').selectOption({ label: 'Dimmer' })
    await page.locator('#patch-address').fill('6')
    await page.locator('#patch-count').fill('1')
    await page.locator('#patch-name').fill('Clash')
    await page.getByRole('button', { name: 'Patch', exact: true }).click()
    await expect(page.getByRole('list', { name: 'Patch warnings' })).toContainText('share a slot')
    await page.getByRole('button', { name: 'Remove Clash' }).click()
    await expect(page.getByRole('list', { name: 'Patch warnings' })).toHaveCount(0)

    // Universe 1 goes to the listener, unicast.
    await lightingTab(page, 'Network')
    await page.locator('#new-output-universe').fill('1')
    await page.getByRole('button', { name: 'Add output', exact: true }).click()
    const outputs = page.getByRole('table', { name: 'Outputs' })
    await outputs.getByLabel('Output transport').selectOption('unicast')
    const address = outputs.getByLabel('Output address')
    await address.fill(`127.0.0.1:${listener.port}`)
    await address.press('Enter')

    // The look: par 1 full and red, par 2 at half.
    await lightingTab(page, 'Faders')
    await setFader(page, 'Dimmer + RGB 1 Dimmer', 1)
    await setFader(page, 'Dimmer + RGB 1 Red', 1)
    await setFader(page, 'Dimmer + RGB 2 Dimmer', 0.5)
    await expect(page.locator('.lighting-fixture[data-fixture="Dimmer + RGB 1"] output').first()).toHaveText('100%')
    // The faders are live before anything is recorded.
    await expect.poll(() => listener.packets.at(-1)?.slots[0], { timeout: 10_000 }).toBe(255)

    await page.getByRole('button', { name: 'New Light cue' }).click()
    await expect(page.locator('.lighting-note[role="status"]')).toContainText('Recorded 3 values into a new Light cue')
    // Recording let the faders go: the rig is back to what the cues hold, which is nothing yet.
    await expect.poll(() => listener.packets.at(-1)?.slots[0], { timeout: 10_000 }).toBe(0)

    // The cue the faders made, in the cue list, with the look in it.
    await page.getByRole('tab', { name: 'Cues' }).click()
    const row = page.locator('.cue-row', { hasText: 'Light Cue' })
    await expect(row).toHaveCount(1)
    await row.click()
    await page.locator('.inspector-tab', { hasText: 'Light' }).first().click()
    await expect(page.getByLabel('Look').locator('.light-look-row')).toHaveCount(3)
    // A quick fade, so the run is short.
    await page.locator('#light-fade').fill('0.2')

    await page.getByRole('button', { name: /GO/ }).click()
    await expect.poll(() => {
      const last = listener.packets.at(-1)
      return last === undefined ? null : [last.universe, last.slots[0], last.slots[1], last.slots[4]]
    }, { timeout: 10_000 }).toEqual([1, 255, 255, 128])

    // The monitor shows the same bytes the wire carried.
    await openLighting(page)
    await lightingTab(page, 'Monitor')
    const cells = page.locator('.lighting-cells[data-universe="1"]')
    await expect(cells.locator('[data-slot="1"]')).toHaveAttribute('data-value', '255')
    await expect(cells.locator('[data-slot="2"]')).toHaveAttribute('data-value', '255')
    await expect(cells.locator('[data-slot="5"]')).toHaveAttribute('data-value', '128')

    // Blackout takes every slot to zero on the wire, and gives them back.
    await page.getByRole('button', { name: 'Blackout' }).click()
    await expect.poll(() => listener.packets.at(-1)?.slots[0], { timeout: 10_000 }).toBe(0)
    await expect(cells.locator('[data-slot="1"]')).toHaveAttribute('data-value', '0')
    await page.getByRole('button', { name: 'Blackout' }).click()
    await expect.poll(() => listener.packets.at(-1)?.slots[0], { timeout: 10_000 }).toBe(255)
  } finally {
    listener.socket.close()
  }
})
