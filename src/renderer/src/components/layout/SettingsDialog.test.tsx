// The settings dialog: seven sections down the side, grouped by where their settings are
// kept, and one shape for every service — a switch, a line saying what it does, and what
// it is doing about it.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { SettingsDialog } from './SettingsDialog'
import { useStore } from '../../store'
import { defaultShowSettings } from '../../../../shared/show'
import { TEST_LICENSE } from '../../../../test/license'

let container: HTMLDivElement
let root: Root

const text = (selector: string): string =>
  [...container.querySelectorAll(selector)].map(node => node.textContent ?? '').join('|')

function render(): void {
  act(() => { root.render(<SettingsDialog onClose={() => {}} />) })
}

function click(selector: string): void {
  const node = container.querySelector(selector)
  if (node === null) throw new Error(`nothing matches ${selector}`)
  act(() => { node.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
}

/** A select driven the way a pointer drives one: the value, then the change it makes. */
function choose(select: HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
  act(() => {
    setter.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

/** Lets the engine info a mount asked for land before it is asserted on. */
async function settle(): Promise<void> {
  await act(async () => { await Promise.resolve() })
}

/** Opens a section the way an operator does: by the name on it. */
function openSection(label: string): void {
  const tab = [...container.querySelectorAll('.settings-tab')]
    .find(button => button.textContent === label)
  if (tab === undefined) throw new Error(`no section named ${label}`)
  act(() => { tab.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
}

beforeEach(() => {
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  useStore.setState({
    showSettings: defaultShowSettings(),
    showServices: [
      { id: 'osc-in', label: 'OSC input', state: 'running', detail: 'listening on port 53000', since: 0 },
      { id: 'presence', label: 'Network presence', state: 'stopped', detail: 'disabled', since: 0 },
      { id: 'companion', label: 'Companion', state: 'stopped', detail: 'disabled', since: 0 }
    ],
    license: { state: 'active', license: TEST_LICENSE }
  })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

describe('SettingsDialog', () => {
  it('groups its sections by where the settings are kept', () => {
    render()
    expect(text('.settings-tab-group-title')).toBe('This show|This computer')
    expect(text('.settings-tab')).toBe(
      'General|Audio|MIDI|Network|Wireless|Backup machine|License'
    )
  })

  it('says what each section is for, once, at the top of it', () => {
    render()
    expect(text('.settings-pane-title')).toBe('General')
    expect(text('.settings-pane-blurb')).toContain('while a show is running')
  })

  it('shows in the sidebar whether a section has something running', () => {
    render()
    const dots = [...container.querySelectorAll('.settings-tab-dot')]
      .map(dot => dot.getAttribute('data-state'))
    // Network's OSC input is running; the MIDI and wireless services are not reporting.
    expect(dots).toContain('running')
  })

  it('gives every service the same shape: a switch, a line, and its state', () => {
    render()
    openSection('Network')

    const blocks = [...container.querySelectorAll('.settings-block')]
    expect(blocks.length).toBe(3)
    for (const block of blocks) {
      expect(block.querySelector('.settings-block-title')?.textContent).toBeTruthy()
      expect(block.querySelector('.settings-block-blurb')?.textContent).toBeTruthy()
      expect(block.querySelector('input.settings-switch')).not.toBeNull()
      expect(block.querySelector('.settings-service')).not.toBeNull()
    }
    expect(text('.settings-block-title')).toBe('OSC control|Find devices|Tablet view')
  })

  it('keeps the protocol details behind Advanced rather than first on the panel', () => {
    render()
    openSection('Network')

    const advanced = container.querySelector('details.settings-advanced')
    expect(advanced).not.toBeNull()
    expect((advanced as HTMLDetailsElement).open).toBe(false)
    // The mDNS service types are in there, not on the face of the panel.
    expect(advanced?.querySelector('#settings-presence-services')).not.toBeNull()
    expect(text('.settings-block-blurb')).not.toContain('_netaudio')
  })

  it('switches a service on through the switch, and writes it to the show', () => {
    render()
    openSection('Network')

    const serve = container.querySelector('#settings-companion') as HTMLInputElement
    expect(serve.checked).toBe(false)
    // A press, not a value written behind React's back: a checkbox turns a click into
    // the change the component listens for.
    click('#settings-companion')
    expect(useStore.getState().showSettings.companion.enabled).toBe(true)
  })

  it('forgets the device when the audio system changes, because the id belongs to the old one', () => {
    useStore.setState({ audioSettings: { outputDeviceId: 'speakers-3', backend: 'auto' } })
    render()
    openSection('Audio')

    choose(container.querySelector<HTMLSelectElement>('#settings-audio-system')!, 'asio')

    // One change, both fields: the device was listed by the system the show just left,
    // and the new one would refuse the id rather than substitute a device of its own.
    expect(useStore.getState().audioSettings).toEqual({ outputDeviceId: 'default', backend: 'asio' })
  })

  it('leaves the exclusive choice to systems that can be asked, and not to ASIO', async () => {
    // The engine this bridge reports runs the silent backend, where exclusive is a
    // request that can be made, so the row is there.
    render()
    await settle()
    openSection('Audio')
    expect(container.querySelector('#settings-exclusive')).not.toBeNull()

    // An engine running ASIO holds the device alone: there is nothing for the operator
    // to choose, and the Device readout below still says what it is doing.
    const silent = await window.cuerunner.audio.info()
    vi.mocked(window.cuerunner.audio.info).mockResolvedValue({ ...silent, backend: 'asio' })
    act(() => { root.render(<div />) })
    render()
    await settle()
    openSection('Audio')
    // The panel really is the Audio one — the row is gone, not the whole tab with it.
    expect(container.querySelector('#settings-audio-system')).not.toBeNull()
    expect(container.querySelector('#settings-exclusive')).toBeNull()
  })
})
