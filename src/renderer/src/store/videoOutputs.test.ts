// The show's outputs in the store: an edit is an edit (the show is dirty), what a panel
// writes is held to the ranges a file is, and a load reads them through the same normaliser.
import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from './index'
import { buildWorkspace } from '../utils/workspace'
import { MAX_OUTPUTS, createOutput } from '../../../shared/visual'

beforeEach(() => {
  useStore.getState().loadWorkspace([], 'Untitled', null)
})

function saved() {
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
    cueLists: s.cueLists,
    oscPatches: s.oscPatches,
    cues: s.cues
  })
}

describe('the show\'s outputs', () => {
  it('starts a show with none, and saves a show with none as it always was', () => {
    expect(useStore.getState().videoOutputs).toEqual([])
    // The key is unset, so the bytes carry nothing for it.
    expect(Object.keys(JSON.parse(JSON.stringify(saved())))).not.toContain('videoOutputs')
  })

  it('adds an output named for its place, as an edit', () => {
    const id = useStore.getState().addVideoOutput()
    const state = useStore.getState()
    expect(state.isDirty).toBe(true)
    expect(state.videoOutputs).toEqual([expect.objectContaining({ id, name: 'Output 1', width: 1920, height: 1080 })])
    expect(saved().videoOutputs).toEqual(state.videoOutputs)
  })

  it('holds an edit from the panel to the ranges a file is held to', () => {
    const id = useStore.getState().addVideoOutput()
    useStore.getState().updateVideoOutput(id, {
      name: 'Stage',
      width: 100_000,
      warp: { corners: [{ x: 4, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }], blend: { left: 0.2, right: 0, top: 0, bottom: 0 }, gamma: 2.2 }
    })
    const [output] = useStore.getState().videoOutputs
    expect(output).toEqual(expect.objectContaining({ id, name: 'Stage', width: 8192 }))
    expect(output.warp.corners[0]).toEqual({ x: 1, y: 0 })
    expect(output.warp.blend.left).toBe(0.2)
  })

  it('removes an output, and stops adding past the most a show has', () => {
    for (let i = 0; i < MAX_OUTPUTS + 2; i++) useStore.getState().addVideoOutput()
    expect(useStore.getState().videoOutputs).toHaveLength(MAX_OUTPUTS)
    const first = useStore.getState().videoOutputs[0].id
    useStore.getState().removeVideoOutput(first)
    expect(useStore.getState().videoOutputs.map(output => output.id)).not.toContain(first)
  })

  it('loads a show\'s outputs as they were saved, and a new show with none', () => {
    const outputs = [createOutput('a', 'Left'), createOutput('b', 'Right')]
    useStore.getState().loadWorkspace([], 'Show', '/show.cuerunner', undefined, undefined, undefined, undefined, undefined, [], undefined, undefined, outputs)
    expect(useStore.getState().videoOutputs).toEqual(outputs)
    expect(useStore.getState().isDirty).toBe(false)
    useStore.getState().loadWorkspace([], 'Untitled', null)
    expect(useStore.getState().videoOutputs).toEqual([])
  })
})
