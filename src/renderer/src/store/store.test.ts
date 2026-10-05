import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from './index'
import type { AudioCue } from '../../../shared/cue'
import { defaultShowSettings, startingChannels } from '../../../shared/show'
import { rowChannels, setRowMember } from '../utils/scenes'
import type {
  AlertEvent,
  AlertLevel,
  CastSettings,
  Dca,
  DeviceEvent,
  DeviceState,
  Ensemble,
  MicScene,
  Performer,
  ServiceEvent,
  ShowEvent
} from '../../../shared/show'

const DCA: Dca = { id: 'dca-1', deskNumber: null }
/** The strip Ada's mic is on, which is what carries her to the desk. */
const CHANNEL = { id: 'ch-1', name: 'Ada' }
const ROUTED_PERFORMER: Performer = {
  id: 'p1',
  name: 'Ada',
  role: 'Lead',
  notes: '',
  channelId: 'ch-1'
}
/** The scene Ada is on: the first fader, and the strip that rides it. */
const NUMBER: MicScene = {
  id: 's1',
  name: 'Bows',
  dcas: [{ dcaId: 'dca-1', kind: 'channel', memberId: 'ch-1' }],
  notes: ''
}

function castWith(cast: Partial<CastSettings> = {}): CastSettings {
  return { channels: [CHANNEL], performers: [ROUTED_PERFORMER], ensembles: [], dcas: [DCA], ...cast }
}

function resetStore() {
  useStore.setState({
    cues: [],
    selectedId: null,
    selectedIds: [],
    selectionAnchorId: null,
    collapsedGroupIds: new Set<string>(),
    running: new Map(),
    lastRuns: {},
    log: [],
    missingMedia: [],
    mediaLengths: {}
  })
}

describe('store — addCue', () => {
  beforeEach(resetStore)

  it('numbers a new cue one past the highest number in the show', () => {
    const { loadWorkspace, addCue } = useStore.getState()
    addCue('wait')
    addCue('wait')
    const made = useStore.getState().cues
    loadWorkspace(
      [{ ...made[0], number: '1' }, { ...made[1], number: '7' }],
      'Opened',
      null
    )
    // A show that has just been opened: the next cue follows its numbers, not a count
    // the window kept from before the file was read.
    addCue('wait', useStore.getState().cues[0].id)
    expect(useStore.getState().cues.map(cue => cue.number)).toEqual(['1', '8', '7'])
  })

  it('starts a new show at cue 1, whatever the last one reached', () => {
    const { loadWorkspace, addCue } = useStore.getState()
    addCue('wait')
    addCue('wait')
    addCue('wait')
    loadWorkspace([], 'Untitled', null)
    addCue('wait')
    expect(useStore.getState().cues.map(cue => cue.number)).toEqual(['1'])
  })

  it('numbers dropped files in the order they were dropped, after the show\'s own', () => {
    const { addCue, addAudioCuesFromFiles } = useStore.getState()
    addCue('wait')
    addCue('wait')
    addAudioCuesFromFiles([
      { filePath: '/media/a.wav', name: 'a' },
      { filePath: '/media/b.wav', name: 'b' },
      { filePath: '/media/c.wav', name: 'c' }
    ])
    expect(useStore.getState().cues.map(cue => cue.number)).toEqual(['1', '2', '3', '4', '5'])
  })

  it('appends a cue to the end by default', () => {
    useStore.getState().addCue('wait')
    expect(useStore.getState().cues).toHaveLength(1)
    expect(useStore.getState().cues[0].type).toBe('wait')
  })

  it('inserts a cue after the specified id', () => {
    useStore.getState().addCue('wait')
    const firstId = useStore.getState().cues[0].id
    useStore.getState().addCue('audio', firstId)

    const cues = useStore.getState().cues
    expect(cues[0].type).toBe('wait')
    expect(cues[1].type).toBe('audio')
  })

  it('selects the newly added cue', () => {
    useStore.getState().addCue('wait')
    const id = useStore.getState().cues[0].id
    expect(useStore.getState().selectedId).toBe(id)
  })

})

describe('store — removeCue', () => {
  beforeEach(resetStore)

  it('removes the cue by id', () => {
    useStore.getState().addCue('wait')
    const id = useStore.getState().cues[0].id
    useStore.getState().removeCues([id])
    expect(useStore.getState().cues).toHaveLength(0)
  })

  it('clears selectedId when the selected cue is removed', () => {
    useStore.getState().addCue('wait')
    const id = useStore.getState().cues[0].id
    useStore.getState().select(id)
    useStore.getState().removeCues([id])
    expect(useStore.getState().selectedId).toBeNull()
  })

  it('preserves selectedId when a different cue is removed', () => {
    useStore.getState().addCue('wait')
    useStore.getState().addCue('audio')
    const [first, second] = useStore.getState().cues
    useStore.getState().select(second.id)
    useStore.getState().removeCues([first.id])
    expect(useStore.getState().selectedId).toBe(second.id)
  })

})

describe('store — updateCue', () => {
  beforeEach(resetStore)

  it('patches the named fields without touching others', () => {
    useStore.getState().addCue('wait')
    const id = useStore.getState().cues[0].id
    const originalNumber = useStore.getState().cues[0].number

    useStore.getState().updateCue(id, { name: 'My Wait', preWait: 500 })

    const cue = useStore.getState().cues[0]
    expect(cue.name).toBe('My Wait')
    expect(cue.preWait).toBe(500)
    expect(cue.number).toBe(originalNumber) // untouched
  })

  it('ignores updates to non-existent ids', () => {
    useStore.getState().addCue('wait')
    useStore.getState().updateCue('does-not-exist', { name: 'Ghost' })
    expect(useStore.getState().cues[0].name).not.toBe('Ghost')
  })
})

describe('store — moveCue', () => {
  beforeEach(resetStore)

  it('moves a cue to the end of the list', () => {
    useStore.getState().addCue('wait')
    useStore.getState().addCue('audio')
    useStore.getState().addCue('midi')

    const [a, b, c] = useStore.getState().cues.map(c => c.id)
    useStore.getState().moveCue(0, 3)

    const ids = useStore.getState().cues.map(c => c.id)
    expect(ids).toEqual([b, c, a])
  })

  it('moves a cue to the front of the list', () => {
    useStore.getState().addCue('wait')
    useStore.getState().addCue('audio')
    useStore.getState().addCue('midi')

    const [a, b, c] = useStore.getState().cues.map(c => c.id)
    useStore.getState().moveCue(2, 0)

    const ids = useStore.getState().cues.map(c => c.id)
    expect(ids).toEqual([c, a, b])
  })

  it('inserts before the given index rather than at it', () => {
    useStore.getState().addCue('wait')
    useStore.getState().addCue('audio')
    useStore.getState().addCue('midi')

    const [a, b, c] = useStore.getState().cues.map(c => c.id)
    useStore.getState().moveCue(0, 2)

    const ids = useStore.getState().cues.map(c => c.id)
    expect(ids).toEqual([b, a, c])
  })

  it('does not record history for a move that changes nothing', () => {
    useStore.getState().addCue('wait')
    useStore.getState().addCue('audio')

    const before = useStore.getState().cues
    const pastLength = useStore.getState().past.length
    useStore.getState().moveCue(0, 0)

    expect(useStore.getState().cues).toBe(before)
    expect(useStore.getState().past).toHaveLength(pastLength)
  })
})

describe('store — moveCue with groups', () => {
  beforeEach(resetStore)

  // [group, child1, child2, wait] — returns the ids in order.
  function setupGroupWithChildren() {
    useStore.getState().addCue('group')
    const groupId = useStore.getState().cues[0].id
    useStore.getState().addCue('wait', groupId)
    useStore.getState().addCue('audio', groupId)
    useStore.getState().addCue('midi')
    return { groupId, ids: useStore.getState().cues.map(c => c.id) }
  }

  it('moves a group together with its children', () => {
    const { groupId, ids: [g, c1, c2, w] } = setupGroupWithChildren()

    useStore.getState().moveCue(0, 4) // move the group to the end

    const cues = useStore.getState().cues
    expect(cues.map(c => c.id)).toEqual([w, g, c1, c2])
    expect(cues[1].parentId).toBeNull()
    expect(cues[2].parentId).toBe(groupId)
    expect(cues[3].parentId).toBe(groupId)
  })

  it('keeps children contiguous when a group moves to the front', () => {
    useStore.getState().addCue('wait')
    useStore.getState().addCue('midi')
    useStore.getState().addCue('group')
    const groupId = useStore.getState().cues[2].id
    useStore.getState().addCue('wait', groupId)
    const [w1, m1, g, child] = useStore.getState().cues.map(c => c.id)

    useStore.getState().moveCue(2, 0)

    expect(useStore.getState().cues.map(c => c.id)).toEqual([g, child, w1, m1])
  })

  it('moves a child out of its group to the top level', () => {
    const { ids: [g, c1, c2, w] } = setupGroupWithChildren()

    useStore.getState().moveCue(1, 0, null) // pull the first child to the top

    const cues = useStore.getState().cues
    expect(cues.map(c => c.id)).toEqual([c1, g, c2, w])
    expect(cues[0].parentId).toBeNull()
  })

  it('ignores a drop inside the moved group (its own rows)', () => {
    const { groupId, ids: [g] } = setupGroupWithChildren()
    const before = useStore.getState().cues

    useStore.getState().moveCue(0, 1, g) // dropping a group just below its own header

    expect(useStore.getState().cues).toBe(before)
    expect(useStore.getState().cues[0].parentId).toBeNull()
    expect(useStore.getState().cues[0].id).toBe(groupId)
  })

  it('refuses to make a group a child of itself or of its own descendant', () => {
    const { ids: [g, c1] } = setupGroupWithChildren()

    useStore.getState().moveCue(0, 0, g)  // itself
    expect(useStore.getState().cues[0].parentId).toBeNull()

    useStore.getState().moveCue(0, 0, c1) // its own child
    expect(useStore.getState().cues[0].parentId).toBeNull()
  })
})

