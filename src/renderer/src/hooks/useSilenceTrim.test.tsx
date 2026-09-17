// The pass that measures where a file's sound starts and stops.
//
// These drive the hook the way the app does — mount it, then change the show's store —
// and hold it to what the feature needs: a cue playing with the trim on is measured
// before anything can fire it, a file the engine cannot read is remembered as refused
// rather than asked again on every keystroke, and nothing at all is read for a machine
// that may not apply the trim.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useSilenceTrim } from './useSilenceTrim'
import { audioEngine } from '../engine/audioEngineClient'
import type { AudioEngineSessionChange } from '../engine/audioEngineClient'
import { useStore } from '../store'
import { TEST_LICENSE } from '../../../test/license'
import type { AudioCue } from '../types/cue'
import type { AudioSilence } from '../../../shared/audio'

vi.mock('../engine/audioEngineClient')

const TRACK = '/show/track.wav'

function audio(patch: Partial<AudioCue> = {}): AudioCue {
  return {
    id: 'a1', number: '1', name: 'Track', type: 'audio',
    colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 20_000,
    advance: 'none', isArmed: true, notes: '',
    filePath: TRACK, startTime: 0, endTime: null, fadeInDuration: 0,
    volume: 1, pan: 0, outputs: null, loopCount: 0, playbackRate: 1, trim: 1,
    ...patch
  }
}

/** Two seconds of silence, six of sound, twelve of silence. */
function scanOf(filePath: string): AudioSilence {
  return { filePath, startMs: 2000, endMs: 8000, durationMs: 20_000, sampleRate: 48000, channels: 2, silent: false }
}

/** A refusal as the preload hands it on: the engine's code, on an Error. */
function refusal(code: string): Error {
  return Object.assign(new Error(`${code} refused the request`), { code })
}

function Harness() {
  useSilenceTrim()
  return null
}

describe('useSilenceTrim', () => {
  let container: HTMLDivElement
  let root: Root
  let sessions: Array<(change: AudioEngineSessionChange) => void>
  const scan = vi.fn()

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    sessions = []
    vi.mocked(audioEngine.onSessionChange).mockImplementation(cb => {
      sessions.push(cb)
      return () => {}
    })
    // The engine client's mock predates this verb: named here with the shape the real
    // call answers, so a test can ask what the pass sent.
    scan.mockReset()
    audioEngine.silence = scan as unknown as typeof audioEngine.silence
    useStore.setState({
      cues: [],
      selectedId: null,
      running: new Map(),
      isDirty: false,
      mediaLengths: {},
      missingMedia: [],
      silenceFailures: {},
      license: { state: 'active', license: TEST_LICENSE }
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllMocks()
  })

  async function settle(): Promise<void> {
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>()
      setTimeout(resolve, 0)
      await promise
    })
  }

  const regionOf = (id: string): unknown =>
    (useStore.getState().cues.find(c => c.id === id) as AudioCue | undefined)?.soundRegion

  it('measures a cue playing with the trim on, and writes the region onto the cue', async () => {
    scan.mockImplementation(async (filePath: string) => scanOf(filePath))
    useStore.setState({ cues: [audio({ trimSilence: true })] })

    act(() => { root.render(<Harness />) })
    await settle()

    expect(scan).toHaveBeenCalledWith(TRACK)
    expect(regionOf('a1')).toEqual({ startMs: 2000, endMs: 8000, durationMs: 20_000, silent: false })
  })

  it('asks about a file once, however often the show is edited', async () => {
    scan.mockImplementation(async (filePath: string) => scanOf(filePath))
    useStore.setState({ cues: [audio({ trimSilence: true })] })

    act(() => { root.render(<Harness />) })
    await settle()
    act(() => { useStore.getState().setWorkspaceName('Night 2') })
    await settle()

    expect(scan).toHaveBeenCalledTimes(1)
  })

  it('asks nothing about a cue that is not trimming, or one already measured', async () => {
    useStore.setState({
      cues: [
        audio({ id: 'a1', trimSilence: false }),
        audio({ id: 'a2', trimSilence: true, soundRegion: { startMs: 500, endMs: 9000, durationMs: 20_000, silent: false } }),
        audio({ id: 'a3', trimSilence: true, filePath: '' })
      ]
    })

    act(() => { root.render(<Harness />) })
    await settle()

    expect(scan).not.toHaveBeenCalled()
  })

  it('remembers a file the engine cannot read instead of asking it again', async () => {
    scan.mockRejectedValue(refusal('decode'))
    useStore.setState({ cues: [audio({ trimSilence: true })] })

    act(() => { root.render(<Harness />) })
    await settle()
    expect(useStore.getState().silenceFailures).toEqual({ a1: TRACK })

    act(() => { useStore.getState().setWorkspaceName('Night 2') })
    await settle()

    expect(scan).toHaveBeenCalledTimes(1)
    expect(regionOf('a1')).toBeUndefined()
  })

  it('leaves an engine that was not there as a question still to ask', async () => {
    scan.mockRejectedValue(refusal('engine'))
    useStore.setState({ cues: [audio({ trimSilence: true })] })

    act(() => { root.render(<Harness />) })
    await settle()
    expect(useStore.getState().silenceFailures).toEqual({})

    // A replaced engine is a new engine, and the file is a question it has not had.
    act(() => {
      for (const session of sessions) {
        session({ previousSessionId: 'test-session', sessionId: 'after-restart', showMs: 0 })
      }
    })
    await settle()

    expect(scan).toHaveBeenCalledTimes(2)
  })

  it('measures for a machine with no licence', async () => {
    // The trim is cue behaviour, so the scan runs wherever the trim is on.
    scan.mockImplementation(async (filePath: string) => scanOf(filePath))
    useStore.setState({ cues: [audio({ trimSilence: true })], license: { state: 'unlicensed' } })

    act(() => { root.render(<Harness />) })
    await settle()

    expect(scan).toHaveBeenCalledWith(TRACK)
    expect(regionOf('a1')).not.toBeNull()
  })

  it('writes nothing for a measurement that arrives after the window is gone', async () => {
    const pending = Promise.withResolvers<AudioSilence>()
    scan.mockImplementation(() => pending.promise)
    useStore.setState({ cues: [audio({ trimSilence: true })] })

    act(() => { root.render(<Harness />) })
    await settle()
    act(() => root.unmount())

    pending.resolve(scanOf(TRACK))
    await settle()

    expect(regionOf('a1')).toBeUndefined()
  })
})
