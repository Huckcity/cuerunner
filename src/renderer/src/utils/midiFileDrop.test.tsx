// MIDI files dropped on the cue list become MIDI File cues, in order, named for their files,
// with the length each file reads as — and a file that is neither audio nor MIDI is still
// refused out loud.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { CueList } from '../components/cue-list/CueList'
import { useStore } from '../store'
import { addMidiFileCuesFromFiles } from './midiFileDrop'
import type { SmfSummary } from '../../../shared/smf'

const summary = (durationMs: number): SmfSummary => ({
  format: 0,
  timing: { kind: 'metrical', ticksPerQuarter: 480 },
  durationMs,
  tracks: [],
  channels: [],
  initialBpm: 120,
  tempoChanges: 0,
  eventCount: 0
})

beforeEach(() => {
  act(() => useStore.getState().loadWorkspace([], 'Untitled', null))
  vi.mocked(window.cuerunner.midi.fileInspect).mockImplementation(async ({ filePath }) =>
    ({ ok: true, summary: summary(filePath.endsWith('a.mid') ? 3000 : 4500) }))
})

afterEach(() => vi.clearAllMocks())

describe('dropping MIDI files', () => {
  it('adds one MIDI File cue a file, in the order dropped, each with its file’s length', async () => {
    useStore.getState().addCue('wait')
    const wait = useStore.getState().selectedId!
    useStore.getState().addCue('wait')
    useStore.getState().select(wait)

    await act(async () => { addMidiFileCuesFromFiles(['/shows/a.mid', '/shows/b.midi'], wait) })

    const cues = useStore.getState().cues
    expect(cues.map(cue => [cue.type, cue.name])).toEqual([
      ['wait', 'Wait'], ['midiFile', 'a'], ['midiFile', 'b'], ['wait', 'Wait']
    ])
    expect(cues.filter(cue => cue.type === 'midiFile').map(cue => cue.duration)).toEqual([3000, 4500])
  })

  it('routes a drop on the list: MIDI files become cues, and only what is neither is refused', async () => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root: Root = createRoot(container)
    act(() => root.render(<CueList />))
    vi.mocked(window.cuerunner.getPathForFile).mockImplementation((file: File) => `/shows/${file.name}`)

    const drop = new Event('drop', { bubbles: true, cancelable: true })
    const files = [new File(['MThd'], 'click.mid'), new File(['?'], 'notes.txt')]
    Object.defineProperty(drop, 'dataTransfer', { value: { types: ['Files'], files } })
    await act(async () => { container.querySelector('.cue-list-container')!.dispatchEvent(drop) })

    expect(useStore.getState().cues.map(cue => [cue.type, cue.name])).toEqual([['midiFile', 'click']])
    expect(useStore.getState().notice).toBe('Not added — Cuerunner plays WAV, AIFF, FLAC, MP3, M4A and OGG audio, and MIDI files: notes.txt')
    act(() => root.unmount())
    container.remove()
  })
})
