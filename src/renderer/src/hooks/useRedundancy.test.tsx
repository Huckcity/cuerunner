// The window's half of redundant playback: what it offers the pair, what it warms for a
// takeover, and what it does with one when it is handed the show. The socket and the
// decision to take over belong to the main process and are held in the service's own
// tests; here the question is only what the window says and what it plays.
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useRedundancy } from './useRedundancy'
import { cueEngine } from '../engine/CueEngine'
import { audioEngine } from '../engine/audioEngineClient'
import { useStore } from '../store'
import { TEST_LICENSE } from '../../../test/license'
import {
  NOTICE_FRESH_MS,
  defaultRedundancySettings,
  type RedundancyDigest,
  type ShowNotice
} from '../../../shared/redundancy'
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

function statusEvent(overrides: Partial<RedundancyEvent['status']> = {}, notice?: ShowNotice): ShowEvent {
  return {
    kind: 'redundancy',
    at: notice?.at ?? 1000,
    status: {
      at: notice?.at ?? 1000,
      enabled: true,
      role: 'standby',
      name: 'desk-b',
      driving: false,
      term: 0,
      listening: true,
      detail: 'standing by — desk-a in sync',
      peer: null,
      lastEvent: null,
      // The notice travels inside the status: it is what a window that reloaded reads back.
      lastNotice: notice ?? null,
      ...overrides
    }
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
  let standDown: Mock

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    adopt = vi.spyOn(cueEngine, 'adopt').mockImplementation(() => ({ adopted: 0, skipped: 0 }))
    standDown = vi.spyOn(cueEngine, 'standDown').mockImplementation(() => {})

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

      log: []
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    adopt.mockRestore()
    standDown.mockRestore()
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

    const notice: ShowNotice = {
      kind: 'takeover',
      at: Date.now(),
      seq: 1,
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

    const notice: ShowNotice = {
      kind: 'takeover',
      at: Date.now(),
      seq: 1,
      silentMs: 0,
      digest: digest(),
      reason: 'the operator took the show',
      term: 1
    }
    act(() => { useStore.getState().applyShowEvents([statusEvent({ driving: true, term: 1 }, notice)]) })
    await flush()
    expect(adopt).toHaveBeenCalledTimes(1)

    // A notice that arrives by a second route — the snapshot of a window that reloaded
    // just after the takeover — is the same term, and the show is not fired twice.
    act(() => {
      useStore.getState().setShowSnapshot({
        at: notice.at,
        services: [],
        devices: [],
        alerts: [],
        events: [statusEvent({ driving: true, term: 1 }, notice)]
      })
    })
    await flush()
    expect(adopt).toHaveBeenCalledTimes(1)
  })

  it('ignores a decision that has been overtaken', async () => {
    // A window opening onto an old status is being shown what happened, not handed a
    // show: a takeover from ten minutes ago is not a cue to start, and a stand-down from
    // before the operator took the show back is not a cue to stop.
    useStore.setState({ redundancySettings: paired() })
    render()
    await flush()

    const stale: ShowNotice = {
      kind: 'takeover',
      at: Date.now() - NOTICE_FRESH_MS - 1000,
      seq: 4,
      silentMs: 0,
      digest: digest(),
      reason: 'the live machine stopped answering',
      term: 1
    }
    act(() => { useStore.getState().applyShowEvents([statusEvent({ driving: true, term: 1 }, stale)]) })
    await flush()
    expect(adopt).not.toHaveBeenCalled()

    // And one that disagrees with the machine's own state: a takeover is only this
    // machine's business while it is the one driving.
    const wrong: ShowNotice = { ...stale, at: Date.now(), seq: 5 }
    act(() => { useStore.getState().applyShowEvents([statusEvent({ driving: false, term: 1 }, wrong)]) })
    await flush()
    expect(adopt).not.toHaveBeenCalled()
  })

  it('acts on a hand-back even though the term has not moved', async () => {
    // Taking the show over and handing it back are two decisions under one term: the
    // sequence is what a window counts, or the hand-back would be dropped and the machine
    // would keep playing the show it has just given away.
    useStore.setState({ redundancySettings: paired() })
    render()
    await flush()

    act(() => {
      useStore.getState().applyShowEvents([statusEvent({ driving: true, term: 1 }, {
        kind: 'takeover',
        at: Date.now(),
        seq: 1,
        silentMs: 0,
        digest: digest(),
        reason: 'the operator took the show',
        term: 1
      })])
    })
    await flush()
    expect(adopt).toHaveBeenCalledTimes(1)

    act(() => {
      useStore.getState().applyShowEvents([statusEvent({ driving: false, term: 1 }, {
        kind: 'stand-down',
        at: Date.now(),
        seq: 2,
        term: 1,
        reason: 'the show was handed back'
      })])
    })
    await flush()
    expect(standDown).toHaveBeenCalledTimes(1)
  })

  it('stops playing when the show has moved to the other machine', async () => {
    // A machine that is no longer driving is no longer the sound. Two machines holding
    // the same cue is the one outcome a pair exists to prevent.
    useStore.setState({ redundancySettings: paired() })
    render()
    await flush()

    const notice: ShowNotice = {
      kind: 'stand-down',
      at: Date.now(),
      seq: 1,
      term: 2,
      reason: 'desk-a is running the show'
    }
    act(() => { useStore.getState().applyShowEvents([statusEvent({ driving: false, term: 2 }, notice)]) })
    await flush()

    expect(standDown).toHaveBeenCalledTimes(1)
    expect(adopt).not.toHaveBeenCalled()
    const messages = useStore.getState().log.map(entry => entry.message)
    expect(messages.some(message => message.includes('Stood down'))).toBe(true)
  })
})
