// A triggered cue goes through the same runner as GO, so what these tests pin is the
// decision to fire: which cue, on which message, and the log line that explains why it
// happened.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useCueTriggers } from './useCueTriggers'
import { cueRunner } from '../engine/CueRunner'
import { useStore } from '../store'
import type { Cue, CueTrigger } from '../types/cue'
import type { ShowEvent } from '../types/show'

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
  let emit: (events: ShowEvent[]) => void
  let goById: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    vi.mocked(window.winslab.show.onEvents).mockImplementation(callback => {
      emit = callback
      return () => {}
    })
    goById = vi.spyOn(cueRunner, 'goById').mockImplementation(() => {})

    useStore.setState({ cues: [], log: [] })
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

  it('fires the cue whose trigger matches, and logs what fired it', () => {
    useStore.setState({ cues: [cue('7', [oscTrigger])] })

    act(() => { emit([osc('/eos/cue/12/fire')]) })

    expect(goById).toHaveBeenCalledWith('7')
    expect(logMessages()).toEqual(['Triggered by OSC /eos/cue/12/fire from 10.0.0.5:8000'])
  })

  it('fires on a MIDI note from the desk, whatever its velocity', () => {
    useStore.setState({ cues: [cue('9', [midiTrigger])] })

    act(() => { emit([midi({ kind: 'noteOn', channel: 1, note: 60, velocity: 127 })]) })

    expect(goById).toHaveBeenCalledWith('9')
    expect(logMessages()).toEqual(['Triggered by MIDI noteOn note 60 on ch1 from "IAC Bus 1"'])
  })

  it('leaves the cue alone when the message is not the one it answers to', () => {
    useStore.setState({ cues: [cue('7', [oscTrigger])] })

    act(() => { emit([osc('/eos/cue/13/fire')]) })

    expect(goById).not.toHaveBeenCalled()
    expect(logMessages()).toEqual([])
  })

  it('does not fire a disarmed cue, and says nothing about it', () => {
    useStore.setState({ cues: [cue('7', [oscTrigger], false)] })

    act(() => { emit([osc('/eos/cue/12/fire')]) })

    expect(goById).not.toHaveBeenCalled()
    expect(logMessages()).toEqual([])
  })

  it('ignores everything on the bus that is not a message from a desk', () => {
    useStore.setState({ cues: [cue('7', [oscTrigger])] })

    act(() => {
      emit([
        { kind: 'device', at: 1, device: { id: 'rf:1', service: 'rf', name: 'Pack 1', online: true, lastSeen: 1 } },
        { kind: 'alert', at: 1, alert: { id: 1, at: 1, level: 'warning', source: 'rf', message: 'pack low' } },
        { kind: 'service', at: 1, service: { id: 'osc-in', label: 'OSC input', state: 'running', detail: '', since: 1 } }
      ])
    })

    expect(goById).not.toHaveBeenCalled()
  })

  it('fires every cue that answers to the message, in cue order', () => {
    useStore.setState({ cues: [cue('1', [oscTrigger]), cue('2', [oscTrigger, midiTrigger])] })

    act(() => { emit([osc('/eos/cue/12/fire')]) })

    expect(goById.mock.calls.map(call => call[0])).toEqual(['1', '2'])
  })
})