describe('store — groups and parentId', () => {
  beforeEach(resetStore)

  it('adding a cue after a group header makes it a child', () => {
    useStore.getState().addCue('group')
    const groupId = useStore.getState().cues[0].id
    useStore.getState().addCue('wait', groupId)

    const cues = useStore.getState().cues
    expect(cues).toHaveLength(2)
    expect(cues[1].parentId).toBe(groupId)
  })

  it('adding a cue after a child inherits the same parentId', () => {
    useStore.getState().addCue('group')
    const groupId = useStore.getState().cues[0].id
    useStore.getState().addCue('wait', groupId)         // child
    const childId = useStore.getState().cues[1].id
    useStore.getState().addCue('audio', childId)        // sibling child

    const cues = useStore.getState().cues
    expect(cues[2].parentId).toBe(groupId)
  })

  it('removing a group also removes its children', () => {
    useStore.getState().addCue('group')
    const groupId = useStore.getState().cues[0].id
    useStore.getState().addCue('wait', groupId)
    useStore.getState().addCue('audio', groupId)
    expect(useStore.getState().cues).toHaveLength(3)

    useStore.getState().removeCues([groupId])
    expect(useStore.getState().cues).toHaveLength(0)
  })

  it('moveCue with newParentId updates the parentId', () => {
    useStore.getState().addCue('group')
    const groupId = useStore.getState().cues[0].id
    useStore.getState().addCue('wait')                  // top-level wait at index 1

    // Remove from index 1, re-insert at index 1 (post-removal), with new parentId
    useStore.getState().moveCue(1, 1, groupId)
    expect(useStore.getState().cues[1].parentId).toBe(groupId)
  })

  it('duplicating a group duplicates its children too', () => {
    useStore.getState().addCue('group')
    const groupId = useStore.getState().cues[0].id
    useStore.getState().addCue('wait', groupId)
    useStore.getState().addCue('audio', groupId)
    expect(useStore.getState().cues).toHaveLength(3)

    useStore.getState().duplicateCues([groupId])
    const cues = useStore.getState().cues
    expect(cues).toHaveLength(6)

    const copyGroup = cues[3]
    expect(copyGroup.type).toBe('group')
    expect(copyGroup.id).not.toBe(groupId)
    expect(cues[4].parentId).toBe(copyGroup.id)
    expect(cues[5].parentId).toBe(copyGroup.id)
  })
})

describe('store — duplicateCue', () => {
  beforeEach(resetStore)

  it('inserts a copy directly after the original', () => {
    useStore.getState().addCue('wait')
    useStore.getState().addCue('audio')
    const [wait] = useStore.getState().cues

    useStore.getState().duplicateCues([wait.id])

    expect(useStore.getState().cues).toHaveLength(3)
    expect(useStore.getState().cues[0].id).toBe(wait.id)
    expect(useStore.getState().cues[1].type).toBe('wait') // the copy
    expect(useStore.getState().cues[1].id).not.toBe(wait.id) // new id
  })

  it('selects the duplicate', () => {
    useStore.getState().addCue('wait')
    const id = useStore.getState().cues[0].id
    useStore.getState().duplicateCues([id])

    const copyId = useStore.getState().cues[1].id
    expect(useStore.getState().selectedId).toBe(copyId)
  })
})

describe('store — selection', () => {
  beforeEach(resetStore)

  function addWaits(count: number): string[] {
    for (let i = 0; i < count; i++) useStore.getState().addCue('wait')
    return useStore.getState().cues.map(cue => cue.id)
  }

  it('selecting one cue makes it the set, the active cue and the anchor', () => {
    const [first] = addWaits(3)
    useStore.getState().select(first)

    const state = useStore.getState()
    expect(state.selectedIds).toEqual([first])
    expect(state.selectedId).toBe(first)
    expect(state.selectionAnchorId).toBe(first)
  })

  it('clearing the selection clears all three', () => {
    addWaits(2)
    useStore.getState().select(null)

    const state = useStore.getState()
    expect(state.selectedIds).toEqual([])
    expect(state.selectedId).toBeNull()
    expect(state.selectionAnchorId).toBeNull()
  })

  it('shift extends from the anchor to the cue that was clicked, in the order given', () => {
    const ids = addWaits(4)
    useStore.getState().select(ids[0])
    useStore.getState().extendSelection(ids, ids[2])

    const state = useStore.getState()
    expect(state.selectedIds).toEqual([ids[0], ids[1], ids[2]])
    expect(state.selectedId).toBe(ids[2])
    expect(state.selectionAnchorId).toBe(ids[0])
  })

  it('keeps extending from the same anchor, however many times it is used', () => {
    const ids = addWaits(4)
    useStore.getState().select(ids[1])
    useStore.getState().extendSelection(ids, ids[3])
    useStore.getState().extendSelection(ids, ids[2])

    const state = useStore.getState()
    expect(state.selectedIds).toEqual([ids[1], ids[2]])
    expect(state.selectionAnchorId).toBe(ids[1])
  })

  it('extends backwards as readily as forwards', () => {
    const ids = addWaits(4)
    useStore.getState().select(ids[3])
    useStore.getState().extendSelection(ids, ids[1])

    expect(useStore.getState().selectedIds).toEqual([ids[1], ids[2], ids[3]])
  })

  it('cmd-click adds a cue to the set and moves the anchor to it', () => {
    const ids = addWaits(3)
    useStore.getState().select(ids[0])
    useStore.getState().toggleSelected(ids[2])

    const state = useStore.getState()
    expect(state.selectedIds).toEqual([ids[0], ids[2]])
    expect(state.selectedId).toBe(ids[2])
    expect(state.selectionAnchorId).toBe(ids[2])
  })

  it('cmd-click takes a cue out of the set, and the hand with it', () => {
    const ids = addWaits(3)
    useStore.getState().select(ids[0])
    useStore.getState().toggleSelected(ids[1])
    useStore.getState().toggleSelected(ids[1])

    const state = useStore.getState()
    expect(state.selectedIds).toEqual([ids[0]])
    expect(state.selectedId).toBe(ids[0])
  })

  it('ignores an order that does not hold the cue, rather than selecting nothing', () => {
    const ids = addWaits(2)
    useStore.getState().select(ids[0])
    useStore.getState().extendSelection(ids, 'not-a-cue')

    expect(useStore.getState().selectedIds).toEqual([ids[0]])
    expect(useStore.getState().selectedId).toBe(ids[0])
  })

  it('re-anchors when the anchor is not in the order the click came from', () => {
    // The order is what the list draws, so a collapsed group's child is not in it: an
    // anchor left on that child would make every later shift-click a plain selection,
    // because there is no run of the list between the two.
    const ids = addWaits(3)
    useStore.getState().select(ids[1])
    useStore.getState().extendSelection([ids[0], ids[2]], ids[2])

    const state = useStore.getState()
    expect(state.selectedIds).toEqual([ids[2]])
    expect(state.selectionAnchorId).toBe(ids[2])

    // And the next shift-click extends from there.
    useStore.getState().extendSelection([ids[0], ids[1], ids[2]], ids[0])
    expect(useStore.getState().selectedIds).toEqual([ids[0], ids[1], ids[2]])
  })
})

describe('store — batch edits', () => {
  beforeEach(resetStore)

  it('writes one patch across the set, as one edit and one undo', () => {
    useStore.getState().addCue('wait')
    useStore.getState().addCue('wait')
    useStore.getState().addCue('wait')
    const ids = useStore.getState().cues.map(cue => cue.id)
    useStore.setState({ past: [] })

    useStore.getState().updateCues(ids, { colorLabel: 'red' })

    expect(useStore.getState().cues.map(cue => cue.colorLabel)).toEqual(['red', 'red', 'red'])
    expect(useStore.getState().isDirty).toBe(true)
    expect(useStore.getState().past).toHaveLength(1)

    // One undo takes the colour off all three: the set was one thing the operator did.
    useStore.getState().undo()
    expect(useStore.getState().cues.map(cue => cue.colorLabel)).toEqual(['none', 'none', 'none'])
  })

  it('removes a set, each cue with its subtree, as one edit', () => {
    useStore.getState().addCue('group')
    const groupId = useStore.getState().cues[0].id
    useStore.getState().addCue('group', groupId)
    const innerId = useStore.getState().cues[1].id
    useStore.getState().addCue('wait', innerId)
    useStore.getState().addCue('wait')
    const outsideId = useStore.getState().cues[3].id
    useStore.setState({ past: [] })

    useStore.getState().removeCues([groupId])

    // The group, the group inside it and the wait inside that; not the cue outside.
    expect(useStore.getState().cues.map(cue => cue.id)).toEqual([outsideId])
    expect(useStore.getState().past).toHaveLength(1)

    useStore.getState().undo()
    expect(useStore.getState().cues).toHaveLength(4)
  })

  it('hands the selection to what is left of it when the active cue is removed', () => {
    useStore.getState().addCue('wait')
    useStore.getState().addCue('wait')
    const ids = useStore.getState().cues.map(cue => cue.id)
    useStore.getState().setSelection(ids, ids[0], ids[0])

    useStore.getState().removeCues([ids[0]])

    expect(useStore.getState().selectedIds).toEqual([ids[1]])
    expect(useStore.getState().selectedId).toBe(ids[1])
  })

  it('duplicates a set as one edit, and selects the copies', () => {
    useStore.getState().addCue('wait')
    useStore.getState().addCue('wait')
    const ids = useStore.getState().cues.map(cue => cue.id)
    const numbers = useStore.getState().cues.map(cue => cue.number)
    const before = useStore.getState().past.length

    useStore.getState().duplicateCues(ids)

    const cues = useStore.getState().cues
    expect(cues).toHaveLength(4)
    // Each copy follows its original, and says it is a copy of it.
    expect(cues.map(cue => cue.number)).toEqual([
      numbers[0], `${numbers[0]} copy`, numbers[1], `${numbers[1]} copy`
    ])
    expect(useStore.getState().selectedIds).toEqual([cues[1].id, cues[3].id])
    expect(useStore.getState().selectedId).toBe(cues[3].id)
    expect(useStore.getState().past).toHaveLength(before + 1)
  })

  it('prunes the selection when an undo takes the copies away', () => {
    useStore.getState().addCue('wait')
    const id = useStore.getState().cues[0].id
    useStore.getState().duplicateCues([id])
    expect(useStore.getState().selectedIds).toHaveLength(1)

    useStore.getState().undo()

    // The copy is gone, so the selection is not left naming it.
    expect(useStore.getState().selectedIds).toEqual([])
    expect(useStore.getState().selectedId).toBeNull()
  })
})

