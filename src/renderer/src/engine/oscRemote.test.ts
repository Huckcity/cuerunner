// What each remote command does to the show, against a recording of the runner's verbs:
// which cue it finds, where the selection goes, and the line the log keeps.
import { describe, it, expect, vi } from 'vitest'
import { runRemote, visibleOrder, type RemoteDeps } from './oscRemote'
import { createCue } from '../utils/cueDefaults'
import type { AudioCue, Cue } from '../../../shared/cue'

function cueOf(type: Cue['type'], number: string, patch: Partial<Cue> = {}): Cue {
  return { ...createCue(type, number), id: `id-${number}`, name: `Cue ${number}`, ...patch } as Cue
}

function harness(cues: Cue[], selected: string | null = null, collapsed: string[] = []) {
  let selection = selected
  const deps = {
    getCues: () => cues,
    getSelected: () => selection,
    getCollapsed: () => new Set(collapsed),
    select: vi.fn((id: string | null) => { selection = id }),
    go: vi.fn(),
    stop: vi.fn(),
    goById: vi.fn(),
    seekCue: vi.fn(),
    log: vi.fn()
  } satisfies RemoteDeps
  return { deps, selection: () => selection }
}

const SOURCE = 'OSC /go from 10.0.0.5:53001'

describe('runRemote', () => {
  it('presses GO and STOP, and says who pressed them', () => {
    const { deps } = harness([cueOf('wait', '1')], 'id-1')
    runRemote({ kind: 'go' }, deps, SOURCE)
    expect(deps.go).toHaveBeenCalledTimes(1)
    runRemote({ kind: 'stop' }, deps, 'OSC /stop from 10.0.0.5:53001')
    expect(deps.stop).toHaveBeenCalledWith()
    expect(deps.log.mock.calls.map(([entry]) => entry.message)).toEqual([
      `GO from ${SOURCE}`,
      'STOP from OSC /stop from 10.0.0.5:53001'
    ])
  })

  it('leaves the panic to main, which has already answered it', () => {
    const { deps } = harness([cueOf('wait', '1')], 'id-1')
    runRemote({ kind: 'panic' }, deps, SOURCE)
    expect(deps.stop).not.toHaveBeenCalled()
    expect(deps.log).not.toHaveBeenCalled()
  })

  it('stands on a cue and presses GO from there for /cue/{n}/go', () => {
    const { deps, selection } = harness([cueOf('wait', '1'), cueOf('wait', '2')], 'id-1')
    deps.go.mockImplementation(() => expect(selection()).toBe('id-2'))
    runRemote({ kind: 'cue-go', cue: { by: 'number', number: '2' } }, deps, SOURCE)
    expect(deps.go).toHaveBeenCalledTimes(1)
  })

  it('fires a cue where it is for /cue/{n}/start, leaving the selection alone', () => {
    const { deps, selection } = harness([cueOf('wait', '1'), cueOf('wait', '2')], 'id-1')
    runRemote({ kind: 'cue-start', cue: { by: 'number', number: '2' } }, deps, SOURCE)
    expect(deps.goById).toHaveBeenCalledWith('id-2')
    expect(selection()).toBe('id-1')
    expect(deps.log).toHaveBeenCalledWith({ level: 'info', message: `Started by ${SOURCE}`, label: '2 · Cue 2' })
  })

  it('will not fire a disarmed cue, and says so', () => {
    const { deps } = harness([cueOf('wait', '1', { isArmed: false })])
    runRemote({ kind: 'cue-start', cue: { by: 'number', number: '1' } }, deps, SOURCE)
    expect(deps.goById).not.toHaveBeenCalled()
    expect(deps.log.mock.calls[0][0].level).toBe('error')
  })

  it('names a cue that is not in the show rather than doing nothing in silence', () => {
    const { deps } = harness([cueOf('wait', '1')])
    runRemote({ kind: 'cue-stop', cue: { by: 'number', number: '99' } }, deps, SOURCE)
    expect(deps.stop).not.toHaveBeenCalled()
    expect(deps.log).toHaveBeenCalledWith({ level: 'error', message: `${SOURCE}: no cue 99 in this show` })
  })

  it('stops one cue, found by number', () => {
    const { deps } = harness([cueOf('wait', '1'), cueOf('wait', '2')])
    runRemote({ kind: 'cue-stop', cue: { by: 'number', number: '2' } }, deps, SOURCE)
    expect(deps.stop).toHaveBeenCalledWith('id-2')
  })

  it('reads the selected cue as the one the selection stands on', () => {
    const { deps } = harness([cueOf('wait', '1'), cueOf('wait', '2')], 'id-2')
    runRemote({ kind: 'cue-stop', cue: { by: 'selected' } }, deps, SOURCE)
    expect(deps.stop).toHaveBeenCalledWith('id-2')
  })

  it('seeks an audio cue in its own region’s seconds', () => {
    const audio = cueOf('audio', '4', { startTime: 2000 } as Partial<AudioCue>)
    const { deps } = harness([audio])
    runRemote({ kind: 'cue-seek', cue: { by: 'number', number: '4' }, seconds: 1.5 }, deps, SOURCE)
    expect(deps.seekCue).toHaveBeenCalledWith('id-4', 3500)
  })

  it('refuses to seek a cue that has no time to move to', () => {
    const { deps } = harness([cueOf('wait', '1')])
    runRemote({ kind: 'cue-seek', cue: { by: 'number', number: '1' }, seconds: 1 }, deps, SOURCE)
    expect(deps.seekCue).not.toHaveBeenCalled()
    expect(deps.log.mock.calls[0][0].level).toBe('error')
  })

  it('walks the selection one visible row at a time, and stops at either end', () => {
    const { deps, selection } = harness([cueOf('wait', '1'), cueOf('wait', '2'), cueOf('wait', '3')], 'id-2')
    runRemote({ kind: 'select-next' }, deps, SOURCE)
    expect(selection()).toBe('id-3')
    runRemote({ kind: 'select-next' }, deps, SOURCE)
    expect(selection()).toBe('id-3')
    runRemote({ kind: 'select-previous' }, deps, SOURCE)
    runRemote({ kind: 'select-previous' }, deps, SOURCE)
    runRemote({ kind: 'select-previous' }, deps, SOURCE)
    expect(selection()).toBe('id-1')
  })

  it('finds its way back in from the end of the show', () => {
    const cues = [cueOf('wait', '1'), cueOf('wait', '2')]
    const next = harness(cues, null)
    runRemote({ kind: 'select-next' }, next.deps, SOURCE)
    expect(next.selection()).toBe('id-1')
    const previous = harness(cues, null)
    runRemote({ kind: 'select-previous' }, previous.deps, SOURCE)
    expect(previous.selection()).toBe('id-2')
  })

  it('stands on a cue for /cue/{n}/select without firing anything', () => {
    const { deps, selection } = harness([cueOf('wait', '1'), cueOf('wait', '2')], 'id-1')
    runRemote({ kind: 'cue-select', cue: { by: 'number', number: '2' } }, deps, SOURCE)
    expect(selection()).toBe('id-2')
    expect(deps.go).not.toHaveBeenCalled()
    expect(deps.goById).not.toHaveBeenCalled()
  })
})

describe('visibleOrder', () => {
  it('drops what a folded group hides, a group inside it included', () => {
    const group = cueOf('group', '1')
    const inner = cueOf('group', '1.1', { parentId: 'id-1' })
    const deep = cueOf('wait', '1.1.1', { parentId: 'id-1.1' })
    const after = cueOf('wait', '2')
    expect(visibleOrder([group, inner, deep, after], new Set(['id-1'])).map(c => c.number)).toEqual(['1', '2'])
    expect(visibleOrder([group, inner, deep, after], new Set()).map(c => c.number)).toEqual(['1', '1.1', '1.1.1', '2'])
  })
})
