// A triggered cue goes through the same runner as GO, so what these tests pin is the
// decision to fire: which cue, on which message, and the log line that explains why it
// happened.
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useCueTriggers } from './useCueTriggers'
import { cueEngine } from '../engine/CueEngine'
import { useStore } from '../store'
import { TEST_LICENSE } from '../../../test/license'
import type { Cue, CueTrigger } from '../../../shared/cue'
import type { ShowEvent } from '../../../shared/show'

function Harness() {
  useCueTriggers()
  return null
}

function cue(id: string, triggers: CueTrigger[], isArmed = true): Cue {
  return {
    id,
    number: id,
    name: `Cue ${id}`,
    colorLabel: 'none',
    parentId: null,
    preWait: 0,
    postWait: 0,
    timelineOffset: 0,
    duration: 0,
    advance: 'none',
    isArmed,
    notes: '',
    triggers,
    type: 'wait'
  }
}

const oscTrigger: CueTrigger = { id: 't1', kind: 'osc', address: '/eos/cue/12/fire' }
const midiTrigger: CueTrigger = {
  id: 't2',
  kind: 'midi',
  device: 'IAC Bus 1',
  message: { kind: 'noteOn', channel: 1, note: 60 }
}

function osc(address: string): ShowEvent {
  return { kind: 'osc', at: 1, from: '10.0.0.5:8000', address, args: [] }
}

function midi(message: Extract<ShowEvent, { kind: 'midi' }>['message']): ShowEvent {
  return { kind: 'midi', at: 1, device: 'IAC Bus 1', message }
}

