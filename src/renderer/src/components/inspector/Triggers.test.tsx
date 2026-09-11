// The trigger editor is the only place a cue can be taught what fires it besides GO,
// so these tests pin the DOM contract the E2E spec targets — the row list, the two
// forms, the learn strip — and the reading of the event river behind Learn.
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Triggers, describeTrigger } from './Triggers'
import { useStore } from '../../store'
import { createCue } from '../../utils/cueDefaults'
import type { Cue, CueTrigger, MidiMessageKind } from '../../types/cue'
import type { MidiInEvent, OscInEvent, ShowEvent } from '../../types/show'

const AT = 1_700_000_000_000

/** A note-on on ch3, the shape the learn flow is expected to turn into a trigger. */
const NOTE_ON: MidiMessageKind = { kind: 'noteOn', channel: 3, note: 64, velocity: 100 }

function oscEvent(address: string): OscInEvent {
  return { kind: 'osc', at: AT, from: '10.0.0.5:8000', address, args: [] }
}

function midiEvent(device: string, message: MidiMessageKind): MidiInEvent {
  return { kind: 'midi', at: AT, device, message }
}

/** Each MIDI message kind with the value field's name and how the row should read. */
const MIDI_CASES = [
  { kind: 'noteOn', label: 'Note', detail: 'note', message: { kind: 'noteOn', channel: 1, note: 60 } },
  { kind: 'noteOff', label: 'Note', detail: 'note', message: { kind: 'noteOff', channel: 1, note: 60 } },
  { kind: 'cc', label: 'Controller', detail: 'controller', message: { kind: 'cc', channel: 1, controller: 60 } },
  { kind: 'programChange', label: 'Program', detail: 'program', message: { kind: 'programChange', channel: 1, program: 60 } }
] as const

/** The cue under edit, as the mounted editor sees it. */
function Harness({ id }: { id: string }) {
  const cue = useStore(s => s.cues.find(c => c.id === id))
  return cue ? <Triggers cue={cue} /> : null
}

