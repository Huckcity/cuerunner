import { describe, expect, it } from 'vitest'
import { TimecodeGenerators, type GeneratorDeps } from './generator'
import { MtcDecoder, decodeFullFrame } from './mtc'
import { decodeArtTimecode } from './artnet'
import { TimecodeFollower } from './follower'
import { LtcClient } from './ltc'
import {
  framesToTimecode,
  idleReceiverStatus,
  parseTimecodeFrames,
  timecodeToFrames,
  type TimecodeGenerateRequest,
  type TimecodeReceiverStatus
} from '../../shared/timecode'

function harness(incoming: () => TimecodeReceiverStatus = () => idleReceiverStatus('none')) {
  let now = 1000
  const midi: Array<{ at: number; bytes: number[] }> = []
  const artnet: Array<{ at: number; packet: Buffer }> = []
  const ltcCalls: Array<{ verb: string; params: Record<string, unknown> }> = []
  const ended: string[] = []
  const deps: GeneratorDeps = {
    now: () => now,
    sendMidi: (_port, messages) => {
      for (const bytes of messages) midi.push({ at: now, bytes })
      return { ok: true }
    },
    ltc: new LtcClient(async (verb, params = {}) => {
      ltcCalls.push({ verb, params })
      return { ok: true }
    }),
    sendArtnet: (_host, packet) => artnet.push({ at: now, packet }),
    incoming,
    ended: cueId => ended.push(cueId),
    tickMs: 0
  }
  const generators = new TimecodeGenerators(deps)
  const advance = (ms: number) => {
    for (let i = 0; i < ms; i++) {
      now++
      generators.tick(now)
    }
  }
  return { generators, midi, artnet, ltcCalls, ended, advance, now: () => now }
}

const request = (patch: Partial<TimecodeGenerateRequest> = {}): TimecodeGenerateRequest => ({
  cueId: 'tc1',
  rate: '25',
  startFrames: parseTimecodeFrames('01:00:00:00', '25')!,
  endFrames: null,
  jam: false,
  mtcPort: 'loop',
  ltcChannel: null,
  ltcLevelDb: -12,
  artnetHost: null,
  ...patch
})

/** What a receiver makes of the MTC the generator sent. */
function heard(midi: Array<{ at: number; bytes: number[] }>) {
  const follower = new TimecodeFollower('mtc', { rate: 'auto', holdMs: 1000, offsetFrames: 0 })
  const decoder = new MtcDecoder({
    running: (frames, rate, at, direction) => follower.running(frames, rate, at, direction),
    located: (frames, rate, at) => follower.located(frames, rate, at),
    alive: at => follower.alive(at)
  })
  for (const { at, bytes } of midi) decoder.message(bytes, at)
  return follower
}