describe('store — audit 2026-09', () => {
  beforeEach(resetStore)

  it('keeps an unrelated cue alone when a boundary moves on another file', () => {
    useStore.getState().addAudioCuesFromFiles([{ filePath: '/a.wav', name: 'A' }])
    useStore.getState().addAudioCuesFromFiles([{ filePath: '/b.wav', name: 'B' }])
    const [a, b] = useStore.getState().cues as AudioCue[]
    // The pair the boundary would otherwise find: B starts where A ends, but on another file.
    useStore.getState().updateCue(a.id, { duration: 10000, endTime: 7000 } as never)
    useStore.getState().updateCue(b.id, { duration: 10000, startTime: 7000 } as never)

    useStore.getState().setRegionBoundary(a.id, 'end', 5000)

    const after = useStore.getState().cues as AudioCue[]
    expect(after[0].endTime).toBe(5000)
    expect(after[1].startTime).toBe(7000)
  })

  it('moves a split pair together on the same file', () => {
    useStore.getState().addAudioCuesFromFiles([{ filePath: '/a.wav', name: 'A' }])
    const [a] = useStore.getState().cues as AudioCue[]
    useStore.getState().updateCue(a.id, { duration: 10000, endTime: 7000 } as never)
    useStore.getState().splitAudioCueAt(a.id, 5000)
    const [, tail] = useStore.getState().cues as AudioCue[]

    useStore.getState().setRegionBoundary(tail.id, 'start', 4000)

    const after = useStore.getState().cues as AudioCue[]
    expect(after[0].endTime).toBe(4000)
    expect(after[1].startTime).toBe(4000)
  })

  it('inserts past a nested subtree, and duplicates a nested group whole', () => {
    useStore.getState().addCue('group')
    const outer = useStore.getState().cues[0].id
    useStore.getState().addCue('group', outer)
    const inner = useStore.getState().cues[1].id
    useStore.getState().addCue('wait', inner)
    const grandchild = useStore.getState().cues[2].id
    useStore.getState().addCue('wait', outer)
    const own = useStore.getState().cues[3].id

    // Inserting after the outer header joins it as its last child — past the nested
    // group and its own cue, not between the nested header and its child.
    useStore.getState().addCue('wait', outer)
    const cues = useStore.getState().cues
    expect(cues.map(cue => cue.id)).toEqual([outer, inner, grandchild, own, cues[4].id])
    expect(cues[4].parentId).toBe(outer)

    useStore.getState().duplicateCues([inner])
    const doubled = useStore.getState().cues
    const copyHeader = doubled.find(cue => cue.parentId === outer && cue.number.endsWith('copy'))
    expect(copyHeader?.type).toBe('group')
    const copyChildren = doubled.filter(cue => cue.parentId === copyHeader!.id)
    expect(copyChildren).toHaveLength(1)
  })

  it('keeps both copies when a group and its last child are duplicated together', () => {
    useStore.getState().addCue('group')
    const group = useStore.getState().cues[0].id
    useStore.getState().addCue('wait', group)
    const child = useStore.getState().cues[1].id

    useStore.getState().duplicateCues([group, child])

    const cues = useStore.getState().cues
    const groupCopies = cues.filter(cue => cue.type === 'group' && cue.number.endsWith('copy'))
    expect(groupCopies).toHaveLength(1)
    const childCopies = cues.filter(cue => cue.parentId === groupCopies[0].id)
    expect(childCopies).toHaveLength(1)
  })

  it('marks an undo after a save dirty again', () => {
    useStore.getState().addCue('wait')
    useStore.getState().saveSucceeded('/shows/hamlet.cuerunner', 'Hamlet', [])
    expect(useStore.getState().isDirty).toBe(false)

    useStore.getState().undo()
    expect(useStore.getState().isDirty).toBe(true)

    useStore.getState().saveSucceeded('/shows/hamlet.cuerunner', 'Hamlet', [])
    useStore.getState().redo()
    expect(useStore.getState().isDirty).toBe(true)
  })
})

describe('store — collapsed groups', () => {
  beforeEach(resetStore)

  /** A group holding a group holding a wait, plus a wait of the outer group's own. */
  function nestedGroups(): { outer: string; inner: string } {
    useStore.getState().addCue('group')
    const outer = useStore.getState().cues[0].id
    useStore.getState().addCue('group', outer)
    const inner = useStore.getState().cues[1].id
    useStore.getState().addCue('wait', inner)
    useStore.getState().addCue('wait', outer)
    return { outer, inner }
  }

  it('toggles one group open and closed', () => {
    const { inner } = nestedGroups()
    useStore.getState().toggleGroup(inner)
    expect(useStore.getState().collapsedGroupIds.has(inner)).toBe(true)

    useStore.getState().toggleGroup(inner)
    expect(useStore.getState().collapsedGroupIds.has(inner)).toBe(false)
  })

  it('expands the top level and leaves the nested groups as they were', () => {
    const { outer, inner } = nestedGroups()
    useStore.getState().toggleGroup(outer)
    useStore.getState().toggleGroup(inner)

    useStore.getState().expandTopLevel()

    // The outer group opened; the one inside it is still folded away, because that was
    // somebody's decision rather than an accident of the top level being closed.
    const collapsed = useStore.getState().collapsedGroupIds
    expect(collapsed.has(outer)).toBe(false)
    expect(collapsed.has(inner)).toBe(true)
  })

  it('collapses everything — there is no partial reading of collapse', () => {
    const { outer, inner } = nestedGroups()

    useStore.getState().collapseAll()

    const collapsed = useStore.getState().collapsedGroupIds
    expect(collapsed.has(outer)).toBe(true)
    expect(collapsed.has(inner)).toBe(true)
  })

  it('leaves no group collapsed in the next workspace', () => {
    nestedGroups()
    useStore.getState().collapseAll()
    expect(useStore.getState().collapsedGroupIds.size).toBeGreaterThan(0)

    useStore.getState().loadWorkspace([], 'Next show', null)

    expect(useStore.getState().collapsedGroupIds.size).toBe(0)
  })
})

describe('store — settings', () => {
  beforeEach(() => {
    useStore.setState({
      audioSettings: { outputDeviceId: 'default' },
      midiSettings: { outputPortName: '' },
    })
  })

  it('updateAudioSettings applies the patch to audioSettings', () => {
    useStore.getState().updateAudioSettings({ outputDeviceId: 'device-123' })
    expect(useStore.getState().audioSettings).toEqual({ outputDeviceId: 'device-123' })
  })

  it('updateMidiSettings applies the patch to midiSettings', () => {
    useStore.getState().updateMidiSettings({ outputPortName: 'IAC Driver Bus 1' })
    expect(useStore.getState().midiSettings).toEqual({ outputPortName: 'IAC Driver Bus 1' })
  })

  it('updateAudioSettings marks workspace dirty', () => {
    useStore.setState({ isDirty: false })
    useStore.getState().updateAudioSettings({ outputDeviceId: 'x' })
    expect(useStore.getState().isDirty).toBe(true)
  })

  it('loadWorkspace restores audioSettings when provided', () => {
    const audioSettings = { outputDeviceId: 'hw-1' }
    const midiSettings = { outputPortName: 'Port A' }
    useStore.getState().loadWorkspace([], 'Test', null, audioSettings, midiSettings)
    expect(useStore.getState().audioSettings).toEqual(audioSettings)
    expect(useStore.getState().midiSettings).toEqual(midiSettings)
  })

  it('loadWorkspace falls back to defaults when settings are omitted', () => {
    useStore.getState().loadWorkspace([], 'Test', null)
    expect(useStore.getState().audioSettings).toEqual({ outputDeviceId: 'default' })
    expect(useStore.getState().midiSettings).toEqual({ outputPortName: '' })
  })
})

