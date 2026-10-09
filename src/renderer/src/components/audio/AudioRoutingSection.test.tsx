// Settings → Audio with patches on several output devices. A patch's device is chosen from
// every output device the engine offers; each device the show plays on has a line saying how
// it is — playing, its rate, its clock against the show's device and how far behind it it
// sounds, or lost and why, with its reconnect beside it; and a patch whose device is not
// playing says where it plays instead. The line that said a patch "plays on the same output
// numbers" of the device in use is gone: the engine plays the device.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { AudioRoutingSection, formatDriftPpm, outputDeviceLine } from './AudioRoutingSection'
import { useStore } from '../../store'
import { resetAudioRoutingSync } from '../../engine/audioRouting'
import type { AudioOutputStatus } from '../../../../shared/audio'
import type { OutputPatch } from '../../../../shared/audioRouting'

const status = (overrides: Partial<AudioOutputStatus>): AudioOutputStatus => ({
  slot: 0, device: 'test:out-b', name: 'Test output B', channels: 2, sampleRate: 48000, running: true, failed: false,
  synthetic: true, error: null, latencyMs: 18.4, targetMs: 23.8, deviceLatencyMs: 0, driftPpm: 12.34, periodFrames: 512,
  underruns: 0, overruns: 0, resyncs: 0, playedFrames: 48000, startedAtMs: 0, ...overrides
})

const patch = (id: string, deviceId: string, channels: number[]): OutputPatch =>
  ({ id, name: id === 'fold' ? 'Foldback' : 'Mains', deviceId, channels, gainDb: 0, muted: false })

describe('the output devices in Settings → Audio', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    vi.useFakeTimers()
    resetAudioRoutingSync()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    vi.mocked(window.cuerunner.audio.outputs).mockResolvedValue([
      { id: 'test:out-a', name: 'Test output A', channels: 2, sampleRate: 0, isDefault: false, synthetic: true },
      { id: 'test:out-b', name: 'Test output B', channels: 2, sampleRate: 0, isDefault: false, synthetic: true }
    ])
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.mocked(window.cuerunner.audio.outputs).mockReset()
    vi.mocked(window.cuerunner.audio.outputStatus).mockReset()
    vi.mocked(window.cuerunner.audio.outputOpen).mockReset()
    vi.useRealTimers()
  })

  async function render(patches: OutputPatch[]): Promise<void> {
    useStore.setState({ audioSettings: { outputDeviceId: 'default', outputPatches: patches } })
    await act(async () => { root.render(<AudioRoutingSection />) })
    // Two readings of the devices: a fallback is only said on the second.
    await act(async () => { await vi.advanceTimersByTimeAsync(2100) })
  }

  it('offers every output device for a patch, and no longer says it plays on the same outputs of the one in use', async () => {
    vi.mocked(window.cuerunner.audio.outputStatus).mockResolvedValue([status({})])
    await render([patch('mains', '', [0, 1]), patch('fold', 'test:out-b', [0, 1])])
    const select = container.querySelector<HTMLSelectElement>('.patch-entry[data-patch="fold"] select.patch-device')!
    expect([...select.options].map(option => option.textContent)).toEqual(['The show\'s device', 'Test output A', 'Test output B'])
    expect(select.value).toBe('test:out-b')
    expect(container.textContent).not.toMatch(/same output numbers|of the one in use/)
    expect(container.querySelector('.patch-fallback')).toBeNull()
  })

  it('shows each device the show plays on: playing, its rate, its clock and how far behind it sounds', async () => {
    vi.mocked(window.cuerunner.audio.outputStatus).mockResolvedValue([status({ deviceLatencyMs: 10.7 })])
    await render([patch('fold', 'test:out-b', [0, 1])])
    const row = container.querySelector('.output-device[data-device="test:out-b"]')!
    expect(row.getAttribute('data-state')).toBe('playing')
    expect(row.querySelector('label')!.textContent).toBe('Test output B')
    expect(row.querySelector('.output-device-state')!.textContent)
      .toBe('Playing · 48,000 Hz · 2 ch · clock +12.3 ppm · 29.1 ms behind')
    expect(row.querySelector('.output-reconnect')).toBeNull()
    expect(container.querySelector('.output-device[data-device="main"]')).not.toBeNull()
  })

  it('shows a lost device and why, says where its patch plays instead, and reconnects it', async () => {
    vi.mocked(window.cuerunner.audio.outputStatus).mockResolvedValue([
      status({ running: false, failed: true, error: 'the device stopped unexpectedly' })
    ])
    vi.mocked(window.cuerunner.audio.outputOpen).mockResolvedValue(status({}))
    await render([patch('fold', 'test:out-b', [2, 3])])
    const row = container.querySelector('.output-device[data-device="test:out-b"]')!
    expect(row.getAttribute('data-state')).toBe('lost')
    expect(row.querySelector('.output-device-state')!.textContent).toBe('Lost — the device stopped unexpectedly')
    expect(container.querySelector('.patch-entry[data-patch="fold"] .patch-fallback')!.textContent)
      .toMatch(/^Plays on outputs 3–4 of .+: Test output B was lost \(the device stopped unexpectedly\)\.$/)
    await act(async () => { row.querySelector<HTMLButtonElement>('.output-reconnect')!.click() })
    expect(window.cuerunner.audio.outputOpen).toHaveBeenCalledWith({ device: 'test:out-b' })
  })

  it('says where a patch plays when this machine does not have its device', async () => {
    vi.mocked(window.cuerunner.audio.outputStatus).mockResolvedValue([])
    await render([patch('fold', 'usb-on-the-other-machine', [2, 3])])
    const select = container.querySelector<HTMLSelectElement>('.patch-entry[data-patch="fold"] select.patch-device')!
    expect(select.value).toBe('usb-on-the-other-machine')
    expect(select.selectedOptions[0].textContent).toBe('usb-on-the-other-machine (not connected)')
    expect(container.querySelector('.patch-fallback')!.textContent)
      .toMatch(/^Plays on outputs 3–4 of .+: usb-on-the-other-machine is not connected to this machine\.$/)
  })
})

describe('a device\'s line', () => {
  it('writes a clock error signed, to a tenth of a part per million', () => {
    expect(formatDriftPpm(299.96)).toBe('+300.0 ppm')
    expect(formatDriftPpm(-12.34)).toBe('−12.3 ppm')
    expect(formatDriftPpm(0.01)).toBe('±0.0 ppm')
  })

  it('says a closed device is closed', () => {
    expect(outputDeviceLine(status({ running: false }))).toBe('Closed')
  })
})
