// OSC feedback: what the show says back to a remote — a TouchOSC page, a QLab-style client, a
// stage manager's tablet — so it can read where the playhead is, what is running and how far
// each running cue has got.
//
// Two conventions are spoken, as the input answers two. A remote written for QLab asks and is
// answered the way QLab's published OSC dictionary documents: a query is answered on
// `/reply/<the address it asked>` with a JSON document (`workspace_id`, `address`, `status`,
// `data`), sent back to the address and port the query came from; and a remote that sent
// `/updates 1` is pushed `/update/workspace/{id}/…` when the playhead moves or a cue starts or
// stops. Everything else is Cuerunner's own namespace, `/cuerunner/…`, pushed to the
// destination the show names and to any remote that asked with `/cuerunner/feedback/subscribe`:
// the playhead, the running cues as numbered slots, and their progress at a rate the show sets.
//
// Nothing here is QLab's code: it is the address grammar and reply shape their documentation
// publishes, read for interoperability. The window builds the snapshot (it owns the cue list and
// the clocks); main keeps the last one, answers queries from it and pushes what changed. These
// functions are pure so both halves read one grammar.

import type { OscArg } from './cue'

/** What a show's settings say about feedback. Optional on disk inside `oscIn`. */
export interface OscFeedbackSettings {
  /** Push the show's state to `host:port` as well as to the remotes that subscribe. */
  enabled: boolean
  host: string
  port: number
  /** How often a running cue's progress is pushed, per second; 0 pushes none. */
  rateHz: number
}

export const DEFAULT_FEEDBACK_RATE_HZ = 10
export const MAX_FEEDBACK_RATE_HZ = 30

export function defaultFeedbackSettings(): OscFeedbackSettings {
  return { enabled: false, host: '127.0.0.1', port: 53001, rateHz: DEFAULT_FEEDBACK_RATE_HZ }
}

/** How many running cues are pushed as slots: a page has room for so many strips. */
export const FEEDBACK_SLOTS = 8

/** One cue as a remote reads it. */
export interface FeedbackCue {
  id: string
  number: string
  name: string
  type: string
}

/** One running cue, with how far it has got. `durationMs` is null where nobody can say. */
export interface FeedbackRun extends FeedbackCue {
  state: 'pre-wait' | 'playing' | 'post-wait' | 'paused'
  elapsedMs: number
  durationMs: number | null
}

/** What the window publishes: the show as a remote can read it, at one moment. */
export interface OscFeedbackSnapshot {
  workspaceId: string
  workspaceName: string
  /** The list the playhead stands in, for QLab's `cueList/{id}/playbackPosition`. */
  listId: string
  /** The cue GO fires next, or null at the end of the show. */
  playhead: FeedbackCue | null
  /** Running cues, in list order. */
  running: FeedbackRun[]
  /** Every cue, in list order, with where it sits and whether it is armed. */
  cues: Array<FeedbackCue & { parentId: string | null; isArmed: boolean; colorName: string; notes: string }>
}

export interface FeedbackMessage {
  address: string
  args: OscArg[]
}

const s = (value: string): OscArg => ({ type: 's', value })
const i = (value: number): OscArg => ({ type: 'i', value: Math.round(value) })
const f = (value: number): OscArg => ({ type: 'f', value })

/** The playhead's messages: number, name, id and type, empty strings at the end of the show. */
export function playheadMessages(snapshot: OscFeedbackSnapshot): FeedbackMessage[] {
  const cue = snapshot.playhead
  return [
    { address: '/cuerunner/playhead/number', args: [s(cue?.number ?? '')] },
    { address: '/cuerunner/playhead/name', args: [s(cue?.name ?? '')] },
    { address: '/cuerunner/playhead/id', args: [s(cue?.id ?? '')] },
    { address: '/cuerunner/playhead/type', args: [s(cue?.type ?? '')] }
  ]
}

/**
 * The running cues as slots 0…7, topmost first: count, whether anything runs, and each slot's
 * number, name, id and state. `previousCount` slots that are now empty are written once as empty
 * so a remote's strip does not keep showing a cue that has stopped.
 */
export function runningMessages(snapshot: OscFeedbackSnapshot, previousCount: number): FeedbackMessage[] {
  const running = snapshot.running.slice(0, FEEDBACK_SLOTS)
  const out: FeedbackMessage[] = [
    { address: '/cuerunner/running/count', args: [i(snapshot.running.length)] },
    { address: '/cuerunner/running/active', args: [i(snapshot.running.length > 0 ? 1 : 0)] }
  ]
  const slots = Math.min(FEEDBACK_SLOTS, Math.max(running.length, previousCount))
  for (let slot = 0; slot < slots; slot++) {
    const run = running[slot]
    out.push(
      { address: `/cuerunner/running/${slot}/number`, args: [s(run?.number ?? '')] },
      { address: `/cuerunner/running/${slot}/name`, args: [s(run?.name ?? '')] },
      { address: `/cuerunner/running/${slot}/id`, args: [s(run?.id ?? '')] },
      { address: `/cuerunner/running/${slot}/state`, args: [s(run?.state ?? '')] }
    )
  }
  return out
}

