// The transport's alarm chip: an alarm the operator cannot see is no alarm, so the one
// surface that is always on screen has to carry the worst of them.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { AlertChip, topAlert } from './AlertChip'
import { useStore } from '../../store'
import type { ShowAlert } from '../../types/show'

function alert(id: number, level: ShowAlert['level'], message: string, extra: Partial<ShowAlert> = {}): ShowAlert {
  return { id, at: id * 1000, level, source: 'rf', message, ...extra }
}

describe('topAlert', () => {
  it('is nothing when nothing is standing', () => {
    expect(topAlert([])).toBeNull()
  })

  it('leaves info alerts to the monitor', () => {
    expect(topAlert([alert(1, 'info', 'OSC input listening')])).toBeNull()
  })

  it('puts a critical alarm ahead of a newer warning', () => {
    const top = topAlert([
      alert(1, 'critical', 'Pack 1 battery critical'),
      alert(2, 'warning', 'Pack 2 battery low')
    ])
    expect(top?.alert.message).toBe('Pack 1 battery critical')
    expect(top?.others).toBe(1)
  })

  it('shows the newest of the same level, the one nobody has looked at', () => {
    const top = topAlert([
      alert(1, 'warning', 'older'),
      alert(2, 'warning', 'newer'),
      alert(3, 'info', 'not counted')
    ])
    expect(top?.alert.message).toBe('newer')
    expect(top?.others).toBe(1)
  })
})

describe('AlertChip', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    useStore.setState({ showAlerts: [] })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function render(onShow = vi.fn()): HTMLButtonElement | null {
    act(() => { root.render(<AlertChip onShow={onShow} />) })
    return container.querySelector('.alert-chip')
  }

  it('takes no room when there is nothing to say', () => {
    expect(render()).toBeNull()
  })

  it('carries the worst alarm and a count of the rest', () => {
    useStore.setState({
      showAlerts: [
        alert(1, 'warning', 'Pack 2 (Sancho) battery low — 19% left', { deviceId: 'rf:ch2' }),
        alert(2, 'critical', 'Pack 1 (Aldonza) battery critical — 6% left', { deviceId: 'rf:ch1' })
      ]
    })

    const chip = render()!

    expect(chip.dataset.level).toBe('critical')
    expect(chip.querySelector('.alert-chip-message')?.textContent).toContain('Aldonza')
    expect(chip.querySelector('.alert-chip-more')?.textContent).toBe('+1')
  })

  it('opens Wireless for a pack alarm', () => {
    useStore.setState({ showAlerts: [alert(1, 'critical', 'Pack 1 battery critical', { deviceId: 'rf:ch1' })] })
    const onShow = vi.fn()

    const chip = render(onShow)!
    act(() => chip.click())

    expect(onShow).toHaveBeenCalledWith('rf')
  })

  it('opens the show monitor for anything else', () => {
    useStore.setState({ showAlerts: [alert(1, 'warning', 'MIDI input "Desk" disconnected', { source: 'midi-in' })] })
    const onShow = vi.fn()

    const chip = render(onShow)!
    act(() => chip.click())

    expect(onShow).toHaveBeenCalledWith('monitor')
  })

  it('goes when the alarm is dismissed', () => {
    useStore.setState({ showAlerts: [alert(1, 'warning', 'Dante endpoint left the network')] })
    expect(render()).not.toBeNull()

    act(() => useStore.getState().dismissAlert(1))

    expect(container.querySelector('.alert-chip')).toBeNull()
  })
})
