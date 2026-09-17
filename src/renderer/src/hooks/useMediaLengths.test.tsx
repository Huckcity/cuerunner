// The pass that gives a loaded show its lengths. These drive the hook the way the app
// does — mount it, then change the show's store — and hold it to the three things R1 is:
// a file is asked about once, an answer is written onto the cue, and a file that cannot
// be read says so instead of reading as a zero.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useMediaLengths } from './useMediaLengths'
import { audioEngine } from '../engine/audioEngineClient'
import type { AudioEngineSessionChange } from '../engine/audioEngineClient'
import { useStore } from '../store'
import { createCue } from '../utils/cueDefaults'
import type { AudioCue } from '../../../shared/cue'
import type { AudioProbe } from '../../../shared/audio'

vi.mock('../engine/audioEngineClient')

function audio(id: string, patch: Partial<AudioCue> = {}): AudioCue {
  return {
    ...createCue('audio'),
    id,
    name: id,
    filePath: `/media/${id}.wav`,
    ...patch
  } as AudioCue
}

function probeOf(filePath: string, durationMs: number): AudioProbe {
  return {
    filePath,
    format: 'wav',
    durationMs,
    sampleRate: 48000,
    channels: 2,
    frames: Math.round((durationMs / 1000) * 48000),
    fileBytes: 0,
    decodedBytes: null,
    streaming: false,
    resident: false
  }
}

/** A refusal as the preload hands it on: the engine's code, on an Error. */
function refusal(code: string): Error {
  return Object.assign(new Error(`${code} refused the request`), { code })
}

function Harness() {
  useMediaLengths()
  return null
}

describe('useMediaLengths', () => {
  let container: HTMLDivElement
  let root: Root
  let sessions: Array<(change: AudioEngineSessionChange) => void>

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
    vi.mocked(audioEngine.probe).mockReset()
    useStore.setState({
      cues: [],
      selectedId: null,
      running: new Map(),
      isDirty: false,
      mediaLengths: {},
      missingMedia: []
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

  it('measures each file once and writes the length onto its cue', async () => {
    vi.mocked(audioEngine.probe).mockImplementation(async filePath =>
      probeOf(filePath, filePath.endsWith('a1.wav') ? 3000 : 1500))
    useStore.setState({ cues: [audio('a1'), audio('a2')] })

    act(() => { root.render(<Harness />) })
    await settle()

    expect(useStore.getState().cues.map(cue => cue.duration)).toEqual([3000, 1500])
    // One at a time, in cue order: the next file is only asked about when the last has
    // answered.
    expect(vi.mocked(audioEngine.probe).mock.calls.map(call => call[0]))
      .toEqual(['/media/a1.wav', '/media/a2.wav'])
    // Measuring is not an edit: a show that has just been opened is not dirty because
    // its files were read.
    expect(useStore.getState().isDirty).toBe(false)
  })

  it('marks a file the engine cannot read, and carries on to the next', async () => {
    vi.mocked(audioEngine.probe).mockImplementation(async filePath => {
      if (filePath.endsWith('a1.wav')) throw refusal('decode')
      return probeOf(filePath, 2000)
    })
    useStore.setState({ cues: [audio('a1'), audio('a2')] })

    act(() => { root.render(<Harness />) })
    await settle()

    expect(useStore.getState().cues[0].duration).toBe(0)
    expect(useStore.getState().mediaLengths).toEqual({
      a1: { path: '/media/a1.wav', state: 'missing' }
    })
    // A show with one unreadable file still gets every other length.
    expect(useStore.getState().cues[1].duration).toBe(2000)
  })

  it('leaves a cue measuring when the engine was not there, and asks again next session', async () => {
    vi.mocked(audioEngine.probe).mockRejectedValue(refusal('engine'))
    useStore.setState({ cues: [audio('a1')] })

    act(() => { root.render(<Harness />) })
    await settle()

    // Nothing was learned about the file: it is still being measured, not missing.
    expect(vi.mocked(audioEngine.probe)).toHaveBeenCalledTimes(1)
    expect(useStore.getState().mediaLengths).toEqual({})
    expect(useStore.getState().cues[0].duration).toBe(0)

    // The engine comes back — a restart, or one that was still starting when the
    // workspace loaded. That is a new session, and the file gets its answer.
    vi.mocked(audioEngine.probe).mockImplementation(async filePath => probeOf(filePath, 1200))
    await act(async () => {
      for (const session of sessions) {
        session({ previousSessionId: 'test-session', sessionId: 'after-restart', showMs: 0 })
      }
    })
    await settle()

    expect(useStore.getState().cues[0].duration).toBe(1200)
  })

  it('writes down a file that states no length, and does not ask it again', async () => {
    vi.mocked(audioEngine.probe).mockImplementation(async filePath => probeOf(filePath, 0))
    useStore.setState({ cues: [audio('a1')] })

    act(() => { root.render(<Harness />) })
    await settle()
    expect(useStore.getState().mediaLengths).toEqual({
      a1: { path: '/media/a1.wav', state: 'no-length' }
    })

    // Anything that wakes the pass finds nothing left to ask about this file.
    await act(async () => { useStore.getState().addCue('wait') })
    await settle()
    expect(vi.mocked(audioEngine.probe)).toHaveBeenCalledTimes(1)
  })

  it('measures a cue again once a relink has given it a file that is there', async () => {
    vi.mocked(audioEngine.probe).mockImplementation(async filePath => probeOf(filePath, 2500))
    useStore.setState({
      cues: [audio('a1')],
      missingMedia: [{ cueId: 'a1', path: 'media/a1.wav', originalPath: '/old-home/media/a1.wav' }]
    })

    act(() => { root.render(<Harness />) })
    await settle()
    // The workspace already knows this file is not on this machine; there is nothing to
    // ask the engine about it.
    expect(vi.mocked(audioEngine.probe)).not.toHaveBeenCalled()

    await act(async () => {
      // The order the relink flow uses: the path first, then the report.
      useStore.getState().applyRelinkedMedia({ a1: '/new-home/a1.wav' })
      useStore.getState().setMissingMedia([])
    })
    await settle()

    expect(vi.mocked(audioEngine.probe).mock.calls.map(call => call[0]))
      .toEqual(['/new-home/a1.wav'])
    expect(useStore.getState().cues[0].duration).toBe(2500)
  })

  it('writes nothing for an answer that arrives after the window is gone', async () => {
    let answer: () => void = () => {}
    vi.mocked(audioEngine.probe).mockImplementation(filePath => {
      const { promise, resolve } = Promise.withResolvers<AudioProbe>()
      answer = () => resolve(probeOf(filePath, 3000))
      return promise
    })
    useStore.setState({ cues: [audio('a1')] })

    act(() => { root.render(<Harness />) })
    await settle()

    act(() => root.unmount())
    await act(async () => {
      answer()
      const { promise, resolve } = Promise.withResolvers<void>()
      setTimeout(resolve, 0)
      await promise
    })

    expect(useStore.getState().cues[0].duration).toBe(0)
  })
})