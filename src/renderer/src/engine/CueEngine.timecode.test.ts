// A timecode cue in the runner: GO asks main for the clock the cue describes, a stop takes
// the clock with the run, and a cue that could not run anywhere says why rather than reporting
// a clock nobody hears.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CueEngine } from './CueEngine'
import type { TimecodeCue } from '../../../shared/cue'
import { TIMECODE_DEFAULTS } from '../utils/cueDefaults'
import { DEFAULT_TRIGGER_GUARD } from '../../../shared/workspace'

vi.mock('./scriptHost', () => ({
  scriptHost: { run: vi.fn(), cancel: vi.fn(), cancelAll: vi.fn() },
  ScriptCancelledError: class ScriptCancelledError extends Error {}
}))
vi.mock('./audioEngineClient')
vi.mock('./networkClient', () => ({ network: { request: vi.fn(), cancel: vi.fn() } }))

const makeTimecode = (overrides: Partial<TimecodeCue> = {}): TimecodeCue => ({
  id: 'tc1', number: '20', name: 'Clock', type: 'timecode',
  colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 0,
  advance: 'none', isArmed: true, notes: '',
  ...TIMECODE_DEFAULTS,
  ...overrides
})

const runners: CueEngine[] = []

function setup(cue: TimecodeCue) {
  const runner = new CueEngine()
  const setLastRun = vi.fn()
  const appendLog = vi.fn()
  let selected: string | null = cue.id
  runner.init({
    getCues: () => [cue],
    getSelected: () => selected,
    setSelected: id => { selected = id },
    setRunning: vi.fn(),
    clearAllRunning: vi.fn(),
    syncCueDuration: vi.fn(),
    setLastRun,
    appendLog,
    getWorkspacePath: () => null,
    getMidiDefaultPort: () => 'default-midi-port',
    getTriggerGuard: () => DEFAULT_TRIGGER_GUARD
  })
  runners.push(runner)
  return { runner, setLastRun, appendLog }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(window.cuerunner.timecode.generate).mockResolvedValue({ ok: true, startFrames: 90_000 })
  vi.mocked(window.cuerunner.timecode.control).mockResolvedValue(true)
})
afterEach(() => {
  for (const runner of runners.splice(0)) runner.dispose()
})

describe('CueEngine — timecode cues', () => {
  it('asks main for the clock the cue describes, on the show’s MIDI port when it names none', async () => {
    const { runner } = setup(makeTimecode({ ltc: true, ltcChannel: 3, endTimecode: '01:00:10:00' }))
    runner.go()
    await vi.waitFor(() => expect(window.cuerunner.timecode.generate).toHaveBeenCalled())
    expect(window.cuerunner.timecode.generate).toHaveBeenCalledWith({
      cueId: 'tc1',
      rate: '25',
      startFrames: 90_000,
      endFrames: 90_250,
      jam: false,
      mtcPort: 'default-midi-port',
      ltcChannel: 3,
      ltcLevelDb: -12,
      artnetHost: null
    })
  })

  it('stops the clock with the run', async () => {
    const { runner } = setup(makeTimecode())
    runner.go()
    await vi.waitFor(() => expect(window.cuerunner.timecode.generate).toHaveBeenCalled())
    await Promise.resolve()
    runner.stop('tc1')
    expect(window.cuerunner.timecode.control).toHaveBeenCalledWith({ cueId: 'tc1', action: { action: 'stop' } })
  })

  it('stops every clock on a global stop', async () => {
    const { runner } = setup(makeTimecode())
    runner.go()
    await vi.waitFor(() => expect(window.cuerunner.timecode.generate).toHaveBeenCalled())
    await Promise.resolve()
    runner.stop()
    expect(window.cuerunner.timecode.control).toHaveBeenCalledWith({ cueId: 'tc1', action: { action: 'stop' } })
  })

  it('refuses a cue with no output, and sends nothing', async () => {
    const { runner, setLastRun, appendLog } = setup(makeTimecode({ mtc: false }))
    runner.go()
    await vi.waitFor(() => expect(setLastRun).toHaveBeenCalled())
    expect(window.cuerunner.timecode.generate).not.toHaveBeenCalled()
    expect(appendLog).toHaveBeenCalledWith([expect.objectContaining({ level: 'error', message: 'no output chosen: MTC, LTC or Art-Net' })])
  })

  it('refuses a start that is not a frame of its rate', async () => {
    const { runner, setLastRun } = setup(makeTimecode({ rate: '29.97df', startTimecode: '00:01:00;00' }))
    runner.go()
    await vi.waitFor(() => expect(setLastRun).toHaveBeenCalled())
    expect(setLastRun).toHaveBeenCalledWith('tc1', expect.objectContaining({ outcome: 'error' }))
    expect(window.cuerunner.timecode.generate).not.toHaveBeenCalled()
  })

  it('says what main said when the clock would not start', async () => {
    vi.mocked(window.cuerunner.timecode.generate).mockResolvedValue({ ok: false, error: 'No MIDI output port named "Loop"' })
    const { runner, setLastRun } = setup(makeTimecode({ mtcPortName: 'Loop' }))
    runner.go()
    await vi.waitFor(() => expect(setLastRun).toHaveBeenCalled())
    expect(setLastRun).toHaveBeenCalledWith('tc1', expect.objectContaining({ outcome: 'error', error: 'No MIDI output port named "Loop"' }))
  })

  it('holds the clock with the show, and lets it go on with it', async () => {
    const { runner } = setup(makeTimecode())
    runner.go()
    await vi.waitFor(() => expect(window.cuerunner.timecode.generate).toHaveBeenCalled())
    await vi.waitFor(() => expect(runner.isHeld()).toBe(false))
    await Promise.resolve()
    runner.pauseAll()
    expect(window.cuerunner.timecode.control).toHaveBeenCalledWith({ cueId: 'tc1', action: { action: 'pause' } })
    runner.resumeAll()
    expect(window.cuerunner.timecode.control).toHaveBeenCalledWith({ cueId: 'tc1', action: { action: 'resume' } })
  })
})