describe('a timecode cue’s clock', () => {
  it('refuses a cue with nowhere to send it', async () => {
    const { generators } = harness()
    const result = await generators.start(request({ mtcPort: null }))
    expect(result.ok).toBe(false)
  })

  it('locates with a full frame and then runs MTC a receiver follows', async () => {
    const { generators, midi, advance, now } = harness()
    expect((await generators.start(request())).ok).toBe(true)
    const first = decodeFullFrame(midi[0].bytes)!
    expect(timecodeToFrames(first.tc, first.rate)).toBe(90_000)
    advance(2000)
    const follower = heard(midi)
    expect(follower.state(now())).toBe('locked')
    expect(Math.abs(follower.status(now()).frames! - (90_000 + 50))).toBeLessThan(0.5)
    expect(generators.status()[0].frames).toBeCloseTo(90_050, 6)
  })

  it('pauses on a full frame, sends nothing while paused, and resumes from there', async () => {
    const { generators, midi, advance, now } = harness()
    await generators.start(request())
    advance(1000)
    await generators.control('tc1', { action: 'pause' })
    const paused = decodeFullFrame(midi[midi.length - 1].bytes)!
    expect(timecodeToFrames(paused.tc, paused.rate)).toBe(90_025)
    const sent = midi.length
    advance(1000)
    expect(midi.length).toBe(sent)
    expect(generators.status()[0]).toMatchObject({ running: false, frames: 90_025 })
    await generators.control('tc1', { action: 'resume' })
    advance(1000)
    expect(generators.status()[0].frames).toBeCloseTo(90_050, 6)
    expect(Math.abs(heard(midi.slice(sent)).status(now()).frames! - 90_050)).toBeLessThan(0.5)
  })

  it('locates mid-run', async () => {
    const { generators, midi, advance } = harness()
    await generators.start(request())
    advance(500)
    await generators.control('tc1', { action: 'locate', frames: 200_000 })
    const located = midi.filter(m => m.bytes[0] === 0xf0).pop()!
    const tc = decodeFullFrame(located.bytes)!
    expect(timecodeToFrames(tc.tc, tc.rate)).toBe(200_000)
    advance(400)
    expect(generators.status()[0].frames).toBeCloseTo(200_010, 6)
  })

  it('stops itself at its end, and says so', async () => {
    const { generators, ended, advance } = harness()
    await generators.start(request({ endFrames: 90_000 + 25 }))
    advance(1100)
    await Promise.resolve()
    await Promise.resolve()
    expect(generators.status()).toEqual([])
    expect(ended).toEqual(['tc1'])
  })

  it('sends one ArtTimeCode a frame', async () => {
    const { generators, artnet, advance } = harness()
    await generators.start(request({ mtcPort: null, artnetHost: '10.0.0.255', rate: '30', startFrames: 0 }))
    advance(1000)
    expect(artnet.length).toBeGreaterThanOrEqual(30)
    expect(artnet.length).toBeLessThanOrEqual(31)
    const labels = artnet.map(({ packet }) => decodeArtTimecode(packet)!)
    expect(labels[0].tc).toEqual(framesToTimecode(0, '30'))
    expect(labels[30].tc).toEqual({ hours: 0, minutes: 0, seconds: 1, frames: 0 })
  })

  it('drives the engine’s LTC voice through the same moves', async () => {
    const { generators, ltcCalls, advance } = harness()
    await generators.start(request({ mtcPort: null, ltcChannel: 3, ltcLevelDb: -18 }))
    advance(400)
    await generators.control('tc1', { action: 'pause' })
    await generators.control('tc1', { action: 'resume' })
    await generators.control('tc1', { action: 'locate', frames: 1234 })
    await generators.control('tc1', { action: 'stop' })
    expect(ltcCalls.map(c => [c.verb, c.params.action ?? null])).toEqual([
      ['ltcStart', null], ['ltcControl', 'pause'], ['ltcControl', 'locate'], ['ltcControl', 'resume'],
      ['ltcControl', 'locate'], ['ltcControl', 'stop']
    ])
    expect(ltcCalls[0].params).toMatchObject({ voiceId: 'tc1', channel: 3, rate: '25', frame: 90_000, levelDb: -18 })
    expect(ltcCalls[2].params.frame).toBe(90_010)
  })
})

describe('jam sync', () => {
  it('starts from the incoming clock, follows a jump, and carries on alone when it drops', async () => {
    let incoming: TimecodeReceiverStatus = {
      ...idleReceiverStatus('mtc'), state: 'locked', frames: 50_000, at: 1000, rate: '25', direction: 1
    }
    const { generators, advance, now } = harness(() => incoming)
    const started = await generators.start(request({ jam: true, startFrames: 0 }))
    expect(started).toEqual({ ok: true, startFrames: 50_000 })
    advance(400)
    expect(generators.status()[0].frames).toBeCloseTo(50_010, 6)
    // The source jumps: the generator goes with it.
    incoming = { ...incoming, frames: 70_000, at: now() }
    advance(1)
    expect(Math.abs(generators.status()[0].frames - 70_000)).toBeLessThan(0.1)
    // The source goes: the generator does not.
    incoming = { ...incoming, state: 'lost' }
    advance(1000)
    expect(Math.abs(generators.status()[0].frames - 70_025)).toBeLessThan(0.1)
  })

  it('refuses to jam to nothing', async () => {
    const { generators } = harness()
    expect(await generators.start(request({ jam: true }))).toMatchObject({ ok: false })
  })
})
