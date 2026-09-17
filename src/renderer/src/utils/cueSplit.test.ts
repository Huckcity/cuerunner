// A split is a duplication with slices: the two halves together play what the original
// played, they are ordinary cues afterwards, and one undo puts the original back.
import { describe, it, expect, beforeEach } from 'vitest'
import { partName, regionEndMs, splitAudioCue } from './cueSplit'
import type { AudioCue } from '../types/cue'
import { useStore } from '../store'

function cue(overrides: Partial<AudioCue> = {}): AudioCue {
  return {
    id: 'a1', number: '1', name: 'Walk-in Music', type: 'audio',
    colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0,
    duration: 120_000, advance: 'none', isArmed: true, notes: '', refire: 'ignore',
    filePath: '/shows/walk-in.wav',
    startTime: 0, endTime: null, fadeInDuration: 0, fadeOutDuration: 0,
    volume: 1, pan: 0, outputs: null, loopCount: 0, playbackRate: 1, trim: 1,
    ...overrides
  } as AudioCue
}

describe('splitAudioCue', () => {
  it('gives the two halves the region the original played, meeting at the split', () => {
    const original = cue({ startTime: 1000, endTime: 60_000 })
    const split = splitAudioCue(original, 30_000)!

    expect(split.head.startTime).toBe(1000)
    expect(split.head.endTime).toBe(30_000)
    expect(split.tail.startTime).toBe(30_000)
    expect(split.tail.endTime).toBe(60_000)
  })

  it('leaves the tail ending where the file ends', () => {
    // A tail that ended at the length it happened to have would stop following the file:
    // replace the media with a longer take and the second half would clip it.
    const split = splitAudioCue(cue({ duration: 120_000 }), 30_000)!
    expect(split.tail.endTime).toBeNull()
  })

  it('cuts the join dry', () => {
    const split = splitAudioCue(cue({ fadeInDuration: 800 }), 30_000)!
    expect(split.tail.fadeInDuration).toBe(0)
  })

  it('keeps the head’s other routing and level', () => {
    const original = cue({ volume: 0.5, pan: -1, loopCount: 3, outputs: [{ inputChannel: 0, outputChannel: 2, gain: 1 }] })
    const split = splitAudioCue(original, 30_000)!

    expect(split.head.volume).toBe(0.5)
    expect(split.head.endTime).toBe(30_000)
    expect(split.tail.volume).toBe(0.5)
    expect(split.tail.loopCount).toBe(3)
    expect(split.tail.outputs).toEqual([{ inputChannel: 0, outputChannel: 2, gain: 1 }])
  })

  it('leaves the tail with nothing that fires it', () => {
    // A copy that kept the head's OSC address or MIDI note would be fired by the same
    // message as the head — one press, two cues — and the script line belongs to the
    // line the cue was cut from, which is the head's now.
    const original = cue({
      triggers: [{ id: 't1', kind: 'osc', address: '/eos/cue/12/fire' }],
      scriptLine: 42
    })

    const split = splitAudioCue(original, 30_000)!

    expect(split.head.triggers).toEqual([{ id: 't1', kind: 'osc', address: '/eos/cue/12/fire' }])
    expect(split.head.scriptLine).toBe(42)
    expect(split.tail.triggers).toEqual([])
    expect(split.tail.scriptLine).toBeNull()
  })

  it('refuses a point that would leave an empty cue', () => {
    const c = cue({ startTime: 1000, endTime: 60_000 })

    expect(splitAudioCue(c, 1000)).toBeNull()
    expect(splitAudioCue(c, 0)).toBeNull()
    expect(splitAudioCue(c, 60_000)).toBeNull()
  })

  it('refuses when the length is not known yet', () => {
    // A cue whose file has never been measured has no region to cut: the whole file is
    // an unknown, and half of an unknown is not a time.
    expect(splitAudioCue(cue({ duration: 0 }), 1000)).toBeNull()
  })
})

describe('regionEndMs', () => {
  it('reads a null end as the length of the file', () => {
    expect(regionEndMs(cue({ duration: 12_000 }))).toBe(12_000)
    expect(regionEndMs(cue({ duration: 12_000, endTime: 5_000 }))).toBe(5_000)
  })
})