describe('store — undo/redo', () => {
  beforeEach(() => {
    useStore.setState({ cues: [], selectedId: null, running: new Map(), past: [], future: [] })
  })

  it('undo after addCue restores the empty list', () => {
    useStore.getState().addCue('wait')
    expect(useStore.getState().cues).toHaveLength(1)
    useStore.getState().undo()
    expect(useStore.getState().cues).toHaveLength(0)
  })

  it('undo after removeCue restores the cue', () => {
    useStore.getState().addCue('wait')
    const id = useStore.getState().cues[0].id
    useStore.getState().removeCues([id])
    expect(useStore.getState().cues).toHaveLength(0)
    useStore.getState().undo()
    expect(useStore.getState().cues).toHaveLength(1)
  })

  it('undo after duplicateCue removes the copy', () => {
    useStore.getState().addCue('wait')
    const id = useStore.getState().cues[0].id
    useStore.getState().duplicateCues([id])
    expect(useStore.getState().cues).toHaveLength(2)
    useStore.getState().undo()
    expect(useStore.getState().cues).toHaveLength(1)
    expect(useStore.getState().cues[0].id).toBe(id)
  })

  it('undo is a no-op when history is empty', () => {
    useStore.getState().undo()
    expect(useStore.getState().cues).toHaveLength(0)
  })

  it('redo restores the state that was undone', () => {
    useStore.getState().addCue('wait')
    useStore.getState().undo()
    expect(useStore.getState().cues).toHaveLength(0)
    useStore.getState().redo()
    expect(useStore.getState().cues).toHaveLength(1)
  })

  it('redo is a no-op when future is empty', () => {
    useStore.getState().addCue('wait')
    useStore.getState().redo() // no-op
    expect(useStore.getState().cues).toHaveLength(1)
  })

  it('new mutation clears redo stack', () => {
    useStore.getState().addCue('wait')
    useStore.getState().undo()
    useStore.getState().addCue('audio') // new action after undo
    expect(useStore.getState().future).toHaveLength(0)
    // redo should be a no-op
    useStore.getState().redo()
    expect(useStore.getState().cues).toHaveLength(1)
    expect(useStore.getState().cues[0].type).toBe('audio')
  })

  it('multiple undos step back through history', () => {
    useStore.getState().addCue('wait')
    useStore.getState().addCue('audio')
    useStore.getState().addCue('midi')
    expect(useStore.getState().cues).toHaveLength(3)
    useStore.getState().undo()
    expect(useStore.getState().cues).toHaveLength(2)
    useStore.getState().undo()
    expect(useStore.getState().cues).toHaveLength(1)
    useStore.getState().undo()
    expect(useStore.getState().cues).toHaveLength(0)
  })

  it('updateCue coalesces rapid calls for the same cue into one history entry', () => {
    useStore.getState().addCue('wait')
    const id = useStore.getState().cues[0].id
    const originalName = useStore.getState().cues[0].name

    // First call records history; rapid follow-ups do not
    useStore.getState().updateCue(id, { name: 'A' })
    useStore.getState().updateCue(id, { name: 'AB' })
    useStore.getState().updateCue(id, { name: 'ABC' })

    // One undo should restore state before 'A' was set
    useStore.getState().undo()
    expect(useStore.getState().cues[0].name).toBe(originalName)
  })

  it('updateCue records separate history for different cues', () => {
    useStore.getState().addCue('wait')
    useStore.getState().addCue('audio')
    const [c1, c2] = useStore.getState().cues

    useStore.getState().updateCue(c1.id, { name: 'First' })
    useStore.getState().updateCue(c2.id, { name: 'Second' }) // different cue → new entry

    useStore.getState().undo()
    expect(useStore.getState().cues.find(c => c.id === c2.id)?.name).not.toBe('Second')
    expect(useStore.getState().cues.find(c => c.id === c1.id)?.name).toBe('First')
  })

  it('undo after removing an ensemble brings it back with the rows that held it', () => {
    const chorus: Ensemble = { id: 'ens-1', name: 'Chorus', channelIds: ['ch-1'] }
    const holding: MicScene = {
      ...NUMBER,
      dcas: [
        { dcaId: 'dca-1', kind: 'ensemble', memberId: 'ens-1' },
        { dcaId: 'dca-2', kind: 'channel', memberId: 'ch-1' }
      ]
    }
    const alsoHolding: MicScene = {
      id: 's2',
      name: 'Finale',
      dcas: [{ dcaId: 'dca-2', kind: 'ensemble', memberId: 'ens-1' }],
      notes: ''
    }
    const defaults = defaultShowSettings()
    useStore.setState({
      showSettings: {
        ...defaults,
        scenes: { ...defaults.scenes, list: [holding, alsoHolding] },
        cast: castWith({
          ensembles: [chorus],
          dcas: [DCA, { id: 'dca-2', deskNumber: null }]
        })
      },
      isDirty: false
    })
    const past = useStore.getState().past.length

    useStore.getState().removeEnsemble(chorus.id)

    // The ensemble goes and every row that held it goes with it, in the same edit: a row
    // pointing at an ensemble that is gone is a group of mics nobody can move from the
    // grid again. A row holding a strip says nothing about the group and stays.
    const settings = useStore.getState().showSettings
    expect(settings.cast.ensembles).toEqual([])
    // The members keep existing: the group is a grouping and nothing else.
    expect(settings.cast.performers).toEqual([ROUTED_PERFORMER])
    expect(settings.scenes.list[0].dcas).toEqual([
      { dcaId: 'dca-2', kind: 'channel', memberId: 'ch-1' }
    ])
    expect(settings.scenes.list[1].dcas).toEqual([])
    expect(useStore.getState().past).toHaveLength(past + 1)
    expect(useStore.getState().isDirty).toBe(true)

    // One undo, rather than half of the edit and then the other half.
    useStore.getState().undo()
    expect(useStore.getState().showSettings.cast.ensembles.map(ensemble => ensemble.id))
      .toEqual([chorus.id])
    expect(useStore.getState().showSettings.scenes.list[0].dcas).toEqual(holding.dcas)
    expect(useStore.getState().showSettings.scenes.list[1].dcas).toEqual(alsoHolding.dcas)
  })

  it('undo after resizing the DCAs puts the list back with the rows that named it', () => {
    // One rule for both counts: a fader that leaves the show takes every scene's row for
    // its place with it, in the same edit — so no scene names a place that is gone, and one
    // undo puts the faders and the rows back together.
    const defaults = defaultShowSettings()
    useStore.setState({
      showSettings: { ...defaults, cast: castWith(), scenes: { ...defaults.scenes, list: [NUMBER] } }
    })

    const cast = useStore.getState().showSettings.cast
    useStore.getState().setDcaCount(0)

    expect(useStore.getState().showSettings.cast.dcas).toEqual([])
    expect(useStore.getState().showSettings.cast.channels).toEqual(cast.channels)
    expect(useStore.getState().showSettings.scenes.list[0].dcas).toEqual([])

    useStore.getState().undo()
    expect(useStore.getState().showSettings.cast.dcas).toEqual([DCA])
    expect(useStore.getState().showSettings.cast.channels).toEqual(cast.channels)
    expect(useStore.getState().showSettings.scenes.list[0].dcas).toEqual(NUMBER.dcas)
  })

  it('a fader grown back after a shrink is a new place, and comes back empty', () => {
    // The row left behind would name an id nothing mints again, so a placement no row reads
    // is not kept for a revival that can never happen.
    const defaults = defaultShowSettings()
    useStore.setState({
      showSettings: { ...defaults, cast: castWith(), scenes: { ...defaults.scenes, list: [NUMBER] } }
    })

    useStore.getState().setDcaCount(0)
    useStore.getState().setDcaCount(1)

    expect(useStore.getState().showSettings.cast.dcas).toHaveLength(1)
    expect(useStore.getState().showSettings.scenes.list[0].dcas).toEqual([])
  })

  it('a strip’s shrink leaves every scene and patch that named it, as one edit', () => {
    // The count is the show's set of strips, and a strip that goes takes its placements and
    // its mic with it — one history entry, because the halves of that are one decision.
    const defaults = defaultShowSettings()
    useStore.setState({
      showSettings: {
        ...defaults,
        cast: castWith({ channels: [CHANNEL, { id: 'ch-2', name: 'Bea' }] }),
        scenes: {
          ...defaults.scenes,
          list: [
            NUMBER,
            { id: 's2', name: 'Bows again', dcas: [{ dcaId: 'dca-1', kind: 'channel', memberId: 'ch-2' }], notes: '' }
          ]
        }
      },
      isDirty: false
    })
    const before = useStore.getState().past.length

    useStore.getState().setChannelCount(1)

    const settings = useStore.getState().showSettings
    expect(settings.cast.channels.map(channel => channel.id)).toEqual(['ch-1'])
    expect(settings.cast.performers[0].channelId).toBe('ch-1')
    // The row whose only content was the strip that went is gone; the other one stays.
    expect(settings.scenes.list[0].dcas).toEqual(NUMBER.dcas)
    expect(settings.scenes.list[1].dcas).toEqual([])
    expect(useStore.getState().past).toHaveLength(before + 1)
    expect(useStore.getState().isDirty).toBe(true)

    useStore.getState().undo()
    const back = useStore.getState().showSettings
    expect(back.cast.channels.map(channel => channel.name)).toEqual(['Ada', 'Bea'])
    expect(back.cast.performers[0].channelId).toBe('ch-1')
    expect(back.scenes.list[1].dcas).toEqual([{ dcaId: 'dca-1', kind: 'channel', memberId: 'ch-2' }])
  })

  it('a count grown appends strips and leaves every scene and patch alone', () => {
    const defaults = defaultShowSettings()
    useStore.setState({
      showSettings: { ...defaults, cast: castWith(), scenes: { ...defaults.scenes, list: [NUMBER] } }
    })
    const scenes = useStore.getState().showSettings.scenes

    useStore.getState().setChannelCount(3)

    const settings = useStore.getState().showSettings
    expect(settings.cast.channels).toHaveLength(3)
    expect(settings.cast.channels[0]).toEqual(CHANNEL)
    expect(settings.cast.performers[0].channelId).toBe('ch-1')
    // Nothing was dropped, so the scene list is not even a new object.
    expect(settings.scenes).toBe(scenes)
  })

  it('a count re-chosen at its own value is not an edit at all', () => {
    const defaults = defaultShowSettings()
    useStore.setState({
      showSettings: { ...defaults, cast: castWith(), scenes: { ...defaults.scenes, list: [NUMBER] } },
      isDirty: false
    })
    const settings = useStore.getState().showSettings
    const before = useStore.getState().past.length

    useStore.getState().setChannelCount(1)
    useStore.getState().setDcaCount(1)

    expect(useStore.getState().showSettings).toBe(settings)
    expect(useStore.getState().past).toHaveLength(before)
    expect(useStore.getState().isDirty).toBe(false)
  })

  it('a show past the dial’s cap keeps every strip when its own count is chosen', () => {
    // The count the dial offers a 99-strip show is 99. Taking it must not trim the show,
    // its placements or its patches — the cap is what growth is asked for, not a size the
    // show is held to.
    const defaults = defaultShowSettings()
    const channels = startingChannels().concat(
      Array.from({ length: 87 }, (_, index) => ({ id: `extra-${index + 1}`, name: '' })))
    useStore.setState({
      showSettings: {
        ...defaults,
        cast: castWith({ channels }),
        scenes: {
          ...defaults.scenes,
          list: [{ id: 's1', name: 'Bows', dcas: [{ dcaId: 'dca-1', kind: 'channel', memberId: 'ch-1' }], notes: '' }]
        }
      },
      isDirty: false
    })
    const before = useStore.getState().past.length

    useStore.getState().setChannelCount(channels.length)

    expect(useStore.getState().showSettings.cast.channels).toHaveLength(channels.length)
    expect(useStore.getState().showSettings.cast.performers[0].channelId).toBe('ch-1')
    expect(useStore.getState().showSettings.scenes.list[0].dcas)
      .toEqual([{ dcaId: 'dca-1', kind: 'channel', memberId: 'ch-1' }])
    expect(useStore.getState().past).toHaveLength(before)
    expect(useStore.getState().isDirty).toBe(false)
  })

  it('undo after pointing the show at another desk puts the address back', () => {
    useStore.setState({ showSettings: defaultShowSettings() })

    useStore.getState().updateDeskSettings({ host: '10.0.0.5', port: 9000 })

    expect(useStore.getState().showSettings.desk).toMatchObject({ host: '10.0.0.5', port: 9000 })

    useStore.getState().undo()
    expect(useStore.getState().showSettings.desk).toMatchObject({ host: '127.0.0.1', port: 8000 })
  })

  it('makes a group out of strips nobody is standing on, because a group holds strips', () => {
    // A rack of playback channels has no cast at all, and grouping it is the whole point of
    // a group being a set of faders rather than a set of people.
    const defaults = defaultShowSettings()
    useStore.setState({
      showSettings: {
        ...defaults,
        scenes: { ...defaults.scenes, list: [NUMBER] },
        cast: { ...castWith(), performers: [] }
      }
    })

    useStore.getState().saveEnsembleOnRow(NUMBER.id, 'dca-1', null, 'Playback', ['ch-1'])

    const settings = useStore.getState().showSettings
    expect(settings.cast.ensembles).toEqual([
      { id: settings.cast.ensembles[0].id, name: 'Playback', channelIds: ['ch-1'] }
    ])
    expect(settings.scenes.list[0].dcas).toEqual([
      { dcaId: 'dca-1', kind: 'ensemble', memberId: settings.cast.ensembles[0].id }
    ])
  })

  it('makes no group out of nothing at all', () => {
    // An empty group is a row holding a block that stands for nothing, so the press that
    // would make one writes nothing rather than landing as a shell.
    const defaults = defaultShowSettings()
    useStore.setState({
      showSettings: { ...defaults, scenes: { ...defaults.scenes, list: [NUMBER] }, cast: castWith() },
      isDirty: false
    })
    const before = useStore.getState().showSettings
    const past = useStore.getState().past.length

    useStore.getState().saveEnsembleOnRow(NUMBER.id, 'dca-1', null, 'Chorus', [])

    expect(useStore.getState().showSettings).toBe(before)
    expect(useStore.getState().past).toHaveLength(past)
    expect(useStore.getState().isDirty).toBe(false)
  })

  it('makes the group the builder was given, named as it was named, and puts it on the row', () => {
    const defaults = defaultShowSettings()
    useStore.setState({
      showSettings: { ...defaults, scenes: { ...defaults.scenes, list: [NUMBER] }, cast: castWith() },
      isDirty: false
    })
    const past = useStore.getState().past.length

    useStore.getState().saveEnsembleOnRow(NUMBER.id, 'dca-1', null, 'Chorus', ['ch-1'])

    const settings = useStore.getState().showSettings
    expect(settings.cast.ensembles).toHaveLength(1)
    expect(settings.cast.ensembles[0].name).toBe('Chorus')
    // The group holds the strip the builder picked, and the row carries the group now rather
    // than naming the strip by hand — the same strip rides, so a regrouping is not a
    // re-routing.
    expect(settings.cast.ensembles[0].channelIds).toEqual(['ch-1'])
    expect(settings.scenes.list[0].dcas).toEqual([
      { dcaId: 'dca-1', kind: 'ensemble', memberId: settings.cast.ensembles[0].id }
    ])
    expect(rowChannels(settings.cast, settings.scenes.list[0].dcas[0])).toEqual(['ch-1'])
    // The grouping and the row it was opened from are one edit: one undo takes both back.
    expect(useStore.getState().past).toHaveLength(past + 1)
    expect(useStore.getState().isDirty).toBe(true)

    useStore.getState().undo()
    expect(useStore.getState().showSettings.cast.ensembles).toEqual([])
    expect(useStore.getState().showSettings.scenes.list[0].dcas).toEqual(NUMBER.dcas)
  })

  it('names a group it was given no name for after the ones already there', () => {
    const defaults = defaultShowSettings()
    useStore.setState({
      showSettings: { ...defaults, scenes: { ...defaults.scenes, list: [NUMBER] }, cast: castWith() }
    })

    useStore.getState().saveEnsembleOnRow(NUMBER.id, 'dca-1', null, '', ['ch-1'])

    expect(useStore.getState().showSettings.cast.ensembles[0].name).toBe('Ensemble 1')
  })

  it('keeps a name it was not given, so saving a group never empties the block it draws', () => {
    // The builder hands over every keystroke, so a cleared field is a blank name — and a
    // block with no name draws nothing while the row still opens the group's mics. An edit
    // keeps the name it had; a new group takes the cast's own default.
    const leads: Ensemble = { id: 'ens-1', name: 'Leads', channelIds: ['ch-1'] }
    const scene: MicScene = {
      id: 's1',
      name: 'Opening',
      dcas: [{ dcaId: 'dca-1', kind: 'ensemble', memberId: 'ens-1' }],
      notes: ''
    }
    const defaults = defaultShowSettings()
    useStore.setState({
      showSettings: {
        ...defaults,
        cast: castWith({ ensembles: [leads] }),
        scenes: { ...defaults.scenes, list: [scene] }
      }
    })

    useStore.getState().saveEnsembleOnRow(scene.id, 'dca-1', leads.id, '   ', ['ch-1'])

    expect(useStore.getState().showSettings.cast.ensembles[0].name).toBe('Leads')
  })

  it('edits a group in place, so every row that holds it carries the new membership', () => {
    // The group is the cast's, not the row's: a save from one scene's row renames and
    // refills the group itself, and a row of another scene that holds it carries what the
    // group now holds without being edited at all.
    const leads: Ensemble = { id: 'ens-1', name: 'Leads', channelIds: ['ch-1'] }
    const BEA = { id: 'ch-2', name: 'Bea' }
    const BEA_PERFORMER: Performer = {
      id: 'p2',
      name: 'Bea',
      role: 'chorus',
      notes: '',
      channelId: 'ch-2'
    }
    const opening: MicScene = { id: 's1', name: 'Opening', dcas: [], notes: '' }
    const finale: MicScene = {
      id: 's2',
      name: 'Finale',
      dcas: [{ dcaId: 'dca-1', kind: 'ensemble', memberId: 'ens-1' }],
      notes: ''
    }
    const defaults = defaultShowSettings()
    useStore.setState({
      showSettings: {
        ...defaults,
        cast: castWith({
          channels: [CHANNEL, BEA],
          performers: [ROUTED_PERFORMER, BEA_PERFORMER],
          ensembles: [leads]
        }),
        scenes: { ...defaults.scenes, list: [opening, finale] }
      },
      isDirty: false
    })
    const past = useStore.getState().past.length

    useStore.getState().saveEnsembleOnRow(opening.id, 'dca-1', leads.id, 'Chorus', ['ch-2'])

    const settings = useStore.getState().showSettings
    expect(settings.cast.ensembles).toEqual([{ id: 'ens-1', name: 'Chorus', channelIds: ['ch-2'] }])
    // The row the builder was opened from holds the group now…
    expect(settings.scenes.list[0].dcas).toEqual([
      { dcaId: 'dca-1', kind: 'ensemble', memberId: 'ens-1' }
    ])
    // …and the row that already held it is not rewritten — it reads the group's membership,
    // which is the whole of what a row holding an ensemble says.
    expect(settings.scenes.list[1].dcas).toEqual([
      { dcaId: 'dca-1', kind: 'ensemble', memberId: 'ens-1' }
    ])
    expect(rowChannels(settings.cast, settings.scenes.list[0].dcas[0])).toEqual(['ch-2'])
    expect(rowChannels(settings.cast, settings.scenes.list[1].dcas[0])).toEqual(['ch-2'])
    expect(useStore.getState().past).toHaveLength(past + 1)
    expect(useStore.getState().isDirty).toBe(true)

    useStore.getState().undo()
    expect(useStore.getState().showSettings.cast.ensembles).toEqual([leads])
    expect(useStore.getState().showSettings.scenes.list[0].dcas).toEqual([])
    expect(useStore.getState().showSettings.scenes.list[1].dcas).toEqual([
      { dcaId: 'dca-1', kind: 'ensemble', memberId: 'ens-1' }
    ])
  })

  it('undo after deleting a scene restores it with its placements', () => {
    const defaults = defaultShowSettings()
    useStore.setState({
      showSettings: { ...defaults, scenes: { ...defaults.scenes, list: [NUMBER] } }
    })

    useStore.getState().updateScenesSettings({ list: [] })
    expect(useStore.getState().showSettings.scenes.list).toEqual([])

    useStore.getState().undo()
    expect(useStore.getState().showSettings.scenes.list).toEqual([NUMBER])
  })

  it('records a placement as one edit, restores it on undo, and marks the show dirty', () => {
    // The grid's cell edits the list and nothing else, so a click that places a strip is
    // one history entry — and one undo puts the row back exactly as it was.
    const defaults = defaultShowSettings()
    useStore.setState({
      showSettings: {
        ...defaults,
        cast: castWith(),
        scenes: { ...defaults.scenes, list: [{ ...NUMBER, dcas: [] }] }
      },
      isDirty: false
    })
    const before = useStore.getState().past.length
    const scenes = useStore.getState().showSettings.scenes

    useStore.getState().updateScenesSettings({
      list: setRowMember(scenes, NUMBER.id, 'dca-1', { kind: 'channel', memberId: 'ch-1' }).list
    })

    expect(useStore.getState().showSettings.scenes.list[0].dcas).toEqual([
      { dcaId: 'dca-1', kind: 'channel', memberId: 'ch-1' }
    ])
    expect(useStore.getState().past).toHaveLength(before + 1)
    expect(useStore.getState().isDirty).toBe(true)

    useStore.getState().undo()
    expect(useStore.getState().showSettings.scenes.list[0].dcas).toEqual([])
  })

  it('takes a strip out of the cast and out of every scene as one edit', () => {
    // Two settings sections, one history entry: a placement naming a channel that is gone
    // is a cell nobody can read again.
    const defaults = defaultShowSettings()
    useStore.setState({
      showSettings: { ...defaults, cast: castWith(), scenes: { ...defaults.scenes, list: [NUMBER] } }
    })
    const before = useStore.getState().past.length

    useStore.getState().removeChannel('ch-1')

    expect(useStore.getState().showSettings.cast.channels).toEqual([])
    expect(useStore.getState().showSettings.cast.performers[0].channelId).toBeNull()
    expect(useStore.getState().showSettings.scenes.list[0].dcas).toEqual([])
    expect(useStore.getState().past).toHaveLength(before + 1)

    useStore.getState().undo()
    expect(useStore.getState().showSettings.cast.channels).toEqual([CHANNEL])
    expect(useStore.getState().showSettings.cast.performers[0].channelId).toBe('ch-1')
    expect(useStore.getState().showSettings.scenes.list[0].dcas).toEqual([
      { dcaId: 'dca-1', kind: 'channel', memberId: 'ch-1' }
    ])
  })

  it('forgets what the desk was told about a strip the show no longer has', () => {
    // The record is what Cuerunner was last told it wrote, per channel. A strip the show
    // does not have is not one a recall can write, so its entries are facts about nothing —
    // and left behind they would be read as facts about the *next* strip to carry that id,
    // a count re-grown or a show merged in.
    const defaults = defaultShowSettings()
    useStore.setState({
      showSettings: { ...defaults, cast: castWith(), scenes: defaults.scenes },
      deskState: { mutes: { 'ch-1': true, 'ch-2': false }, assignments: { 'ch-1': ['dca-1'] } }
    })

    useStore.getState().removeChannel('ch-1')

    expect(useStore.getState().deskState).toEqual({ mutes: { 'ch-2': false }, assignments: {} })
  })

  it('forgets the strips a fader count dropped, and keeps the rest of the record', () => {
    const defaults = defaultShowSettings()
    useStore.setState({
      showSettings: { ...defaults, cast: castWith(), scenes: defaults.scenes },
      deskState: { mutes: { 'ch-1': true }, assignments: { 'ch-1': ['dca-1'] } }
    })

    useStore.getState().setDcaCount(0)

    // The channel keeps its own entry with an empty list: what it was last written onto is
    // the faders that are left, and none are. An absent entry would say the desk's state
    // was never told — which the next recall would rewrite, for a place that is gone.
    expect(useStore.getState().deskState).toEqual({ mutes: { 'ch-1': true }, assignments: { 'ch-1': [] } })
  })

  it('takes a departed fader out of what each channel was written onto, and nothing else', () => {
    // The channel keeps its own entry: an empty list is a fact too — the desk was told it
    // rides nothing — and a fader that is gone cannot be one of the places it rides.
    const defaults = defaultShowSettings()
    useStore.setState({
      showSettings: {
        ...defaults,
        cast: castWith({ dcas: [{ id: 'dca-1', deskNumber: null }, { id: 'dca-2', deskNumber: null }] })
      },
      deskState: {
        mutes: { 'ch-1': false },
        assignments: { 'ch-1': ['dca-1', 'dca-2'], 'ch-9': ['dca-2'] }
      }
    })

    useStore.getState().setDcaCount(1)

    expect(useStore.getState().deskState).toEqual({
      mutes: { 'ch-1': false },
      assignments: { 'ch-1': ['dca-1'], 'ch-9': [] }
    })
  })

  it('never undoes what the desk was told: the record is session state, not an edit', () => {
    // Where the desk was left is what Cuerunner last sent, and an undo puts a show back
    // rather than a desk: a record an undo could rewind would describe a desk nobody has
    // touched, and the next recall would send nothing.
    useStore.setState({
      showSettings: defaultShowSettings(),
      deskState: { mutes: { 'ch-1': true }, assignments: { 'ch-1': ['dca-1'] } },
      deskSceneId: 's1',
      isDirty: false
    })
    const before = useStore.getState().past.length

    useStore.getState().mergeDeskState({ mutes: { 'ch-1': false } }, 's2')
    expect(useStore.getState().deskState.mutes).toEqual({ 'ch-1': false })
    expect(useStore.getState().deskSceneId).toBe('s2')
    expect(useStore.getState().past).toHaveLength(before)
    expect(useStore.getState().isDirty).toBe(false)

    useStore.getState().setDeskState({ mutes: { 'ch-1': false }, assignments: {} }, null)
    useStore.getState().updateScenesSettings({ list: [] })
    useStore.getState().undo()

    expect(useStore.getState().deskState).toEqual({ mutes: { 'ch-1': false }, assignments: {} })
    expect(useStore.getState().deskSceneId).toBeNull()
  })

  it('editing the Scenes view is a mode, not an edit, and opening a show ends it', () => {
    useStore.setState({ showSettings: defaultShowSettings(), isDirty: false })
    const before = useStore.getState().past.length

    useStore.getState().setScenesEditing(true)

    expect(useStore.getState().scenesEditing).toBe(true)
    expect(useStore.getState().past).toHaveLength(before)
    expect(useStore.getState().isDirty).toBe(false)

    // A show that has just been opened is run from, not edited.
    useStore.getState().loadWorkspace([], 'Next show', null)
    expect(useStore.getState().scenesEditing).toBe(false)
  })

  it('loadWorkspace clears undo and redo stacks', () => {
    useStore.getState().addCue('wait')
    useStore.getState().addCue('audio')
    expect(useStore.getState().past.length).toBeGreaterThan(0)

    useStore.getState().loadWorkspace([], 'Fresh', null)
    expect(useStore.getState().past).toHaveLength(0)
    expect(useStore.getState().future).toHaveLength(0)
  })
})

