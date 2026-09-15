// The window's half of redundant playback: what it offers the pair, what it warms for a
// takeover, and what it does with one when it is handed the show. The socket and the
// decision to take over belong to the main process and are held in the service's own
// tests; here the question is only what the window says and what it plays.
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useRedundancy } from './useRedundancy'
import { cueRunner } from '../engine/CueRunner'
import { audioEngine } from '../engine/audioEngineClient'
import { useStore } from '../store'
import { TEST_LICENSE } from '../../../test/license'
import { defaultRedundancySettings, type RedundancyDigest, type TakeoverNotice } from '../../../shared/redundancy'
import type { AudioCue } from '../types/cue'
import type { RedundancyEvent, ShowEvent } from '../types/show'

vi.mock('../engine/audioEngineClient')

const engine = vi.mocked(audioEngine)

function Harness() {
  useRedundancy()
  return null
}

function audioCue(overrides: Partial<AudioCue> = {}): AudioCue {
  return {
    id: 'a1',
    number: '1',
    name: 'Overture',
    type: 'audio',
    colorLabel: 'none',
    parentId: null,
    preWait: 0,
    postWait: 0,
    timelineOffset: 0,
    duration: 60_000,
    advance: 'none',
    isArmed: true,
    notes: '',
    filePath: '/show/overture.wav',
    startTime: 0,
    endTime: null,
    fadeInDuration: 0,
    volume: 1,
    pan: 0,
    outputs: null,
    loopCount: 0,
    playbackRate: 1,
    trim: 1,
    ...overrides
  }
}

/** This machine's settings as the main process holds them: paired and standing by. */
function paired(): ReturnType<typeof defaultRedundancySettings> {
  return { ...defaultRedundancySettings('desk-b', 'id-b'), enabled: true, role: 'standby', peerHost: '10.0.0.9' }
}

function digest(overrides: Partial<RedundancyDigest> = {}): RedundancyDigest {
  return {
    at: 1000,
    show: { id: 'show-1', name: 'Hamlet', cues: 6, hash: 'abcd1234' },
    selectedId: 'a1',
    running: [],
    prepared: 0,
    ...overrides
  }
}

function statusEvent(overrides: Partial<RedundancyEvent['status']> = {}, takeover?: TakeoverNotice): ShowEvent {
  return {
    kind: 'redundancy',
    at: 1000,
    status: {
      at: 1000,
      enabled: true,
      role: 'standby',
      name: 'desk-b',
      driving: false,
      term: 0,
      listening: true,
      detail: 'standing by — desk-a in sync',
      peer: null,
      lastEvent: null,
      ...overrides
    },
    ...(takeover === undefined ? {} : { takeover })
  }
}

/** The publish calls the hook has made, in order, with their payloads. */
function published(): Array<Record<string, unknown>> {
  const command = vi.mocked(window.winslab.show.command)
  return command.mock.calls
    .filter(call => call[0] === 'redundancy' && call[1] === 'publish')
    .map(call => call[2] as Record<string, unknown>)
}

