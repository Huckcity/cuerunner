// A QLab show, turned into Cuerunner cues — and the account of how.
//
// Two rules, both for the operator who has to run what comes out:
//
// - Nothing is dropped. A QLab cue Cuerunner has no type for arrives as a placeholder: a
//   disarmed wait under the QLab cue's own number and name, with notes that say what it was
//   and carry the settings it had, so the running order keeps its shape and the gap is in
//   front of the operator rather than discovered at the half.
// - Nothing is pretended. Where a mapping cannot be exact, the report says so, cue by cue;
//   where it is exact but written differently (Cuerunner counts a chained cue's wait from
//   another moment than QLab does), the report says which fields moved.
//
// The mapping reads only `QLabShow`, which both the file reader and the OSC reader
// produce, so a show imported either way becomes the same cues.

import nodePath, { type PlatformPath } from 'node:path'
import type {
  AudioCue, Cue, CueBase, CueColor, CueType, FadeCue, GroupCue, GroupMode, MidiCue,
  MidiMessageKind, MscCommand, MscCue, MscFormat, OscArg, OscCue, StopCue, DevampCue, WaitCue,
  ControlAction, ControlCue, OscPatch, MemoCue
} from '../../shared/cue'
import { AUDIO_MAX_SLICES } from '../../shared/audio'
import { SLICE_MAX_PLAYS, SLICE_SKIP, SLICE_VAMP, slicesInUse, type CueSlices } from '../../shared/slices'
import type { QLabImportNote, QLabTypeCount } from '../../shared/ipc/qlab'
import { QLAB_TYPE_LABELS, type QLabCue, type QLabKind, type QLabShow } from './qlabShow'
import { canonicalCueList, MAIN_CUE_LIST_ID, MAIN_CUE_LIST_NAME, type CueListInfo } from '../../shared/cueLists'

/** What the mapping produced: the cue list, and everything the report says about it. */
export interface MappedShow {
  cues: Cue[]
  /** The show's lists, in QLab's order: the main one first, then every other list and cart. */
  cueLists: CueListInfo[]
  types: QLabTypeCount[]
  notes: QLabImportNote[]
  totalCues: number
  /** QLab's network patches the cues send through, as the show's own OSC patches. */
  oscPatches: OscPatch[]
}

/** Why each type with no Cuerunner counterpart is a placeholder, in one line. */
const NO_COUNTERPART: Partial<Record<QLabKind, string>> = {
  video: 'Cuerunner has no video cue',
  camera: 'Cuerunner has no camera cue',
  text: 'Cuerunner has no text cue',
  light: 'Cuerunner has no light cue: its commands are kept below',
  mic: 'Cuerunner has no live-input cue (its Mic cue mutes a radio mic)',
  midifile: 'Cuerunner has no MIDI file cue',
  timecode: 'Cuerunner has no timecode cue',
  target: 'Cuerunner has no target cue: its targets are fixed when the cue is made',
  script: 'QLab scripts are AppleScript, which Cuerunner does not run: the script is kept below',
  unknown: 'this is a cue type the import does not know'
}

/** QLab's colour names, grouped into the eight Cuerunner draws. */
const COLOURS: Record<string, CueColor> = {
  red: 'red', crimson: 'red', scarlet: 'red', rose: 'red',
  orange: 'orange', peach: 'orange', coral: 'orange', bronze: 'orange', tangerine: 'orange',
  yellow: 'yellow', gold: 'yellow', lemon: 'yellow',
  green: 'green', forest: 'green', mint: 'green', avocado: 'green', olive: 'green', lime: 'green',
  blue: 'blue', cyan: 'blue', sky: 'blue', skyblue: 'blue', indigo: 'blue', navy: 'blue', teal: 'blue', azure: 'blue',
  purple: 'purple', grape: 'purple', lavender: 'purple', violet: 'purple', plum: 'purple', lilac: 'purple',
  pink: 'pink', berry: 'pink', magenta: 'pink', fuchsia: 'pink'
}

/** The byte each MSC format's general class is, which is the one Cuerunner sends. */
const MSC_GENERAL: Record<Exclude<MscFormat, 'all'>, number> = {
  lighting: 0x01, sound: 0x10, machinery: 0x20, video: 0x30, projection: 0x40
}

/** MSC's command bytes Cuerunner's show control cue sends. */
const MSC_COMMANDS: Record<number, MscCommand> = { 0x01: 'go', 0x02: 'stop', 0x03: 'resume', 0x05: 'load', 0x0a: 'reset' }

/** QLab's voice-message index → Cuerunner's message, where Cuerunner has one. */
const VOICE_KINDS: Record<number, MidiMessageKind['kind']> = { 0: 'noteOff', 1: 'noteOn', 3: 'cc', 4: 'programChange' }

/** The cue an id generator is asked for when QLab's own id cannot be reused. */
export type IdSource = () => string

const MS_LIMIT = 24 * 60 * 60 * 1000

/** Seconds, as QLab writes them, to the milliseconds Cuerunner keeps — bounded to a day. */
function ms(seconds: number | undefined): number {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return 0
  return Math.min(Math.round(seconds * 1000), MS_LIMIT)
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high)
}

