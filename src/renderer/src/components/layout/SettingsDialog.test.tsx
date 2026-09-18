// The settings dialog: seven sections down the side, grouped by where their settings are
// kept, and one shape for every service — a switch, a line saying what it does, and what
// it is doing about it.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { SettingsDialog } from './SettingsDialog'
import { useStore } from '../../store'
import { defaultShowSettings } from '../../../../shared/show'
import { AUDIO_CHANNELS } from '../../../../shared/audio'
import type { AudioEngineInfo } from '../../engine/audioEngineClient'
import { TEST_LICENSE } from '../../../../test/license'

let container: HTMLDivElement
let root: Root

const text = (selector: string): string =>
  [...container.querySelectorAll(selector)].map(node => node.textContent ?? '').join('|')

/** The reading row with this label, so a check can read the engine's own figure. */
function row(label: string): string {
  const found = [...container.querySelectorAll('.field-row')]
    .find(node => node.querySelector('label')?.textContent === label)
  return found?.textContent ?? ''
}

/**
 * A reading from an engine with a device in force. The mock these tests run against
 * reports the silent backend, the one backend where the lever must not be offered; a
 * real device is what the checks about reconnecting are about.
 */
async function deviceReading(overrides: Partial<AudioEngineInfo> = {}): Promise<AudioEngineInfo> {
  return {
    ...(await window.cuerunner.audio.info()),
    backend: 'pulseaudio',
    deviceId: 'sink-9',
    deviceName: 'Acceptance Sink',
    ...overrides
  }
}

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
  // Every test starts from the engine's own record again: a test that made the engine
  // answer with a device, or refuse a request, must not leave that answer to the next.
  vi.mocked(window.cuerunner.audio.info).mockReset()
  vi.mocked(window.cuerunner.audio.configure).mockReset()
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

  it('sends the settings already in force when the device is reconnected', async () => {
    useStore.setState({
      audioSettings: {
        outputDeviceId: 'sink-9', backend: 'auto', sampleRate: 48000,
        channels: 8, exclusive: true, bufferFrames: 256
      },
      audioDeviceError: null
    })
    vi.mocked(window.cuerunner.audio.info).mockResolvedValue(await deviceReading())

    render()
    await settle()
    openSection('Audio')
    await settle()

    click('#settings-audio-reconnect')
    await settle()

    // The lever is the window's own device request: the exact fields the mount effect
    // sends, derived from the show's settings and nothing else. Nothing is pretended to
    // have changed — the engine reopens a latched-off device on exactly this ask.
    expect(window.cuerunner.audio.configure).toHaveBeenLastCalledWith({
      backend: 'auto',
      deviceId: 'sink-9',
      sampleRate: 48000,
      channels: 8,
      exclusive: true,
      bufferFrames: 256
    })
  })

  it('clears the refusal and shows the device again once the reconnect succeeds', async () => {
    const loss = 'audio device stopped unexpectedly'
    useStore.setState({
      audioSettings: { outputDeviceId: 'default' },
      audioDeviceError: loss
    })
    vi.mocked(window.cuerunner.audio.info).mockResolvedValue(
      await deviceReading({ deviceName: 'Old Output', lastError: loss, warnings: [loss] })
    )

    render()
    await settle()
    openSection('Audio')
    await settle()
    expect(text('.settings-device-error')).toBe(loss)
    expect(text('.settings-warning')).toContain(loss)
    expect(row('Device')).toContain('Old Output')

    vi.mocked(window.cuerunner.audio.configure).mockResolvedValue(
      await deviceReading({ deviceName: 'Acceptance Sink', lastError: null, warnings: [] })
    )
    click('#settings-audio-reconnect')
    await settle()

    // A configure that took answers the refusal, and the reading it returned is what the
    // panel shows — the operator sees the device back without waiting for the next poll.
    // The warnings bar reads the engine too, and gets the same fresh reading: it must not
    // go on claiming a lost device beside a readout that says the device is back.
    expect(useStore.getState().audioDeviceError).toBeNull()
    expect(container.querySelector('.settings-device-error')).toBeNull()
    expect(row('Device')).toContain('Acceptance Sink')
    expect(text('.settings-warning')).not.toContain(loss)
  })

  it('keeps the engine\'s own words when the reconnect is refused', async () => {
    vi.mocked(window.cuerunner.audio.info).mockResolvedValue(await deviceReading())
    vi.mocked(window.cuerunner.audio.configure).mockImplementation(() => Promise.reject(new Error(
      `Error invoking remote method '${AUDIO_CHANNELS.configure}': AudioEngineError: requested audio device 'gone' was not found`
    )))

    render()
    await settle()
    openSection('Audio')
    await settle()

    click('#settings-audio-reconnect')
    await settle()

    // The engine's sentence, not the IPC plumbing around it and not a shrug.
    expect(text('.settings-device-error')).toBe("requested audio device 'gone' was not found")
  })

  it('does not offer the lever to a backend that has no device', async () => {
    render()
    await settle()
    openSection('Audio')
    await settle()

    // The engine's own reading is the silent backend, where every device request is
    // refused by design: an offer that can only ever produce a refusal nobody can act
    // on is not an offer. Nothing is sent by a control that is not offered.
    const reconnect = container.querySelector<HTMLButtonElement>('#settings-audio-reconnect')
    expect(reconnect).not.toBeNull()
    expect(reconnect!.disabled).toBe(true)

    click('#settings-audio-reconnect')
    await settle()
    expect(window.cuerunner.audio.configure).not.toHaveBeenCalled()

    // `none` is how the engine reports every other backend with no device — the offline
    // one among them — and the same reading decides the lever there.
    const silent = await window.cuerunner.audio.info()
    vi.mocked(window.cuerunner.audio.info).mockResolvedValue({ ...silent, backend: 'none', deviceName: '' })
    act(() => { root.render(<div />) })
    render()
    await settle()
    openSection('Audio')
    await settle()
    expect(container.querySelector<HTMLButtonElement>('#settings-audio-reconnect')!.disabled).toBe(true)
  })

  it('shows the refusal when a press finds no reading to hide it behind', async () => {
    useStore.setState({ audioDeviceError: null })
    vi.mocked(window.cuerunner.audio.info)
      .mockImplementation(() => Promise.reject(new Error('the engine is not running')))
    vi.mocked(window.cuerunner.audio.configure).mockImplementation(() => Promise.reject(new Error(
      `Error invoking remote method '${AUDIO_CHANNELS.configure}': AudioEngineError: the engine could not be started`
    )))

    render()
    await settle()
    openSection('Audio')
    await settle()
    // Nothing has been asked yet, and the readout has nothing to say.
    expect(text('.settings-device-error')).toBe('')
    expect(text('.inspector-hint')).toContain('The audio engine is not answering.')

    click('#settings-audio-reconnect')
    await settle()

    // No reading named a backend and the engine cannot be reached, so there is nothing
    // to hide the refusal behind — and nothing else would tell the operator that the
    // press did anything at all.
    expect(text('.settings-device-error')).toBe('the engine could not be started')
  })

  it('offers the lever while the engine cannot be reached, where a configure restarts it', async () => {
    vi.mocked(window.cuerunner.audio.info)
      .mockImplementation(() => Promise.reject(new Error('the engine is not running')))

    render()
    await settle()
    openSection('Audio')
    await settle()

    const reconnect = container.querySelector<HTMLButtonElement>('#settings-audio-reconnect')
    expect(reconnect).not.toBeNull()
    expect(reconnect!.disabled).toBe(false)
  })
})
