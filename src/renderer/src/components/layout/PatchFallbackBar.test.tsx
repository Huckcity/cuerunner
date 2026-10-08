// A show opened on a machine without one of its devices says which patches fell back, where
// to and why — across the top of the window, and once in the log — and says nothing at all
// when every device it names is playing.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { PatchFallbackBar } from './PatchFallbackBar'
import { useStore } from '../../store'
import { resetAudioRoutingSync } from '../../engine/audioRouting'
import type { AudioOutputStatus } from '../../../../shared/audio'
import type { OutputPatch } from '../../../../shared/audioRouting'

const patch = (id: string, name: string, deviceId: string, channels: number[]): OutputPatch =>
  ({ id, name, deviceId, channels, gainDb: 0, muted: false })

const playing = (device: string): AudioOutputStatus => ({
  slot: 0, device, name: device, channels: 2, sampleRate: 48000, running: true, failed: false, synthetic: true,
  error: null, latencyMs: 18, targetMs: 23, deviceLatencyMs: 0, driftPpm: 0, periodFrames: 512, underruns: 0,
  overruns: 0, resyncs: 0, playedFrames: 0, startedAtMs: 0
})

describe('PatchFallbackBar', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    vi.useFakeTimers()
    resetAudioRoutingSync()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    useStore.setState({ log: [] })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.mocked(window.cuerunner.audio.outputStatus).mockReset()
    vi.useRealTimers()
  })

  async function render(patches: OutputPatch[]): Promise<void> {
    useStore.setState({ audioSettings: { outputDeviceId: 'default', outputPatches: patches } })
    await act(async () => { root.render(<PatchFallbackBar />) })
    await act(async () => { await vi.advanceTimersByTimeAsync(2100) })
  }

  it('says nothing when every device the show names is playing', async () => {
    vi.mocked(window.cuerunner.audio.outputStatus).mockResolvedValue([playing('test:out-b')])
    await render([patch('fold', 'Foldback', 'test:out-b', [0, 1])])
    expect(container.querySelector('.patch-fallback-bar')).toBeNull()
  })

  it('says which patches fell back, where to and why, and writes each to the log once', async () => {
    vi.mocked(window.cuerunner.audio.outputStatus).mockResolvedValue([])
    await render([
      patch('mains', 'Mains', '', [0, 1]),
      patch('fold', 'Foldback', 'usb-desk', [2, 3]),
      patch('iem', 'IEM', 'dante-rack', [4, 5])
    ])
    const bar = container.querySelector('.patch-fallback-bar')!
    expect(bar.getAttribute('data-count')).toBe('2')
    expect(bar.textContent).toContain('2 output patches fell back to')
    const items = [...bar.querySelectorAll('li')].map(item => item.textContent)
    expect(items).toHaveLength(2)
    expect(items[0]).toMatch(/^Foldback plays on outputs 3–4 of .+: usb-desk is not connected to this machine$/)
    expect(items[1]).toMatch(/^IEM plays on outputs 5–6 of .+: dante-rack is not connected to this machine$/)
    // Polled again: the same two, still once each in the log.
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    const lines = useStore.getState().log.filter(entry => entry.message.startsWith('Output patch fell back'))
    expect(lines.map(entry => entry.message)).toEqual([
      `Output patch fell back — ${items[0]}`,
      `Output patch fell back — ${items[1]}`
    ])
  })

  it('goes when dismissed, until the list changes', async () => {
    vi.mocked(window.cuerunner.audio.outputStatus).mockResolvedValue([])
    await render([patch('fold', 'Foldback', 'usb-desk', [2, 3])])
    await act(async () => { container.querySelector<HTMLButtonElement>('.patch-fallback-dismiss')!.click() })
    expect(container.querySelector('.patch-fallback-bar')).toBeNull()
    useStore.setState({ audioSettings: { outputDeviceId: 'default', outputPatches: [patch('fold', 'Foldback', 'usb-desk', [0, 1])] } })
    await act(async () => { await vi.advanceTimersByTimeAsync(2100) })
    expect(container.querySelector('.patch-fallback-bar')!.textContent).toContain('Foldback plays on outputs 1–2')
  })
})
