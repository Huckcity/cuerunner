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

/** One cue list as a remote reads it: its own playhead, and whether it fires at all. */
export interface FeedbackList {
  id: string
  name: string
  /** The cue this list's GO fires next, or null at the end of the list. */
  playhead: FeedbackCue | null
  cart: boolean
  disarmed: boolean
}

/** One running cue, with how far it has got. `durationMs` is null where nobody can say. */
export interface FeedbackRun extends FeedbackCue {
  /** The list it runs in. */
  listId: string
  state: 'pre-wait' | 'playing' | 'post-wait' | 'paused'
  elapsedMs: number
  durationMs: number | null
}

/** What the window publishes: the show as a remote can read it, at one moment. */
export interface OscFeedbackSnapshot {
  workspaceId: string
  workspaceName: string
  /** The list in front: the one GO and `/cuerunner/playhead` speak for. */
  activeListId: string
  /** The cue the list in front's GO fires next, or null at the end of it. */
  playhead: FeedbackCue | null
  /** Every cue list, in tab order, each with its own playhead. */
  lists: FeedbackList[]
  /** Running cues, in array order, each naming the list it runs in. */
  running: FeedbackRun[]
  /** Every cue, in array order, with where it sits, its list and whether it is armed. */
  cues: Array<FeedbackCue & { parentId: string | null; listId: string; isArmed: boolean; colorName: string; notes: string }>
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
      { address: `/cuerunner/running/${slot}/state`, args: [s(run?.state ?? '')] },
      // The list it runs in, by name: a strip on a remote says which tab the sound came from.
      { address: `/cuerunner/running/${slot}/list`, args: [s(run === undefined ? '' : listName(snapshot, run.listId))] }
    )
  }
  return out
}

function listName(snapshot: OscFeedbackSnapshot, listId: string): string {
  return snapshot.lists.find(list => list.id === listId)?.name ?? ''
}

/**
 * Every list's own state, by its place among the tabs counting from 1 — the place a remote's
 * `/list/{place}/go` names it by — under `/cuerunner/list/{place}/…`: its id and name, its own
 * playhead, and how many of its cues are running. `previousCount` places that no longer exist
 * are written once as empty.
 */