describe('useCueTriggers', () => {
  let container: HTMLDivElement
  let root: Root
  let emit: ((events: ShowEvent[]) => void) | null
  let goById: Mock

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    vi.mocked(window.cuerunner.show.onEvents).mockImplementation(callback => {
      emit = callback
      return () => {
        if (emit === callback) emit = null
      }
    })
    goById = vi.spyOn(cueEngine, 'goById').mockImplementation(() => {})
    // The guard is real here on purpose — a hook that asked it in the wrong order looked
    // fine against a stub and blocked every MIDI note in the app. What the tests control
    // is where the guard starts from.
    cueEngine.resetGuards()

    useStore.setState({ license: { state: 'active', license: TEST_LICENSE }, cues: [], log: [] })
    act(() => { root.render(<Harness />) })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    goById.mockRestore()
    vi.clearAllMocks()
  })

  function logMessages(): string[] {
    return useStore.getState().log.map(entry => entry.message)
  }

  /** What the main process does: hand a batch to whatever is listening on the bridge. */
  function deliver(events: ShowEvent[]): void {
    if (emit === null) throw new Error('nothing is subscribed to the show bus')
    emit(events)
  }

  it('stays subscribed with no licence, because the inputs are the free half', () => {
    // OSC and MIDI in are free: a desk's key or a footswitch has to fire cues on a
    // machine that has never seen a key, so the hook never comes off the bridge.
    act(() => {
      useStore.setState({ license: { state: 'unlicensed' }, cues: [cue('7', [oscTrigger])] })
    })

    expect(emit).not.toBeNull()

    act(() => { deliver([osc('/eos/cue/12/fire')]) })
    expect(goById).toHaveBeenCalledWith('7')
  })

  it('fires the cue whose trigger matches, and logs what fired it', () => {
    useStore.setState({ cues: [cue('7', [oscTrigger])] })

    act(() => { deliver([osc('/eos/cue/12/fire')]) })

    expect(goById).toHaveBeenCalledWith('7')
    expect(logMessages()).toEqual(['Triggered by OSC /eos/cue/12/fire from 10.0.0.5:8000'])
  })

  it('fires on a MIDI note from the desk, whatever its velocity', () => {
    useStore.setState({ cues: [cue('9', [midiTrigger])] })

    act(() => { deliver([midi({ kind: 'noteOn', channel: 1, note: 60, velocity: 127 })]) })

    expect(goById).toHaveBeenCalledWith('9')
    expect(logMessages()).toEqual(['Triggered by MIDI noteOn note 60 on ch1 from "IAC Bus 1"'])
  })

  it('leaves the cue alone when the message is not the one it answers to', () => {
    useStore.setState({ cues: [cue('7', [oscTrigger])] })

    act(() => { deliver([osc('/eos/cue/13/fire')]) })

    expect(goById).not.toHaveBeenCalled()
    expect(logMessages()).toEqual([])
  })

  it('does not fire a disarmed cue, and says nothing about it', () => {
    useStore.setState({ cues: [cue('7', [oscTrigger], false)] })

    act(() => { deliver([osc('/eos/cue/12/fire')]) })

    expect(goById).not.toHaveBeenCalled()
    expect(logMessages()).toEqual([])
  })

  it('ignores everything on the bus that is not a message from a desk', () => {
    useStore.setState({ cues: [cue('7', [oscTrigger])] })

    act(() => {
      deliver([
        { kind: 'device', at: 1, device: { id: 'rf:1', service: 'rf', name: 'Pack 1', online: true, lastSeen: 1 } },
        { kind: 'alert', at: 1, alert: { id: 1, at: 1, level: 'warning', source: 'rf', message: 'pack low' } },
        { kind: 'service', at: 1, service: { id: 'osc-in', label: 'OSC input', state: 'running', detail: '', since: 1 } }
      ])
    })

    expect(goById).not.toHaveBeenCalled()
  })

  it('fires every cue that answers to the message, in cue order', () => {
    useStore.setState({ cues: [cue('1', [oscTrigger]), cue('2', [oscTrigger, midiTrigger])] })

    act(() => { deliver([osc('/eos/cue/12/fire')]) })

    expect(goById.mock.calls.map(call => call[0])).toEqual(['1', '2'])
  })

  describe('the remote', () => {
    let go: Mock
    let stop: Mock

    beforeEach(() => {
      go = vi.spyOn(cueEngine, 'go').mockImplementation(() => {})
      stop = vi.spyOn(cueEngine, 'stop').mockImplementation(() => {})
    })

    afterEach(() => {
      go.mockRestore()
      stop.mockRestore()
    })

    it('presses GO for a QLab /go, and the log says who pressed it', () => {
      useStore.setState({ cues: [cue('1', [])] })
      act(() => { deliver([osc('/go')]) })
      expect(go).toHaveBeenCalledTimes(1)
      expect(logMessages()).toEqual(['GO from OSC /go from 10.0.0.5:8000'])
    })

    it('fires a cue by its number for /cue/{n}/start', () => {
      useStore.setState({ cues: [cue('1', []), cue('2', [])] })
      act(() => { deliver([osc('/workspace/ABC/cue/2/start')]) })
      expect(goById).toHaveBeenCalledWith('2')
    })

    it('leaves an address a cue’s own trigger answers to that cue', () => {
      const goTrigger: CueTrigger = { id: 't3', kind: 'osc', address: '/go' }
      useStore.setState({ cues: [cue('5', [goTrigger])] })
      act(() => { deliver([osc('/go')]) })
      expect(goById).toHaveBeenCalledWith('5')
      expect(go).not.toHaveBeenCalled()
    })

    it('answers nothing when the show turned the remote off', () => {
      const showSettings = useStore.getState().showSettings
      useStore.setState({
        cues: [cue('1', [])],
        showSettings: { ...showSettings, oscIn: { ...showSettings.oscIn, remote: false } }
      })
      act(() => { deliver([osc('/go'), osc('/stop')]) })
      expect(go).not.toHaveBeenCalled()
      expect(stop).not.toHaveBeenCalled()
      useStore.setState({ showSettings })
    })

    it('asks the repeat guard first, so a desk that sends /select/next twice steps once', () => {
      // The guard's window is its own test's business (inputGuard.test.ts); what this pins is
      // that the remote goes through it, as a trigger does.
      const accepts = vi.spyOn(cueEngine, 'acceptsFire')
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false)
      useStore.setState({ cues: [cue('1', []), cue('2', []), cue('3', [])], selectedId: '1' })
      act(() => { deliver([osc('/select/next'), osc('/select/next')]) })
      expect(accepts).toHaveBeenCalledWith('osc', '/select/next ')
      expect(useStore.getState().selectedId).toBe('2')
      accepts.mockRestore()
    })
  })
})
