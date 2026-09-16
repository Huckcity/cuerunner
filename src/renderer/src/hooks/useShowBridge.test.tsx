// The bridge is where the renderer meets the show services: a snapshot for the world
// as it is now, and a subscription for everything after it. The order those two are
// applied in decides whether an event that lands during startup survives.
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useShowBridge } from './useShowBridge'
import { useStore } from '../store'
import { defaultShowSettings } from '../types/show'
import { TEST_LICENSE } from '../../../test/license'
import type { ShowEvent, ShowSettings, ShowSnapshot } from '../types/show'

function Harness() {
  useShowBridge()
  return null
}

function osc(address: string, at: number): ShowEvent {
  return { kind: 'osc', at, from: '10.0.0.5:8000', address, args: [] }
}

function snapshotAt(at: number, addresses: string[]): ShowSnapshot {
  return {
    at,
    services: [],
    devices: [],
    alerts: [],
    events: addresses.map(address => osc(address, at - 1))
  }
}

/** Every address in the river, in order — non-OSC events are not what these tests read. */
function addresses(): string[] {
  return useStore.getState().showEvents.map(event => event.kind === 'osc' ? event.address : '')
}

describe('useShowBridge', () => {
  let container: HTMLDivElement
  let root: Root
  let emit: (events: ShowEvent[]) => void
  let off: Mock
  /** The settings the show is holding, which is what the services are handed. */
  let settings: ShowSettings
  let resolveSnapshot: (snapshot: ShowSnapshot) => void

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    const pending = Promise.withResolvers<ShowSnapshot>()
    resolveSnapshot = pending.resolve
    off = vi.fn()

    const bridge = window.cuerunner.show
    vi.mocked(bridge.onEvents).mockImplementation(callback => {
      emit = callback
      return off
    })
    vi.mocked(bridge.snapshot).mockImplementation(() => pending.promise)
    vi.mocked(bridge.configure).mockImplementation(() => Promise.resolve())

    settings = defaultShowSettings()
    useStore.setState({
      license: { state: 'active', license: TEST_LICENSE },
      showSettings: settings,
      showServices: [],
      showDevices: [],
      showAlerts: [],
      showEvents: []
    })

    act(() => { root.render(<Harness />) })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllMocks()
  })

  async function settle(): Promise<void> {
    await act(async () => { await Promise.resolve() })
  }

  it('replays the events that arrived while the snapshot was in flight', async () => {
    emit([osc('/early', 2000)])

    await act(async () => {
      resolveSnapshot(snapshotAt(1500, ['/from-snapshot']))
    })
    await settle()

    expect(addresses()).toEqual(['/from-snapshot', '/early'])
  })

  it('drops a batch the snapshot already contains', async () => {
    // An event older than the snapshot was already folded into it, and applying it
    // again would put a stale reading back on the panel.
    emit([osc('/stale', 1000)])

    await act(async () => {
      resolveSnapshot(snapshotAt(1500, ['/from-snapshot']))
    })
    await settle()

    expect(addresses()).toEqual(['/from-snapshot'])
  })

  it('applies live batches immediately once the snapshot has landed', async () => {
    await act(async () => {
      resolveSnapshot(snapshotAt(1500, []))
    })
    await settle()

    act(() => { emit([osc('/live', 3000)]) })

    expect(addresses()).toEqual(['/live'])
  })

  it('sends the settings on mount, and again when the operator changes them', async () => {
    await settle()
    expect(vi.mocked(window.cuerunner.show.configure)).toHaveBeenCalledWith(settings)

    act(() => { useStore.getState().updateOscInSettings({ port: 53010 }) })
    await settle()

    expect(vi.mocked(window.cuerunner.show.configure)).toHaveBeenLastCalledWith(
      expect.objectContaining({ oscIn: { enabled: true, port: 53010 } })
    )
  })

  it('stops listening when the app shell unmounts', async () => {
    act(() => { root.unmount() })

    expect(off).toHaveBeenCalled()
  })

  it('never touches the show services while the machine is not licensed', async () => {
    // The services themselves are gated in the main process; with no key the window has
    // no reason to ask, and asking would leave a socket open behind a locked panel.
    act(() => root.unmount())
    vi.clearAllMocks()
    act(() => { useStore.setState({ license: { state: 'unlicensed' } }) })
    root = createRoot(container)
    act(() => { root.render(<Harness />) })
    await settle()

    expect(vi.mocked(window.cuerunner.show.onEvents)).not.toHaveBeenCalled()
    expect(vi.mocked(window.cuerunner.show.snapshot)).not.toHaveBeenCalled()
    expect(vi.mocked(window.cuerunner.show.configure)).not.toHaveBeenCalled()
  })
})
