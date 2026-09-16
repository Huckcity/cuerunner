// Redundant playback, end to end: a machine standing by while another one drives.
//
// The spec process is the other machine. It speaks the pair's protocol over a real
// socket — a hello, then a beat five times a second with the live show attached, and
// then silence — and what is asserted is what the app did about it: the media it warmed
// before it was needed, the status it shows the operator, and the cue that comes back at
// the position the live machine had reached rather than from the top.
//
// The audio engine is the silent backend (launchApp's default), which mixes and clocks
// exactly as the real one does; the position the app reports is the engine's own.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { closeApp, launchApp, mintLicense, openFromRecent, openLogPanel } from './helpers'
import { cueListHash, decodeMessage, REDUNDANCY_PROTOCOL } from '../src/shared/redundancy'
import type { RedundancyDigest } from '../src/shared/redundancy'

/** Where in the show the live machine is when this machine has to pick it up. */
const LIVE_POSITION_MS = 4000
const TRACK_SECONDS = 30
const TOKEN = 'desk-token'
const SHOW_ID = 'w-redundancy'
const CUE_HASH = cueListHash([{ id: 'a1', number: '1', name: 'Overture' }])

/** A PCM WAV of an exact length: the cue's own file, written by the spec. */
function writeWav(filePath: string, seconds: number): void {
  const sampleRate = 48000
  const frames = seconds * sampleRate
  const dataBytes = frames * 2
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataBytes, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20) // PCM
  buffer.writeUInt16LE(1, 22) // mono
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataBytes, 40)
  for (let frame = 0; frame < frames; frame++) {
    buffer.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * frame) / sampleRate) * 12000), 44 + frame * 2)
  }
  fs.writeFileSync(filePath, buffer)
}

/** The other machine of the pair: a socket, a hello, and a beat while it is running. */
interface LivePeer {
  port: number
  /** Everything the app has sent, decoded. */
  received: Array<Record<string, unknown>>
  /** The last digest the app sent, or undefined before its first beat. */
  digest: () => Partial<RedundancyDigest> | undefined
  hello: () => Record<string, unknown> | undefined
  /** Stops answering, the way a machine that has died stops answering. */
  stop: () => Promise<void>
}

async function startLivePeer(): Promise<LivePeer> {
  const received: Array<Record<string, unknown>> = []
  const sockets = new Set<net.Socket>()
  let beat: NodeJS.Timeout | null = null
  let stopped = false

  const server = net.createServer(socket => {
    sockets.add(socket)
    let buffer = ''
    socket.on('data', chunk => {
      buffer += chunk.toString('utf8')
      let end = buffer.indexOf('\n')
      while (end >= 0) {
        const line = buffer.slice(0, end)
        buffer = buffer.slice(end + 1)
        const message = decodeMessage(line)
        if (message) received.push(message as unknown as Record<string, unknown>)
        end = buffer.indexOf('\n')
      }
    })
    socket.on('error', () => sockets.delete(socket))
    socket.on('close', () => sockets.delete(socket))

    // The hello comes straight back, and then the beats: the live machine's show, as it
    // stands, five times a second, exactly as the service's own cadence is documented.
    socket.write(`${JSON.stringify({
      t: 'hello',
      protocol: REDUNDANCY_PROTOCOL,
      id: 'id-a',
      name: 'desk-a',
      role: 'live',
      driving: true,
      term: 0,
      token: TOKEN
    })}\n`)

    if (beat !== null) clearInterval(beat)
    let seq = 0
    beat = setInterval(() => {
      if (stopped || socket.destroyed) return
      socket.write(`${JSON.stringify({
        t: 'beat',
        seq: seq++,
        term: 0,
        driving: true,
        digest: liveDigest()
      })}\n`)
    }, 100)
  })

  const listening = Promise.withResolvers<void>()
  server.listen(0, '127.0.0.1', () => listening.resolve())
  await listening.promise

  return {
    port: (server.address() as net.AddressInfo).port,
    received,
    hello: () => received.find(message => message.t === 'hello'),
    digest: () => {
      const beats = received.filter(message => message.t === 'beat')
      return beats.at(-1)?.digest as Partial<RedundancyDigest> | undefined
    },
    stop: async () => {
      stopped = true
      if (beat !== null) clearInterval(beat)
      for (const socket of sockets) socket.destroy()
      const closed = Promise.withResolvers<void>()
      server.close(() => closed.resolve())
      await closed.promise
    }
  }
}

/** What the live machine is doing with the show: one cue, four seconds in. */
function liveDigest(): RedundancyDigest {
  return {
    at: Date.now(),
    show: { id: SHOW_ID, name: 'Redundancy', cues: 1, hash: CUE_HASH },
    selectedId: 'a1',
    running: [
      {
        cueId: 'a1',
        number: '1',
        name: 'Overture',
        type: 'audio',
        state: 'playing',
        positionMs: LIVE_POSITION_MS,
        durationMs: TRACK_SECONDS * 1000
      }
    ],
    prepared: 0
  }
}

let app: ElectronApplication
let page: Page
let peer: LivePeer
let userData: string