describe('store — addAudioCuesFromFiles', () => {
  beforeEach(() => useStore.setState({ cues: [], selectedId: null, past: [], future: [] }))

  it('leaves the show alone when a drop brings no files', () => {
    useStore.getState().addCue('wait')
    const before = useStore.getState()

    // A drop of nothing is nothing: the selection helper needs a cue to point at, and
    // an empty list has none — this used to throw inside the store.
    expect(() => useStore.getState().addAudioCuesFromFiles([])).not.toThrow()
    expect(useStore.getState().cues).toBe(before.cues)
    expect(useStore.getState().isDirty).toBe(before.isDirty)
  })

  it('appends audio cues from file list at the end when no afterId', () => {
    useStore.getState().addAudioCuesFromFiles([
      { filePath: '/a.wav', name: 'Sound A' },
      { filePath: '/b.wav', name: 'Sound B' }
    ])
    const cues = useStore.getState().cues as AudioCue[]
    expect(cues).toHaveLength(2)
    expect(cues[0].type).toBe('audio')
    expect(cues[0].filePath).toBe('/a.wav')
    expect(cues[0].name).toBe('Sound A')
    expect(cues[1].filePath).toBe('/b.wav')
    expect(cues[1].name).toBe('Sound B')
  })

  it('selects the last added audio cue', () => {
    useStore.getState().addAudioCuesFromFiles([
      { filePath: '/a.wav', name: 'A' },
      { filePath: '/b.wav', name: 'B' }
    ])
    const cues = useStore.getState().cues
    expect(useStore.getState().selectedId).toBe(cues[1].id)
  })

  it('inserts after a specific cue when afterId is given', () => {
    useStore.getState().addCue('wait')
    const waitId = useStore.getState().cues[0].id
    useStore.getState().addAudioCuesFromFiles([{ filePath: '/a.wav', name: 'A' }], waitId)
    const cues = useStore.getState().cues
    expect(cues).toHaveLength(2)
    expect(cues[0].type).toBe('wait')
    expect(cues[1].type).toBe('audio')
  })

  it('inserts as child when afterId points to a group header', () => {
    useStore.getState().addCue('group')
    const groupId = useStore.getState().cues[0].id
    useStore.getState().addAudioCuesFromFiles([{ filePath: '/a.wav', name: 'A' }], groupId)
    const cues = useStore.getState().cues
    expect(cues[1].parentId).toBe(groupId)
  })

  it('inherits parentId when afterId points to a group child', () => {
    useStore.getState().addCue('group')
    const groupId = useStore.getState().cues[0].id
    useStore.getState().addCue('wait', groupId)
    const childId = useStore.getState().cues[1].id
    useStore.getState().addAudioCuesFromFiles([{ filePath: '/a.wav', name: 'A' }], childId)
    const cues = useStore.getState().cues
    expect(cues[2].parentId).toBe(groupId)
  })

  it('marks workspace dirty', () => {
    useStore.setState({ isDirty: false })
    useStore.getState().addAudioCuesFromFiles([{ filePath: '/a.wav', name: 'A' }])
    expect(useStore.getState().isDirty).toBe(true)
  })
})