/**
 * Each running slot's progress, 0–1, its elapsed and remaining seconds, and its length; −1 for a
 * remaining or a length nobody can say (a loop for ever, a cue held open). `previousCount` slots
 * that are now empty get one zeroing pulse, so a remote's gauge does not freeze where it was.
 */
export function progressMessages(snapshot: OscFeedbackSnapshot, previousCount: number): FeedbackMessage[] {
  const running = snapshot.running.slice(0, FEEDBACK_SLOTS)
  const out: FeedbackMessage[] = []
  const slots = Math.min(FEEDBACK_SLOTS, Math.max(running.length, previousCount))
  for (let slot = 0; slot < slots; slot++) {
    const run = running[slot]
    const elapsed = run === undefined ? 0 : Math.max(0, run.elapsedMs) / 1000
    const duration = run?.durationMs ?? null
    const known = duration !== null && duration > 0
    const progress = run === undefined ? 0 : known ? Math.min(1, Math.max(0, run.elapsedMs / duration)) : 0
    out.push(
      { address: `/cuerunner/running/${slot}/progress`, args: [f(progress)] },
      { address: `/cuerunner/running/${slot}/elapsed`, args: [f(elapsed)] },
      {
        address: `/cuerunner/running/${slot}/remaining`,
        args: [f(run === undefined ? 0 : known ? Math.max(0, duration - run.elapsedMs) / 1000 : -1)]
      },
      { address: `/cuerunner/running/${slot}/duration`, args: [f(run === undefined ? 0 : known ? duration / 1000 : -1)] }
    )
  }
  return out
}

/**
 * The whole list for a remote's picker: how many cues, and a JSON list of `[number, "number —
 * name"]` pairs, the shape a dropdown in Open Stage Control or TouchOSC takes as its values.
 */
export function cueListMessages(snapshot: OscFeedbackSnapshot): FeedbackMessage[] {
  const options = snapshot.cues.map(cue => {
    const label = cue.number !== '' && cue.name !== '' ? `${cue.number} — ${cue.name}` : cue.number || cue.name
    return [cue.number, label]
  })
  return [
    { address: '/cuerunner/cues/count', args: [i(snapshot.cues.length)] },
    { address: '/cuerunner/cues/options', args: [s(JSON.stringify(options))] }
  ]
}

/** What changed between two snapshots, for the structural pushes. */
export function feedbackChanges(
  before: OscFeedbackSnapshot | null,
  after: OscFeedbackSnapshot
): { playhead: boolean; running: boolean; cues: boolean; changedCueIds: string[] } {
  const playhead = before === null || before.playhead?.id !== after.playhead?.id ||
    before.playhead?.number !== after.playhead?.number || before.playhead?.name !== after.playhead?.name
  const runKey = (snapshot: OscFeedbackSnapshot | null): string =>
    snapshot === null ? '' : snapshot.running.map(run => `${run.id}:${run.state}:${run.number}:${run.name}`).join('|')
  const running = runKey(before) !== runKey(after)
  const listKey = (snapshot: OscFeedbackSnapshot | null): string =>
    snapshot === null ? '' : snapshot.cues.map(cue => `${cue.id}:${cue.number}:${cue.name}`).join('|')
  const cues = listKey(before) !== listKey(after)
  // The cues whose running state moved: started, stopped, paused or resumed.
  const was = new Map((before?.running ?? []).map(run => [run.id, run.state]))
  const now = new Map(after.running.map(run => [run.id, run.state]))
  const changedCueIds = [...new Set([...was.keys(), ...now.keys()])].filter(id => was.get(id) !== now.get(id))
  return { playhead, running, cues, changedCueIds }
}

// ── QLab's request / reply ─────────────────────────────────────────────────

/** QLab's `/workspace/{id}` prefix, which names the one show this app has open. */
const WORKSPACE_PREFIX = /^\/workspace\/[^/]+(?=\/)/

/** A reply to a QLab-style query: where it goes, and the JSON document it carries. */
export interface QLabReply {
  address: string
  body: { workspace_id?: string; address: string; status: 'ok' | 'error'; data?: unknown }
}

