import { afterEach, describe, expect, it } from 'vitest'
import { TimecodeReceiver, type ReceiverDeps } from './receiver'
import { MidiTimecodeTap } from './midiTap'
import { LtcClient, type LtcReadFrame } from './ltc'
import { encodeArtTimecode } from './artnet'
import { MtcClock, encodeFullFrame } from './mtc'
import {
  defaultTimecodeSettings,
  framesToTimecode,
  parseTimecodeFrames,
  type TimecodeSettings
} from '../../shared/timecode'

const receivers: TimecodeReceiver[] = []
afterEach(async () => {
  for (const receiver of receivers.splice(0)) await receiver.stop()
})

function harness(patch: Partial<ReceiverDeps> = {}) {
  let now = 10_000
  const tap = new MidiTimecodeTap()
  let packetHandler: ((packet: Buffer, at: number) => void) | null = null
  let midiHandler: ((bytes: number[], at: number) => void) | null = null
  const opened: string[] = []
  const deps: ReceiverDeps = {
    now: () => now,
    tap,
    listMidiInputs: () => ['Clock In'],
    openMidiInput: (port, onMessage) => {
      opened.push(port)
      midiHandler = onMessage
      return { close: () => {} }
    },
    ltc: null,
    bindUdp: async (_port, onPacket) => {
      packetHandler = onPacket
      return { close: () => {} }
    },
    ...patch
  }
  const receiver = new TimecodeReceiver(deps)
  receivers.push(receiver)
  return {
    receiver,
    tap,
    opened,
    advance: (ms: number) => { now += ms },
    now: () => now,
    packet: (buffer: Buffer) => packetHandler!(buffer, now),
    midi: (bytes: number[]) => midiHandler!(bytes, now)
  }
}

const settings = (patch: Partial<TimecodeSettings>): TimecodeSettings => ({ ...defaultTimecodeSettings(), ...patch })

describe('the receiver, over Art-Net', () => {
  it('locks on a running stream, and reports where the clock is between datagrams', async () => {
    const h = harness()
    expect(await h.receiver.start(settings({ source: 'artnet' }))).toMatchObject({ state: 'running' })
    const start = parseTimecodeFrames('10:00:00:00', '25')!
    for (let n = 0; n < 10; n++) {
      h.packet(encodeArtTimecode(framesToTimecode(start + n, '25'), '25'))
      h.advance(40)
    }
    const status = h.receiver.status()
    expect(status.state).toBe('locked')
    expect(status.rate).toBe('25')
    expect(status.frames).toBeCloseTo(start + 10, 6)
  })

  it('calls a console that repeats one frame a clock standing still', async () => {
    const h = harness()
    await h.receiver.start(settings({ source: 'artnet' }))
    const packet = encodeArtTimecode(framesToTimecode(500, '30'), '30')
    for (let n = 0; n < 4; n++) {
      h.packet(packet)
      h.advance(33)
    }
    expect(h.receiver.status()).toMatchObject({ state: 'stopped', frames: 500 })
  })

  it('says why when the port is taken', async () => {
    const h = harness({ bindUdp: () => Promise.reject(new Error('bind EADDRINUSE 0.0.0.0:6454')) })
    expect(await h.receiver.start(settings({ source: 'artnet' }))).toEqual({
      state: 'degraded',
      detail: 'could not listen on UDP 6454: bind EADDRINUSE 0.0.0.0:6454'
    })
  })
})

describe('the receiver, over MTC', () => {
  it('opens the port itself when the MIDI input service does not hold it', async () => {
    const h = harness()
    expect(await h.receiver.start(settings({ source: 'mtc', mtcPort: 'Clock In' }))).toEqual({ state: 'running', detail: 'MTC on "Clock In"' })
    expect(h.opened).toEqual(['Clock In'])
    h.midi(encodeFullFrame(framesToTimecode(1234, '25'), '25'))
    expect(h.receiver.status()).toMatchObject({ state: 'stopped', frames: 1234 })
  })

  it('listens through the MIDI input service when it already has the port open', async () => {
    const h = harness()
    const turnedOn: boolean[] = []
    h.tap.opened('Clock In', { setTimecode: on => turnedOn.push(on) })
    await h.receiver.start(settings({ source: 'mtc', mtcPort: 'Clock In' }))
    expect(h.opened).toEqual([])
    expect(turnedOn).toEqual([true])
    // The service hands the tap what arrives, and the tap keeps it from the show.
    const clock = new MtcClock('25', 90_000, h.now())
    let consumed = true
    for (let t = 0; t <= 400; t++) {
      for (const bytes of clock.due(h.now())) consumed = h.tap.offer('Clock In', bytes, h.now()) && consumed
      h.advance(1)
    }
    expect(consumed).toBe(true)
    expect(h.receiver.status().state).toBe('locked')
    await h.receiver.stop()
    expect(turnedOn).toEqual([true, false])
  })

  it('waits, saying so, for a port that is not there', async () => {
    const h = harness()
    expect(await h.receiver.start(settings({ source: 'mtc', mtcPort: 'Gone' }))).toEqual({
      state: 'degraded',
      detail: 'no MIDI input port named "Gone"'
    })
  })
})

describe('the receiver, over LTC', () => {
  it('reads the frames the engine heard, on this process’s clock, and works out the rate from them', async () => {
    let reads = 0
    const frames: LtcReadFrame[] = []
    const ltc = new LtcClient(async verb => {
      if (verb === 'ltcListen') return { description: 'Interface, channel 3' }
      if (verb === 'ltcRead') {
        reads++
        const out = frames.splice(0)
        return { listening: true, description: '', nowMs: 5000, frames: out }
      }
      return {}
    })
    const h = harness({ ltc, ltcPollMs: 5 })
    expect(await h.receiver.start(settings({ source: 'ltc', ltcChannel: 2 }))).toEqual({
      state: 'running',
      detail: 'LTC on Interface, channel 3'
    })
    // Two seconds of 30 fps frames, the last one heard just now on the engine's clock.
    for (let n = 0; n < 60; n++) {
      const tc = framesToTimecode(n, '30')
      frames.push({ ...tc, dropFrame: false, reverse: false, atMs: 5000 - (59 - n) * (1000 / 30), cellSamples: 20 })
    }
    await new Promise(resolve => setTimeout(resolve, 40))
    expect(reads).toBeGreaterThan(0)
    const status = h.receiver.status()
    expect(status.state).toBe('locked')
    expect(status.declaredRate).toBe('30')
    expect(status.frames).toBeCloseTo(60, 6)
  })
})