function decibels(gain: number): string {
  if (gain <= 0) return '−∞ dB'
  const db = 20 * Math.log10(gain)
  return `${db >= 0 ? '+' : '−'}${Math.abs(db).toFixed(1)} dB`
}

/** Pan from a pair of output levels: equal is centre, one side alone is hard over. */
function panOf(left: number | null, right: number | null): number | null {
  if (left === null || right === null) return null
  const total = left + right
  if (total <= 0 || Math.abs(left - right) < 1e-6) return 0
  return clamp((right - left) / total, -1, 1)
}

/** QLab's message string, split the way QLab reads it: on spaces, except inside quotes. */
export function oscTokens(message: string): string[] {
  const tokens: string[] = []
  const pattern = /"((?:[^"\\]|\\.)*)"|(\S+)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(message)) !== null) {
    tokens.push(match[1] !== undefined ? match[1].replace(/\\(.)/g, '$1') : match[2])
  }
  return tokens
}

/** One OSC argument, typed the way QLab types an unquoted word. */
function oscArg(token: string, quoted: boolean): OscArg {
  if (!quoted) {
    if (/^[+-]?\d+$/.test(token) && Number.isSafeInteger(Number(token))) return { type: 'i', value: Number(token) }
    if (/^[+-]?(\d+\.\d*|\.\d+|\d+)([eE][+-]?\d+)?$/.test(token)) return { type: 'f', value: Number(token) }
  }
  return { type: 's', value: token }
}

/** An OSC message string as an address and typed arguments, or null when it has no address. */
export function parseOscMessage(message: string): { address: string; args: OscArg[] } | null {
  const pattern = /"((?:[^"\\]|\\.)*)"|(\S+)/g
  const parts: Array<{ text: string; quoted: boolean }> = []
  let match: RegExpExecArray | null
  while ((match = pattern.exec(message)) !== null) {
    parts.push(match[1] !== undefined
      ? { text: match[1].replace(/\\(.)/g, '$1'), quoted: true }
      : { text: match[2], quoted: false })
  }
  const [first, ...rest] = parts
  if (!first || first.quoted || !first.text.startsWith('/')) return null
  return { address: first.text, args: rest.map(part => oscArg(part.text, part.quoted)) }
}

/**
 * Where an audio file is on this machine, as best the record says: the folder's copy first.
 *
 * QLab writes its paths the Mac's way: a relative path with forward slashes, an absolute one
 * from `/`. The relative half is joined to the workspace folder with this machine's own path
 * rules (`paths`, Node's own for the platform it runs on), so a show copied to Windows plays
 * from `C:\…\audio\walk-in.wav`. A Mac absolute is never rewritten: on Windows it names no
 * file, and it is kept exactly as QLab wrote it so the report shows where the file was and
 * Find in Folder can follow its tail. A relative path that climbs out of the folder
 * (`../Sound/a.wav`) is joined the same way, because that is where QLab would look too.
 */
export function mediaPath(
  cue: QLabCue,
  baseDir: string | null,
  paths: Pick<PlatformPath, 'isAbsolute' | 'resolve'> = nodePath
): string {
  const media = cue.media
  if (!media) return ''
  const relative = media.relative.replace(/\\/g, '/')
  // Absolute in either convention: a Mac path, or a drive or share on Windows.
  const absolute = (candidate: string): boolean => candidate.startsWith('/') || paths.isAbsolute(candidate)
  if (relative !== '' && !absolute(relative) && baseDir !== null) return paths.resolve(baseDir, relative)
  if (media.absolute !== '') return media.absolute
  return relative
}

