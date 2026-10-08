// The runner's half of a MIDI File cue: what it asks main for, and how a run's end — and so
// the show's next step — follows from main's answer.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { CueEngine } from './CueEngine'
import { NO_MIDI_FILE_SELECTED } from './midiFile'
import type { Cue, MidiFileCue, WaitCue } from '../../../shared/cue'
import { MIDI_FILE_IDENTITY_MAP } from '../../../shared/midiFile'
import { DEFAULT_TRIGGER_GUARD } from '../../../shared/workspace'

vi.mock('./scriptHost', () => ({
  scriptHost: { run: vi.fn(), cancel: vi.fn(), cancelAll: vi.fn() },
  ScriptCancelledError: class ScriptCancelledError extends Error {}
}))
vi.mock('./audioEngineClient')
vi.mock('./networkClient', () => ({ network: { request: vi.fn(), cancel: vi.fn() } }))

const runners: CueEngine[] = []
afterEach(() => {
  for (const runner of runners.splice(0)) runner.dispose()
})

const base = {
  colorLabel: 'none' as const, parentId: null, preWait: 0, postWait: 0, timelineOffset: 0,
  advance: 'none' as const, isArmed: true, notes: ''
}

function makeFile(overrides: Partial<MidiFileCue> = {}): MidiFileCue {
  return {
    ...base,
    id: 'f1', number: '1', name: 'Click', type: 'midiFile', duration: 0,
    filePath: '/shows/click.mid', portName: '', playbackRate: 1, startTime: 0, endTime: null,
    loopCount: 0, channelMap: [...MIDI_FILE_IDENTITY_MAP], transpose: 0, transposeDrums: false,
    ...overrides
  }
}

function makeWait(overrides: Partial<WaitCue> = {}): WaitCue {
  return { ...base, id: 'w1', number: '2', name: 'Wait', type: 'wait', duration: 1000, ...overrides }
}

interface Setup {
  runner: CueEngine
  setRunning: Mock
  setLastRun: Mock
  appendLog: Mock
  syncCueDuration: Mock
}

function setup(cues: Cue[]): Setup {
  const runner = new CueEngine()
  let selected: string | null = cues[0]?.id ?? null
  const setRunning = vi.fn()
  const setLastRun = vi.fn()
  const appendLog = vi.fn()
  const syncCueDuration = vi.fn()
  runner.init({
    getCues: () => cues,
    getSelected: () => selected,
    setSelected: vi.fn((id: string | null) => { selected = id }),
    setRunning,
    clearAllRunning: vi.fn(),
    syncCueDuration,
    setLastRun,
    appendLog,
    getWorkspacePath: () => null,
    getMidiDefaultPort: () => 'show-port',
    getTriggerGuard: () => DEFAULT_TRIGGER_GUARD,
    isPro: () => false
  })
  runners.push(runner)
  return { runner, setRunning, setLastRun, appendLog, syncCueDuration }
}

const midi = () => vi.mocked(window.cuerunner.midi)

