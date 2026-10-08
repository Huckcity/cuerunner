// A merge of two copies of a show where one side dropped an optional section — took the rig
// out, put the clock back to its defaults, removed the last output, went back to one list. The
// section the blend settles on as nothing is left out of the merged show rather than written as
// `null`, which the load funnel refuses: the merged show has to open, and save back the bytes it
// opened with. One rule for every optional section the merge blends whole, held here for each.
import { describe, it, expect, vi } from 'vitest'
import type { WaitCue } from '../../shared/cue'
import type { Workspace } from '../../shared/workspace'
import type { WorkspaceKey } from '../../shared/workspaceSections'
import { mergeWorkspaces } from '../../shared/showfileMerge'
import { defaultLightingSettings } from '../../shared/dmx'
import { createOutput } from '../../shared/visual'
import { defaultCueLists } from '../../shared/cueLists'
import { migrateWorkspace } from './WorkspaceManager'
import { serialiseWorkspace } from './serialise'

vi.mock('electron', () => ({ app: {}, dialog: {}, BrowserWindow: {} }))

const FOLDER = '/shows'

const cue: WaitCue = {
  id: 'w1', number: '1', name: 'Walk-in', colorLabel: 'none', parentId: null, preWait: 0, postWait: 0,
  timelineOffset: 0, duration: 1000, advance: 'none', isArmed: true, notes: '', type: 'wait'
}

function show(extra: Partial<Workspace> = {}): Workspace {
  return {
    version: 1,
    id: 'w',
    name: 'Press Night',
    createdAt: '2026-10-01T00:00:00.000Z',
    audioSettings: { outputDeviceId: 'default' },
    midiSettings: { outputPortName: '' },
    triggerGuard: { windowMs: 300 },
    cues: [cue],
    ...extra
  }
}

/** Each optional section the merge blends whole, as a value and as that value changed. */
const SECTIONS: Array<{ key: WorkspaceKey; value: unknown; changed: unknown }> = [
  { key: 'triggerGuard', value: { windowMs: 500 }, changed: { windowMs: 700 } },
  { key: 'lighting', value: { ...defaultLightingSettings(), panic: 'release' }, changed: { ...defaultLightingSettings(), panic: 'blackout' } },
  {
    key: 'timecode',
    value: { rate: 'auto', holdMs: 1000, chase: true, offsetFrames: 0, onStop: 'hold', toleranceFrames: 10 },
    changed: { rate: '25', holdMs: 1000, chase: false, offsetFrames: 25, onStop: 'stop', toleranceFrames: 10 }
  },
  { key: 'videoOutputs', value: [createOutput('out-1', 'Stage')], changed: [createOutput('out-1', 'Stage left')] },
  {
    key: 'cueLists',
    value: [...defaultCueLists(), { id: 'fx', name: 'Effects' }],
    changed: [...defaultCueLists(), { id: 'fx', name: 'Effects', cart: true }]
  },
  // The show's picture settings have one field: the change a second writer can make is to turn
  // it back, which a merge still has to carry when the policy says theirs.
  { key: 'pictures', value: { stopOnNextGo: true }, changed: { stopOnNextGo: false } }
]

const withSection = (key: WorkspaceKey, value: unknown): Workspace => ({ ...show(), [key]: value }) as Workspace
const without = (key: WorkspaceKey): Workspace => {
  const workspace = show() as unknown as Record<string, unknown>
  delete workspace[key]
  return workspace as unknown as Workspace
}

/**
 * The merged show as a file: written, read back through the funnel and written again. The
 * funnel completes a show with no guard with the default guard, so the guard's first read may
 * add one; from there on every save is the bytes it read.
 */
function roundTrip(merged: Workspace, key: WorkspaceKey): void {
  const written = serialiseWorkspace(merged, FOLDER)
  const read = migrateWorkspace(JSON.parse(written) as Workspace, 'the merged show')
  const again = serialiseWorkspace(read, FOLDER)
  if (key !== 'triggerGuard' || Object.hasOwn(merged, key)) expect(again).toBe(written)
  const third = serialiseWorkspace(migrateWorkspace(JSON.parse(again) as Workspace, 'the merged show'), FOLDER)
  expect(third).toBe(again)
}

describe('merging an optional section one side dropped', () => {
  for (const { key, value, changed } of SECTIONS) {
    describe(key, () => {
      it('leaves it out where one side dropped it and the other left it alone', () => {
        const { workspace } = mergeWorkspaces(withSection(key, value), without(key), withSection(key, value))
        expect(Object.hasOwn(workspace, key)).toBe(false)
        roundTrip(workspace, key)
        const { workspace: mirrored } = mergeWorkspaces(withSection(key, value), withSection(key, value), without(key))
        expect(Object.hasOwn(mirrored, key)).toBe(false)
        roundTrip(mirrored, key)
      })

      it('leaves it out or keeps the change, as the policy says, where the other side changed it', () => {
        const ours = mergeWorkspaces(withSection(key, value), without(key), withSection(key, changed), { onConflict: 'ours' })
        expect(Object.hasOwn(ours.workspace, key)).toBe(false)
        expect(ours.tally.conflicts).toBe(1)
        roundTrip(ours.workspace, key)
        const theirs = mergeWorkspaces(withSection(key, value), without(key), withSection(key, changed), { onConflict: 'theirs' })
        expect((theirs.workspace as unknown as Record<string, unknown>)[key]).toEqual(changed)
        roundTrip(theirs.workspace, key)
      })

      it('leaves it out where both sides dropped it', () => {
        const { workspace, tally } = mergeWorkspaces(withSection(key, value), without(key), without(key))
        expect(Object.hasOwn(workspace, key)).toBe(false)
        expect(tally.conflicts).toBe(0)
        roundTrip(workspace, key)
      })

      it('takes it where only the other side added it', () => {
        const { workspace } = mergeWorkspaces(without(key), without(key), withSection(key, value))
        expect((workspace as unknown as Record<string, unknown>)[key]).toEqual(value)
        roundTrip(workspace, key)
      })
    })
  }
})
