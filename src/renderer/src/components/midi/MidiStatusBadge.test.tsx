// A build without the native MIDI module has to say so: a MIDI cue that reaches nothing
// must not look like one that worked. The badge is the surface an operator sees.
import { describe, it, expect, beforeEach, afterEach, type Mock } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import MidiStatusBadge from './MidiStatusBadge'
import { useStore } from '../../store'

describe('MidiStatusBadge', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    ;(window.cuerunner.midi.status as unknown as Mock).mockResolvedValue({ available: true, error: null })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function render(): Promise<HTMLButtonElement> {
    await act(async () => { root.render(<MidiStatusBadge />) })
    return container.querySelector('.midi-status') as HTMLButtonElement
  }

  it('says nothing on a machine where MIDI works', async () => {
    const badge = await render()

    expect(badge.dataset.state).toBe('ok')
    expect(badge.textContent).toBe('')
  })

  it('says MIDI is unavailable, with the reason on the badge', async () => {
    ;(window.cuerunner.midi.status as unknown as Mock)
      .mockResolvedValue({ available: false, error: 'the MIDI module is not installed in this build' })

    const badge = await render()

    expect(badge.dataset.state).toBe('unavailable')
    expect(badge.textContent).toBe('MIDI unavailable')
    expect(badge.title).toContain('the MIDI module is not installed in this build')
  })

  it('does not claim MIDI works when the status itself fails', async () => {
    ;(window.cuerunner.midi.status as unknown as Mock).mockRejectedValue(new Error('no handler'))

    const badge = await render()

    expect(badge.dataset.state).toBe('unavailable')
  })

  it('opens Settings on the MIDI tab when clicked', async () => {
    ;(window.cuerunner.midi.status as unknown as Mock)
      .mockResolvedValue({ available: false, error: 'no module' })
    useStore.setState({ settingsTab: null })
    const badge = await render()

    await act(async () => { badge.click() })

    expect(useStore.getState().settingsTab).toBe('midi')
    useStore.setState({ settingsTab: null })
  })
})
