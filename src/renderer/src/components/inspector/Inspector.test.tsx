// The inspector's shape: what every cue shares on Basics, what the type does on its own
// tab, and what else can fire it on Triggers — with nothing on Basics that only one kind
// of cue in one kind of group would ever use.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Inspector } from './Inspector'
import { useStore } from '../../store'
import { createCue } from '../../utils/cueDefaults'
import type { Cue, GroupCue } from '../../../../shared/cue'

function cue(type: Cue['type'], patch: Partial<Cue> = {}): Cue {
  return { ...createCue(type), ...patch } as Cue
}

describe('Inspector', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    useStore.setState({ cues: [], selectedId: null })
  })

  function show(cues: Cue[], selected: Cue): void {
    act(() => {
      useStore.setState({ cues, selectedId: selected.id })
      root.render(<Inspector />)
    })
  }

  const tabs = (): string[] =>
    [...container.querySelectorAll('.inspector-tab')].map(tab => tab.textContent ?? '')

  const openTab = (name: string): void => {
    const tab = [...container.querySelectorAll<HTMLButtonElement>('.inspector-tab')]
      .find(candidate => candidate.textContent?.startsWith(name))!
    act(() => tab.click())
  }

  const labels = (): string[] =>
    [...container.querySelectorAll('.field-row label')].map(label => label.textContent ?? '')

  it('gives an audio cue Basics, Audio, Time & Loops, Slices and Triggers — one thing called Timing', () => {
    const audio = cue('audio')
    show([audio], audio)
    expect(tabs()).toEqual(['Basics', 'Audio', 'Time & Loops', 'Slices', 'Triggers'])
  })

  it('keeps triggers off Basics, and counts them on their own tab', () => {
    const wait = cue('wait', {
      triggers: [
        { id: 't1', kind: 'osc', address: '/eos/cue/12/fire' },
        { id: 't2', kind: 'osc', address: '/show/go' }
      ]
    })
    show([wait], wait)

    expect(container.querySelector('.triggers')).toBeNull()
    expect(container.querySelector('.inspector-tab-count')?.textContent).toBe('2')

    openTab('Triggers')
    expect(container.querySelectorAll('.trigger-row')).toHaveLength(2)
  })

  it('asks for a timeline offset only inside a timeline group, and in seconds', () => {
    const loose = cue('wait')
    show([loose], loose)
    expect(labels()).not.toContain('Timeline offset (s)')

    const group = cue('group', { mode: 'timeline' } as Partial<GroupCue>)
    const child = cue('wait', { parentId: group.id, timelineOffset: 2500 })
    show([group, child], child)
    expect(labels()).toContain('Timeline offset (s)')
    const field = [...container.querySelectorAll('.field-row')]
      .find(row => row.textContent?.startsWith('Timeline offset'))!
      .querySelector('input')!
    expect(field.value).toBe('2.5')
  })

  it('draws a reset arrow only where the cue differs from a new one', () => {
    const wait = cue('wait', { preWait: 500 })
    show([wait], wait)

    const shown = [...container.querySelectorAll<HTMLButtonElement>('.inspector-reset-btn')]
      .filter(button => button.dataset.default === 'false')
      .map(button => button.title)
    expect(shown).toEqual(['Reset Pre-wait to default'])
  })

  it('shows a SysEx cue’s bytes in hex, the way they are typed and sent', () => {
    // The cue's data is bytes, and the placeholder, the field and the monitor all speak
    // hex. Shown in decimal, the next keystroke in that field would re-parse a number the
    // operator never typed — and put bytes on the wire that mean something else.
    const midi = cue('midi', {
      messages: [{ kind: 'sysex', data: [0xf0, 0x41, 0x10, 0xf7] }]
    } as Partial<Cue>)
    show([midi], midi)
    openTab('MIDI')

    const field = container.querySelector<HTMLInputElement>('input[placeholder*="F0 41"]')!
    expect(field.value).toBe('F0 41 10 F7')
  })

  it('gives a new OSC string argument a value that is a string', () => {
    // A 0 left under an argument the panel calls `string` is a value of the wrong kind: the
    // row would say one thing and the value another.
    const osc = cue('osc', {
      messages: [{ patchId: '', host: '127.0.0.1', port: 53000, address: '/x', args: [{ type: 'f', value: 0 }] }]
    } as Partial<Cue>)
    show([osc], osc)
    openTab('OSC')

    // The first select is where the message goes; the argument's type is the next.
    const select = container.querySelectorAll<HTMLSelectElement>('.osc-message select')[1]
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
      setter?.call(select, 's')
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })

    const stored = useStore.getState().cues[0] as { messages: Array<{ args: Array<{ type: string; value: unknown }> }> }
    expect(stored.messages[0].args[0]).toEqual({ type: 's', value: '' })
  })

  it('refuses a header rename that would take another header’s value with it', () => {
    // Headers are one plain object, so two rows with the same name are one entry: the
    // rename would delete the other row — and its value — while the operator is still
    // typing, and typing on would not bring it back.
    const network = cue('network', {
      headers: { Accept: 'application/json', 'Content-Type': 'text/plain' }
    } as Partial<Cue>)
    show([network], network)
    openTab('Network')

    const rows = [...container.querySelectorAll('.field-row')]
      .filter(row => row.querySelector('label')?.textContent?.startsWith('Header'))
    const secondKey = rows[1].querySelector<HTMLInputElement>('input')!
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(secondKey, 'Accept')
      secondKey.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const stored = useStore.getState().cues[0] as { headers: Record<string, string> }
    expect(stored.headers).toEqual({
      Accept: 'application/json',
      'Content-Type': 'text/plain'
    })
  })
})