describe('Triggers', () => {
  let container: HTMLDivElement
  let root: Root
  let cueId: string

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    const cue = createCue('wait')
    cueId = cue.id
    useStore.setState({ cues: [cue], showEvents: [] })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    useStore.setState({ cues: [], showEvents: [] })
  })

  function $(selector: string): Element {
    const el = container.querySelector(selector)
    if (!el) throw new Error(`no element for ${selector}`)
    return el
  }

  function text(selector: string): string {
    return $(selector).textContent ?? ''
  }

  function click(el: Element): void {
    act(() => { (el as HTMLElement).click() })
  }

  function type(el: Element, value: string): void {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    act(() => {
      setter?.call(el, value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  function choose(el: Element, value: string): void {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
    act(() => {
      setter?.call(el, value)
      el.dispatchEvent(new Event('change', { bubbles: true }))
    })
  }

  function pushEvents(...events: ShowEvent[]): void {
    act(() => { useStore.setState(s => ({ showEvents: [...s.showEvents, ...events] })) })
  }

  function seed(triggers: CueTrigger[]): void {
    act(() => {
      useStore.setState(s => ({
        cues: s.cues.map(c => c.id === cueId ? { ...c, triggers } : c)
      }))
    })
  }

  function triggers(): CueTrigger[] {
    return (useStore.getState().cues.find(c => c.id === cueId) as Cue).triggers ?? []
  }

  async function mount(): Promise<void> {
    await act(async () => { root.render(<Harness id={cueId} />) })
  }

  it('titles the section and says nothing fires the cue yet', async () => {
    await mount()

    expect(text('.field-section-title')).toBe('Triggers')
    expect(text('.trigger-empty')).toBe('Nothing fires this cue but GO.')
    expect(container.querySelectorAll('.trigger-row')).toHaveLength(0)
    expect($('.triggers').contains($('.trigger-empty'))).toBe(true)
    // The heading sits above the block, so it reads as a section of the tab.
    expect($('.field-section-title').compareDocumentPosition($('.triggers')))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('adds an OSC trigger and clears the field', async () => {
    await mount()
    const add = $('.trigger-section[data-kind="osc"] .trigger-add') as HTMLButtonElement
    expect(add.disabled).toBe(true)

    type($('#trigger-osc-address'), '/eos/cue/12/fire')
    expect(add.disabled).toBe(false)
    click(add)

    expect(triggers()).toEqual([
      { id: expect.any(String), kind: 'osc', address: '/eos/cue/12/fire' }
    ])
    expect(($('#trigger-osc-address') as HTMLInputElement).value).toBe('')
    expect(add.disabled).toBe(true)
    expect(text('.trigger-row .trigger-text')).toBe('OSC /eos/cue/12/fire')
    expect($('.trigger-row').getAttribute('data-kind')).toBe('osc')
  })

  it.each(MIDI_CASES)('adds a $kind trigger with the value field named $label', async ({ kind, label, detail, message }) => {
    ;(window.winslab.midi.listInputPorts as unknown as Mock).mockResolvedValue(['IAC Bus 1'])
    await mount()

    const add = $('.trigger-section[data-kind="midi"] .trigger-add') as HTMLButtonElement
    expect(add.disabled).toBe(true)

    choose($('#trigger-midi-device'), 'IAC Bus 1')
    choose($('#trigger-midi-kind'), kind)
    type($('#trigger-midi-value'), '60')

    expect(text('label[for="trigger-midi-value"]')).toBe(label)
    expect(add.disabled).toBe(false)
    click(add)

    expect(triggers()).toEqual([
      { id: expect.any(String), kind: 'midi', device: 'IAC Bus 1', message }
    ])
    expect(text('.trigger-row .trigger-text')).toBe(`MIDI ${kind} ch1 ${detail} 60 on "IAC Bus 1"`)
    expect($('.trigger-row').getAttribute('data-kind')).toBe('midi')
  })

  it('removes one trigger and leaves the other standing', async () => {
    seed([
      { id: 'a', kind: 'osc', address: '/one' },
      { id: 'b', kind: 'midi', device: 'IAC Bus 1', message: { kind: 'cc', channel: 2, controller: 7 } }
    ])
    await mount()

    const rows = [...container.querySelectorAll('.trigger-row')]
    expect(rows).toHaveLength(2)
    expect(rows.map(row => row.getAttribute('data-kind'))).toEqual(['osc', 'midi'])

    click(rows[0].querySelector('.trigger-remove') as Element)

    expect(triggers()).toEqual([
      { id: 'b', kind: 'midi', device: 'IAC Bus 1', message: { kind: 'cc', channel: 2, controller: 7 } }
    ])
    expect(container.querySelectorAll('.trigger-row')).toHaveLength(1)
    expect(text('.trigger-text')).toBe('MIDI cc ch2 controller 7 on "IAC Bus 1"')
  })

  it('learns an OSC trigger from the event river and ignores other kinds', async () => {
    await mount()
    click($('.trigger-section[data-kind="osc"] .trigger-learn'))
    expect(text('.trigger-learning')).toContain('Waiting for a message…')

    pushEvents(midiEvent('IAC Bus 1', NOTE_ON))
    expect(triggers()).toHaveLength(0)
    expect(container.querySelector('.trigger-learning')).toBeTruthy()

    pushEvents(oscEvent('/eos/cue/12/fire'))
    expect(triggers()).toEqual([
      { id: expect.any(String), kind: 'osc', address: '/eos/cue/12/fire' }
    ])
    expect(container.querySelector('.trigger-learning')).toBeNull()
    expect(text('.trigger-text')).toBe('OSC /eos/cue/12/fire')
  })

  it('learns a MIDI trigger, skipping a sysex that cannot answer one', async () => {
    await mount()
    click($('.trigger-section[data-kind="midi"] .trigger-learn'))

    pushEvents(midiEvent('IAC Bus 1', { kind: 'sysex', data: [0x7e, 0x00] }))
    expect(triggers()).toHaveLength(0)
    expect(container.querySelector('.trigger-learning')).toBeTruthy()

    pushEvents(midiEvent('IAC Bus 1', NOTE_ON))
    expect(triggers()).toEqual([
      {
        id: expect.any(String),
        kind: 'midi',
        device: 'IAC Bus 1',
        message: { kind: 'noteOn', channel: 3, note: 64 }
      }
    ])
    expect(container.querySelector('.trigger-learning')).toBeNull()
    expect(text('.trigger-text')).toBe('MIDI noteOn ch3 note 64 on "IAC Bus 1"')
  })

  it('stops capturing once learning is cancelled', async () => {
    await mount()
    click($('.trigger-section[data-kind="osc"] .trigger-learn'))
    click($('.trigger-learn-cancel'))

    expect(container.querySelector('.trigger-learning')).toBeNull()

    pushEvents(oscEvent('/eos/cue/12/fire'), midiEvent('IAC Bus 1', NOTE_ON))
    expect(triggers()).toHaveLength(0)
  })
})

describe('describeTrigger', () => {
  it('writes an OSC address', () => {
    expect(describeTrigger({ id: 'a', kind: 'osc', address: '/eos/cue/12/fire' }))
      .toBe('OSC /eos/cue/12/fire')
  })

  it('names the note for note on and note off', () => {
    expect(describeTrigger({
      id: 'a', kind: 'midi', device: 'IAC Bus 1',
      message: { kind: 'noteOn', channel: 1, note: 60 }
    })).toBe('MIDI noteOn ch1 note 60 on "IAC Bus 1"')

    expect(describeTrigger({
      id: 'b', kind: 'midi', device: 'IAC Bus 1',
      message: { kind: 'noteOff', channel: 16, note: 127 }
    })).toBe('MIDI noteOff ch16 note 127 on "IAC Bus 1"')
  })

  it('names the controller for cc and the program for a program change', () => {
    expect(describeTrigger({
      id: 'a', kind: 'midi', device: 'Launchpad',
      message: { kind: 'cc', channel: 5, controller: 7 }
    })).toBe('MIDI cc ch5 controller 7 on "Launchpad"')

    expect(describeTrigger({
      id: 'b', kind: 'midi', device: 'Launchpad',
      message: { kind: 'programChange', channel: 5, program: 12 }
    })).toBe('MIDI programChange ch5 program 12 on "Launchpad"')
  })
})
