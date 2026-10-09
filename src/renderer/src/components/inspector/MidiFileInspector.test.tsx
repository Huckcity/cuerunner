// The MIDI File cue's inspector: what the file is read back as, and what the operator's
// choices write onto the cue.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MidiFileInspector } from './MidiFileInspector'
import { useStore } from '../../store'
import { createCue } from '../../utils/cueDefaults'
import type { MidiFileCue } from '../../../../shared/cue'
import type { SmfSummary } from '../../../../shared/smf'
import { cueEngine } from '../../engine/CueEngine'

const SUMMARY: SmfSummary = {
  format: 1,
  timing: { kind: 'metrical', ticksPerQuarter: 480 },
  durationMs: 8000,
  tracks: [
    { name: 'Conductor', channelEvents: 0, notes: 0, sysex: 0, meta: 3, channels: [], endMs: 8000 },
    { name: 'Keys', channelEvents: 40, notes: 18, sysex: 1, meta: 2, channels: [1, 2], endMs: 8000 },
    { name: '', channelEvents: 12, notes: 12, sysex: 0, meta: 1, channels: [10], endMs: 7000 }
  ],
  channels: [1, 2, 10],
  initialBpm: 120,
  tempoChanges: 2,
  eventCount: 53
}

describe('MidiFileInspector', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    vi.mocked(window.cuerunner.midi.fileInspect).mockResolvedValue({ ok: true, summary: SUMMARY })
    vi.mocked(window.cuerunner.midi.listPorts).mockResolvedValue(['cuerunner-feat-midi-file-cue'])
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllMocks()
  })

  async function show(tab: string, over: Partial<MidiFileCue> = {}): Promise<MidiFileCue> {
    const cue = { ...createCue('midiFile'), id: 'f1', filePath: '/shows/act1.mid', ...over } as MidiFileCue
    useStore.setState({ cues: [cue] })
    await act(async () => { root.render(<MidiFileInspector cue={cue} tab={tab} />) })
    return cue
  }

  const stored = (): MidiFileCue => useStore.getState().cues[0] as MidiFileCue

  it('reads the file back: its format, tracks, tempo and length, and each track by name', async () => {
    await show('MIDI File')
    expect(container.querySelector('.midi-file-summary')?.textContent)
      .toBe('Format 1 · 3 tracks · 120 BPM (2 tempo changes) · 8.0s')
    const tracks = [...container.querySelectorAll('.midi-file-track')].map(row => [
      row.querySelector('.midi-file-track-name')?.textContent,
      row.querySelector('.midi-file-track-counts')?.textContent,
      row.querySelector('.midi-file-track-channels')?.textContent
    ])
    expect(tracks).toEqual([
      ['Conductor', '0 notes · 0 events', 'no channels'],
      ['Keys', '18 notes · 40 events · 1 SysEx', 'ch 1, 2'],
      ['Track 3', '12 notes · 12 events', 'ch 10']
    ])
  })

  it('says why a file cannot be played, in main’s words', async () => {
    vi.mocked(window.cuerunner.midi.fileInspect).mockResolvedValue({ ok: false, error: 'act1.mid is not there' })
    await show('MIDI File')
    expect(container.querySelector('.midi-file-fault')?.textContent).toBe('This file cannot be played: act1.mid is not there')
  })

  it('writes the run’s length with a change to how long it runs', async () => {
    await show('MIDI File')
    const rate = container.querySelector<HTMLInputElement>('input[type="range"]')!
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    act(() => {
      setValue.call(rate, '2')
      rate.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(stored().playbackRate).toBe(2)
    expect(stored().duration).toBe(4000)
  })

  it('names an unnamed cue after the file chosen for it, and writes its length', async () => {
    vi.mocked(window.cuerunner.midi.pickFile).mockResolvedValue('/shows/Overture.mid')
    await show('MIDI File', { filePath: '' })
    await act(async () => { container.querySelector<HTMLButtonElement>('.inspector-btn')!.click() })
    expect(stored()).toMatchObject({ filePath: '/shows/Overture.mid', name: 'Overture', duration: 8000 })
  })

  it('maps a channel to another, or to nothing, and marks the channels the file uses', async () => {
    await show('Channels')
    const row = (channel: number) => container.querySelector(`.midi-file-channel[data-channel="${channel}"]`)!
    expect(row(2).querySelector('.midi-file-channel-used')?.textContent).toBe('in file')
    expect(row(3).querySelector('.midi-file-channel-used')?.textContent).toBe('')
    const select = row(2).querySelector('select')!
    act(() => {
      select.value = '0'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(stored().channelMap[1]).toBe(0)
    expect(stored().channelMap[0]).toBe(1)
  })

  it('transposes, and leaves channel 10 alone until asked', async () => {
    await show('Channels')
    const drums = container.querySelector<HTMLInputElement>('#midi-file-transpose-drums')!
    expect(drums.checked).toBe(false)
    act(() => { drums.click() })
    expect(stored().transposeDrums).toBe(true)
  })

  it('reads a hold from the row, whoever made it, and holds and lets go through the runner’s one path', async () => {
    const toggle = vi.spyOn(cueEngine, 'togglePauseCue').mockReturnValue(true)
    const held = vi.spyOn(cueEngine, 'isHeld').mockReturnValue(false)
    await show('MIDI File')
    const button = () => container.querySelector<HTMLButtonElement>('.midi-file-hold')
    expect(button()).toBeNull()

    act(() => useStore.getState().setRunning('f1', { cueId: 'f1', state: 'playing', startedAt: Date.now(), progress: 0 }))
    expect(button()?.textContent).toBe('Pause')
    act(() => button()!.click())
    expect(toggle).toHaveBeenCalledWith('f1')

    // Held by a Control cue or the Active tab: the row says so, and the button lets it go.
    act(() => useStore.getState().setRunning('f1', { cueId: 'f1', state: 'paused', startedAt: Date.now(), progress: 0 }))
    expect(button()?.textContent).toBe('Resume')
    expect(button()?.disabled).toBe(false)

    // Held with the whole show: only the show's RESUME lets it go.
    held.mockReturnValue(true)
    act(() => useStore.getState().setRunning('f1', { cueId: 'f1', state: 'paused', startedAt: Date.now() - 1, progress: 0 }))
    expect(button()?.disabled).toBe(true)
    act(() => useStore.getState().setRunning('f1', null))
    toggle.mockRestore()
    held.mockRestore()
  })
})
