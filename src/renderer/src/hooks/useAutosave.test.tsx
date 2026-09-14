// Autosave is the half of recovery that has to keep running unattended: it snapshots
// unsaved work on a timer, and a write that fails must not stop the next one.
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useAutosave } from './useAutosave'
import { useStore } from '../store'

const INTERVAL_MS = 30_000

function Harness() {
  useAutosave()
  return null
}

describe('useAutosave', () => {
  let container: HTMLDivElement
  let root: Root
  let autosave: Mock

  beforeEach(() => {
    vi.useFakeTimers()
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    autosave = window.winslab.workspace.autosave as unknown as Mock
    autosave.mockReset()
    autosave.mockResolvedValue(undefined)
    useStore.setState({
      cues: [],
      isDirty: false,
      workspaceName: 'Untitled',
      workspacePath: null,
      notice: null
    })

    act(() => { root.render(<Harness />) })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('snapshots unsaved work, with the path it belongs to', () => {
    useStore.getState().addCue('wait')
    useStore.setState({ workspaceName: 'My Show', workspacePath: '/shows/My Show.wlab' })

    act(() => { vi.advanceTimersByTime(INTERVAL_MS) })

    expect(autosave).toHaveBeenCalledTimes(1)
    const [snapshot, sourcePath] = autosave.mock.calls[0]
    expect(snapshot.name).toBe('My Show')
    expect(snapshot.cues).toHaveLength(1)
    expect(snapshot.cues[0].type).toBe('wait')
    expect(sourcePath).toBe('/shows/My Show.wlab')
  })

  it('writes nothing while the session is already saved', () => {
    act(() => { vi.advanceTimersByTime(INTERVAL_MS * 3) })

    expect(autosave).not.toHaveBeenCalled()
  })

  it('carries the cue the session was standing on, so a recovery can name it', () => {
    useStore.getState().addCue('wait')
    const standing = useStore.getState().cues[0].id
    useStore.getState().select(standing)

    act(() => { vi.advanceTimersByTime(INTERVAL_MS) })

    expect(autosave.mock.calls[0][2]).toBe(standing)
  })

  it('keeps snapshotting after a write fails', () => {
    useStore.getState().addCue('wait')
    autosave.mockRejectedValueOnce(new Error('disk full'))

    act(() => { vi.advanceTimersByTime(INTERVAL_MS) })
    act(() => { vi.advanceTimersByTime(INTERVAL_MS) })

    expect(autosave).toHaveBeenCalledTimes(2)
  })
})
