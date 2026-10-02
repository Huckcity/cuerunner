// The receivers found on the network, as the Wireless page offers them. What is found comes
// from main, so these tests drive the bridge and pin what the operator is told: that it looks
// by itself, that a receiver already added is not offered again, and that "nothing found" and
// "could not look" are different sentences.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { EwDxFinder } from './EwDxFinder'
import type { EwDxDiscoverResult, EwDxFound } from '../../../../shared/ipc/show'
import type { TelemetrySource } from '../../../../shared/show'

const em4: EwDxFound = {
  address: '192.168.0.194',
  port: 443,
  name: 'EWDXEM4D-001B663BDD13',
  product: 'EWDX4CHDS',
  model: 'EW-DX EM 4 Dante',
  serial: '5364000906'
}

const added = (target: string): TelemetrySource => ({
  id: 'rack-a',
  label: 'Rack A',
  kind: 'ew-dx',
  target,
  pollMs: 2000,
  timeoutMs: 1500
})

describe('EwDxFinder', () => {
  let container: HTMLDivElement
  let root: Root
  const discover = () => vi.mocked(window.cuerunner.show.ewDxDiscover)

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    discover().mockReset()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function render(sources: TelemetrySource[] = [], onAdd = vi.fn()): Promise<ReturnType<typeof vi.fn>> {
    await act(async () => {
      root.render(<EwDxFinder sources={sources} onAdd={onAdd} />)
    })
    return onAdd
  }

  const text = (): string => container.textContent ?? ''
  const state = (): string => container.querySelector('.ewdx-finder-state')!.textContent ?? ''
  const button = (name: string): HTMLButtonElement =>
    [...container.querySelectorAll('button')].find(b => b.textContent === name)!
  const click = (el: HTMLElement): Promise<void> => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })

  it('looks by itself when it is opened, and says so while it does', async () => {
    let finish: (result: EwDxDiscoverResult) => void = () => undefined
    discover().mockReturnValue(new Promise(resolve => { finish = resolve }))
    await render()

    expect(discover()).toHaveBeenCalledTimes(1)
    expect(state()).toBe('Looking…')
    expect(button('Look again').disabled).toBe(true)

    await act(async () => finish({ receivers: [], error: null }))
    expect(button('Look again').disabled).toBe(false)
  })

  it('offers each receiver it found, by model and address, with a way to add it', async () => {
    discover().mockResolvedValue({ receivers: [em4], error: null })
    const onAdd = await render()

    expect(state()).toBe('1 found')
    expect(container.querySelector('.ewdx-found-name')!.textContent).toBe('EW-DX EM 4 Dante')
    expect(container.querySelector('.ewdx-found-address')!.textContent).toBe('192.168.0.194')

    await click(button('Add'))
    expect(onAdd).toHaveBeenCalledWith(em4)
  })

  it('does not offer a receiver that is already a source, however its address was typed', async () => {
    discover().mockResolvedValue({ receivers: [em4], error: null })
    await render([added('https://192.168.0.194')])

    expect(container.querySelector('.ewdx-found')).toBeNull()
    expect(state()).toBe('Every receiver found is added')
  })

  it('says none were found, without alarm, when the network answered and nobody was there', async () => {
    discover().mockResolvedValue({ receivers: [], error: null })
    await render()

    expect(state()).toBe('No EW-DX receivers found')
    expect(container.querySelector('.ewdx-finder-state')!.getAttribute('data-state')).toBe('done')
  })

  it('says it could not look, which is not the same as nothing being there', async () => {
    discover().mockResolvedValue({ receivers: [], error: 'this computer is not on a network' })
    await render()

    expect(state()).toBe('Could not look: this computer is not on a network')
    expect(container.querySelector('.ewdx-finder-state')!.getAttribute('data-state')).toBe('error')
  })

  it('treats a look that failed outright as one that could not be made, and can try again', async () => {
    discover().mockRejectedValueOnce(new Error('the bridge fell over'))
    await render()
    expect(state()).toBe('Could not look: the bridge fell over')

    discover().mockResolvedValue({ receivers: [em4], error: null })
    await click(button('Look again'))
    expect(state()).toBe('1 found')
  })

  it('does not touch the page after it has been closed mid-look', async () => {
    let finish: (result: EwDxDiscoverResult) => void = () => undefined
    discover().mockReturnValue(new Promise(resolve => { finish = resolve }))
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await render()

    act(() => root.unmount())
    await act(async () => finish({ receivers: [em4], error: null }))

    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
    root = createRoot(container)
  })

  it('has nothing to say about itself in the page text beyond what it found', async () => {
    discover().mockResolvedValue({ receivers: [], error: null })
    await render()

    expect(text()).toBe('On the networkNo EW-DX receivers foundLook again')
  })
})
