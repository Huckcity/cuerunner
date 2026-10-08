import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TimecodeHub } from './hub'
import { MidiTimecodeTap } from './midiTap'
import { encodeArtTimecode } from './artnet'
import { artnetAddress } from './main'
import { ShowBus } from '../bus/ShowBus'
import { defaultTimecodeShowSettings, framesToTimecode, type TimecodeStatus } from '../../shared/timecode'

const dirs: string[] = []
const hubs: TimecodeHub[] = []
afterEach(() => {
  for (const hub of hubs.splice(0)) hub.dispose()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  vi.useRealTimers()
})

function harness(stored?: object) {
  const dir = mkdtempSync(join(tmpdir(), 'cuerunner-feat-timecode-hub-'))
  dirs.push(dir)
  const filePath = join(dir, 'timecode.json')
  if (stored) writeFileSync(filePath, JSON.stringify(stored))
  let now = 1_000_000
  let onPacket: ((packet: Buffer, at: number) => void) | null = null
  const pushed: TimecodeStatus[] = []
  const restarts = vi.fn(async () => {})
  const hub = new TimecodeHub({
    filePath,
    receiver: {
      now: () => now,
      tap: new MidiTimecodeTap(),
      listMidiInputs: () => [],
      openMidiInput: () => { throw new Error('none') },
      ltc: null,
      bindUdp: async (_port, handler) => {
        onPacket = handler
        return { close: () => {} }
      }
    },
    generators: { now: () => now, sendMidi: () => ({ ok: true }), ltc: null, sendArtnet: () => {}, tickMs: 0 },
    broadcast: status => pushed.push(status),
    restartReceiver: restarts
  })
  hubs.push(hub)
  const bus = new ShowBus({ flushMs: 0 })
  const states: Array<[string, string]> = []
  const context = { bus, setState: (state: string, detail: string) => states.push([state, detail]) }
  return {
    hub, filePath, pushed, restarts, bus, states,
    context: context as unknown as Parameters<TimecodeHub['startReceiving']>[0],
    advance: (ms: number) => { now += ms },
    packet: (frames: number) => onPacket!(encodeArtTimecode(framesToTimecode(frames, '25'), '25'), now)
  }
}

describe('the timecode hub', () => {
  it('starts on the defaults with no file, and keeps what it is given beside the licence', async () => {
    const h = harness()
    expect(h.hub.current().source).toBe('none')
    const updated = await h.hub.update({ source: 'artnet', artnetPort: 47001 })
    expect(updated).toMatchObject({ source: 'artnet', artnetPort: 47001 })
    // Only the machine's own settings: how a show follows the clock is the show's file's.
    expect(JSON.parse(readFileSync(h.filePath, 'utf8'))).toEqual({
      source: 'artnet', mtcPort: '', ltcDevice: '', ltcChannel: 0, artnetPort: 47001
    })
    expect(h.restarts).toHaveBeenCalledTimes(1)
    expect(h.pushed.length).toBeGreaterThan(0)
  })

  it('reads a file a previous run wrote, holding each field to what it may be', () => {
    const h = harness({ source: 'mtc', mtcPort: 'Clock', ltcChannel: -5 })
    expect(h.hub.current()).toMatchObject({ source: 'mtc', mtcPort: 'Clock', ltcChannel: 0 })
  })

  it('raises lock and loss on the show’s alarm strip, and says so in the service status', async () => {
    const h = harness({ source: 'artnet' })
    h.hub.applyShow({ ...defaultTimecodeShowSettings(), holdMs: 200 })
    await h.hub.startReceiving(h.context)
    for (let n = 0; n < 6; n++) {
      h.packet(1000 + n)
      h.advance(40)
    }
    h.hub.status()
    // The push is what notices a transition; it runs on its own timer in the app.
    await h.hub.update({})
    h.advance(1000)
    await h.hub.update({})
    const alerts = h.bus.snapshot().alerts.map(alert => `${alert.level}: ${alert.message}`)
    expect(alerts[0]).toMatch(/^info: Timecode locked at 00:00:40:0\d \(ArtTimeCode on UDP 6454\)$/)
    expect(alerts[1]).toMatch(/^warning: Timecode lost at 00:00:40:\d\d \(ArtTimeCode on UDP 6454\)$/)
    expect(h.states.map(([state]) => state)).toEqual(['running', 'running', 'degraded'])
  })
})

describe('the show’s own timecode', () => {
  it('is applied to the stream as it runs, without reopening anything', async () => {
    const h = harness({ source: 'artnet' })
    await h.hub.startReceiving(h.context)
    h.packet(1000)
    expect(h.hub.status().receiver.frames).toBe(1000)
    const applied = h.hub.applyShow({ ...defaultTimecodeShowSettings(), offsetFrames: 250, rate: '25', chase: true })
    expect(applied).toMatchObject({ offsetFrames: 250, rate: '25', chase: true })
    expect(h.hub.status().receiver.frames).toBe(1250)
    expect(h.restarts).not.toHaveBeenCalled()
  })
})

describe('an Art-Net address', () => {
  it('is Art-Net’s own port unless it names another', () => {
    expect(artnetAddress('2.255.255.255')).toEqual({ host: '2.255.255.255', port: 6454 })
    expect(artnetAddress('127.0.0.1:47001')).toEqual({ host: '127.0.0.1', port: 47001 })
    expect(artnetAddress(' 10.0.0.9 ')).toEqual({ host: '10.0.0.9', port: 6454 })
  })
})
