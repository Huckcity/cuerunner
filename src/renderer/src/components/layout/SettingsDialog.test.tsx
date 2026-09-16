// The settings dialog: seven sections down the side, grouped by where their settings are
// kept, and one shape for every service — a switch, a line saying what it does, and what
// it is doing about it.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { SettingsDialog } from './SettingsDialog'
import { useStore } from '../../store'
import { defaultShowSettings } from '../../types/show'
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
})
