// The runner's half of a MIDI File cue: what it asks main for, and how a run's end — and so
// the show's next step — follows from main's answer.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { CueEngine } from './CueEngine'
import { NO_MIDI_FILE_SELECTED } from './midiFile'
import type { ControlCue, Cue, MidiFileCue, WaitCue } from '../../../shared/cue'
import type { RunningCue } from '../store'
import { createCue } from '../utils/cueDefaults'
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
  for (const runner of runners.splice(0)) {
    // A hold left standing would freeze the next test's clock.
    runner.stop()
    runner.dispose()
  }
})

function makeControl(action: ControlCue['action'], overrides: Partial<ControlCue> = {}): ControlCue {
  return { ...(createCue('control') as ControlCue), id: 'c1', number: '9', name: 'Control', action, targetCueIds: ['f1'], ...overrides }
}

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
  /** The rows as the store would hold them, written through `setRunning`. */
  rows: Map<string, RunningCue>
  setRunning: Mock
  setLastRun: Mock
  appendLog: Mock
  syncCueDuration: Mock
}

function setup(cues: Cue[]): Setup {
  const runner = new CueEngine()
  let selected: string | null = cues[0]?.id ?? null
  const rows = new Map<string, RunningCue>()
  const setRunning = vi.fn((id: string, state: RunningCue | null) => {
    if (state === null) rows.delete(id)
    else rows.set(id, state)
  })
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
    getRunning: () => rows,
    isPro: () => false
  })
  runners.push(runner)
  return { runner, rows, setRunning, setLastRun, appendLog, syncCueDuration }
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
    const { runner, rows, setLastRun } = setup([makeFile({ duration: 2000 })])
    runner.go()
    await vi.advanceTimersByTimeAsync(500)
    expect(runner.pauseCue('f1')).toBe(true)
    expect(midi().filePause).toHaveBeenCalledWith({ cueId: 'f1' })
    expect(rows.get('f1')?.state).toBe('paused')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(setLastRun).not.toHaveBeenCalled()
    expect(runner.resumeCue('f1')).toBe(true)
    expect(midi().fileResume).toHaveBeenCalledWith({ cueId: 'f1' })
    expect(rows.get('f1')?.state).toBe('playing')
    await vi.advanceTimersByTimeAsync(1400)
    expect(setLastRun).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(200)
    expect(setLastRun).toHaveBeenCalledWith('f1', expect.objectContaining({ outcome: 'success' }))
  })
})

describe('a MIDI File cue under the show’s PAUSE and a Control cue', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    midi().filePlay.mockResolvedValue({ ok: true, remainingMs: 2000, passMs: 2000 })
  })
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it('holds the file in main with the show, and plans its end from main’s answer when the show goes on', async () => {
    midi().fileResume.mockResolvedValue({ ok: true, remainingMs: 1200 })
    const { runner, rows, setLastRun, setRunning } = setup([makeFile({ duration: 2000, advance: 'on-end' }), makeWait()])
    runner.go()
    await vi.advanceTimersByTimeAsync(800)
    runner.pauseAll()
    // Held in main, where it plays: a show that is held must not have a file running on under it.
    expect(midi().filePause).toHaveBeenCalledWith({ cueId: 'f1' })
    expect(rows.get('f1')?.state).toBe('paused')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(setLastRun).not.toHaveBeenCalled()
    expect(setRunning).not.toHaveBeenCalledWith('w1', expect.anything())

    runner.resumeAll()
    expect(midi().fileResume).toHaveBeenCalledWith({ cueId: 'f1' })
    await vi.advanceTimersByTimeAsync(1100)
    expect(setLastRun).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(200)
    expect(setLastRun).toHaveBeenCalledWith('f1', expect.objectContaining({ outcome: 'success' }))
    expect(setRunning).toHaveBeenCalledWith('w1', expect.objectContaining({ state: 'playing' }))
  })

  it('leaves a file held on its own alone when the show is held and let go', async () => {
    const { runner } = setup([makeFile({ duration: 2000 })])
    runner.go()
    await vi.advanceTimersByTimeAsync(100)
    runner.pauseCue('f1')
    vi.mocked(midi().filePause).mockClear()
    runner.pauseAll()
    runner.resumeAll()
    expect(midi().filePause).not.toHaveBeenCalled()
    expect(midi().fileResume).not.toHaveBeenCalled()
    expect(runner.isPaused('f1')).toBe(true)
  })

  it('is held and let go by a Control cue’s Pause and Resume, the way its own hold does', async () => {
    midi().fileResume.mockResolvedValue({ ok: true, remainingMs: 900 })
    const cues: Cue[] = [makeFile({ duration: 2000 }), makeControl('pause'), makeControl('resume', { id: 'c2', number: '10' })]
    const { runner, rows, setLastRun } = setup(cues)
    runner.go()
    await vi.advanceTimersByTimeAsync(300)
    runner.goById('c1')
    await vi.advanceTimersByTimeAsync(50)
    expect(midi().filePause).toHaveBeenCalledWith({ cueId: 'f1' })
    expect(rows.get('f1')?.state).toBe('paused')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(setLastRun).not.toHaveBeenCalledWith('f1', expect.anything())

    runner.goById('c2')
    await vi.advanceTimersByTimeAsync(50)
    expect(midi().fileResume).toHaveBeenCalledWith({ cueId: 'f1' })
    await vi.advanceTimersByTimeAsync(1000)
    expect(setLastRun).toHaveBeenCalledWith('f1', expect.objectContaining({ outcome: 'success' }))
  })

  it('holds a file inside a group a Control cue pauses', async () => {
    const group = { ...(createCue('group')), id: 'g', number: '1', name: 'Band', mode: 'sequence' } as Cue
    const file = makeFile({ parentId: 'g' })
    const { runner } = setup([group, file, makeControl('pause', { targetCueIds: ['g'] })])
    runner.goById('f1')
    await vi.advanceTimersByTimeAsync(100)
    runner.goById('c1')
    await vi.advanceTimersByTimeAsync(50)
    expect(midi().filePause).toHaveBeenCalledWith({ cueId: 'f1' })
  })

  it('moves a running file to the place a Control cue’s Load names, with its end planned from there', async () => {
    midi().fileSeek.mockResolvedValue({ ok: true, remainingMs: 500 })
    const { runner, setLastRun } = setup([makeFile({ duration: 2000 }), makeControl('load', { loadToMs: 1500 })])
    runner.go()
    await vi.advanceTimersByTimeAsync(100)
    runner.goById('c1')
    await vi.advanceTimersByTimeAsync(0)
    expect(midi().fileSeek).toHaveBeenCalledWith({ cueId: 'f1', positionMs: 1500 })
    await vi.advanceTimersByTimeAsync(400)
    expect(setLastRun).not.toHaveBeenCalledWith('f1', expect.anything())
    await vi.advanceTimersByTimeAsync(200)
    expect(setLastRun).toHaveBeenCalledWith('f1', expect.objectContaining({ outcome: 'success' }))
  })

  it('starts a file a Load readied part-way in from there, the next time it is fired', async () => {
    const { runner } = setup([makeControl('load', { loadToMs: 750 }), makeFile()])
    runner.goById('c1')
    await vi.advanceTimersByTimeAsync(10)
    runner.goById('f1')
    await vi.advanceTimersByTimeAsync(0)
    expect(midi().filePlay).toHaveBeenCalledWith(expect.objectContaining({ cueId: 'f1', offsetMs: 750 }))
  })
})