test.beforeAll(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'winslab-redundancy-'))
  const overture = path.join(root, 'overture.wav')
  writeWav(overture, TRACK_SECONDS)

  const showPath = path.join(root, 'Redundancy.wlab')
  fs.writeFileSync(showPath, JSON.stringify({
    version: 1,
    id: SHOW_ID,
    name: 'Redundancy',
    createdAt: '2026-01-01T00:00:00.000Z',
    audioSettings: { outputDeviceId: 'default' },
    midiSettings: { outputPortName: '' },
    cues: [
      {
        id: 'a1',
        number: '1',
        name: 'Overture',
        type: 'audio',
        colorLabel: 'none',
        parentId: null,
        preWait: 0,
        postWait: 0,
        timelineOffset: 0,
        duration: TRACK_SECONDS * 1000,
        advance: 'none',
        isArmed: true,
        notes: '',
        filePath: overture,
        startTime: 0,
        endTime: null,
        fadeInDuration: 0,
        volume: 1,
        pan: 0,
        outputs: null,
        loopCount: 0,
        playbackRate: 1,
        trim: 1
      }
    ]
  }))

  peer = await startLivePeer()

  // This machine's own half of the pair, written where the app keeps it: with the
  // license and not with the show.
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'winslab-redundancy-user-'))
  fs.writeFileSync(path.join(userData, 'redundancy.json'), JSON.stringify({
    enabled: true,
    name: 'desk-b',
    id: 'id-b',
    role: 'standby',
    port: 53119,
    peerHost: '127.0.0.1',
    peerPort: peer.port,
    token: TOKEN,
    timeoutMs: 1500,
    takeover: 'auto'
  }))

  ;({ app, page } = await launchApp({ userDataDir: userData, license: mintLicense() }))
  await openFromRecent(page, userData, showPath)
})

test.afterAll(async () => {
  await peer.stop()
  await closeApp(app)
})

test('the standby takes the live machine’s show and warms the media before it is needed', async () => {
  // The wire, from the other machine's side: what the app says about itself and what it
  // offers. This is a machine standing by, and it says so with the same token.
  await expect.poll(() => peer.hello()?.role ?? null).toBe('standby')
  expect(peer.hello()).toMatchObject({ protocol: REDUNDANCY_PROTOCOL, name: 'desk-b', driving: false, token: TOKEN })

  // And it mirrors the show it was given, cue list and all, at a beat a second and a
  // half at the outside.
  await expect.poll(() => peer.digest()?.selectedId ?? null).toBe('a1')
  expect(peer.digest()?.show).toEqual({ id: SHOW_ID, name: 'Redundancy', cues: 1, hash: CUE_HASH })

  // The file the live machine is playing has been decoded into this machine's engine:
  // that is what a takeover starting instantly is made of.
  await expect.poll(() => peer.digest()?.prepared ?? 0).toBeGreaterThan(0)

  // The status the operator reads: this machine is standing by, it has heard from the
  // partner, and the two have the same show open.
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu [data-action="settings"]').click()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await dialog.getByRole('button', { name: 'Backup machine', exact: true }).click()

  await expect(dialog.locator('.redundancy-line[data-field="machine"]')).toContainText('desk-b — standing by')
  await expect(dialog.locator('.redundancy-line[data-field="partner"]')).toContainText('desk-a (live)')
  // A partner that is answering is described as answering — not with an age worked out
  // from a status that has simply not changed since, which reads as a partner that has
  // stopped.
  await expect(dialog.locator('.redundancy-line[data-field="partner"]')).toContainText('answering')
  await expect(dialog.locator('.redundancy-line[data-field="show"]')).toContainText('In sync')
  await expect(dialog.locator('.settings-service[data-service="redundancy"]')).toHaveAttribute('data-state', 'running')

  await dialog.getByRole('button', { name: 'Close' }).click()
})

test('the live machine going quiet is a takeover, and the cue comes back where it was', async () => {
  // The other machine stops answering. Nothing else changes: no cue is fired by hand,
  // and the show is never reloaded.
  await peer.stop()

  await openLogPanel(page)
  await expect(page.locator('.log-panel')).toContainText('took the show over')
  await expect(page.locator('.log-panel')).toContainText('1 cue picked up at its position')

  // The cue is playing on this machine's engine — and the engine says it is four
  // seconds in and counting, not starting again from the top. This is the whole claim:
  // a takeover picks the show up rather than restarting it.
  await expect(page.locator('.cue-row[data-running="true"]')).toHaveCount(1)
  await expect.poll(async () => {
    const progress = await page.evaluate(() =>
      (window as unknown as {
        winslab: { audio: { progress: (cueId: string) => Promise<{ elapsedMs: number } | null> } }
      }).winslab.audio.progress('a1')
    )
    return Math.round(progress?.elapsedMs ?? 0)
  }).toBeGreaterThanOrEqual(LIVE_POSITION_MS)

  // And the status says which machine is running the show now.
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu [data-action="settings"]').click()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await dialog.getByRole('button', { name: 'Backup machine', exact: true }).click()
  await expect(dialog.locator('.redundancy-line[data-field="machine"]')).toContainText('desk-b — running the show')
  await expect(dialog.locator('.redundancy-line[data-field="partner"]')).toContainText('gone quiet')
  await dialog.getByRole('button', { name: 'Close' }).click()
})