describe('partName', () => {
  it('numbers a name that is already taken', () => {
    expect(partName('Clip 1', new Set())).toBe('Clip 1')
    expect(partName('Clip 1', new Set(['Clip 1']))).toBe('Clip 1 2')
    expect(partName('Clip 1', new Set(['Clip 1', 'Clip 1 2']))).toBe('Clip 1 3')
  })
})

describe('store — splitAudioCueAt', () => {
  beforeEach(() => {
    useStore.setState({
      cues: [cue()],
      selectedId: 'a1',
      selectedIds: ['a1'],
      selectionAnchorId: 'a1',
      waveformCursor: null,
      past: [],
      future: [],
      isDirty: false
    })
  })

  it('puts the tail after the head and selects both halves', () => {
    useStore.getState().splitAudioCueAt('a1', 30_000)

    const cues = useStore.getState().cues as AudioCue[]
    expect(cues).toHaveLength(2)
    expect(cues[0].id).toBe('a1')
    expect(cues[0].endTime).toBe(30_000)
    expect(cues[1].startTime).toBe(30_000)
    expect(cues[1].parentId).toBeNull()
    expect(useStore.getState().selectedIds).toEqual(['a1', cues[1].id])
  })

  it('names the pair so they read as two halves of one thing', () => {
    useStore.getState().splitAudioCueAt('a1', 30_000)

    // The head keeps the name the operator gave the cue — a split track is still that
    // track — and the tail is the same name, numbered.
    const cues = useStore.getState().cues
    expect(cues[0].name).toBe('Walk-in Music')
    expect(cues[1].name).toBe('Walk-in Music 2')
  })

  it('numbers the tail past a name that is already taken', () => {
    const other = cue({ id: 'a2', number: '2', name: 'Walk-in Music 2' })
    useStore.setState({ cues: [cue(), other] })

    useStore.getState().splitAudioCueAt('a1', 30_000)

    const cues = useStore.getState().cues
    expect(cues[0].name).toBe('Walk-in Music')
    expect(cues[1].name).toBe('Walk-in Music 3')
  })

  it('is one edit, and one undo puts the original cue back', () => {
    useStore.getState().splitAudioCueAt('a1', 30_000)
    expect(useStore.getState().cues).toHaveLength(2)

    useStore.getState().undo()

    const cues = useStore.getState().cues
    expect(cues).toHaveLength(1)
    expect(cues[0].id).toBe('a1')
    expect(cues[0].name).toBe('Walk-in Music')
    expect((cues[0] as AudioCue).endTime).toBeNull()
  })

  it('spends the cursor it cut with', () => {
    useStore.setState({ waveformCursor: { cueId: 'a1', ms: 30_000 } })
    useStore.getState().splitAudioCueAt('a1', 30_000)
    expect(useStore.getState().waveformCursor).toBeNull()
  })

  it('does nothing when the point is outside the region', () => {
    useStore.getState().splitAudioCueAt('a1', 200_000)

    expect(useStore.getState().cues).toHaveLength(1)
    expect(useStore.getState().isDirty).toBe(false)
  })

  it('places the tail where the head’s sound reaches the cut on a timeline', () => {
    // Timeline children are fired at their own offsets, so a tail left at the head's
    // offset plays the second half of the file over the first: the pair's join is the
    // head's offset plus its own region before the cut.
    const group = {
      id: 'g1', number: '1', name: 'Bows', type: 'group', colorLabel: 'none',
      parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 0,
      advance: 'none', isArmed: true, notes: '', mode: 'timeline'
    }
    useStore.setState({
      cues: [group as never, cue({ parentId: 'g1', timelineOffset: 2000, startTime: 5000, endTime: 90_000 })]
    })

    useStore.getState().splitAudioCueAt('a1', 25_000)

    const cues = useStore.getState().cues as AudioCue[]
    const tail = cues[cues.length - 1]
    expect(tail?.timelineOffset).toBe(22_000)
    expect(tail?.startTime).toBe(25_000)
  })
})

