// The window's half of the log on disk: what it forwards, how a line reads, and what it leaves
// to main.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { LOG_FLUSH_MS, logFileLine, openLogsFolder, useLogFile } from './useLogFile'
import { useStore } from '../store'

function Harness() {
  useLogFile()
  return null
}

describe('logFileLine', () => {
  it('reads level, cue and message', () => {
    expect(logFileLine({ level: 'error', label: '3 · Network Cue', message: 'HTTP 500' }))
      .toBe('ERROR [3 · Network Cue] HTTP 500')
    expect(logFileLine({ level: 'info', message: 'audio engine restarted' })).toBe('INFO audio engine restarted')
  })
})

describe('useLogFile', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.useFakeTimers()
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    useStore.setState({ log: [] })
    useStore.getState().appendLog([{ level: 'info', message: 'before the hook' }])
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => { root.render(<Harness />) })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
    vi.mocked(window.cuerunner.app.writeLog).mockClear()
  })

  it('writes what the log takes from now on, gathered into one write', () => {
    useStore.getState().appendLog([{ level: 'info', label: '1 · Walk-in', message: 'started' }])
    useStore.getState().appendLog([{ level: 'error', label: '2 · Sting', message: 'playback failed' }])
    expect(window.cuerunner.app.writeLog).not.toHaveBeenCalled()

    vi.advanceTimersByTime(LOG_FLUSH_MS)
    expect(window.cuerunner.app.writeLog).toHaveBeenCalledTimes(1)
    expect(window.cuerunner.app.writeLog).toHaveBeenCalledWith([
      'INFO [1 · Walk-in] started',
      'ERROR [2 · Sting] playback failed'
    ])
  })

  it('leaves main’s own failures to main, which has written them already', () => {
    useStore.getState().appendLog([{ level: 'error', message: 'MIDI output gone', origin: 'main' }])
    vi.advanceTimersByTime(LOG_FLUSH_MS)
    expect(window.cuerunner.app.writeLog).not.toHaveBeenCalled()
  })

  it('writes what is waiting when the window goes', () => {
    useStore.getState().appendLog([{ level: 'info', message: 'last words' }])
    act(() => root.unmount())
    expect(window.cuerunner.app.writeLog).toHaveBeenCalledWith(['INFO last words'])
    // Remounted so the afterEach has something to unmount.
    root = createRoot(container)
    act(() => { root.render(<Harness />) })
  })
})

describe('openLogsFolder', () => {
  it('says on the notice bar when the machine would not open it', async () => {
    vi.mocked(window.cuerunner.app.openLogs).mockResolvedValueOnce({ ok: false, error: 'no file manager' })
    await openLogsFolder()
    expect(useStore.getState().notice).toBe('no file manager')
    useStore.setState({ notice: null })
  })
})
