// A lock says what is behind it and offers two ways on: a key, for whoever has one, and
// the page that says what one costs, for whoever does not.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ProLock } from './ProLock'
import { useStore } from '../../store'
import { PRICING_URL } from '../../../../shared/support'

describe('ProLock', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    useStore.setState({ license: { state: 'unlicensed' }, settingsTab: null })
    act(() => { root.render(<ProLock feature="Scenes" blurb="Who is open on stage, scene by scene." variant="view" />) })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('opens the License tab for somebody with a key', () => {
    act(() => container.querySelector<HTMLButtonElement>('.pro-lock-unlock')!.click())
    expect(useStore.getState().settingsTab).toBe('license')
  })

  it('points somebody without one at the pricing page, in the browser rather than the window', () => {
    const link = container.querySelector<HTMLAnchorElement>('.pro-lock-pricing')!
    expect(link.textContent).toBe('See what Pro costs')
    expect(link.href).toBe(PRICING_URL)
    // A new-window request is what the main process hands to the operating system; a plain
    // link would ask the window itself to leave the app, which it refuses.
    expect(link.target).toBe('_blank')
  })
})
