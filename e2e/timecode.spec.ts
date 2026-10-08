// SMPTE timecode, the whole way: a clock arrives on the network as ArtTimeCode, the window
// says it is locked, and a cue fires on its frame — and the other way, a timecode cue sends
// a clock a receiver on this test's own socket reads back frame by frame. Art-Net is the wire
// because it needs no hardware and no MIDI module: the follower behind it is the one MTC and
// LTC feed too.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { createSocket, type Socket } from 'node:dgram'
import { addCueFromMoreMenu, closeApp, launchApp, mintLicense, openLogPanel, toolbarCueBtn } from './helpers'

let app: ElectronApplication
let page: Page
const sockets: Socket[] = []
const timers: NodeJS.Timeout[] = []

test.beforeEach(async () => {
  ;({ app, page } = await launchApp({ license: mintLicense() }))
})

test.afterEach(async () => {
  for (const timer of timers.splice(0)) clearInterval(timer)
  for (const socket of sockets.splice(0)) socket.close()
  await closeApp(app)
})

/** A port of this test's own, in a range the rest of the suite does not use. */
function timecodePort(): number {
  return 47100 + Math.floor(Math.random() * 800)
}

function artTimecode(hours: number, minutes: number, seconds: number, frames: number, type = 1): Buffer {
  const packet = Buffer.alloc(19)
  packet.write('Art-Net\0', 0, 'latin1')
  packet[8] = 0x00
  packet[9] = 0x97
  packet[11] = 14
  packet[14] = frames
  packet[15] = seconds
  packet[16] = minutes
  packet[17] = hours
  packet[18] = type
  return packet
}

/** Sends a 25 fps clock from `startFrame` frames past 01:00:00:00, one datagram a frame. */
function sendClock(port: number, startFrame: number): () => void {
  const socket = createSocket('udp4')
  sockets.push(socket)
  let frame = startFrame
  const timer = setInterval(() => {
    const total = 90_000 + frame++
    const label = [Math.floor(total / 90_000), Math.floor(total / 1500) % 60, Math.floor(total / 25) % 60, total % 25]
    socket.send(artTimecode(label[0], label[1], label[2], label[3]), port, '127.0.0.1')
  }, 40)
  timers.push(timer)
  return () => clearInterval(timer)
}

async function openTimecodeSettings(): Promise<ReturnType<Page['getByRole']>> {
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu [data-action="settings"]').click()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await dialog.getByRole('button', { name: 'Timecode', exact: true }).click()
  return dialog
}

/** Points the receiver at ArtTimeCode on a port of this test's own. */
async function listenOnArtnet(port: number, extra?: (dialog: ReturnType<Page['getByRole']>) => Promise<void>): Promise<void> {
  const dialog = await openTimecodeSettings()
  await dialog.locator('#settings-timecode-source').selectOption('artnet')
  await dialog.locator('#settings-timecode-artnet-port').fill(String(port))
  await dialog.locator('#settings-timecode-artnet-port').blur()
  await expect(dialog.locator('.settings-service[data-service="timecode"]')).toContainText(`UDP ${port}`)
  if (extra) await extra(dialog)
  await dialog.getByRole('button', { name: 'Close' }).click()
}

test('a cue fires on its frame of the incoming clock, and the window says the clock is locked', async () => {
  const port = timecodePort()
  await listenOnArtnet(port)

  await toolbarCueBtn(page, 'Wait').click()
  await page.locator('.inspector-tab', { hasText: 'Triggers' }).click()
  await page.locator('#trigger-timecode').fill('01:00:01:10')
  await page.locator('.trigger-timecode-add').click()
  await expect(page.locator('.trigger-row[data-kind="timecode"]')).toContainText('Timecode 01:00:01:10')

  sendClock(port, 0)

  const chip = page.locator('.timecode-chip')
  await expect(chip).toHaveAttribute('data-state', 'locked')
  await expect(chip.locator('.timecode-chip-value')).toContainText('01:00:0')

  await openLogPanel(page)
  await expect(page.locator('.log-panel')).toContainText('Triggered by timecode 01:00:01:10', { timeout: 10_000 })
  // Once a pass: the clock running on does not fire it again.
  await page.waitForTimeout(500)
  await expect(page.locator('.log-panel').getByText('Triggered by timecode 01:00:01:10')).toHaveCount(1)
})

