// A key that is refused is an answer, and the field says why. A check that faults — the key
// file could not be written, the main process threw — is not an answer, and it used to be
// nothing at all: the button stayed disabled and no sentence appeared.
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { LicenseSection } from './LicenseSection'
import { useStore } from '../../store'

describe('LicenseSection — a check that faults', () => {
  let container: HTMLDivElement
  let root: Root
  const activate = (): Mock => window.cuerunner.license.activate as unknown as Mock
  const deactivate = (): Mock => window.cuerunner.license.deactivate as unknown as Mock

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllMocks()
  })

  const button = (label: string): HTMLButtonElement =>
    [...container.querySelectorAll('button')].find(b => b.textContent === label)!

  /** Types into the key field the way React hears it. */
  function typeKey(text: string): void {
    const field = container.querySelector<HTMLTextAreaElement>('#license-key')!
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    act(() => {
      setValue.call(field, text)
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  it('says the key could not be checked, and gives the button back', async () => {
    useStore.setState({ license: { state: 'unlicensed' } })
    activate().mockRejectedValueOnce(
      new Error("Error invoking remote method 'license:activate': Error: EACCES: permission denied")
    )
    act(() => { root.render(<LicenseSection />) })
    typeKey('CRN1.some-key')

    await act(async () => { button('Activate').click() })

    expect(container.querySelector('.license-error')?.textContent)
      .toBe('The key could not be checked: EACCES: permission denied')
    // The operator can try again without closing the dialog, and the key is still there.
    expect(button('Activate').disabled).toBe(false)
    expect(container.querySelector<HTMLTextAreaElement>('#license-key')?.value).toBe('CRN1.some-key')
    expect(useStore.getState().license).toEqual({ state: 'unlicensed' })
  })

  it('says so when a key could not be removed, and leaves the machine licensed', async () => {
    const license = { v: 1 as const, id: 'CRN-1', licensee: 'A Venue', issued: '2026-01-01' }
    useStore.setState({ license: { state: 'active', license } })
    deactivate().mockRejectedValueOnce(new Error('EBUSY: resource busy'))
    act(() => { root.render(<LicenseSection />) })

    await act(async () => { button('Deactivate').click() })

    expect(container.querySelector('.license-error')?.textContent)
      .toBe('The key could not be removed: EBUSY: resource busy')
    expect(useStore.getState().license.state).toBe('active')
  })
})