describe('store — setRegionBoundary', () => {
  beforeEach(() => {
    useStore.setState({
      cues: [cue()],
      selectedId: 'a1',
      selectedIds: ['a1'],
      selectionAnchorId: 'a1',
      waveformCursor: null,
      past: [],
      future: [],
      isDirty: false
    })
  })

  const halves = (): AudioCue[] => {
    useStore.getState().splitAudioCueAt('a1', 30_000)
    return useStore.getState().cues as AudioCue[]
  }

  it('moves the continuation of a split pair with the boundary', () => {
    // The pair only plays the file once if the join stays a join: moving one side alone
    // leaves a gap or an overlap nobody asked for.
    const [head, tail] = halves()

    useStore.getState().setRegionBoundary(head.id, 'end', 45_000)

    const cues = useStore.getState().cues as AudioCue[]
    expect(cues[0].endTime).toBe(45_000)
    expect(cues[1].id).toBe(tail.id)
    expect(cues[1].startTime).toBe(45_000)
  })

  it('is one edit: one undo puts the join back', () => {
    const [head] = halves()
    useStore.getState().setRegionBoundary(head.id, 'end', 45_000)
    expect((useStore.getState().cues[1] as AudioCue).startTime).toBe(45_000)

    useStore.getState().undo()

    const cues = useStore.getState().cues as AudioCue[]
    expect(cues[0].endTime).toBe(30_000)
    expect(cues[1].startTime).toBe(30_000)
  })

  it('moves a lone cue’s own boundary without looking for a partner', () => {
    useStore.getState().setRegionBoundary('a1', 'end', 30_000)

    const cues = useStore.getState().cues as AudioCue[]
    expect(cues).toHaveLength(1)
    expect(cues[0].endTime).toBe(30_000)
    // And moving the head of that same cue past its own tail is held at the tail: the
    // region stops shrinking rather than turning inside out.
    useStore.getState().setRegionBoundary('a1', 'start', 40_000)
    expect((useStore.getState().cues[0] as AudioCue).startTime).toBe(29_999)
  })

  it('keeps the region from collapsing to nothing', () => {
    // A region of no length is a cue that plays nothing, and two grips with no way to
    // pull them apart again.
    useStore.getState().setRegionBoundary('a1', 'start', 120_000)
    const narrowed = useStore.getState().cues[0] as AudioCue
    expect(narrowed.startTime).toBe(narrowed.duration - 1)
  })

  it('stops the head at the tail’s end, leaving the pair a pair', () => {
    // Both edges of the pair are held: dragging the head's end past the tail's end
    // would write a region that runs backwards, which plays nothing and is saved that
    // way. The head stops one millisecond short of the tail's own edge.
    const [head, tail] = halves()
    useStore.getState().setRegionBoundary(tail.id, 'end', 40_000)
    useStore.getState().setRegionBoundary(head.id, 'end', 90_000)

    const cues = useStore.getState().cues as AudioCue[]
    expect(cues[0].endTime).toBe(39_999)
    expect(cues[1].startTime).toBe(39_999)
    expect(cues[1].endTime).toBe(40_000)
  })

  it('stops the tail at the head’s start when it is dragged past it', () => {
    useStore.setState({
      cues: [
        cue({ id: 'a1', startTime: 5000, endTime: 30_000 }),
        cue({ id: 'a2', number: '2', startTime: 30_000, endTime: null })
      ]
    })

    useStore.getState().setRegionBoundary('a2', 'start', 1000)

    const cues = useStore.getState().cues as AudioCue[]
    expect(cues[1].startTime).toBe(5001)
    expect(cues[0].endTime).toBe(5001)
    expect(cues[0].startTime).toBe(5000)
  })

  it('is one undo entry for a drag, however many moves it takes', () => {
    // The grip reports every pointer move, and a drag of a second is sixty of them: one
    // entry each would walk the whole 50-entry history off the end and leave Cmd+Z
    // stepping back through the same drag instead of the operator's last action.
    for (let ms = 30_000; ms < 30_060; ms++) {
      useStore.getState().setRegionBoundary('a1', 'end', ms, true)
    }
    useStore.getState().endRegionDrag()
    // A second drag is a second edit, whatever it does.
    useStore.getState().setRegionBoundary('a1', 'end', 31_000, true)
    useStore.getState().endRegionDrag()

    expect(useStore.getState().past).toHaveLength(2)
    expect((useStore.getState().cues[0] as AudioCue).endTime).toBe(31_000)
  })
})