test('the show monitor reads the clock back, and says when it is lost', async () => {
  const port = timecodePort()
  await listenOnArtnet(port, async dialog => {
    await dialog.locator('#settings-timecode-hold').fill('300')
    await dialog.locator('#settings-timecode-hold').blur()
  })
  const stop = sendClock(port, 0)
  await page.locator('.dock-tab.btn-monitor').click()
  const panel = page.locator('.timecode-panel')
  await expect(panel.locator('.timecode-panel-state')).toHaveText('Locked')
  await expect(panel).toContainText('ArtTimeCode on UDP')
  await expect(panel).toContainText('25 fps')

  stop()
  await expect(panel.locator('.timecode-panel-state')).toHaveText('Lost', { timeout: 5_000 })
  await expect(page.locator('.timecode-chip')).toHaveAttribute('data-state', 'lost')
})

test('with chase on, a cue the clock starts inside of is put where the clock is', async () => {
  const port = timecodePort()
  await listenOnArtnet(port, async dialog => {
    await dialog.locator('#settings-timecode-chase').check()
  })
  await toolbarCueBtn(page, 'Wait').click()
  await page.locator('.inspector-tab', { hasText: 'Wait' }).click()
  await page.locator('.field-row').filter({ hasText: 'Duration' }).locator('input').fill('20')
  await page.locator('.field-row').filter({ hasText: 'Duration' }).locator('input').blur()
  await page.locator('.inspector-tab', { hasText: 'Triggers' }).click()
  await page.locator('#trigger-timecode').fill('01:00:00:00')
  await page.locator('.trigger-timecode-add').click()

  // The clock is first heard five seconds after the cue's frame.
  sendClock(port, 125)
  await openLogPanel(page)
  await expect(page.locator('.log-panel')).toContainText(/Chased timecode to 5\.\d s in/, { timeout: 10_000 })
})

test('a timecode cue sends a clock a receiver reads back frame by frame', async () => {
  const port = timecodePort()
  const receiver = createSocket('udp4')
  sockets.push(receiver)
  const heard: string[] = []
  receiver.on('message', packet => {
    if (packet.length < 19 || packet.readUInt16LE(8) !== 0x9700) return
    heard.push([packet[17], packet[16], packet[15], packet[14]].map(v => String(v).padStart(2, '0')).join(':'))
  })
  await new Promise<void>(resolve => receiver.bind(port, '127.0.0.1', resolve))

  await addCueFromMoreMenu(page, 'Timecode')
  await page.locator('.inspector-tab', { hasText: 'Timecode' }).click()
  await page.locator('#timecode-mtc').uncheck()
  await page.locator('#timecode-artnet').check()
  await page.locator('.timecode-artnet-host').fill(`127.0.0.1:${port}`)
  await page.locator('.timecode-artnet-host').blur()
  await page.locator('.timecode-start').fill('02:00:00:00')
  await page.locator('.timecode-start').blur()

  await page.locator('.btn-go').click()
  await expect.poll(() => heard.length, { timeout: 10_000 }).toBeGreaterThan(30)
  expect(heard[0]).toBe('02:00:00:00')
  // Consecutive frames, a frame a datagram.
  expect(heard.slice(0, 26)).toContain('02:00:01:00')

  // The inspector shows the clock it is running, and pausing it stops the datagrams. GO moved
  // the selection on, so the cue is picked again to read it.
  await page.locator('.cue-row').first().click()
  await page.locator('.inspector-tab', { hasText: 'Timecode' }).click()
  await expect(page.locator('.timecode-running-value')).toContainText('02:00:0')
  await page.locator('.timecode-pause').click()
  await expect(page.locator('.timecode-running-value')).toContainText('(paused)')
  const paused = heard.length
  await page.waitForTimeout(400)
  expect(heard.length - paused).toBeLessThanOrEqual(1)
})