export function listMessages(snapshot: OscFeedbackSnapshot, previousCount: number): FeedbackMessage[] {
  const out: FeedbackMessage[] = [{ address: '/cuerunner/lists/count', args: [i(snapshot.lists.length)] }]
  const places = Math.max(snapshot.lists.length, previousCount)
  for (let at = 0; at < places; at++) {
    const list = snapshot.lists[at]
    const place = at + 1
    const head = list?.playhead ?? null
    out.push(
      { address: `/cuerunner/list/${place}/id`, args: [s(list?.id ?? '')] },
      { address: `/cuerunner/list/${place}/name`, args: [s(list?.name ?? '')] },
      { address: `/cuerunner/list/${place}/playhead/number`, args: [s(head?.number ?? '')] },
      { address: `/cuerunner/list/${place}/playhead/name`, args: [s(head?.name ?? '')] },
      { address: `/cuerunner/list/${place}/playhead/id`, args: [s(head?.id ?? '')] },
      {
        address: `/cuerunner/list/${place}/running/count`,
        args: [i(list === undefined ? 0 : snapshot.running.filter(run => run.listId === list.id).length)]
      }
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
): { playhead: boolean; running: boolean; cues: boolean; lists: boolean; changedCueIds: string[]; movedListIds: string[] } {
  const playhead = before === null || before.playhead?.id !== after.playhead?.id ||
    before.playhead?.number !== after.playhead?.number || before.playhead?.name !== after.playhead?.name
  const listKey = (list: FeedbackList): string =>
    `${list.id}:${list.name}:${list.playhead?.id ?? ''}:${list.playhead?.number ?? ''}:${list.playhead?.name ?? ''}`
  const lists = before === null || before.lists.map(listKey).join('|') !== after.lists.map(listKey).join('|') ||
    before.activeListId !== after.activeListId
  // The lists whose playhead moved: what QLab's remotes are told, one list at a time.
  const was = new Map((before?.lists ?? []).map(list => [list.id, list.playhead?.id ?? '']))
  const movedListIds = after.lists.filter(list => !was.has(list.id) || was.get(list.id) !== (list.playhead?.id ?? '')).map(list => list.id)
  const runKey = (snapshot: OscFeedbackSnapshot | null): string =>
    snapshot === null ? '' : snapshot.running.map(run => `${run.id}:${run.state}:${run.number}:${run.name}`).join('|')
  const running = runKey(before) !== runKey(after)
  const cueKey = (snapshot: OscFeedbackSnapshot | null): string =>
    snapshot === null ? '' : snapshot.cues.map(cue => `${cue.id}:${cue.number}:${cue.name}:${cue.listId}`).join('|')
  const cues = cueKey(before) !== cueKey(after)
  // The cues whose running state moved: started, stopped, paused or resumed.
  const ran = new Map((before?.running ?? []).map(run => [run.id, run.state]))
  const now = new Map(after.running.map(run => [run.id, run.state]))
  const changedCueIds = [...new Set([...ran.keys(), ...now.keys()])].filter(id => ran.get(id) !== now.get(id))
  return { playhead, running, cues, lists, changedCueIds, movedListIds }
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

/**
 * The show's lists as QLab's `/cueLists` describes them, in tab order: each a cue of type
 * `Cue List` (or `Cart`), holding its top-level cues as `cues` and a group's children as the
 * group's `cues`, however deep.
 */
function qlabLists(snapshot: OscFeedbackSnapshot): Array<Record<string, unknown>> {
  const children = new Map<string | null, OscFeedbackSnapshot['cues']>()
  for (const cue of snapshot.cues) {
    const list = children.get(cue.parentId) ?? []
    list.push(cue)
    children.set(cue.parentId, list)
  }
  const tree = (parentId: string | null, depth: number, listId: string | null): unknown[] =>
    (children.get(parentId) ?? [])
      .filter(cue => listId === null || cue.listId === listId)
      .map(cue => ({
        ...qlabCue(cue),
        // Bounded by the list itself: a group cannot hold itself, and the depth is a backstop.
        ...(cue.type === 'group' && depth < 32 ? { cues: tree(cue.id, depth + 1, null) } : {})
      }))
  return snapshot.lists.map(list => ({
    ...qlabListCue(list),
    cues: tree(null, 0, list.id)
  }))
}

/** A cue list as QLab describes one where it is read as a cue. */
function qlabListCue(list: FeedbackList): Record<string, unknown> {
  return {
    uniqueID: list.id,
    number: '',
    name: list.name,
    listName: list.name,
    type: list.cart ? 'Cart' : 'Cue List',
    colorName: 'none',
    flagged: false,
    armed: !list.disarmed
  }
}

/** One property of a cue list, asked as QLab asks it: `/cue_id/{list}/…`. */
function listProperty(snapshot: OscFeedbackSnapshot, list: FeedbackList, property: string): unknown {
  switch (property) {
    case 'playbackPosition':
    case 'playheadId': return list.playhead?.id ?? ''
    case 'number': return ''
    case 'name':
    case 'displayName':
    case 'listName': return list.name
    case 'uniqueID': return list.id
    case 'type': return list.cart ? 'Cart' : 'Cue List'
    case 'armed': return !list.disarmed
    case 'isRunning': return snapshot.running.some(run => run.listId === list.id && run.state !== 'paused')
    default: return undefined
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
      return reply('ok', qlabLists(snapshot))
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
  // QLab counts a cue list as a cue: `/cue_id/{list}/playbackPosition` is that list's playhead.
  const list = byUid !== null ? snapshot.lists.find(entry => entry.id === ref) : undefined
  if (list !== undefined) {
    const value = listProperty(snapshot, list, property)
    return value === undefined ? null : reply('ok', value)
  }
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
    return cueProperty(snapshot, { id: '', number: '', name: '', type: '', parentId: null, listId: '', isArmed: true, colorName: '', notes: '' }, property) === undefined
      ? null
      : reply('error')
  }
  return reply('ok', value)
}

/** QLab's push that a cue changed: no arguments, the remote asks again for what it shows. */
export function qlabCueUpdate(workspaceId: string, cueId: string): FeedbackMessage {
  return { address: `/update/workspace/${workspaceId}/cue_id/${cueId}`, args: [] }
}

/** QLab's push that one list's playhead moved, with the cue it stands on. */
export function qlabPlayheadUpdate(snapshot: OscFeedbackSnapshot, listId: string): FeedbackMessage {
  const list = snapshot.lists.find(entry => entry.id === listId)
  return {
    address: `/update/workspace/${snapshot.workspaceId}/cueList/${listId}/playbackPosition`,
    args: [s(list?.playhead?.id ?? '')]
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
