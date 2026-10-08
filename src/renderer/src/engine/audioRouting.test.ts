// The show's patches in the engine, on the devices they name: each patch goes out with its
// device, a fader moved goes out alone, the engine's word about a device that would not open
// is kept for the window, and a device the show no longer names is let go — while a show on
// one device asks the engine nothing about devices at all.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { audioEngine } from './audioEngineClient'
import { patchDeviceReasons, resetAudioRoutingSync, syncAudioRouting } from './audioRouting'
import type { OutputPatch } from '../../../shared/audioRouting'
import type { AudioOutputStatus } from '../../../shared/audio'

vi.mock('./audioEngineClient')

const engine = vi.mocked(audioEngine)

const patch = (id: string, deviceId: string, channels: number[] = [0, 1], gainDb = 0): OutputPatch =>
  ({ id, name: id, deviceId, channels, gainDb, muted: false })

const status = (device: string): AudioOutputStatus => ({
  slot: 0, device, name: device, channels: 2, sampleRate: 48000, running: true, failed: false, synthetic: true,
  error: null, latencyMs: 18, targetMs: 23, deviceLatencyMs: 0, driftPpm: 0, periodFrames: 512, underruns: 0,
  overruns: 0, resyncs: 0, playedFrames: 0, startedAtMs: 0
})

beforeEach(() => {
  resetAudioRoutingSync()
})
afterEach(() => {
  vi.clearAllMocks()
})

describe('patches on several devices, in the engine', () => {
  it('sends each patch with the device it names, and the show\'s own as none', async () => {
    await syncAudioRouting({
      outputDeviceId: 'default',
      outputPatches: [patch('mains', ''), patch('fold', 'test:out-b', [0])]
    })
    expect(engine.patch).toHaveBeenCalledWith(0, [0, 1], 1, '')
    expect(engine.patch).toHaveBeenCalledWith(1, [0], 1, 'test:out-b')
  })

  it('sends a patch again when it is moved to another device, and only that patch', async () => {
    const settings = { outputDeviceId: 'default', outputPatches: [patch('mains', ''), patch('fold', 'test:out-a')] }
    await syncAudioRouting(settings)
    engine.patch.mockClear()
    await syncAudioRouting({ ...settings, outputPatches: [patch('mains', ''), patch('fold', 'test:out-b')] })
    expect(engine.patch).toHaveBeenCalledTimes(1)
    expect(engine.patch).toHaveBeenCalledWith(1, [0, 1], 1, 'test:out-b')
  })

  it('keeps what the engine said about a device it could not open, and forgets it once the device opens', async () => {
    engine.patch.mockResolvedValueOnce({
      ok: true, at: 0, applied: true, device: null, fallback: true, reason: 'usb is not connected to this machine'
    })
    const settings = { outputDeviceId: 'default', outputPatches: [patch('fold', 'usb')] }
    await syncAudioRouting(settings)
    expect(patchDeviceReasons().get('usb')).toBe('usb is not connected to this machine')
    // Plugged in, and sent again: the patch is on its device, and the reason is gone.
    await syncAudioRouting(settings, true)
    expect(patchDeviceReasons().has('usb')).toBe(false)
  })

  it('lets go of a device no patch names any more', async () => {
    await syncAudioRouting({ outputDeviceId: 'default', outputPatches: [patch('fold', 'test:out-a'), patch('iem', 'test:out-b')] })
    engine.outputStatus.mockResolvedValueOnce([status('test:out-a'), status('test:out-b')])
    await syncAudioRouting({ outputDeviceId: 'default', outputPatches: [patch('fold', 'test:out-a')] })
    expect(engine.outputClose).toHaveBeenCalledTimes(1)
    expect(engine.outputClose).toHaveBeenCalledWith('test:out-b')
  })

  it('asks a show on one device nothing about devices', async () => {
    await syncAudioRouting({ outputDeviceId: 'default', outputPatches: [patch('mains', ''), patch('fold', '', [2, 3])] })
    await syncAudioRouting({ outputDeviceId: 'default', outputPatches: [patch('mains', '', [0, 1], -6), patch('fold', '', [2, 3])] })
    expect(engine.outputStatus).not.toHaveBeenCalled()
    expect(engine.outputClose).not.toHaveBeenCalled()
  })
})