describe('store — setRunning / clearAllRunning', () => {
  beforeEach(() => {
    useStore.setState({ running: new Map(), cues: [], selectedId: null })
  })

  it('setRunning adds a running cue', () => {
    useStore.getState().setRunning('c1', { cueId: 'c1', state: 'playing', startedAt: 1000, progress: 0.5 })
    const running = useStore.getState().running
    expect(running.get('c1')).toEqual({ cueId: 'c1', state: 'playing', startedAt: 1000, progress: 0.5 })
  })

  it('setRunning with null removes the running cue', () => {
    useStore.getState().setRunning('c1', { cueId: 'c1', state: 'playing', startedAt: 1000, progress: 0.5 })
    useStore.getState().setRunning('c1', null)
    expect(useStore.getState().running.has('c1')).toBe(false)
  })

  it('setRunning preserves other running cues when removing one', () => {
    useStore.getState().setRunning('c1', { cueId: 'c1', state: 'playing', startedAt: 1000, progress: 0 })
    useStore.getState().setRunning('c2', { cueId: 'c2', state: 'playing', startedAt: 2000, progress: 0 })
    useStore.getState().setRunning('c1', null)
    expect(useStore.getState().running.has('c2')).toBe(true)
    expect(useStore.getState().running.size).toBe(1)
  })

  it('clearAllRunning removes all running cues', () => {
    useStore.getState().setRunning('c1', { cueId: 'c1', state: 'playing', startedAt: 1000, progress: 0 })
    useStore.getState().setRunning('c2', { cueId: 'c2', state: 'playing', startedAt: 2000, progress: 0 })
    useStore.getState().clearAllRunning()
    expect(useStore.getState().running.size).toBe(0)
  })

  it('clearAllRunning on empty map is a no-op', () => {
    useStore.getState().clearAllRunning()
    expect(useStore.getState().running.size).toBe(0)
  })
})

describe('store — mediaLengths', () => {
  beforeEach(resetStore)

  it('records an answer against its cue, and forgets one when asked to', () => {
    useStore.getState().setMediaLengths({ a1: { path: '/media/a1.wav', state: 'missing' } })
    expect(useStore.getState().mediaLengths).toEqual({
      a1: { path: '/media/a1.wav', state: 'missing' }
    })

    useStore.getState().setMediaLengths({ a2: { path: '/media/a2.wav', state: 'no-length' } })
    useStore.getState().setMediaLengths({ a1: null })
    expect(useStore.getState().mediaLengths).toEqual({
      a2: { path: '/media/a2.wav', state: 'no-length' }
    })
  })

  it('leaves state alone when an answer says what it already said', () => {
    useStore.getState().setMediaLengths({ a1: { path: '/media/a1.wav', state: 'missing' } })
    const before = useStore.getState().mediaLengths
    useStore.getState().setMediaLengths({ a1: { path: '/media/a1.wav', state: 'missing' } })
    expect(useStore.getState().mediaLengths).toBe(before)
  })

  it('says nothing about the last show once another is loaded', () => {
    useStore.getState().setMediaLengths({ a1: { path: '/media/a1.wav', state: 'missing' } })
    useStore.getState().loadWorkspace([], 'Next show', null)
    expect(useStore.getState().mediaLengths).toEqual({})
  })
})

describe('store — load notes', () => {
  const note = {
    cueId: 'o1',
    kind: 'missing-group' as const,
    detail: 'it has no group in this file: still fires with the show, at the top level'
  }

  it('records the repairs a load reports', () => {
    useStore.getState().setLoadNotes([note])
    expect(useStore.getState().loadNotes).toEqual([note])
  })

  it('says nothing about the last show once another is loaded', () => {
    useStore.getState().setLoadNotes([note])
    useStore.getState().loadWorkspace([], 'Next show', null)
    expect(useStore.getState().loadNotes).toEqual([])
  })

  it('forgets the repairs once a save has written them into the file', () => {
    useStore.getState().setLoadNotes([note])
    useStore.getState().saveSucceeded('/shows/Next show.cuerunner', 'Next show', [])
    expect(useStore.getState().loadNotes).toEqual([])
  })
})

