// The receiver's password and certificate rows. What is held lives in main, so these tests
// drive the bridge the window talks through and pin what the operator is told: that a
// password is held without saying what it is, why one was refused, and that a certificate
// the first connection saw turns up without the dialog being reopened.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { EwDxCredentials, shortFingerprint } from './EwDxCredentials'
import type { EwDxCredentialResult, EwDxCredentialStatus } from '../../../../shared/ipc/show'

const FINGERPRINT =
  '8D:24:BA:47:B0:EE:13:37:DF:E1:5A:A8:85:9D:D2:D7:7E:68:9D:9F:C4:6A:9C:FF:CB:30:21:12:A1:44:56:F1'

const none: EwDxCredentialStatus = { hasPassword: false, encrypted: true, fingerprint: null }
const held: EwDxCredentialStatus = { hasPassword: true, encrypted: true, fingerprint: FINGERPRINT }

describe('EwDxCredentials', () => {
  let container: HTMLDivElement
  let root: Root
  const show = () => window.cuerunner.show

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    vi.mocked(show().ewDxCredentials).mockResolvedValue(none)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllMocks()
  })

  async function render(serviceKey = 'running:polling Rack A'): Promise<void> {
    await act(async () => {
      root.render(<EwDxCredentials sourceId="rack-a" serviceKey={serviceKey} />)
    })
  }

  const input = (): HTMLInputElement => container.querySelector<HTMLInputElement>('input')!
  const button = (name: string): HTMLButtonElement =>
    [...container.querySelectorAll('button')].find(b => b.textContent === name)!
  const text = (): string => container.textContent ?? ''

  async function type(value: string): Promise<void> {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input(), value)
      input().dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  async function click(el: HTMLElement): Promise<void> {
    await act(async () => {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
  }

  it('tells a machine that holds nothing where the password comes from', async () => {
    await render()

    expect(input().type).toBe('password')
    expect(input().placeholder).toBe('From WSM')
    expect(text()).toContain('Turn on third-party access in WSM first.')
    expect(text()).not.toContain('Certificate')
  })

  it('keeps Save out of reach until something has been typed', async () => {
    await render()
    expect(button('Save').disabled).toBe(true)

    await type('a password')
    expect(button('Save').disabled).toBe(false)
  })

  it('saves the password, empties the box, and says one is held without saying what it is', async () => {
    vi.mocked(show().ewDxSetPassword).mockResolvedValue({ ok: true, ...held, fingerprint: null })
    await render()

    await type('Correct-horse')
    await click(button('Save'))

    expect(show().ewDxSetPassword).toHaveBeenCalledWith('rack-a', 'Correct-horse')
    expect(input().value).toBe('')
    expect(input().placeholder).toBe('Saved on this machine')
    expect(container.innerHTML).not.toContain('Correct-horse')
    expect(text()).not.toContain('Turn on third-party access')
  })

  it('saves on Enter as well', async () => {
    vi.mocked(show().ewDxSetPassword).mockResolvedValue({ ok: true, ...held })
    await render()

    await type('Correct-horse')
    await act(async () => {
      input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })

    expect(show().ewDxSetPassword).toHaveBeenCalledTimes(1)
  })

  it('says why a password was refused, under the box, and keeps what was typed', async () => {
    const refused: EwDxCredentialResult = { ok: false, error: 'Cuerunner Pro is required for the show services' }
    vi.mocked(show().ewDxSetPassword).mockResolvedValue(refused)
    await render()

    await type('Correct-horse')
    await click(button('Save'))

    const alert = container.querySelector('[role="alert"]')!
    expect(alert.textContent).toBe('Cuerunner Pro is required for the show services')
    expect(input().value).toBe('Correct-horse')
    expect(input().getAttribute('aria-invalid')).toBe('true')

    // The reason is about what was in the box, so it goes when the box changes.
    await type('Correct-horse2')
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('shows the certificate a connection has seen, short, with the whole of it on hover', async () => {
    vi.mocked(show().ewDxCredentials).mockResolvedValue(held)
    await render()

    const shown = container.querySelector<HTMLElement>('.ewdx-fingerprint')!
    expect(shown.textContent).toBe('8D:24:BA:47…56:F1')
    expect(shown.title).toBe(FINGERPRINT)
    expect(text()).toContain('Trust again if the receiver has a new certificate.')
  })

  it('looks again when the service moves, because the first connection is what sees the certificate', async () => {
    vi.mocked(show().ewDxCredentials).mockResolvedValueOnce({ ...held, fingerprint: null })
    await render('starting:')
    expect(container.querySelector('.ewdx-fingerprint')).toBeNull()

    vi.mocked(show().ewDxCredentials).mockResolvedValue(held)
    await render('running:polling Rack A')

    expect(container.querySelector('.ewdx-fingerprint')).not.toBeNull()
  })

  it('forgets the certificate when told to trust again, and the row goes with it', async () => {
    vi.mocked(show().ewDxCredentials).mockResolvedValue(held)
    vi.mocked(show().ewDxTrustAgain).mockResolvedValue({ ok: true, ...held, fingerprint: null })
    await render()

    await click(button('Trust again'))

    expect(show().ewDxTrustAgain).toHaveBeenCalledWith('rack-a')
    expect(container.querySelector('.ewdx-fingerprint')).toBeNull()
  })

  it('says so when the password is stored without a keychain', async () => {
    vi.mocked(show().ewDxCredentials).mockResolvedValue({ hasPassword: true, encrypted: false, fingerprint: null })
    await render()

    expect(text()).toContain('Stored without encryption: this machine has no keychain.')
  })

  it('does not set state after it has gone, when the answer arrives late', async () => {
    let resolve: (status: EwDxCredentialStatus) => void = () => undefined
    vi.mocked(show().ewDxCredentials).mockReturnValue(new Promise(r => { resolve = r }))
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await render()

    act(() => root.unmount())
    await act(async () => resolve(held))

    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
    // Re-mount a root so afterEach has something to unmount.
    root = createRoot(container)
  })
})

describe('shortFingerprint', () => {
  it('keeps the head and the tail of a SHA-256, which is what a person compares', () => {
    expect(shortFingerprint(FINGERPRINT)).toBe('8D:24:BA:47…56:F1')
  })

  it('leaves a value that is not a fingerprint alone', () => {
    expect(shortFingerprint('AA:BB')).toBe('AA:BB')
  })
})