describe('a MIDI File cue in the runner', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    midi().filePlay.mockResolvedValue({ ok: true, remainingMs: 2000, passMs: 2000 })
  })
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it('asks main to play its file, with its options, to the show’s port when it names none', async () => {
    const cue = makeFile({ playbackRate: 1.5, transpose: -2, loopCount: 1 })
    const { runner } = setup([cue])
    runner.go()
    await vi.advanceTimersByTimeAsync(0)
    expect(midi().filePlay).toHaveBeenCalledWith({
      cueId: 'f1',
      filePath: '/shows/click.mid',
      portName: 'show-port',
      options: {
        rate: 1.5, startMs: 0, endMs: null, loopCount: 1,
        channelMap: [...MIDI_FILE_IDENTITY_MAP], transpose: -2, transposeDrums: false
      },
      offsetMs: 0
    })
  })

  it('completes when main says its file ends, and the show follows on by itself', async () => {
    const { runner, setRunning, setLastRun, syncCueDuration } = setup([
      makeFile({ advance: 'on-end' }),
      makeWait()
    ])
    runner.go()
    await vi.advanceTimersByTimeAsync(0)
    // The row learns the run's real length from main's reading of the tempo map.
    expect(syncCueDuration).toHaveBeenCalledWith('f1', 2000)
    await vi.advanceTimersByTimeAsync(1900)
    expect(setRunning).not.toHaveBeenCalledWith('w1', expect.anything())
    await vi.advanceTimersByTimeAsync(200)
    expect(setLastRun).toHaveBeenCalledWith('f1', expect.objectContaining({ outcome: 'success' }))
    expect(setRunning).toHaveBeenCalledWith('w1', expect.objectContaining({ state: 'playing' }))
  })

  it('says why a file did not play, and does not hold the show', async () => {
    midi().filePlay.mockResolvedValue({ ok: false, error: 'No MIDI output port named "Synth"' })
    const { runner, setLastRun, appendLog, setRunning } = setup([makeFile({ advance: 'on-end' }), makeWait()])
    runner.go()
    await vi.advanceTimersByTimeAsync(100)
    expect(setLastRun).toHaveBeenCalledWith('f1', expect.objectContaining({
      outcome: 'error', error: 'No MIDI output port named "Synth"'
    }))
    expect(appendLog).toHaveBeenCalledWith([expect.objectContaining({ level: 'error', message: 'No MIDI output port named "Synth"' })])
    expect(setRunning).toHaveBeenCalledWith('w1', expect.objectContaining({ state: 'playing' }))
  })

  it('says a cue with no file played nothing, without asking main', async () => {
    const { runner, setLastRun } = setup([makeFile({ filePath: '' })])
    runner.go()
    await vi.advanceTimersByTimeAsync(100)
    expect(midi().filePlay).not.toHaveBeenCalled()
    expect(setLastRun).toHaveBeenCalledWith('f1', expect.objectContaining({ outcome: 'error', error: NO_MIDI_FILE_SELECTED }))
  })

  it('stops the file in main when STOP takes the run away, and asks nothing for other cues', async () => {
    const { runner } = setup([makeFile(), makeWait({ id: 'w9' })])
    runner.go()
    runner.go()
    await vi.advanceTimersByTimeAsync(10)
    runner.stop('w9')
    expect(midi().fileStop).not.toHaveBeenCalled()
    runner.stop('f1')
    expect(midi().fileStop).toHaveBeenCalledWith({ cueId: 'f1' })
  })

  it('stops the file on a panic', async () => {
    const { runner } = setup([makeFile()])
    runner.go()
    await vi.advanceTimersByTimeAsync(10)
    runner.panic()
    expect(midi().fileStop).toHaveBeenCalledWith({ cueId: 'f1' })
  })

  it('holds the show while a file loops until stopped', async () => {
    midi().filePlay.mockResolvedValue({ ok: true, remainingMs: null, passMs: 500 })
    const { runner, setRunning, setLastRun } = setup([makeFile({ loopCount: -1, advance: 'on-end' }), makeWait()])
    runner.go()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(setLastRun).not.toHaveBeenCalled()
    expect(setRunning).not.toHaveBeenCalledWith('w1', expect.anything())
  })

  it('takes a held file’s end away, and plans it again from what main says is left', async () => {
    midi().fileResume.mockResolvedValue({ ok: true, remainingMs: 1500 })
    const { runner, setLastRun } = setup([makeFile({ duration: 2000 })])
    runner.go()
    await vi.advanceTimersByTimeAsync(500)
    runner.pauseMidiFile('f1')
    expect(midi().filePause).toHaveBeenCalledWith({ cueId: 'f1' })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(setLastRun).not.toHaveBeenCalled()
    runner.resumeMidiFile('f1')
    await vi.advanceTimersByTimeAsync(1400)
    expect(setLastRun).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(200)
    expect(setLastRun).toHaveBeenCalledWith('f1', expect.objectContaining({ outcome: 'success' }))
  })
})
