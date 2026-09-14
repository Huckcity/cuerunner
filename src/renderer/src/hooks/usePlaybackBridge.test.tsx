// The window's half of the device contract: the operator's settings reach the engine,
// and a request the engine will not honour comes back with the engine's own words
// rather than a shrug. These tests drive the hook the way the app does — mount it, then
// change the settings in the store.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { usePlaybackBridge } from './usePlaybackBridge'
import { audioEngine } from '../engine/audioEngineClient'
import { useStore } from '../store'

vi.mock('../engine/audioEngineClient')

function Harness() {
  usePlaybackBridge()
  return null
}

describe('usePlaybackBridge — device settings', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    vi.mocked(audioEngine.configure).mockResolvedValue({} as never)
    useStore.setState({
      audioSettings: { outputDeviceId: 'default' },
      audioDeviceError: null
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllMocks()
  })

  async function settle(): Promise<void> {
    await act(async () => { await Promise.resolve() })
  }

  it('applies the operator\'s device settings, and applies them again when one changes', async () => {
    act(() => { root.render(<Harness />) })
    await settle()

    // The mount request is the workspace's settings; "default" is no device id at all.
    expect(audioEngine.configure).toHaveBeenLastCalledWith({
      deviceId: undefined,
      sampleRate: undefined,
      channels: undefined,
      exclusive: undefined,
      bufferFrames: undefined
    })

    await act(async () => {
      useStore.getState().updateAudioSettings({ exclusive: true, sampleRate: 48000 })
      await Promise.resolve()
    })

    expect(audioEngine.configure).toHaveBeenLastCalledWith(expect.objectContaining({
      exclusive: true,
      sampleRate: 48000
    }))
  })

  it('keeps the engine\'s reason when it refuses a request, not the IPC sentence around it', async () => {
    vi.mocked(audioEngine.configure).mockRejectedValue(new Error(
      "Error invoking remote method 'audio:configure': AudioEngineError: the device is held exclusively by another application"
    ))

    act(() => { root.render(<Harness />) })
    await settle()

    expect(useStore.getState().audioDeviceError)
      .toBe('the device is held exclusively by another application')
  })

  it('clears the refusal once a request is honoured', async () => {
    vi.mocked(audioEngine.configure).mockRejectedValue(new Error('exclusive was refused by the driver'))
    act(() => { root.render(<Harness />) })
    await settle()
    expect(useStore.getState().audioDeviceError).toBe('exclusive was refused by the driver')

    vi.mocked(audioEngine.configure).mockResolvedValue({} as never)
    await act(async () => {
      useStore.getState().updateAudioSettings({ exclusive: false })
      await Promise.resolve()
    })

    expect(useStore.getState().audioDeviceError).toBeNull()
  })
})