describe('store — syncCueDuration', () => {
  beforeEach(() => {
    useStore.setState({ cues: [] })
  })

  it('sets duration on the matching cue', () => {
    useStore.getState().addCue('audio')
    const id = useStore.getState().cues[0].id
    useStore.getState().syncCueDuration(id, 5000)
    expect(useStore.getState().cues[0].duration).toBe(5000)
  })

  it('does nothing when cue id is not found', () => {
    useStore.getState().addCue('audio')
    const originalDuration = useStore.getState().cues[0].duration
    useStore.getState().syncCueDuration('nonexistent', 5000)
    expect(useStore.getState().cues[0].duration).toBe(originalDuration)
  })

  it('returns early when duration is unchanged', () => {
    useStore.getState().addCue('audio')
    const id = useStore.getState().cues[0].id
    useStore.getState().syncCueDuration(id, 0) // initial duration is 0
    expect(useStore.getState().cues[0].duration).toBe(0)
  })
})

describe('store — setLastRun', () => {
  beforeEach(resetStore)

  it('records the result against the cue without dirtying the workspace', () => {
    useStore.getState().addCue('network')
    const id = useStore.getState().cues[0].id
    useStore.setState({ isDirty: false, past: [] })

    useStore.getState().setLastRun(id, {
      startedAt: 1000, durationMs: 42, outcome: 'success', status: 200, statusText: 'OK'
    })

    expect(useStore.getState().lastRuns[id]).toMatchObject({ outcome: 'success', status: 200 })
    // Run results are not workspace content — they must not dirty the file or enter undo
    expect(useStore.getState().isDirty).toBe(false)
    expect(useStore.getState().past).toHaveLength(0)
  })

  it('drops the result when its cue is removed', () => {
    useStore.getState().addCue('network')
    const id = useStore.getState().cues[0].id
    useStore.getState().setLastRun(id, { startedAt: 1, durationMs: 1, outcome: 'success' })

    useStore.getState().removeCues([id])

    expect(useStore.getState().lastRuns[id]).toBeUndefined()
  })

  it('clears results when a workspace is loaded', () => {
    useStore.getState().addCue('network')
    const id = useStore.getState().cues[0].id
    useStore.getState().setLastRun(id, { startedAt: 1, durationMs: 1, outcome: 'success' })

    useStore.getState().loadWorkspace([], 'Other', null)

    expect(useStore.getState().lastRuns).toEqual({})
  })
})

describe('store — appendLog / clearLog', () => {
  beforeEach(resetStore)

  it('appends entries with increasing ids and a timestamp', () => {
    useStore.getState().appendLog([{ level: 'info', message: 'started' }])
    useStore.getState().appendLog([{ level: 'output', message: 'hello', label: '2 · Script Cue' }])

    const log = useStore.getState().log
    expect(log).toHaveLength(2)
    expect(log[0].message).toBe('started')
    expect(log[1]).toMatchObject({ level: 'output', message: 'hello', label: '2 · Script Cue' })
    expect(log[1].id).toBeGreaterThan(log[0].id)
    expect(log[1].at).toBeGreaterThan(0)
  })

  it('keeps only the most recent entries', () => {
    useStore.getState().appendLog(
      Array.from({ length: 600 }, (_, i) => ({ level: 'info' as const, message: `line ${i}` }))
    )

    const log = useStore.getState().log
    expect(log).toHaveLength(500)
    expect(log[log.length - 1].message).toBe('line 599')
    expect(log[0].message).toBe('line 100')
  })

  it('truncates an over-long message instead of keeping it whole', () => {
    useStore.getState().appendLog([{ level: 'output', message: 'x'.repeat(9000) }])

    const message = useStore.getState().log[0].message
    expect(message).toHaveLength(4000 + '… (truncated)'.length)
    expect(message).toContain('(truncated)')
  })

  it('clearLog empties the log', () => {
    useStore.getState().appendLog([{ level: 'info', message: 'started' }])
    useStore.getState().clearLog()
    expect(useStore.getState().log).toEqual([])
  })
})

describe('store — loadWorkspace', () => {
  beforeEach(() => {
    useStore.setState({ cues: [], selectedId: null, past: [], future: [] })
  })

  it('selects the first top-level cue', () => {
    useStore.getState().addCue('wait')
    useStore.getState().addCue('audio')
    const waitId = useStore.getState().cues[0].id

    useStore.getState().loadWorkspace(
      useStore.getState().cues.map(c => ({ ...c, parentId: null })),
      'Test', null
    )
    // Should select the first cue (wait)
    expect(useStore.getState().selectedId).toBe(waitId)
  })

  it('selects null when cues array is empty', () => {
    useStore.getState().loadWorkspace([], 'Empty', null)
    expect(useStore.getState().selectedId).toBeNull()
  })
})

describe('store — hooks logic', () => {
  beforeEach(() => {
    useStore.setState({ cues: [], selectedId: null, running: new Map() })
  })

  it('selectedId null causes find to return null (useSelectedCue logic)', () => {
    const state = useStore.getState()
    const found = state.cues.find(c => c.id === state.selectedId) ?? null
    expect(found).toBeNull()
  })

  it('selectedId matching a cue returns that cue (useSelectedCue logic)', () => {
    useStore.getState().addCue('wait')
    const id = useStore.getState().cues[0].id
    useStore.getState().select(id)

    const state = useStore.getState()
    const found = state.cues.find(c => c.id === state.selectedId) ?? null
    expect(found).not.toBeNull()
    expect(found!.id).toBe(id)
  })

  it('selectedId pointing to a removed cue returns null (useSelectedCue logic)', () => {
    useStore.getState().addCue('wait')
    const id = useStore.getState().cues[0].id
    useStore.getState().select(id)
    useStore.getState().removeCues([id])

    const state = useStore.getState()
    const found = state.cues.find(c => c.id === state.selectedId) ?? null
    expect(found).toBeNull()
  })

  it('parent group lookup returns null when cue has no parentId', () => {
    useStore.getState().addCue('wait')
    const id = useStore.getState().cues[0].id

    const state = useStore.getState()
    const cue = state.cues.find(c => c.id === id)
    const parent = cue?.parentId ? state.cues.find(c => c.id === cue.parentId) : null
    expect(parent).toBeNull()
  })

  it('parent group lookup returns null when parent is not a group', () => {
    useStore.getState().addCue('wait')
    useStore.getState().addCue('audio', useStore.getState().cues[0].id)
    const childId = useStore.getState().cues[1].id

    const state = useStore.getState()
    const cue = state.cues.find(c => c.id === childId)
    const parent = cue?.parentId ? state.cues.find(c => c.id === cue.parentId) : null
    const result = parent?.type === 'group' ? parent : null
    expect(result).toBeNull()
  })

  it('parent group lookup returns the group cue for a child', () => {
    useStore.getState().addCue('group')
    const groupId = useStore.getState().cues[0].id
    useStore.getState().addCue('wait', groupId)
    const childId = useStore.getState().cues[1].id

    const state = useStore.getState()
    const cue = state.cues.find(c => c.id === childId)
    const parent = cue?.parentId ? state.cues.find(c => c.id === cue.parentId) : null
    const result = parent?.type === 'group' ? parent : null
    expect(result).not.toBeNull()
    expect(result!.id).toBe(groupId)
    expect(result!.type).toBe('group')
  })

  it('parent group lookup returns null for non-existent cue id', () => {
    const state = useStore.getState()
    const cue = state.cues.find(c => c.id === 'nonexistent')
    const parent = cue?.parentId ? state.cues.find(c => c.id === cue.parentId) : null
    expect(parent).toBeNull()
  })
})

// ── Show services ────────────────────────────────────────────────────────────
// The renderer's view of what the main process reports: devices on stage, service
// state, and the alarms. A batch of events arrives 20 times a second during a show,
// so what it does NOT do to state matters as much as what it does.

let alertSeq = 0

function deviceEvent(device: Partial<DeviceState> & { id: string; name: string }): DeviceEvent {
  return {
    kind: 'device',
    at: 1000,
    device: { service: 'test', online: true, lastSeen: 1000, ...device }
  }
}

function serviceEvent(id: string, state: ServiceEvent['service']['state'], detail: string): ServiceEvent {
  return { kind: 'service', at: 1000, service: { id, label: id, state, detail, since: 1000 } }
}

function alertEvent(level: AlertLevel, source: string, message: string): AlertEvent {
  return {
    kind: 'alert',
    at: 1000,
    alert: { id: ++alertSeq, at: 1000, level, source, message }
  }
}

function oscEvent(address: string): ShowEvent {
  return { kind: 'osc', at: 1000, from: '10.0.0.5:8000', address, args: [] }
}

