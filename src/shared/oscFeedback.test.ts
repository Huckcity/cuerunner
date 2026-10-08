// What a remote is told and what it is answered: Cuerunner's own namespace, and QLab's
// /reply convention for a remote written for QLab.
import { describe, it, expect } from 'vitest'
import {
  cueListMessages,
  feedbackChanges,
  parseFeedbackRequest,
  playheadMessages,
  progressMessages,
  qlabCueUpdate,
  qlabPlayheadUpdate,
  qlabReply,
  runningMessages,
  type OscFeedbackSnapshot
} from './oscFeedback'

const cue = (id: string, number: string, name: string, extra: Partial<OscFeedbackSnapshot['cues'][number]> = {}) =>
  ({ id, number, name, type: 'audio', parentId: null, isArmed: true, colorName: 'none', notes: '', ...extra })

const snapshot = (patch: Partial<OscFeedbackSnapshot> = {}): OscFeedbackSnapshot => ({
  workspaceId: 'WS',
  workspaceName: 'Press Night',
  listId: 'main',
  playhead: { id: 'c2', number: '2', name: 'Storm', type: 'audio' },
  running: [
    { id: 'c1', number: '1', name: 'Walk-in', type: 'audio', state: 'playing', elapsedMs: 5000, durationMs: 20_000 },
    { id: 'c3', number: '3', name: 'Loop', type: 'audio', state: 'paused', elapsedMs: 1000, durationMs: null }
  ],
  cues: [
    cue('c1', '1', 'Walk-in'),
    cue('c2', '2', 'Storm', { notes: 'big', colorName: 'red' }),
    cue('c3', '3', 'Loop'),
    cue('g', '4', 'Act 2', { type: 'group' }),
    cue('c5', '4.1', 'Inside', { parentId: 'g', isArmed: false })
  ],
  ...patch
})

const values = (messages: Array<{ address: string; args: Array<{ value: unknown }> }>) =>
  Object.fromEntries(messages.map(message => [message.address, message.args.map(arg => arg.value)]))

describe('Cuerunner’s own feedback', () => {
  it('says where the playhead stands, and empty strings at the end of the show', () => {
    expect(values(playheadMessages(snapshot()))).toEqual({
      '/cuerunner/playhead/number': ['2'],
      '/cuerunner/playhead/name': ['Storm'],
      '/cuerunner/playhead/id': ['c2'],
      '/cuerunner/playhead/type': ['audio']
    })
    expect(values(playheadMessages(snapshot({ playhead: null })))['/cuerunner/playhead/number']).toEqual([''])
  })

  it('names the running cues as slots, and empties the slots that are no longer used', () => {
    const now = values(runningMessages(snapshot(), 3))
    expect(now['/cuerunner/running/count']).toEqual([2])
    expect(now['/cuerunner/running/active']).toEqual([1])
    expect(now['/cuerunner/running/0/number']).toEqual(['1'])
    expect(now['/cuerunner/running/1/state']).toEqual(['paused'])
    expect(now['/cuerunner/running/2/name']).toEqual([''])
    expect(now['/cuerunner/running/3/name']).toBeUndefined()
  })

  it('pushes progress, with −1 where nobody can say how long, and zeroes a freed slot once', () => {
    const now = values(progressMessages(snapshot(), 3))
    expect(now['/cuerunner/running/0/progress']).toEqual([0.25])
    expect(now['/cuerunner/running/0/elapsed']).toEqual([5])
    expect(now['/cuerunner/running/0/remaining']).toEqual([15])
    expect(now['/cuerunner/running/0/duration']).toEqual([20])
    expect(now['/cuerunner/running/1/remaining']).toEqual([-1])
    expect(now['/cuerunner/running/1/duration']).toEqual([-1])
    expect(now['/cuerunner/running/2/progress']).toEqual([0])
  })

  it('lists the cues as a dropdown’s values', () => {
    const now = values(cueListMessages(snapshot()))
    expect(now['/cuerunner/cues/count']).toEqual([5])
    expect(JSON.parse(String(now['/cuerunner/cues/options'][0]))[1]).toEqual(['2', '2 — Storm'])
  })

  it('tells a change of playhead, of what runs and of the list apart, and which cues moved', () => {
    const before = snapshot()
    expect(feedbackChanges(null, before)).toMatchObject({ playhead: true, running: true, cues: true })
    expect(feedbackChanges(before, snapshot())).toEqual({ playhead: false, running: false, cues: false, changedCueIds: [] })
    // Progress alone is not a change: it is pushed on its own clock.
    const later = snapshot({ running: before.running.map(run => ({ ...run, elapsedMs: run.elapsedMs + 500 })) })
    expect(feedbackChanges(before, later).running).toBe(false)
    const stopped = snapshot({ running: before.running.slice(1), playhead: null })
    expect(feedbackChanges(before, stopped)).toMatchObject({ playhead: true, running: true, changedCueIds: ['c1'] })
  })

  it('reads the feedback’s own requests, and QLab’s /updates', () => {
    expect(parseFeedbackRequest('/cuerunner/feedback/request', [])).toEqual({ kind: 'request' })
    expect(parseFeedbackRequest('/cuerunner/feedback/subscribe', [{ value: 9001 }])).toEqual({ kind: 'subscribe', port: 9001 })
    expect(parseFeedbackRequest('/cuerunner/feedback/subscribe', [{ value: 'x' }])).toEqual({ kind: 'subscribe', port: null })
    expect(parseFeedbackRequest('/cuerunner/feedback/unsubscribe', [])).toEqual({ kind: 'unsubscribe' })
    expect(parseFeedbackRequest('/workspace/WS/updates', [{ value: 1 }])).toEqual({ kind: 'qlab-updates', on: true })
    expect(parseFeedbackRequest('/updates', [{ value: 0 }])).toEqual({ kind: 'qlab-updates', on: false })
    expect(parseFeedbackRequest('/go', [])).toBeNull()
  })
})