/** A cue as QLab's dictionary describes one in a list reply. */
function qlabCue(cue: OscFeedbackSnapshot['cues'][number] | FeedbackCue, listName = ''): Record<string, unknown> {
  const full = cue as Partial<OscFeedbackSnapshot['cues'][number]>
  return {
    uniqueID: cue.id,
    number: cue.number,
    name: cue.name,
    listName: listName || cue.name,
    type: qlabType(cue.type),
    colorName: full.colorName ?? 'none',
    flagged: false,
    armed: full.isArmed ?? true
  }
}

/** Cuerunner's types under QLab's names, where QLab has one. */
function qlabType(type: string): string {
  switch (type) {
    case 'audio': return 'Audio'
    case 'midi': return 'MIDI'
    case 'osc': return 'Network'
    case 'wait': return 'Wait'
    case 'fade': return 'Fade'
    case 'stop': return 'Stop'
    case 'group': return 'Group'
    case 'devamp': return 'Devamp'
    case 'memo': return 'Memo'
    case 'script': return 'Script'
    case 'midiFile': return 'MIDI File'
    case 'light': return 'Light'
    case 'timecode': return 'Timecode'
    case 'control': return 'Start'
    default: return type
  }
}

/** The list as QLab's `/cueLists` describes it: cues inside groups as their `cues`. */
function qlabList(snapshot: OscFeedbackSnapshot): Record<string, unknown> {
  const children = new Map<string | null, OscFeedbackSnapshot['cues']>()
  for (const cue of snapshot.cues) {
    const list = children.get(cue.parentId) ?? []
    list.push(cue)
    children.set(cue.parentId, list)
  }
  const tree = (parentId: string | null, depth: number): unknown[] =>
    (children.get(parentId) ?? []).map(cue => ({
      ...qlabCue(cue),
      // Bounded by the list itself: a group cannot hold itself, and the depth is a backstop.
      ...(cue.type === 'group' && depth < 32 ? { cues: tree(cue.id, depth + 1) } : {})
    }))
  return {
    uniqueID: snapshot.listId,
    number: '',
    name: 'Main Cue List',
    listName: 'Main Cue List',
    type: 'Cue List',
    colorName: 'none',
    flagged: false,
    armed: true,
    cues: tree(null, 0)
  }
}

/** The one property of one cue a `/cue/{ref}/{property}` query reads. */
function cueProperty(snapshot: OscFeedbackSnapshot, cue: OscFeedbackSnapshot['cues'][number], property: string): unknown {
  const run = snapshot.running.find(entry => entry.id === cue.id)
  const elapsed = (run?.elapsedMs ?? 0) / 1000
  const duration = run?.durationMs ?? null
  switch (property) {
    case 'number': return cue.number
    case 'name': return cue.name
    case 'displayName': return cue.name || cue.number
    case 'listName': return cue.name
    case 'uniqueID': return cue.id
    case 'type': return qlabType(cue.type)
    case 'armed': return cue.isArmed
    case 'colorName': return cue.colorName
    case 'notes': return cue.notes
    case 'isRunning': return run !== undefined && run.state !== 'paused'
    case 'isPaused': return run?.state === 'paused'
    case 'isActionRunning': return run?.state === 'playing'
    case 'actionElapsed': return elapsed
    case 'preWaitElapsed': return run?.state === 'pre-wait' ? elapsed : 0
    case 'duration':
    case 'currentDuration': return duration === null ? 0 : duration / 1000
    case 'percentActionElapsed': return duration !== null && duration > 0 && run ? Math.min(1, run.elapsedMs / duration) : 0
    default: return undefined
  }
}

/**
 * The reply to a QLab-style query, or null when the address is not a query this app answers —
 * a command (`/go`, `/cue/12/start`) is the remote's business, and the window's to carry out.
 * `appVersion` answers `/version`. A query carries no arguments; the same address with one is a
 * setter, which is not answered.
 */