function fileStem(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

interface Context {
  baseDir: string | null
  newId: IdSource
  /** QLab's unique id → the Cuerunner id the cue was given. */
  byUniqueId: Map<string, string>
  /** QLab's cue number → the Cuerunner id, for a target named by number alone. */
  byNumber: Map<string, string>
  /** The kind of every cue by its Cuerunner id, for what a fade can act on. */
  kindOf: Map<string, QLabKind>
  out: Cue[]
  notes: QLabImportNote[]
  types: Map<string, QLabTypeCount>
  /** QLab's network patches by name, each made once, as the show's OSC patches. */
  patches: Map<string, OscPatch>
  /** The audio cues with slice markers, by their Cuerunner id: what a devamp's mapping reads. */
  sliced: Set<string>
  /** How many audio cues have a slice QLab set to play no times: one line in the report says what that became. */
  skipping: number
}

/** Converts a QLab show into a Cuerunner cue list, with everything the report says about it. */
export function mapQLabShow(show: QLabShow, newId: IdSource): MappedShow {
  const context: Context = {
    baseDir: show.baseDir,
    newId,
    byUniqueId: new Map(),
    byNumber: new Map(),
    kindOf: new Map(),
    out: [],
    notes: [],
    types: new Map(),
    patches: new Map(),
    sliced: new Set(),
    skipping: 0
  }

  // Ids first, across every list, so a fade can target a cue that comes after it or sits
  // in another list. QLab's own ids are kept where they can be: they are what the show's
  // own scripts and the next import know the cues by.
  const ids = new Map<QLabCue, string>()
  const taken = new Set<string>()
  const assign = (cue: QLabCue): void => {
    const own = cue.uniqueID
    const id = /^[A-Za-z0-9-]{1,64}$/.test(own) && !taken.has(own) ? own : uniqueFrom(newId, taken)
    taken.add(id)
    ids.set(cue, id)
    if (own !== '') context.byUniqueId.set(own, id)
    if (cue.number !== '' && !context.byNumber.has(cue.number)) context.byNumber.set(cue.number, id)
    context.kindOf.set(id, cue.kind)
    if (cue.kind === 'audio' && (cue.slices?.length ?? 0) > 0) context.sliced.add(id)
    cue.children?.forEach(assign)
  }
  show.lists.forEach(list => list.cues.forEach(assign))

  // Every QLab list is a list here, each its own tab and its own GO. The first list that is not
  // a cart is the main list, so a cue that names no list runs where the show's own running
  // order did; it comes first among the tabs, and the rest follow in QLab's order. A cart is a
  // cart list: its tiles fire on their own, in the order the cart held them.
  const mainIndex = Math.max(0, show.lists.findIndex(list => !list.cart))
  const cueLists: CueListInfo[] = []
  const order = show.lists.length === 0 ? [] : [mainIndex, ...show.lists.map((_, index) => index).filter(index => index !== mainIndex)]
  for (const index of order) {
    const list = show.lists[index]
    const isMain = index === mainIndex
    // QLab's own id for the list where it can be kept: it is what `/cue_id/{id}/go` from a
    // remote set up for that show names, and a remote that worked there should work here.
    const own = list.uniqueID
    const id = isMain
      ? MAIN_CUE_LIST_ID
      : /^[A-Za-z0-9-]{1,64}$/.test(own) && !taken.has(own) && own !== MAIN_CUE_LIST_ID ? own : uniqueFrom(newId, taken)
    taken.add(id)
    const name = list.name.trim() || (isMain ? MAIN_CUE_LIST_NAME : list.cart ? 'Cart' : 'Cue List')
    cueLists.push(canonicalCueList({ id, name, cart: list.cart }))
    if (list.cart) {
      context.notes.push({
        cueId: '', number: '', name, qlabType: 'Cart', kind: 'approximated',
        detail: 'a cart is a grid of buttons in QLab; here it is a cart list, its tiles in the order the cart held them'
      })
    }
    const from = context.out.length
    mapSiblings(list.cues, null, ids, context)
    if (isMain) continue
    // The list's own cues at its top level name it; their children are in it through them.
    for (let at = from; at < context.out.length; at++) {
      if (context.out[at].parentId === null) context.out[at] = { ...context.out[at], listId: id }
    }
  }

  if (context.skipping > 0) {
    context.notes.push({
      cueId: '', number: '', name: `${context.skipping} audio ${context.skipping === 1 ? 'cue' : 'cues'}`, qlabType: 'Audio',
      kind: 'approximated',
      detail: 'QLab set some of their slices to play 0 times; here those slices are skipped, the music going from the slice ' +
        'before straight into the slice after. QLab does not document a count of 0 — this is read from what workspaces hold — so listen through each one'
    })
  }

  return {
    cues: context.out,
    cueLists,
    types: [...context.types.values()],
    notes: context.notes,
    totalCues: ids.size,
    oscPatches: [...context.patches.values()]
  }
}

function uniqueFrom(newId: IdSource, taken: Set<string>): string {
  for (;;) {
    const id = newId()
    if (!taken.has(id)) return id
  }
}

function baseFields(id: string, number: string, name: string, parentId: string | null): CueBase {
  return {
    id,
    number,
    name,
    colorLabel: 'none',
    parentId,
    preWait: 0,
    postWait: 0,
    timelineOffset: 0,
    duration: 0,
    advance: 'none',
    isArmed: true,
    notes: '',
    refire: 'ignore'
  }
}

/**
 * Cues that follow one another in a list, where GO and each cue's own advance chain them.
 *
 * QLab's auto-continue fires the next cue a post-wait after this one *starts acting* —
 * after its own pre-wait. Cuerunner's On start fires the next cue the moment this one is
 * fired, before its pre-wait, and does not read a post-wait. So the next cue's pre-wait is
 * written to include both, which puts it at the same moment, and the post-wait the chain
 * no longer reads is cleared. Auto-follow is On end, where QLab reads no post-wait either.
 */
function mapSiblings(cues: QLabCue[], parentId: string | null, ids: Map<QLabCue, string>, context: Context): void {
  const mapped: Cue[] = []
  for (const cue of cues) mapped.push(mapCue(cue, parentId, ids, context))
  for (let i = 0; i < mapped.length - 1; i++) {
    const current = mapped[i]
    const source = cues[i]
    if (source.continueMode !== 1) continue
    const carried = current.preWait + ms(source.postWait)
    if (carried === 0) continue
    const next = mapped[i + 1]
    next.preWait = Math.min(next.preWait + carried, MS_LIMIT)
    note(context, next, cues[i + 1], 'retimed',
      `pre-wait is ${seconds(next.preWait)}: it includes ${cues[i].number ? `cue ${cues[i].number}` : 'the cue before'}’s ` +
      `${current.preWait > 0 ? 'pre-wait and ' : ''}post-wait, because On start fires this cue as that one is fired`)
  }
}

function seconds(value: number): string {
  return `${(value / 1000).toFixed(2).replace(/\.?0+$/, '')} s`
}

function note(context: Context, cue: Cue, source: QLabCue, kind: QLabImportNote['kind'], detail: string): void {
  context.notes.push({ cueId: cue.id, number: source.number, name: source.name || cue.name, qlabType: label(source), kind, detail })
}

function label(cue: QLabCue): string {
  return cue.kind === 'unknown' ? (cue.typeName || 'Unknown') : QLAB_TYPE_LABELS[cue.kind]
}

/** Counts one cue against its QLab type and what it became: a placeholder is `null`. */
function count(context: Context, cue: QLabCue, becameType: CueType | null): void {
  const qlabType = label(cue)
  const key = `${qlabType}\u0000${becameType ?? ''}`
  const entry = context.types.get(key) ?? { qlabType, becameType, count: 0 }
  entry.count++
  context.types.set(key, entry)
}

/** Maps one cue, writes it (and, for a group, its children after it), and returns it. */
function mapCue(cue: QLabCue, parentId: string | null, ids: Map<QLabCue, string>, context: Context): Cue {
  const id = ids.get(cue)!
  const fallbackName = cue.kind === 'audio' && cue.media ? fileStem(cue.media.relative || cue.media.absolute) : label(cue)
  const base: CueBase = {
    ...baseFields(id, cue.number, cue.name.trim() !== '' ? cue.name : fallbackName, parentId),
    colorLabel: COLOURS[cue.colorName.toLowerCase()] ?? 'none',
    preWait: ms(cue.preWait),
    advance: cue.continueMode === 1 ? 'on-start' : cue.continueMode === 2 ? 'on-end' : 'none',
    isArmed: cue.armed,
    notes: cue.notes
  }

  const placeholder = (why: string, extra: string[] = []): WaitCue => {
    count(context, cue, null)
    const lines = [`[From QLab: ${label(cue)} cue. ${capitalise(why)}, so it is disarmed here and does nothing.]`, ...extra]
    const cr: WaitCue = {
      ...base,
      isArmed: false,
      notes: cue.notes.trim() === '' ? lines.join('\n') : `${lines.join('\n')}\n\n${cue.notes}`,
      type: 'wait'
    }
    note(context, cr, cue, 'placeholder', why)
    return cr
  }

  let mapped: Cue
  switch (cue.kind) {
    case 'audio': mapped = mapAudio(cue, base, context); break
    case 'fade': mapped = mapFade(cue, base, context) ?? placeholder(
      'it fades something Cuerunner cannot fade (geometry, opacity or rate): only level and pan move here',
      targetLines(cue, context)
    ); break
    case 'stop':
    case 'devamp': mapped = mapTargeted(cue, base, context); break
    case 'start':
    case 'pause':
    case 'load':
    case 'reset':
    case 'goto':
    case 'arm':
    case 'disarm': mapped = mapControl(cue, base, context); break
    case 'wait': {
      count(context, cue, 'wait')
      mapped = { ...base, duration: ms(cue.duration), type: 'wait' }
      break
    }
    case 'memo': {
      // A note in the stack, its words the cue's own name and notes, as QLab's memo is.
      count(context, cue, 'memo')
      const memo: MemoCue = { ...base, type: 'memo' }
      mapped = memo
      break
    }
    case 'midi': mapped = mapMidi(cue, base, context) ?? placeholder(midiGap(cue), midiLines(cue)); break
    case 'network': mapped = mapNetwork(cue, base, context) ?? placeholder(networkGap(cue), networkLines(cue)); break
    case 'group': {
      // A group is written before its children: children follow their parent.
      const group: GroupCue = { ...base, type: 'group', mode: 'sequence' }
      count(context, cue, 'group')
      context.out.push(group)
      mapGroup(cue, group, ids, context)
      return group
    }
    default: {
      mapped = placeholder(NO_COUNTERPART[cue.kind] ?? NO_COUNTERPART.unknown!, placeholderLines(cue, context))
    }
  }
  context.out.push(mapped)
  return mapped
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function targetLines(cue: QLabCue, context: Context): string[] {
  if (!cue.target) return []
  const id = resolveTarget(cue, context)
  const named = cue.target.number !== '' ? `cue ${cue.target.number}` : 'a cue'
  return [id === null ? `Targets ${named} (not in this show).` : `Targets ${named}.`]
}

function placeholderLines(cue: QLabCue, context: Context): string[] {
  const lines = targetLines(cue, context)
  if (cue.media && (cue.media.relative !== '' || cue.media.absolute !== '')) {
    lines.push(`File: ${cue.media.relative || cue.media.absolute}`)
  }
  if (cue.duration > 0) lines.push(`Duration: ${seconds(ms(cue.duration))}`)
  if (cue.kind === 'script' && cue.script) lines.push('', cue.script)
  if (cue.detail) lines.push('', cue.detail)
  return lines
}

function resolveTarget(cue: QLabCue, context: Context): string | null {
  if (!cue.target) return null
  return context.byUniqueId.get(cue.target.uniqueID) ?? (cue.target.number !== '' ? context.byNumber.get(cue.target.number) : undefined) ?? null
}

function mapAudio(cue: QLabCue, base: CueBase, context: Context): AudioCue {
  count(context, cue, 'audio')
  const filePath = mediaPath(cue, context.baseDir)
  const startTime = ms(cue.startTime)
  const end = ms(cue.endTime)
  const master = cue.levels?.master ?? null
  const pan = panOf(cue.levels?.left ?? null, cue.levels?.right ?? null)
  const rawRate = cue.rate !== undefined && Number.isFinite(cue.rate) && cue.rate > 0 ? cue.rate : 1
  const audio: AudioCue = {
    ...base,
    type: 'audio',
    filePath,
    startTime,
    endTime: end > startTime ? end : null,
    fadeInDuration: 0,
    volume: master === null ? 1 : clamp(master, 0, 1),
    pan: pan ?? 0,
    outputs: null,
    loopCount: cue.infiniteLoop ? -1 : Math.max(0, Math.min(Math.round(cue.playCount ?? 1), 10_000) - 1),
    playbackRate: clamp(rawRate, 0.25, 4),
    trim: 1,
    trimSilence: false
  }
  mapSlices(cue, audio, context)
  if (master !== null && master > 1) {
    note(context, audio, cue, 'approximated',
      `QLab plays it at ${decibels(master)}; Cuerunner’s volume stops at unity, so it plays at 0 dB`)
  }
  if (rawRate !== audio.playbackRate) {
    note(context, audio, cue, 'approximated', `QLab’s rate ${rawRate.toFixed(2)}× is outside 0.25×–4×, so it plays at ${audio.playbackRate}×`)
  }
  if (filePath === '') note(context, audio, cue, 'approximated', 'QLab did not say which file it plays: pick one in the inspector')
  return audio
}

/** A time into the file, seconds as QLab writes it, to file ms — kept to the microsecond, so a marker stays on its sample. */
function fileMs(seconds: number): number {
  return Math.min(Math.round(seconds * 1_000_000) / 1000, MS_LIMIT)
}

/** A QLab slice's count as Cuerunner's: a vamp whatever its count says when it loops for ever, otherwise its passes, 0 skipping it. */
function sliceCount(slice: { playCount: number; infiniteLoop: boolean }): number {
  if (slice.infiniteLoop) return SLICE_VAMP
  if (!Number.isFinite(slice.playCount) || slice.playCount < 0) return SLICE_VAMP
  return Math.min(SLICE_MAX_PLAYS, Math.round(slice.playCount))
}

/**
 * An audio cue's slices. QLab keeps a marker per slice at the slice's *end* — "time corresponds
 * to the end time of the slice", in its OSC dictionary — with that slice's count, and the piece
 * after the last marker in `lastSlice`. Cuerunner keeps the markers where pieces meet and one
 * count per piece, so the markers carry straight across, each count stays with the music it
 * was set on, and `lastSlice` is the last piece's.
 *
 * A slice that loops for ever is a vamp whatever its count says (QLab keeps the count it had
 * before the loop was ticked). A count of 0 is a skip: QLab's interface offers 1 or more, but
 * workspaces hold 0, and what the shows around them do says the slice is passed over — two
 * copies of one cue that differ only by a last slice of 0 or 1, a lone bar of 0 between two of
 * 1, and a song whose bars only land where its devamps say if the 0 after the count-in is not
 * played. That is read from QLab's data, not from a QLab document, and the report says so.
 *
 * A cue with no markers is its one region: `lastSlice` is the whole cue, and its loop is the
 * cue's own. A count of 0 there would be a cue that plays nothing, which no show has been seen
 * to mean — a cue copied from a sliced one keeps its 0 when its markers go — so it plays once.
 */
function mapSlices(cue: QLabCue, audio: AudioCue, context: Context): void {
  const raw = (cue.slices ?? []).filter(slice => Number.isFinite(slice.time) && slice.time > 0)
  const last = cue.lastSlice ?? { playCount: 1, infiniteLoop: false }
  if (raw.length === 0) {
    const loops = !cue.infiniteLoop && (cue.playCount ?? 1) === 1
    if (loops && last.infiniteLoop) audio.loopCount = -1
    else if (loops && last.playCount > 1) audio.loopCount = Math.min(Math.round(last.playCount), 10_000) - 1
    else if (!last.infiniteLoop && last.playCount === 0) {
      note(context, audio, cue, 'approximated', 'QLab set its one slice to play 0 times; with no markers it plays once here')
    }
    return
  }

  // In the order they cut the file, one marker at each time: two at one moment bound nothing.
  const sorted = [...raw].sort((a, b) => a.time - b.time)
  const markers: number[] = []
  const playCounts: number[] = []
  for (const slice of sorted) {
    const at = fileMs(slice.time)
    if (markers.length > 0 && at <= markers[markers.length - 1]) continue
    markers.push(at)
    playCounts.push(sliceCount(slice))
  }
  playCounts.push(sliceCount(last))

  // The engine carries a fixed number of slices: past it, the rest of the file plays through.
  const room = AUDIO_MAX_SLICES - 1
  if (markers.length > room) {
    const from = markers[room - 1]
    note(context, audio, cue, 'approximated',
      `QLab cuts it into ${markers.length + 1} slices and Cuerunner carries ${AUDIO_MAX_SLICES}: from ${seconds(from)} it plays straight to the end`)
    markers.length = room
    playCounts.length = room
    playCounts.push(1)
  }

  const slices: CueSlices = { markers, playCounts }
  if (!slicesInUse(slices)) return
  audio.slices = slices
  // With slices, the counts are per slice and the cue's own loop count is not read.
  audio.loopCount = 0
  if (cue.infiniteLoop || (cue.playCount ?? 1) !== 1) {
    note(context, audio, cue, 'approximated', 'QLab also loops the whole cue; with slices Cuerunner plays the slices’ own counts, once through')
  }
  if (playCounts.includes(SLICE_SKIP)) context.skipping++
}

function mapFade(cue: QLabCue, base: CueBase, context: Context): FadeCue | null {
  const master = cue.fadeTo?.master ?? null
  const pan = cue.fadeTo?.pan ?? null
  if (master === null && pan === null) return null
  count(context, cue, 'fade')
  const targetCueId = resolveTarget(cue, context) ?? ''
  const fade: FadeCue = {
    ...base,
    type: 'fade',
    duration: ms(cue.duration),
    // A QLab fade names one cue; Cuerunner's names a list, and this is a list of that one.
    targetCueIds: targetCueId === '' ? [] : [targetCueId],
    fadeProperty: master !== null ? 'volume' : 'pan',
    targetValue: master !== null ? clamp(master, 0, 1) : clamp(pan!, -1, 1),
    // QLab's fades are S-curves unless their shape is redrawn, which an import cannot read.
    curve: 'sCurve',
    stopTargetWhenDone: cue.stopTargetWhenDone === true
  }
  if (master !== null && pan !== null && pan !== 0) {
    note(context, fade, cue, 'approximated', 'it fades level and pan in QLab; a Cuerunner fade moves one, so only the level fades')
  }
  if (master !== null && master > 1) {
    note(context, fade, cue, 'approximated', `QLab fades to ${decibels(master)}; Cuerunner fades no higher than unity`)
  }
  targetNotes(cue, fade, targetCueId, context, ['audio'])
  return fade
}

function targetNotes(cue: QLabCue, mapped: Cue, targetCueId: string, context: Context, accepts: QLabKind[]): void {
  if (!cue.target || (cue.target.uniqueID === '' && cue.target.number === '')) {
    note(context, mapped, cue, 'approximated', 'QLab gave it no target: pick one in the inspector')
  } else if (targetCueId === '') {
    note(context, mapped, cue, 'approximated',
      `its target${cue.target.number ? `, cue ${cue.target.number},` : ''} is not in this show: pick one in the inspector`)
  } else {
    const kind = context.kindOf.get(targetCueId)
    if (kind !== undefined && !accepts.includes(kind)) {
      note(context, mapped, cue, 'approximated',
        `it targets a ${QLAB_TYPE_LABELS[kind]} cue, which a Cuerunner ${mapped.type} cue does not act on`)
    }
  }
}

function mapTargeted(cue: QLabCue, base: CueBase, context: Context): StopCue | DevampCue {
  const targetCueId = resolveTarget(cue, context) ?? ''
  if (cue.kind === 'devamp') return mapDevamp(cue, base, targetCueId, context)
  count(context, cue, 'stop')
  const stop: StopCue = {
    ...base,
    type: 'stop',
    // A QLab stop names one cue; the list of that one — never "all", which QLab's stop is not.
    targetCueIds: targetCueId === '' ? [] : [targetCueId],
    fadeOut: false,
    fadeOutDuration: 500,
    waitForFade: false
  }
  targetNotes(cue, stop, targetCueId, context, Object.keys(QLAB_TYPE_LABELS) as QLabKind[])
  return stop
}

/** QLab 5's devamp types: the slice that is looping, or the cue's own loop with its slices ignored. */
const DEVAMP_SLICE = 1
const DEVAMP_CUE = 2

/**
 * A Devamp cue. QLab 5's devamp type 1, "devamp currently looping slice", is what Cuerunner's
 * devamp does: the vamping slice finishes the pass it is on and the cue goes on into the next
 * slice — past any slice set to play 0 times. Type 2, "devamp looping cue", lets the cue's own
 * loop go and ignores its slices; on a cue without slices that is the same release.
 *
 * QLab's "start next cue when target reaches the end of the current slice" fires the cue after
 * the devamp at the moment the slice ends; Cuerunner's devamp has no such moment of its own, so
 * the report says so. Its "stop target" checkbox works only with that one ticked, and with both
 * the target stops at the end of the slice, which is Cuerunner's Stop at the end of the slice.
 */
function mapDevamp(cue: QLabCue, base: CueBase, targetCueId: string, context: Context): DevampCue {
  count(context, cue, 'devamp')
  const startsNext = cue.startNextAtSliceEnd === true
  const stops = startsNext && cue.stopTargetWhenDone === true
  const devamp: DevampCue = { ...base, type: 'devamp', targetCueId, ...(stops ? { devampMode: 'stop' as const } : {}) }
  targetNotes(cue, devamp, targetCueId, context, ['audio'])
  const type = cue.devampType ?? DEVAMP_SLICE
  if (type === DEVAMP_CUE && context.sliced.has(targetCueId)) {
    note(context, devamp, cue, 'approximated',
      'QLab devamps the target’s own loop and ignores its slices; here the slice it is in finishes its pass and the cue goes on to the next slice')
  } else if (type !== DEVAMP_SLICE && type !== DEVAMP_CUE) {
    note(context, devamp, cue, 'approximated', `QLab’s devamp type ${type} is not one the import knows; it devamps the slice that is looping`)
  }
  if (startsNext) {
    note(context, devamp, cue, 'approximated',
      `QLab starts the next cue the moment the target reaches the end of its slice${stops ? ' and stops it there' : ''}; ` +
      `here ${stops ? 'the target stops there, and ' : ''}the next cue waits for its own GO`)
  }
  return devamp
}

/** QLab's control cue types, as the one Control cue's verbs. */
const CONTROL_ACTION: Partial<Record<QLabKind, ControlAction>> = {
  start: 'start', pause: 'pause', load: 'load', reset: 'reset', goto: 'goto', arm: 'arm', disarm: 'disarm'
}

/**
 * QLab's Start, Pause, Load, Reset, GoTo, Arm and Disarm cues: each is a Control cue with that
 * verb, aimed at the cue it names. A Load keeps its time into the target where QLab said one.
 */
function mapControl(cue: QLabCue, base: CueBase, context: Context): ControlCue {
  count(context, cue, 'control')
  const targetCueId = resolveTarget(cue, context) ?? ''
  const control: ControlCue = {
    ...base,
    type: 'control',
    action: CONTROL_ACTION[cue.kind] ?? 'start',
    targetCueIds: targetCueId === '' ? [] : [targetCueId],
    loadToMs: cue.kind === 'load' && cue.loadAt !== undefined ? ms(cue.loadAt) : 0
  }
  targetNotes(cue, control, targetCueId, context, Object.keys(QLAB_TYPE_LABELS) as QLabKind[])
  return control
}

function midiGap(cue: QLabCue): string {
  const midi = cue.midi
  if (!midi) return 'QLab did not say what it sends'
  if (midi.messageType === 2) {
    return MSC_COMMANDS[midi.msc?.command ?? -1] === undefined
      ? 'Cuerunner’s show control cue sends Go, Stop, Resume, Load and Reset, and this is another MSC command'
      : 'Cuerunner’s show control cue has no format for the equipment this addresses'
  }
  if (midi.messageType === 3) return 'its SysEx bytes could not be read'
  return 'Cuerunner’s MIDI cue sends notes, control changes, program changes and SysEx, and this is another message'
}

function midiLines(cue: QLabCue): string[] {
  const midi = cue.midi
  if (!midi) return []
  const lines = [`Message type ${midi.messageType}, status ${midi.status}, channel ${midi.channel}, bytes ${midi.byte1} ${midi.byte2}.`]
  if (midi.msc) {
    lines.push(`MSC: format 0x${hex(midi.msc.format)}, command 0x${hex(midi.msc.command)}, device ${midi.msc.deviceId}, ` +
      `cue “${midi.msc.cueNumber}”, list “${midi.msc.cueList}”.`)
  }
  if (midi.port !== '') lines.push(`Port: ${midi.port}`)
  return lines
}

function hex(value: number): string {
  return value.toString(16).toUpperCase().padStart(2, '0')
}

function mscFormat(byte: number): MscFormat | null {
  if (byte === 0x7f) return 'all'
  if (byte >= 0x01 && byte <= 0x0f) return 'lighting'
  if (byte >= 0x10 && byte <= 0x1f) return 'sound'
  if (byte >= 0x20 && byte <= 0x2f) return 'machinery'
  if (byte >= 0x30 && byte <= 0x3f) return 'video'
  if (byte >= 0x40 && byte <= 0x4f) return 'projection'
  return null
}

function byte(value: number): number {
  return Number.isFinite(value) ? clamp(Math.round(value), 0, 127) : 0
}

function mapMidi(cue: QLabCue, base: CueBase, context: Context): MidiCue | MscCue | null {
  const midi = cue.midi
  if (!midi) return null
  if (midi.messageType === 2) {
    const msc = midi.msc
    const command = MSC_COMMANDS[msc?.command ?? -1]
    const format = mscFormat(msc?.format ?? -1)
    if (!msc || command === undefined || format === null) return null
    count(context, cue, 'msc')
    const mapped: MscCue = {
      ...base,
      type: 'msc',
      command,
      format,
      deviceId: clamp(Math.round(msc.deviceId), 0, 127),
      cueNumber: msc.cueNumber,
      cueList: msc.cueList,
      // QLab sends MSC out of a MIDI port; the show's desk connection is the other route.
      destination: 'port',
      portName: midi.port
    }
    if (format !== 'all' && msc.format !== MSC_GENERAL[format]) {
      note(context, mapped, cue, 'approximated',
        `MSC format 0x${hex(msc.format)} is sent as the general ${format} format`)
    }
    if (midi.port === '') note(context, mapped, cue, 'approximated', 'QLab’s MIDI patch did not name a port: pick one in the inspector')
    return mapped
  }

  let message: MidiMessageKind | null = null
  const channel = clamp(Math.round(midi.channel) || 1, 1, 16)
  if (midi.messageType === 3) {
    if (midi.sysex && midi.sysex.length > 0) message = { kind: 'sysex', data: midi.sysex.map(byteOf => clamp(Math.round(byteOf), 0, 255)) }
  } else {
    const kind = VOICE_KINDS[midi.status]
    if (kind === 'noteOn' || kind === 'noteOff') message = { kind, channel, note: byte(midi.byte1), velocity: byte(midi.byte2) }
    else if (kind === 'cc') message = { kind, channel, controller: byte(midi.byte1), value: byte(midi.byte2) }
    else if (kind === 'programChange') message = { kind, channel, program: byte(midi.byte1) }
  }
  if (message === null) return null
  count(context, cue, 'midi')
  return { ...base, type: 'midi', portName: midi.port, messages: [message] }
}

function networkGap(cue: QLabCue): string {
  switch (cue.network?.kind) {
    case 'qlab': return 'it sends a QLab command, and Cuerunner’s OSC cue needs the OSC message it stands for'
    case 'text': return 'it sends plain text over the network, which Cuerunner’s cues do not'
    case 'hex': return 'it sends raw bytes over the network, which Cuerunner’s cues do not'
    default: return 'QLab did not give it an OSC message Cuerunner can send'
  }
}

function networkLines(cue: QLabCue): string[] {
  const network = cue.network
  if (!network) return []
  const lines: string[] = []
  if (network.message !== '') lines.push(`Message: ${network.message}`)
  if (network.host !== null) lines.push(`Destination: ${network.host}:${network.port ?? ''}`)
  else if (network.patch !== '') lines.push(`Patch: ${network.patch}`)
  return lines
}

function mapNetwork(cue: QLabCue, base: CueBase, context: Context): OscCue | null {
  const network = cue.network
  if (!network || network.kind !== 'osc') return null
  const parsed = parseOscMessage(network.message)
  if (parsed === null) return null
  count(context, cue, 'osc')
  const known = network.host !== null && network.host !== ''
  const host = known ? (network.host === 'localhost' ? '127.0.0.1' : network.host!) : '127.0.0.1'
  const port = network.port !== null && network.port >= 1 && network.port <= 65535 ? network.port : 53000
  // A named QLab patch with a known destination becomes one of the show's OSC patches, made
  // once and shared by every cue that sent through it — so a show moved to another venue
  // changes one address here, as it did in QLab.
  const patchName = network.patch.trim()
  let patchId = ''
  if (known && patchName !== '') {
    const existing = context.patches.get(patchName)
    const patch = existing ?? { id: uniqueFrom(context.newId, new Set()), name: patchName, host, port }
    if (existing === undefined) context.patches.set(patchName, patch)
    patchId = patch.id
  }
  const osc: OscCue = {
    ...base,
    type: 'osc',
    messages: [{ patchId, host, port, address: parsed.address, args: parsed.args }]
  }
  if (!known) {
    note(context, osc, cue, 'approximated',
      `QLab’s network patch${network.patch ? ` “${network.patch}”` : ''} did not say where it sends: set the host and port`)
  }
  return osc
}

/**
 * A group, and its children after it, in the mode that runs them the way QLab did.
 *
 * QLab's "start first child and go to next cue" leaves the children to chain themselves
 * by their own continue modes. Cuerunner's groups decide that themselves: a chain of
 * auto-continues is a timeline, each child at the moment the chain reached it, and a chain
 * of auto-follows is a sequence. A chain that stops part-way — a child set to do not
 * continue — has no Cuerunner equivalent, and the report says so.
 */
function mapGroup(cue: QLabCue, group: GroupCue, ids: Map<QLabCue, string>, context: Context): void {
  const children = cue.children ?? []
  const mode = cue.groupMode ?? 2
  let groupMode: GroupMode
  let offsets: number[] | null = null

  if (mode === 3) {
    groupMode = 'timeline'
    offsets = children.map(child => ms(child.preWait))
  } else if (mode === 4) {
    groupMode = 'random'
  } else if (mode === 1) {
    groupMode = 'playlist'
    note(context, group, cue, 'approximated',
      'QLab enters this group and each GO fires its next child; here each GO fires one child, without the children’s own continue modes')
  } else if (mode === 6) {
    groupMode = 'sequence'
  } else {
    const chained = children.slice(0, -1)
    if (children.length > 1 && chained.every(child => child.continueMode === 1)) {
      groupMode = 'timeline'
      offsets = []
      let at = 0
      children.forEach((child, index) => {
        at += ms(child.preWait)
        offsets!.push(Math.min(at, MS_LIMIT))
        if (index < children.length - 1) at += ms(child.postWait)
      })
      note(context, group, cue, 'retimed',
        'its children auto-continue into each other, so it is a timeline here: each child starts at the moment the chain reached it')
    } else {
      groupMode = 'sequence'
      if (children.length > 1 && !chained.every(child => child.continueMode === 2)) {
        note(context, group, cue, 'approximated',
          'its children chain by their own continue modes in QLab; here they play one after another, each when the one before ends')
      }
    }
  }
  group.mode = groupMode

  for (const child of children) mapCue(child, group.id, ids, context)
  if (offsets !== null) {
    // The children were written straight after the group, in order; their own pre-waits
    // are now the timeline's offsets, and nothing else times them.
    const written = context.out.filter(entry => entry.parentId === group.id)
    written.forEach((entry, index) => {
      entry.timelineOffset = offsets![index] ?? 0
      entry.preWait = 0
      entry.postWait = 0
      entry.advance = 'none'
    })
  }
}
