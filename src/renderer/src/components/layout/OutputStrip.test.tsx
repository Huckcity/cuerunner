// The output strip: the master level in dB as the engine's gain, sent to every engine the
// window meets, and the meter read after it on a dB scale.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { OutputStrip, METER_POLL_MS, formatDb, gainFromDb, meterFraction } from './OutputStrip'
import { audioEngine } from '../../engine/audioEngineClient'

vi.mock('../../engine/audioEngineClient')

const engine = vi.mocked(audioEngine)

describe('the level arithmetic', () => {
  it('reads dB as a gain, the floor as silence', () => {
    expect(gainFromDb(0)).toBe(1)
    expect(gainFromDb(6)).toBeCloseTo(1.995, 3)
    expect(gainFromDb(-6)).toBeCloseTo(0.501, 3)
    expect(gainFromDb(-60)).toBe(0)
  })

  it('reads a peak along a dB scale from the floor', () => {
    expect(meterFraction(1)).toBe(1)
    expect(meterFraction(0)).toBe(0)
    expect(meterFraction(0.001)).toBeCloseTo(0, 5)
    expect(meterFraction(Math.pow(10, -30 / 20))).toBeCloseTo(0.5, 5)
    expect(meterFraction(4)).toBe(1)
  })

  it('writes the readout as a desk does', () => {
    expect(formatDb(0)).toBe('0.0 dB')
    expect(formatDb(-12.5)).toBe('−12.5 dB')
    expect(formatDb(3)).toBe('+3.0 dB')
    expect(formatDb(-60)).toBe('−∞')
  })
})

describe('OutputStrip', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('sends this machine’s master to the engine, and again to an engine that replaces it', () => {
    localStorage.setItem('cuerunner.master.db', '-6')
    let replaced: (() => void) | null = null
    engine.onSessionChange.mockImplementation(cb => { replaced = cb as () => void; return () => {} })
    act(() => { root.render(<OutputStrip />) })
    expect(engine.master).toHaveBeenLastCalledWith(expect.closeTo(0.501, 3))
    expect(container.querySelector('.master-readout')?.textContent).toBe('−6.0 dB')
    engine.master.mockClear()
    act(() => { replaced?.() })
    expect(engine.master).toHaveBeenCalledWith(expect.closeTo(0.501, 3))
  })

  it('moves the master with the fader and keeps it on this machine', () => {
    act(() => { root.render(<OutputStrip />) })
    const fader = container.querySelector<HTMLInputElement>('.master-fader')!
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(fader, '-12')
      fader.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(engine.master).toHaveBeenLastCalledWith(expect.closeTo(0.251, 3))
    expect(localStorage.getItem('cuerunner.master.db')).toBe('-12')
  })

  it('draws the meter from the engine’s reading, and marks a channel that reached full scale', async () => {
    engine.meters.mockResolvedValue({ at: 0, master: 1, peaks: [1, Math.pow(10, -30 / 20)] })
    act(() => { root.render(<OutputStrip />) })
    await act(async () => { await vi.advanceTimersByTimeAsync(METER_POLL_MS) })
    const covers = [...container.querySelectorAll<HTMLElement>('.output-meter-bar')]
    expect(covers[0].style.transform).toBe('scaleX(0)')
    expect(covers[1].style.transform).toBe('scaleX(0.5)')
    expect(container.querySelector<HTMLElement>('.output-meter')?.dataset.clipped).toBe('true')
  })
})