export function qlabReply(
  address: string,
  args: readonly unknown[],
  snapshot: OscFeedbackSnapshot | null,
  appVersion: string
): QLabReply | null {
  const path = address.replace(WORKSPACE_PREFIX, '')
  const reply = (status: 'ok' | 'error', data?: unknown): QLabReply => ({
    address: `/reply${address}`,
    body: {
      ...(snapshot !== null ? { workspace_id: snapshot.workspaceId } : {}),
      address,
      status,
      ...(data !== undefined ? { data } : {})
    }
  })

  if (path === '/thump') return reply('ok', 'thump')
  if (path === '/version') return reply('ok', appVersion)
  if (path === '/connect') return reply('ok', 'ok')
  if (path === '/workspaces') {
    return reply('ok', snapshot === null ? [] : [{
      uniqueID: snapshot.workspaceId,
      displayName: snapshot.workspaceName,
      hasPasscode: false,
      version: appVersion
    }])
  }
  if (snapshot === null) return null
  const byId = new Map(snapshot.cues.map(cue => [cue.id, cue]))
  const runningCues = (): unknown[] => snapshot.running.flatMap(run => {
    const cue = byId.get(run.id)
    return cue === undefined ? [] : [qlabCue(cue)]
  })

  switch (path) {
    case '/runningCues':
      return reply('ok', snapshot.running.filter(run => run.state !== 'paused').flatMap(run => {
        const cue = byId.get(run.id)
        return cue === undefined ? [] : [qlabCue(cue)]
      }))
    case '/runningOrPausedCues':
      return reply('ok', runningCues())
    case '/selectedCues':
      return reply('ok', snapshot.playhead === null ? [] : [qlabCue(byId.get(snapshot.playhead.id) ?? snapshot.playhead)])
    case '/cueLists':
      return reply('ok', [qlabList(snapshot)])
    case '/playbackPosition':
      return reply('ok', snapshot.playhead?.id ?? '')
  }

  // `/cue/{ref}/{property}` and `/cue_id/{id}/{property}`: a property of one cue. With an
  // argument the same address is QLab's setter — `/cue/1/name "Walk-in"` renames the cue — and
  // a remote does not edit this show, so it is not answered as though it had been read.
  if (args.length > 0) return null
  const byNumber = /^\/cue\/(.+)\/([A-Za-z]+)$/.exec(path)
  const byUid = /^\/cue_id\/([^/]+)\/([A-Za-z]+)$/.exec(path)
  const match = byNumber ?? byUid
  if (match === null) return null
  const [, ref, property] = match
  let cue: OscFeedbackSnapshot['cues'][number] | undefined
  if (byUid !== null) cue = byId.get(ref)
  else if (ref === 'selected' || ref === 'playhead') cue = snapshot.playhead === null ? undefined : byId.get(snapshot.playhead.id)
  else cue = snapshot.cues.find(candidate => candidate.number.trim() === ref.trim())
  const value = cue === undefined ? undefined : cueProperty(snapshot, cue, property)
  // A command on a cue (`start`, `stop`) is not a query: it is left to the window.
  if (cue !== undefined && value === undefined) return null
  if (cue === undefined) {
    // An address shaped like a query about a cue the show does not have says so, rather than
    // leaving the remote waiting — but only for a property this app would answer.
    return cueProperty(snapshot, { id: '', number: '', name: '', type: '', parentId: null, isArmed: true, colorName: '', notes: '' }, property) === undefined
      ? null
      : reply('error')
  }
  return reply('ok', value)
}

/** QLab's push that a cue changed: no arguments, the remote asks again for what it shows. */
export function qlabCueUpdate(workspaceId: string, cueId: string): FeedbackMessage {
  return { address: `/update/workspace/${workspaceId}/cue_id/${cueId}`, args: [] }
}

/** QLab's push that the playhead moved, with the cue it stands on. */
export function qlabPlayheadUpdate(snapshot: OscFeedbackSnapshot): FeedbackMessage {
  return {
    address: `/update/workspace/${snapshot.workspaceId}/cueList/${snapshot.listId}/playbackPosition`,
    args: [s(snapshot.playhead?.id ?? '')]
  }
}

/** Whether an address is one of the feedback's own requests, rather than the transport's. */
export type FeedbackRequest =
  | { kind: 'request' }
  | { kind: 'subscribe'; port: number | null }
  | { kind: 'unsubscribe' }
  | { kind: 'qlab-updates'; on: boolean }
  | { kind: 'cues' }

export function parseFeedbackRequest(
  address: string,
  args: ReadonlyArray<{ value: number | string | boolean }>
): FeedbackRequest | null {
  const path = address.replace(WORKSPACE_PREFIX, '')
  const first = args[0]?.value
  const number = typeof first === 'number' ? first : typeof first === 'string' && first.trim() !== '' ? Number(first) : null
  switch (path) {
    case '/cuerunner/feedback/request':
    case '/cuerunner/playhead/request':
      return { kind: 'request' }
    case '/cuerunner/cues/request':
      return { kind: 'cues' }
    case '/cuerunner/feedback/subscribe':
      return {
        kind: 'subscribe',
        port: number !== null && Number.isInteger(number) && number >= 1 && number <= 65535 ? number : null
      }
    case '/cuerunner/feedback/unsubscribe':
      return { kind: 'unsubscribe' }
    case '/updates':
      return { kind: 'qlab-updates', on: !(first === 0 || first === false || first === '0') }
    default:
      return null
  }
}