describe('store — show services', () => {
  beforeEach(() => {
    resetStore()
    useStore.setState({ showServices: [], showDevices: [], showAlerts: [], showEvents: [] })
  })

  it('keeps the newest reading of each device, in the order the devices appeared', () => {
    useStore.getState().applyShowEvents([
      deviceEvent({ id: 'rf:1', name: 'Pack 1', battery: { percent: 90 } }),
      deviceEvent({ id: 'rf:2', name: 'Pack 2', battery: { percent: 80 } })
    ])
    useStore.getState().applyShowEvents([
      deviceEvent({ id: 'rf:1', name: 'Pack 1', battery: { percent: 20 } })
    ])

    const devices = useStore.getState().showDevices
    expect(devices.map(device => device.name)).toEqual(['Pack 1', 'Pack 2'])
    expect(devices[0].battery?.percent).toBe(20)
  })

  describe('what went wrong with a pack, and what was playing', () => {
    const rfDevice = (overrides: Partial<DeviceState> = {}) =>
      deviceEvent({ id: 'rf:ch-1', name: 'Pack 7', service: 'rf', ...overrides })

    const playing = (number: string, name: string): void => {
      const cue = { id: `cue-${number}`, number, name, type: 'wait', parentId: null } as never
      useStore.setState({
        cues: [cue],
        running: new Map([[`cue-${number}`, { cueId: `cue-${number}`, state: 'playing', startedAt: 1, progress: 0 }]])
      })
    }

    beforeEach(() => useStore.setState({ rfIncidents: [], showDevices: [] }))

    it('notes a pack going quiet against the cue that is playing', () => {
      useStore.getState().applyShowEvents([rfDevice()])
      playing('47', 'Walk-in')

      useStore.getState().applyShowEvents([rfDevice({ online: false })])

      expect(useStore.getState().rfIncidents).toEqual([
        expect.objectContaining({ channelId: 'ch-1', name: 'Pack 7', kind: 'dropout', text: 'went quiet', cue: { number: '47', name: 'Walk-in' } })
      ])
    })

    it('says between cues when nothing is playing', () => {
      useStore.getState().applyShowEvents([rfDevice()])
      useStore.setState({ running: new Map() })

      useStore.getState().applyShowEvents([rfDevice({ online: false })])

      expect(useStore.getState().rfIncidents[0].cue).toBeNull()
    })

    it('notes nothing for a device it is seeing for the first time', () => {
      useStore.getState().applyShowEvents([rfDevice({ online: false })])
      expect(useStore.getState().rfIncidents).toEqual([])
    })

    it('keeps the incidents when the batch carries no news, and a bounded number of them', () => {
      useStore.getState().applyShowEvents([rfDevice()])
      const events = Array.from({ length: 250 }, () => [rfDevice({ online: false }), rfDevice({ online: true })]).flat()
      useStore.getState().applyShowEvents(events)
      const noted = useStore.getState().rfIncidents
      expect(noted).toHaveLength(200)

      useStore.getState().applyShowEvents([oscEvent('/go')])
      expect(useStore.getState().rfIncidents).toBe(noted)
    })
  })

  it('replaces a service entry rather than adding a second row for it', () => {
    useStore.getState().applyShowEvents([serviceEvent('osc-in', 'starting', 'binding')])
    useStore.getState().applyShowEvents([serviceEvent('osc-in', 'running', 'listening on 0.0.0.0:53000')])

    expect(useStore.getState().showServices).toEqual([
      expect.objectContaining({ id: 'osc-in', state: 'running', detail: 'listening on 0.0.0.0:53000' })
    ])
  })

  it('does not churn the device list for a batch that carries no device news', () => {
    useStore.getState().applyShowEvents([deviceEvent({ id: 'rf:1', name: 'Pack 1' })])
    const before = useStore.getState().showDevices

    useStore.getState().applyShowEvents([oscEvent('/go')])

    expect(useStore.getState().showDevices).toBe(before)
  })

  it('writes an alarm to the session log, where it outlives the monitor being closed', () => {
    useStore.getState().applyShowEvents([
      alertEvent('critical', 'rf', 'Pack 12 battery critical — Aldonza is on in 2 cues')
    ])

    expect(useStore.getState().log).toEqual([
      expect.objectContaining({
        level: 'error',
        label: 'rf',
        message: 'Pack 12 battery critical — Aldonza is on in 2 cues'
      })
    ])
  })

  it('keeps an informational alarm informational in the log', () => {
    useStore.getState().applyShowEvents([alertEvent('info', 'midi-in', 'MIDI input: off')])

    expect(useStore.getState().log[0].level).toBe('info')
  })

  it('drops the oldest events once the river is full', () => {
    const events = Array.from({ length: 305 }, (_, i) => oscEvent(`/event/${i}`))
    useStore.getState().applyShowEvents(events)

    const river = useStore.getState().showEvents
    expect(river).toHaveLength(300)
    expect(river[0]).toMatchObject({ address: '/event/5' })
    expect(river[299]).toMatchObject({ address: '/event/304' })
  })

  it('dismisses an alarm without touching the log entry it wrote', () => {
    useStore.getState().applyShowEvents([alertEvent('warning', 'rf', 'Pack 3 RF low')])
    const id = useStore.getState().showAlerts[0].id

    useStore.getState().dismissAlert(id)

    expect(useStore.getState().showAlerts).toEqual([])
    expect(useStore.getState().log).toHaveLength(1)
  })

  it('replaces the world from a snapshot, and keeps only the newest events of it', () => {
    useStore.getState().applyShowEvents([deviceEvent({ id: 'rf:1', name: 'Stale pack' })])

    useStore.getState().setShowSnapshot({
      at: 5000,
      services: [
        { id: 'osc-in', label: 'OSC input', state: 'running', detail: 'listening', since: 4000 }
      ],
      devices: [deviceEvent({ id: 'rf:2', name: 'Pack 2' }).device],
      alerts: [],
      events: Array.from({ length: 302 }, (_, i) => oscEvent(`/snapshot/${i}`))
    })

    const state = useStore.getState()
    expect(state.showDevices.map(device => device.name)).toEqual(['Pack 2'])
    expect(state.showServices.map(service => service.state)).toEqual(['running'])
    expect(state.showEvents).toHaveLength(300)
    expect(state.showEvents[0]).toMatchObject({ address: '/snapshot/2' })
  })
})

describe('store — silence trim', () => {
  beforeEach(() => {
    resetStore()
    useStore.setState({
      audioSettings: { outputDeviceId: 'default' },
      silenceFailures: {},
      isDirty: false
    })
  })

  const cue = (index = 0): AudioCue => useStore.getState().cues[index] as AudioCue
  const REGION = { startMs: 500, endMs: 9000, durationMs: 20_000, silent: false }

  it('is born on a cue added while the show says new cues trim their silence', () => {
    useStore.getState().updateAudioSettings({ autoTrimSilence: true })

    useStore.getState().addCue('audio')
    useStore.getState().addAudioCuesFromFiles([{ filePath: '/media/walk.wav', name: 'Walk-in' }])

    expect(cue(0).trimSilence).toBe(true)
    expect(cue(1).trimSilence).toBe(true)
  })

  it('is a default for new cues, not a switch over the show', () => {
    useStore.getState().addCue('audio')
    expect(cue().trimSilence).toBe(false)

    // Turning it on rewrites nothing that is already in the list: the cue keeps the
    // answer it was born with, which is what the setting being a default means.
    useStore.getState().updateAudioSettings({ autoTrimSilence: true })
    expect(cue().trimSilence).toBe(false)
  })

  it('writes a measurement onto its cue without making the session dirty', () => {
    useStore.getState().addCue('audio')
    const id = cue().id
    // The cue being added is an edit; the measurement that follows is not.
    useStore.setState({ isDirty: false })

    useStore.getState().syncCueSilence(id, REGION)

    expect(cue().soundRegion).toEqual(REGION)
    expect(useStore.getState().isDirty).toBe(false)

    // The same answer to the same question is not a new state every pass.
    const before = useStore.getState().cues
    useStore.getState().syncCueSilence(id, REGION)
    expect(useStore.getState().cues).toBe(before)
  })

  it('forgets a measurement and a refusal when the cue is pointed at another file', () => {
    useStore.getState().addCue('audio')
    const id = cue().id
    useStore.getState().syncCueSilence(id, REGION)
    useStore.getState().setSilenceFailure(id, '/media/old.wav')

    useStore.getState().updateCue(id, { filePath: '/media/other.wav' })

    expect(cue().filePath).toBe('/media/other.wav')
    expect(cue().soundRegion).toBeNull()
    expect(useStore.getState().silenceFailures).toEqual({})
  })

  it('does the same for a relink, which is the other way a cue changes its file', () => {
    useStore.getState().addCue('audio')
    const id = cue().id
    useStore.getState().syncCueSilence(id, REGION)
    useStore.getState().setSilenceFailure(id, '/media/old.wav')

    useStore.getState().applyRelinkedMedia({ [id]: '/media/relinked.wav' })

    expect(cue().filePath).toBe('/media/relinked.wav')
    expect(cue().soundRegion).toBeNull()
    expect(useStore.getState().silenceFailures).toEqual({})
  })

  it('lets the route pair go with the file it names, whichever way the cue is pointed elsewhere', () => {
    // A cue read from a showfile carries the pair the file stored for it. A pair left
    // behind names the file the cue no longer plays, and a load reads the pair before the
    // cue's own path: a recovered session would resolve that old file, and a save would
    // write its route back.
    const pair = { path: 'media/walk-in.wav', originalPath: '/shows/tour/media/walk-in.wav' }
    const withPair = (): AudioCue =>
      ({ ...cue(), filePath: '/shows/tour/media/walk-in.wav', media: pair } as AudioCue)
    const pairOnCue = (): unknown => (cue() as unknown as Record<string, unknown>).media

    useStore.getState().addCue('audio')
    const id = cue().id
    useStore.setState({ cues: [withPair()] })

    // The relink funnel.
    useStore.getState().applyRelinkedMedia({ [id]: '/shows/tour/other.wav' })
    expect(cue().filePath).toBe('/shows/tour/other.wav')
    expect(pairOnCue()).toBeUndefined()

    // The inspector's pick, which patches the cue directly.
    useStore.setState({ cues: [withPair()] })
    useStore.getState().updateCue(id, { filePath: '/shows/elsewhere/walk-in.wav' })
    expect(pairOnCue()).toBeUndefined()

    // A patch that leaves the file alone leaves the pair alone: it is the route of the
    // file the cue plays, not something every edit drops.
    useStore.setState({ cues: [withPair()] })
    useStore.getState().updateCue(id, { volume: 0.5 })
    expect(pairOnCue()).toEqual(pair)
  })

  it('forgets the length of the file a cue no longer points at', () => {
    // The length came back from the file that answered, so it does not outlive it: a cue
    // that keeps the old take's length is a row, a group sum and a timeline width that
    // all describe a file it is not playing, and nothing would ever ask again.
    useStore.getState().addCue('audio')
    const id = cue().id
    useStore.getState().updateCue(id, { filePath: '/media/old.wav', duration: 62_000 })

    useStore.getState().applyRelinkedMedia({ [id]: '/media/relinked.wav' })

    expect(cue().duration).toBe(0)
  })

  it('keeps the length when the file is the one it was measured from', () => {
    useStore.getState().addCue('audio')
    const id = cue().id
    useStore.getState().updateCue(id, { filePath: '/media/old.wav', duration: 62_000 })

    useStore.getState().updateCue(id, { volume: 0.5 })

    expect(cue().duration).toBe(62_000)
  })

  it('remembers a refusal by path, and lets it go on request', () => {
    useStore.getState().setSilenceFailure('a1', '/media/broken.wav')
    expect(useStore.getState().silenceFailures).toEqual({ a1: '/media/broken.wav' })

    const before = useStore.getState().silenceFailures
    useStore.getState().setSilenceFailure('a1', '/media/broken.wav')
    expect(useStore.getState().silenceFailures).toBe(before)

    useStore.getState().setSilenceFailure('a1', null)
    expect(useStore.getState().silenceFailures).toEqual({})
  })

  it('says nothing about the last show once another is loaded', () => {
    useStore.getState().setSilenceFailure('a1', '/media/broken.wav')
    useStore.getState().loadWorkspace([], 'Next show', null)
    expect(useStore.getState().silenceFailures).toEqual({})
  })
})
