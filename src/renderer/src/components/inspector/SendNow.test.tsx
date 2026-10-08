// Send now: the cue's message out of the inspector without running the cue, and what happened.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { SendNow } from './SendNow'

describe('SendNow', () => {
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
  })

  const button = (): HTMLButtonElement => container.querySelector('button')!
  const result = (): HTMLElement | null => container.querySelector('.send-now-result')

  async function press(): Promise<void> {
    await act(async () => { button().click() })
  }

  it('sends, and says it was sent', async () => {
    const send = vi.fn(async () => ({ ok: true }))
    act(() => { root.render(<SendNow what="the message" send={send} />) })
    await press()
    expect(send).toHaveBeenCalledTimes(1)
    expect(result()?.textContent).toBe('Sent')
    expect(result()?.dataset.ok).toBe('true')
  })

  it('says why a send did not leave, in the socket’s words', async () => {
    act(() => { root.render(<SendNow what="the message" send={async () => ({ ok: false, error: 'getaddrinfo ENOTFOUND desk' })} />) })
    await press()
    expect(result()?.textContent).toBe('getaddrinfo ENOTFOUND desk')
    expect(result()?.dataset.ok).toBe('false')
  })

  it('says a fault as a failure rather than throwing it at the window', async () => {
    act(() => { root.render(<SendNow what="the message" send={async () => { throw new Error('the port went away') }} />) })
    await press()
    expect(result()?.textContent).toBe('the port went away')
  })

  it('is not offered with nothing to send', () => {
    act(() => { root.render(<SendNow what="0 messages" disabled send={async () => ({ ok: true })} />) })
    expect(button().disabled).toBe(true)
  })
})
