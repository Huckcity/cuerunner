// The transport says when the sound is not where the operator thinks it is: no engine at
// all, or an engine that refused the device the show asks for and stayed on the one it had.
// Both used to be visible only inside Settings → Audio.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { AudioStatusBadge, ENGINE_SILENCE_GRACE_MS } from './AudioStatusBadge'
import { audioEngine } from '../../engine/audioEngineClient'
import type { AudioEngineInfo } from '../../engine/audioEngineClient'
import { useStore } from '../../store'

vi.mock('../../engine/audioEngineClient')

const engine = vi.mocked(audioEngine)

/** The engine's reading of itself, on the backend given. */
async function reading(backend: string): Promise<AudioEngineInfo> {
  return { ...(await engine.info.getMockImplementation()!()), backend } as AudioEngineInfo
}

describe('AudioStatusBadge', () => {
  let container: HTMLDivElement
  let root: Root
  let healthy: AudioEngineInfo

  beforeEach(async () => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    healthy = await reading('wasapi')
    vi.useFakeTimers()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    useStore.setState({ audioDeviceError: null, settingsTab: null })
    engine.info.mockResolvedValue(healthy)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  const badge = (): HTMLButtonElement => container.querySelector<HTMLButtonElement>('.audio-status')!
  const mount = async (): Promise<void> => {
    await act(async () => { root.render(<AudioStatusBadge />) })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  }

  it('says nothing while the engine answers and has what the show asked for', async () => {
    await mount()
    expect(badge().dataset.state).toBe('ok')
    expect(badge().textContent).toBe('')
  })

  it('says the output device was refused, in the engine’s own words, and opens the panel that fixes it', async () => {
    useStore.setState({ audioDeviceError: "requested audio device 'Dante Virtual Soundcard' was not found" })
    await mount()

    expect(badge().dataset.state).toBe('device')
    expect(badge().textContent).toBe('Output device refused')
    expect(badge().title).toContain("requested audio device 'Dante Virtual Soundcard' was not found")

    act(() => badge().click())
    expect(useStore.getState().settingsTab).toBe('audio')
  })

  it('does not report a backend that has no device to refuse with', async () => {
    // The silent engine a test or a dev run uses refuses every device request by
    // definition: that is not a fault anybody can act on.
    engine.info.mockResolvedValue({ ...healthy, backend: 'silent' })
    useStore.setState({ audioDeviceError: 'device configuration is unavailable with the silent backend' })
    await mount()
    expect(badge().dataset.state).toBe('ok')
  })

  it('says the engine is not answering once it has stayed silent, and not for one refused reading', async () => {
    engine.info.mockRejectedValue(new Error('audio engine is not running'))
    await mount()
    // An engine still starting as the window opens refuses the first reading.
    expect(badge().dataset.state).toBe('ok')

    await act(async () => { await vi.advanceTimersByTimeAsync(ENGINE_SILENCE_GRACE_MS) })
    expect(badge().dataset.state).toBe('engine')
    expect(badge().textContent).toBe('Audio engine not answering')

    // And it goes when the engine is back.
    engine.info.mockResolvedValue(healthy)
    await act(async () => { await vi.advanceTimersByTimeAsync(4000) })
    expect(badge().dataset.state).toBe('ok')
  })

  it('stays quiet when the engine answers before the grace is up', async () => {
    engine.info.mockRejectedValueOnce(new Error('audio engine is not running'))
    await mount()
    // The next poll, four seconds on, is answered.
    await act(async () => { await vi.advanceTimersByTimeAsync(ENGINE_SILENCE_GRACE_MS + 1000) })
    expect(badge().dataset.state).toBe('ok')
  })
})