describe('useRedundancy', () => {
  let container: HTMLDivElement
  let root: Root
  let adopt: Mock

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    adopt = vi.spyOn(cueRunner, 'adopt').mockImplementation(() => ({ adopted: 0, skipped: 0 }))

    // The machine's own file is the truth about whether this machine is paired: the
    // hook reads it at startup and the store follows it.
    vi.mocked(window.winslab.redundancy.settings).mockResolvedValue(
      paired()
    )
    useStore.setState({
      license: { state: 'active', license: TEST_LICENSE },
      cues: [audioCue()],
      selectedId: 'a1',
      workspaceId: 'show-1',
      workspaceName: 'Hamlet',
      running: new Map(),
      redundancy: null,
      redundancySettings: null,
      redundancyTakeover: null,
      log: []
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    adopt.mockRestore()
    vi.clearAllMocks()
  })

  function render(): void {
    act(() => { root.render(<Harness />) })
  }

  async function flush(): Promise<void> {
    await act(async () => { await Promise.resolve() })
  }

  it('offers the show to the pair, with the cue the operator is standing on', async () => {
    useStore.setState({ redundancySettings: paired() })
    render()
    await flush()

    const last = published().at(-1)!
    expect(last.show).toEqual({ id: 'show-1', name: 'Hamlet', cues: 1, hash: expect.any(String) })
    expect(last.selectedId).toBe('a1')
    expect(last.at).toEqual(expect.any(Number))
  })

  it('offers it again when the operator moves in the show', async () => {
    useStore.setState({
      cues: [audioCue(), audioCue({ id: 'a2', number: '2', name: 'Entrance' })],
      redundancySettings: paired()
    })
    render()
    await flush()
    const before = published().length

    act(() => { useStore.getState().select(null) })
    await flush()
    expect(published().length).toBeGreaterThan(before)
    expect(published().at(-1)!.selectedId).toBeNull()
  })

  it('says nothing at all while the machine is not paired', async () => {
    // Off is the default: a machine nobody has paired has no show to offer.
    vi.mocked(window.winslab.redundancy.settings).mockResolvedValue(defaultRedundancySettings('desk-b', 'id-b'))
    useStore.setState({ redundancySettings: defaultRedundancySettings('desk-b', 'id-b') })
    render()
    await flush()
    expect(published()).toEqual([])
  })

  it('says nothing while the machine is not licensed', async () => {
    useStore.setState({ license: { state: 'unlicensed' }, redundancySettings: paired() })
    render()
    await flush()
    expect(published()).toEqual([])
  })

  it('reads this machine’s own settings at startup', async () => {
    render()
    await flush()
    await flush()
    expect(useStore.getState().redundancySettings?.name).toBe('desk-b')
    expect(vi.mocked(window.winslab.redundancy.settings)).toHaveBeenCalled()
  })

  it('warms the media a takeover would need, so picking the show up costs no wait', async () => {
    useStore.setState({ redundancySettings: paired() })
    render()
    await flush()

    expect(engine.prepare).toHaveBeenCalledWith('a1', '/show/overture.wav')
    await flush()
    expect(published().at(-1)!.prepared).toBe(1)
  })

  it('puts the show the live machine was running back on this machine’s engine', async () => {
    useStore.setState({ redundancySettings: paired() })
    render()
    await flush()

    const notice: TakeoverNotice = {
      at: 2000,
      silentMs: 2000,
      digest: digest({
        running: [
          {
            cueId: 'a1',
            number: '1',
            name: 'Overture',
            type: 'audio',
            state: 'playing',
            positionMs: 5000,
            durationMs: 60_000
          }
        ]
      }),
      reason: 'the live machine stopped answering',
      term: 1
    }

    act(() => { useStore.getState().applyShowEvents([statusEvent({ driving: true, term: 1 }, notice)]) })
    await flush()

    expect(adopt).toHaveBeenCalledTimes(1)
    const plan = adopt.mock.calls[0][0] as { adopt: Array<{ cueId: string; seekMs: number }>; silentMs: number }
    // Five seconds into the cue when the last beat said so, plus the two seconds the
    // machine has been quiet: the show carried on while nobody was listening.
    expect(plan.adopt).toEqual([expect.objectContaining({ cueId: 'a1', seekMs: 7000 })])
    expect(plan.silentMs).toBe(2000)
  })

  it('takes the notice off the store, so a replayed batch cannot fire the show twice', async () => {
    useStore.setState({ redundancySettings: paired() })
    render()
    await flush()

    const notice: TakeoverNotice = {
      at: 2000,
      silentMs: 0,
      digest: digest(),
      reason: 'the operator took the show',
      term: 1
    }
    act(() => { useStore.getState().applyShowEvents([statusEvent({ driving: true, term: 1 }, notice)]) })
    await flush()
    expect(useStore.getState().redundancyTakeover).toBeNull()
    expect(adopt).toHaveBeenCalledTimes(1)

    // A second render of the same state has nothing left to act on.
    act(() => { root.render(<Harness />) })
    await flush()
    expect(adopt).toHaveBeenCalledTimes(1)
  })
})
