// How a show follows timecode is the show's own: it opens with the file, an edit dirties the
// show and goes back with undo, and a show that leaves it at the defaults writes nothing —
// so a show saved before timecode existed saves back the bytes it was opened with.
import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './index'
import { buildWorkspace } from '../utils/workspace'
import { defaultTimecodeShowSettings, type TimecodeShowSettings } from '../../../shared/timecode'
import type { Workspace } from '../../../shared/workspace'

function saved(): Workspace {
  const s = useStore.getState()
  return buildWorkspace({
    id: s.workspaceId,
    name: s.workspaceName,
    createdAt: s.workspaceCreatedAt,
    history: s.showHistory,
    audioSettings: s.audioSettings,
    midiSettings: s.midiSettings,
    showSettings: s.showSettings,
    triggerGuard: s.triggerGuard,
    lighting: s.lighting,
    timecode: s.timecode,
    videoOutputs: s.videoOutputs,
    oscPatches: s.oscPatches,
    cues: s.cues
  })
}

const chasing: TimecodeShowSettings = {
  ...defaultTimecodeShowSettings(), chase: true, offsetFrames: -90_000, rate: '25', onStop: 'stop'
}

beforeEach(() => {
  useStore.getState().loadWorkspace([], 'Untitled', null)
})

describe('the show’s timecode in the store', () => {
  it('opens with the show, and follows with the defaults when the file says nothing', () => {
    useStore.getState().loadWorkspace([], 'Chasing', '/shows/a.cuerunner', undefined, undefined, undefined,
      undefined, undefined, [], undefined, chasing)
    expect(useStore.getState().timecode).toEqual(chasing)

    useStore.getState().loadWorkspace([], 'Older', '/shows/b.cuerunner')
    expect(useStore.getState().timecode).toEqual(defaultTimecodeShowSettings())
  })

  it('writes no section while every field is its default, and the whole section once one moves', () => {
    expect(Object.keys(JSON.parse(JSON.stringify(saved())))).not.toContain('timecode')
    useStore.getState().setTimecode({ chase: true })
    expect(saved().timecode).toEqual({ ...defaultTimecodeShowSettings(), chase: true })
    useStore.getState().setTimecode({ chase: false })
    expect(Object.keys(JSON.parse(JSON.stringify(saved())))).not.toContain('timecode')
  })

  it('dirties the show, and goes back with undo and forward with redo', () => {
    expect(useStore.getState().isDirty).toBe(false)
    useStore.getState().setTimecode({ offsetFrames: 250 })
    expect(useStore.getState().isDirty).toBe(true)
    useStore.getState().setTimecode({ chase: true })

    useStore.getState().undo()
    expect(useStore.getState().timecode).toMatchObject({ offsetFrames: 250, chase: false })
    useStore.getState().undo()
    expect(useStore.getState().timecode).toEqual(defaultTimecodeShowSettings())
    useStore.getState().redo()
    expect(useStore.getState().timecode).toMatchObject({ offsetFrames: 250, chase: false })
  })

  it('holds an edit to what the window may set', () => {
    useStore.getState().setTimecode({ holdMs: 99_999, toleranceFrames: -4 })
    expect(useStore.getState().timecode).toMatchObject({ holdMs: 10_000, toleranceFrames: 0 })
  })
})
