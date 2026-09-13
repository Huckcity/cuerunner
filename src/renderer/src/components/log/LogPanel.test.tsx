// The log is the session's one history: what the cues did and what the show sent in,
// newest last, with a filter for either half.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { LogPanel, logRows } from './LogPanel'
import { useStore, type LogEntry } from '../../store'
import { formatClock } from '../../utils/cueDefaults'
import { TEST_LICENSE } from '../../../../test/license'
import type { ShowEvent } from '../../types/show'

const AT = 1_700_000_000_000

function entry(id: number, at: number, message: string): LogEntry {
  return { id, at, level: 'info', message, label: '1 · Walk-in' }
}

const EVENTS: ShowEvent[] = [
  { kind: 'osc', at: AT + 1000, from: '192.168.1.4:8000', address: '/cue/1/go', args: [{ type: 'i', value: 1 }] },
  { kind: 'midi', at: AT + 3000, device: 'Launchpad', message: { kind: 'noteOn', channel: 1, note: 60, velocity: 100 } },
  {
    kind: 'alert',
    at: AT + 4000,
    alert: { id: 1, at: AT + 4000, level: 'warning', source: 'rf', message: 'Pack 2 battery low' }
  },
  {
    kind: 'service',
    at: AT + 5000,
    service: { id: 'osc-in', label: 'OSC in', state: 'failed', detail: 'connection refused', since: AT }
  }
]

describe('logRows', () => {
  const log = [entry(1, AT, 'started'), entry(2, AT + 2000, 'completed in 2000ms')]

  it('interleaves the cues and the show by time, leaving alerts to the log that already has them', () => {
    const rows = logRows(log, EVENTS, 'all')
    expect(rows.map(row => row.kind === 'entry' ? row.entry.message : row.event.kind))
      .toEqual(['started', 'osc', 'completed in 2000ms', 'midi', 'service'])
  })

  it('filters to either half', () => {
    expect(logRows(log, EVENTS, 'cues').every(row => row.kind === 'entry')).toBe(true)
    expect(logRows(log, EVENTS, 'show').map(row => row.kind === 'event' && row.event.kind))
      .toEqual(['osc', 'midi', 'service'])
  })
})

describe('LogPanel', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    useStore.setState({ log: [], showEvents: [], license: { state: 'unlicensed' } })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    useStore.setState({ log: [], showEvents: [], license: { state: 'unlicensed' } })
  })

  const count = (): string | null | undefined => container.querySelector('.log-count')?.textContent
  const texts = (selector: string): string[] =>
    [...container.querySelectorAll(selector)].map(el => el.textContent ?? '')

  function render(): void {
    act(() => { root.render(<LogPanel onClose={() => {}} />) })
  }

  it('counts entries the way they are said', () => {
    render()
    expect(count()).toBe('empty')

    act(() => { useStore.getState().appendLog([{ level: 'info', message: 'started' }]) })
    expect(count()).toBe('1 entry')

    act(() => { useStore.getState().appendLog([{ level: 'info', message: 'completed' }]) })
    expect(count()).toBe('2 entries')
  })

  it('labels what came in from the show by its kind, in the operator’s terms', () => {
    useStore.setState({ showEvents: EVENTS, license: { state: 'active', license: TEST_LICENSE } })
    render()

    expect([...container.querySelectorAll('.log-event')].map(row => row.getAttribute('data-kind')))
      .toEqual(['osc', 'midi', 'service'])
    expect(texts('.log-event-kind')).toEqual(['OSC', 'MIDI', 'SERVICE'])
    expect(texts('.log-event .log-time')[0]).toBe(formatClock(AT + 1000))
    expect(texts('.log-event .log-message')).toEqual([
      '/cue/1/go from 192.168.1.4:8000 1',
      'noteOn ch1 60/100',
      'OSC in failed: connection refused'
    ])
  })

  it('offers the filter only where the show can send anything in', () => {
    render()
    expect(container.querySelector('.log-filters')).toBeNull()

    act(() => { useStore.setState({ license: { state: 'active', license: TEST_LICENSE }, showEvents: EVENTS }) })
    const cuesOnly = container.querySelector<HTMLButtonElement>('.log-filter[data-filter="cues"]')!
    act(() => cuesOnly.click())
    expect(cuesOnly.getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelectorAll('.log-event')).toHaveLength(0)
  })

  it('clears both halves at once', () => {
    useStore.setState({ showEvents: EVENTS, license: { state: 'active', license: TEST_LICENSE } })
    act(() => { useStore.getState().appendLog([{ level: 'info', message: 'started' }]) })
    render()

    const clear = [...container.querySelectorAll<HTMLButtonElement>('.log-btn')].find(b => b.textContent === 'Clear')!
    act(() => clear.click())

    expect(useStore.getState().log).toEqual([])
    expect(useStore.getState().showEvents).toEqual([])
    expect(count()).toBe('empty')
  })
})
