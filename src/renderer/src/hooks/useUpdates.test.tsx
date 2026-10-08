// The window's report to the updater: any cue the engine holds open — a sound, a wait, a video,
// an image or a text up on a screen — is the show running, and main is told as it changes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useUpdates } from './useUpdates'
import { useStore } from '../store'

function Probe({ showMode }: { showMode: boolean }) {
  useUpdates(showMode)
  return null
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  useStore.setState({ running: new Map(), workspacePath: null })
  vi.mocked(window.cuerunner.update.report).mockClear()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('what the window tells the updater', () => {
  it('reports a picture held on a screen as the show running, and its end as idle', () => {
    act(() => root.render(<Probe showMode={false} />))
    expect(window.cuerunner.update.report).toHaveBeenLastCalledWith({ busy: false, showMode: false, showOpen: false })
    for (const type of ['video', 'image', 'text']) {
      act(() => useStore.getState().setRunning(`${type}-1`, { state: 'playing' } as never))
      expect(window.cuerunner.update.report, type).toHaveBeenLastCalledWith({ busy: true, showMode: false, showOpen: false })
      act(() => useStore.getState().setRunning(`${type}-1`, null))
      expect(window.cuerunner.update.report).toHaveBeenLastCalledWith({ busy: false, showMode: false, showOpen: false })
    }
  })

  it('reports Show Mode, and whether the show is a file', () => {
    act(() => useStore.setState({ workspacePath: '/shows/Hamlet.cuerunner' }))
    act(() => root.render(<Probe showMode={true} />))
    expect(window.cuerunner.update.report).toHaveBeenLastCalledWith({ busy: false, showMode: true, showOpen: true })
  })
})