describe('QLab’s request and reply', () => {
  const ask = (address: string, args: unknown[] = []) => qlabReply(address, args, snapshot(), '1.2.3')

  it('answers a property of the selected cue on /reply, with QLab’s JSON', () => {
    expect(ask('/cue/selected/number')).toEqual({
      address: '/reply/cue/selected/number',
      body: { workspace_id: 'WS', address: '/cue/selected/number', status: 'ok', data: '2' }
    })
    expect(ask('/workspace/WS/cue/playhead/name')?.body.data).toBe('Storm')
    expect(ask('/cue/2/colorName')?.body.data).toBe('red')
    expect(ask('/cue_id/c1/percentActionElapsed')?.body.data).toBe(0.25)
    expect(ask('/cue/1/isRunning')?.body.data).toBe(true)
    expect(ask('/cue/3/isPaused')?.body.data).toBe(true)
    expect(ask('/cue/1/actionElapsed')?.body.data).toBe(5)
  })

  it('lists what is running, what is selected and the list itself', () => {
    expect((ask('/runningCues')?.body.data as Array<{ number: string }>).map(entry => entry.number)).toEqual(['1'])
    expect((ask('/runningOrPausedCues')?.body.data as Array<{ number: string }>).map(entry => entry.number)).toEqual(['1', '3'])
    expect((ask('/selectedCues')?.body.data as Array<{ uniqueID: string }>)[0].uniqueID).toBe('c2')
    const [list] = ask('/cueLists')?.body.data as Array<{ cues: Array<{ number: string; cues?: Array<{ number: string; armed: boolean }> }> }>
    expect(list.cues.map(entry => entry.number)).toEqual(['1', '2', '3', '4'])
    expect(list.cues[3].cues).toEqual([expect.objectContaining({ number: '4.1', armed: false })])
  })

  it('answers the workspace-level questions a QLab remote opens with', () => {
    expect(ask('/thump')?.body.data).toBe('thump')
    expect(ask('/version')?.body.data).toBe('1.2.3')
    expect(ask('/workspaces')?.body.data).toEqual([{ uniqueID: 'WS', displayName: 'Press Night', hasPasscode: false, version: '1.2.3' }])
    expect(qlabReply('/workspaces', [], null, '1')?.body.data).toEqual([])
  })

  it('leaves commands and setters to the window, and says a cue it has not got is not there', () => {
    expect(ask('/go')).toBeNull()
    expect(ask('/cue/2/start')).toBeNull()
    // QLab's setter: the same address with a value renames the cue, and a remote does not edit this show.
    expect(ask('/cue/2/name', ['Rain'])).toBeNull()
    expect(ask('/cue/99/number')).toMatchObject({ body: { status: 'error' } })
  })

  it('pushes QLab’s update addresses', () => {
    expect(qlabCueUpdate('WS', 'c1')).toEqual({ address: '/update/workspace/WS/cue_id/c1', args: [] })
    expect(qlabPlayheadUpdate(snapshot())).toEqual({
      address: '/update/workspace/WS/cueList/main/playbackPosition',
      args: [{ type: 's', value: 'c2' }]
    })
  })
})
