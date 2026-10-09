// A QLab workspace file, read into a `QLabShow`.
//
// QLab saves a workspace (`.qlab4`, `.qlab5`) as an NSKeyedArchiver archive, and keeps its
// cue tree as a second archive stored as data inside the first. Both are read by
// `keyedArchive.ts`; this file knows where QLab put things inside them. The property names
// are QLab's own and plainly named — `preWait`, `continueMode`, `fileTarget` — which is what
// makes an import possible at all; the readers here are tolerant of where they sit, because
// QLab has moved some of them between versions, and of a `.cues` file, which holds cues
// rather than a workspace.
//
// Reading someone else's file format to bring across work the operator already owns is
// interoperability. No QLab code is involved, and the container is Apple's. QLab is a
// trademark of Figure 53, LLC; Cuerunner is not affiliated with it.
//
// Bounded throughout: the file is measured before it is read and refused past 64 MiB, a
// QLab 5 package folder is listed to a fixed number of entries, the archive readers bound
// their own work, and the conversion stops at `MAX_IMPORTED_CUES`.

import { open, readdir, stat } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Refusal } from '../ipc/refusal'
import { PlistError, isBinaryPlist, isBytes } from './bplist'
import { isArchivedObject, isRecord, unarchive, type Archived, type ArchivedDict } from './keyedArchive'
import {
  MAX_IMPORTED_CUES, qlabKind,
  type QLabCue, type QLabKind, type QLabList, type QLabMedia, type QLabMidi, type QLabNetwork, type QLabShow, type QLabSlice
} from './qlabShow'

/** The largest workspace file this import reads. A workspace is far smaller; a show file is 64 MiB at most too. */
export const MAX_QLAB_FILE_BYTES = 64 * 1024 * 1024

/**
 * The extensions the import offers in its dialog. A `.qlab5backup` is one of the autosaves
 * QLab 5 keeps in a "<show> backups" folder beside the workspace: the same archive, read the
 * same way, which is what an operator has when the workspace itself is lost or damaged.
 */
export const QLAB_EXTENSIONS = ['qlab5', 'qlab4', 'qlab3', 'qlab5backup', 'cues'] as const

/** How many entries of a package folder are looked at for the workspace inside it. */
const MAX_PACKAGE_ENTRIES = 512

/** How deep the settings are searched for patches. */
const MAX_SETTINGS_DEPTH = 12

/** Where each patch a cue names by id actually sends. */
interface Patches {
  network: Map<string, { name: string; host: string | null; port: number | null }>
  /** The network patches in the order the workspace lists them, for a cue that names one by number. */
  networkOrder: Array<{ name: string; host: string | null; port: number | null }>
  midi: Map<string, string>
}

/** Reads a QLab workspace — a file, or a QLab 5 package folder — into a show. */
export async function readQLabWorkspace(filePath: string): Promise<QLabShow> {
  const name = basename(filePath)
  const info = await stat(filePath).catch(() => null)
  if (info === null) throw new Refusal(`“${name}” is not there any more`)

  let workspaceFile = filePath
  if (info.isDirectory()) {
    const inner = await packageWorkspace(filePath)
    if (inner === null) throw new Refusal(`“${name}” is a folder with no QLab workspace inside it`)
    workspaceFile = inner
  }
  const bytes = await readBounded(workspaceFile, name)
  const show = parseQLabWorkspace(bytes, name)
  return {
    ...show,
    name: show.name || basename(filePath, extname(filePath)),
    baseDir: info.isDirectory() ? filePath : mediaFolder(filePath)
  }
}

/**
 * The folder a workspace file's relative media paths are relative to: its own — except a
 * backup still in the "<show> backups" folder QLab wrote it to, whose paths are the
 * workspace's, relative to the folder above.
 */
function mediaFolder(filePath: string): string {
  const folder = dirname(filePath)
  if (/backup$/i.test(extname(filePath)) && / backups$/i.test(basename(folder))) return dirname(folder)
  return folder
}

/** The bytes of a workspace file, refused before they are read when there are too many. */
async function readBounded(filePath: string, name: string): Promise<Uint8Array> {
  const handle = await open(filePath, 'r').catch(() => null)
  if (handle === null) throw new Refusal(`“${name}” could not be opened`)
  try {
    const { size } = await handle.stat()
    if (size > MAX_QLAB_FILE_BYTES) {
      throw new Refusal(
        `“${name}” is ${(size / (1024 * 1024)).toFixed(0)} MB, and a QLab workspace this import reads is at most 64 MB`
      )
    }
    const buffer = Buffer.alloc(size)
    let read = 0
    while (read < size) {
      const { bytesRead } = await handle.read(buffer, read, size - read, read)
      if (bytesRead === 0) break
      read += bytesRead
    }
    return buffer.subarray(0, read)
  } finally {
    await handle.close()
  }
}

/**
 * The workspace inside a package folder: the largest property list among its first
 * entries, preferring one that carries a QLab extension. Only the folder's own files are
 * looked at; nothing is searched below it.
 */
async function packageWorkspace(folder: string): Promise<string | null> {
  const entries = (await readdir(folder, { withFileTypes: true }).catch(() => [])).slice(0, MAX_PACKAGE_ENTRIES)
  let best: { path: string; size: number; named: boolean } | null = null
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const candidate = join(folder, entry.name)
    const size = (await stat(candidate).catch(() => null))?.size ?? 0
    if (size === 0 || size > MAX_QLAB_FILE_BYTES) continue
    const head = Buffer.alloc(8)
    const handle = await open(candidate, 'r').catch(() => null)
    if (handle === null) continue
    try {
      await handle.read(head, 0, 8, 0)
    } finally {
      await handle.close()
    }
    if (!isBinaryPlist(head)) continue
    const named = /\.qlab\d$/i.test(entry.name)
    if (best === null || (named && !best.named) || (named === best.named && size > best.size)) {
      best = { path: candidate, size, named }
    }
  }
  return best?.path ?? null
}

/** Reads a workspace's bytes into a show. `name` is what a refusal calls the file. */
export function parseQLabWorkspace(bytes: Uint8Array, name: string): QLabShow {
  if (!isBinaryPlist(bytes)) {
    throw new Refusal(
      `“${name}” is not a QLab workspace: QLab saves its workspaces as a binary property list, and this file is not one`
    )
  }
  const outer = readArchive(bytes, name)
  const settings = nested(record(outer)?.['settings'] ?? null, name)
  const patches = readPatches(settings)

  const lists = findLists(outer, name)
  if (lists === null) throw new Refusal(`“${name}” is an archive, but it holds no QLab cue lists`)

  const counter = { cues: 0 }
  const converted: QLabList[] = lists.map(list => ({
    name: text(list.record['name']) || text(list.record['listName']),
    uniqueID: text(list.record['uniqueID']),
    cart: list.cart,
    cues: list.cues.map(cue => fileCue(cue, patches, counter, name))
  }))
  const outerRecord = record(outer)
  return {
    name: text(outerRecord?.['workspaceName']) || text(outerRecord?.['displayName']),
    lists: converted,
    baseDir: null
  }
}

function readArchive(bytes: Uint8Array, name: string): Archived {
  try {
    return unarchive(bytes)
  } catch (error) {
    if (error instanceof PlistError) {
      throw new Refusal(`“${name}” looks like a QLab workspace but cannot be read: ${error.message}`)
    }
    throw error
  }
}

/** A value that may be a second archive stored as data, opened when it is one. */
function nested(value: Archived, name: string): Archived {
  if (isBytes(value) && isBinaryPlist(value)) return readArchive(value, name)
  return value
}

function record(value: Archived | undefined): ArchivedDict | null {
  return isRecord(value) ? value : null
}

interface FoundList {
  record: ArchivedDict
  cart: boolean
  cues: Archived[]
}

function className(value: Archived | undefined): string {
  return isArchivedObject(value) ? value.$class : ''
}

/**
 * A group's mode that makes it a cue list or a cart rather than a group in one. QLab 5 keeps
 * its lists as Group cues: a list is mode 0 and a cart mode 5, the two modes its OSC
 * dictionary calls read-only, under a root group whose own id is "[root group of cue lists]".
 */
const LIST_MODE = 0
const CART_MODE = 5

function isListGroup(value: ArchivedDict): boolean {
  if (qlabKind(className(value)) !== 'group') return false
  const mode = number(value['groupMode']) ?? number(value['mode'])
  return mode === LIST_MODE || mode === CART_MODE
}

/** Whether an archived object is a cue list or a cart rather than a cue. */
function isList(value: Archived): boolean {
  if (!isRecord(value)) return false
  const named = className(value)
  if (/CueList|Cart/i.test(named)) return true
  if (isListGroup(value)) return true
  return named === '' && Array.isArray(value['cues'])
}

function isCart(value: ArchivedDict): boolean {
  if (isListGroup(value)) return (number(value['groupMode']) ?? number(value['mode'])) === CART_MODE
  return /Cart/i.test(className(value)) || value['cart'] === true || value['isCart'] === true
}

/**
 * The cue lists, wherever this file keeps them: the nested archive a workspace stores under
 * `cueLists` — in QLab 5 a root group whose children are the lists — a list of lists, or, in a
 * `.cues` file, cues with no list around them, which are read as one list.
 */
function findLists(outer: Archived, name: string): FoundList[] | null {
  const top = record(outer)
  let container: Archived = top?.['cueLists'] !== undefined ? nested(top['cueLists'], name) : outer
  if (isRecord(container) && !isList(container) && Array.isArray(container['cues'])) container = container['cues']
  else if (isRecord(container) && Array.isArray(container['cueLists'])) container = container['cueLists']

  const items: Archived[] = Array.isArray(container) ? container : isRecord(container) && isList(container) ? [container] : []
  if (items.length === 0) return null
  if (items.every(isList)) {
    return items.map(item => {
      const list = item as ArchivedDict
      const cues = list['cues']
      return { record: list, cart: isCart(list), cues: Array.isArray(cues) ? cues : [] }
    })
  }
  // Cues on their own, as a `.cues` file holds them.
  const cues = items.filter(isRecord)
  if (cues.length === 0) return null
  return [{ record: {}, cart: false, cues }]
}

function text(value: Archived | undefined): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function number(value: Archived | undefined): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return undefined
}

function flag(value: Archived | undefined, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  return fallback
}

/** The kind an archived cue's class means, allowing for a class name with a prefix of its own. */
function fileKind(cue: ArchivedDict): { kind: QLabKind; typeName: string } {
  const named = className(cue)
  const kind = qlabKind(named)
  if (kind !== 'unknown') return { kind, typeName: named }
  const unprefixed = named.replace(/^(QLab|QL|F53)/, '')
  return { kind: qlabKind(unprefixed), typeName: named.replace(/Cue$/, '') }
}

/** A linear gain from a level QLab wrote, linear or in decibels. */
function gain(value: number | undefined): number | null {
  if (value === undefined) return null
  // Linear gains are never negative; a negative level is QLab's decibels.
  if (value < 0) return value <= -60 ? 0 : Math.pow(10, value / 20)
  return value
}

/** The crosspoints of a level matrix, as row/column/value triples. */
function matrixEntries(matrix: Archived | undefined, valueKey: 'level' | 'end'): Array<{ row: number; column: number; value: number; live: boolean }> {
  const entries = isRecord(matrix) ? matrix['entries'] : undefined
  const list: Archived[] = Array.isArray(entries) ? entries : isRecord(entries) ? Object.values(entries) : []
  const out: Array<{ row: number; column: number; value: number; live: boolean }> = []
  for (const entry of list) {
    if (!isRecord(entry)) continue
    const row = number(entry['row'])
    const column = number(entry['column'])
    if (row === undefined || column === undefined) continue
    let value: number | undefined
    if (valueKey === 'end') value = number(entry['endValue'])
    else {
      const initial = number(entry['initialLevel']) ?? number(entry['level'])
      const trim = number(entry['trimLevel'])
      value = initial === undefined ? undefined : initial < 0 ? initial + (trim ?? 0) : initial * (trim ?? 1)
    }
    if (value === undefined) continue
    out.push({ row, column, value, live: flag(entry['live'], true) })
  }
  return out
}

function levelAt(entries: ReturnType<typeof matrixEntries>, row: number, column: number): number | null {
  const found = entries.find(entry => entry.row === row && entry.column === column)
  return found === undefined ? null : gain(found.value)
}

function fileMedia(target: Archived | undefined): QLabMedia | undefined {
  if (typeof target === 'string') return target.startsWith('/') ? { relative: '', absolute: target } : { relative: target, absolute: '' }
  if (!isRecord(target)) return undefined
  const relative = text(target['relativePath'])
  let absolute = text(target['lastKnownPath']) || text(target['absolutePath']) || text(target['path'])
  // QLab 4 keeps the file as an NSURL: a file:// address, or a path relative to a base one.
  const urlText = text(target['NS.relative'])
  if (absolute === '' && urlText !== '') {
    const base = record(target['NS.base'])
    const baseText = base ? text(base['NS.relative']) : ''
    try {
      const url = baseText !== '' ? new URL(urlText, baseText) : new URL(urlText)
      if (url.protocol === 'file:') absolute = fileURLToPath(url, { windows: false })
    } catch {
      // Not an address: a bare path, kept as QLab wrote it.
      return { relative: urlText, absolute: '' }
    }
  }
  if (relative === '' && absolute === '') return undefined
  return { relative, absolute }
}

/** The most slice markers read off one cue: past the engine's count, the rest are not looked at. */
const MAX_READ_SLICES = 1024

/** A cue's slice markers, as QLab archives them (`AudioSlice`: time, playCount, infiniteLoop). */
function fileSlices(value: Archived | undefined): QLabSlice[] | undefined {
  if (!Array.isArray(value)) return undefined
  const slices: QLabSlice[] = []
  for (const item of value.slice(0, MAX_READ_SLICES)) {
    if (!isRecord(item)) continue
    const time = number(item['time'])
    if (time === undefined) continue
    slices.push({ time, playCount: number(item['playCount']) ?? 1, infiniteLoop: flag(item['infiniteLoop'], false) })
  }
  return slices
}

function hexBytes(value: Archived | undefined): number[] | undefined {
  if (isBytes(value)) return [...value]
  if (typeof value !== 'string') return undefined
  const pairs = value.replace(/0x/gi, '').replace(/[^0-9a-f]/gi, ' ').trim().split(/\s+/)
  const bytes: number[] = []
  for (const pair of pairs) {
    if (pair === '') continue
    // A run of hex without spaces is read two digits at a time.
    for (let i = 0; i < pair.length; i += 2) {
      const parsed = parseInt(pair.slice(i, i + 2), 16)
      if (Number.isNaN(parsed)) return undefined
      bytes.push(parsed)
    }
  }
  return bytes.length > 0 ? bytes : undefined
}

function fileMidi(cue: ArchivedDict, patches: Patches): QLabMidi {
  let byte1 = number(cue['byte1']) ?? 0
  let byte2 = number(cue['byte2']) ?? 0
  const status = number(cue['status']) ?? 1
  // A control change written by an older QLab keeps its number and value under their own names.
  if (status === 3 && byte1 === 0 && number(cue['controlNumber']) !== undefined) {
    byte1 = number(cue['controlNumber']) ?? 0
    byte2 = number(cue['controlValue']) ?? byte2
  }
  const messageType = number(cue['messageType']) ?? 1
  const midi: QLabMidi = {
    messageType,
    status,
    channel: number(cue['channel']) ?? 1,
    byte1,
    byte2,
    port: patches.midi.get(text(cue['midiPatchID'])) ?? text(cue['midiDestinationName'])
  }
  if (messageType === 2) {
    midi.msc = {
      format: number(cue['commandFormat']) ?? 0x7f,
      command: number(cue['command']) ?? 0x01,
      deviceId: number(cue['deviceID']) ?? 127,
      cueNumber: text(cue['qNumber']),
      cueList: text(cue['qList'])
    }
  }
  if (messageType === 3) midi.sysex = hexBytes(cue['sysexString'] ?? cue['sysex'] ?? cue['rawString'] ?? cue['hexString'])
  return midi
}

function fileNetwork(cue: ArchivedDict, patches: Patches): QLabNetwork {
  const patchId = text(cue['networkPatchID']) || text(cue['patchID'])
  const patchNumber = number(cue['patch'])
  const patch = patches.network.get(patchId) ??
    (patchNumber !== undefined ? patches.networkOrder[patchNumber - 1] : undefined) ??
    (patches.networkOrder.length === 1 ? patches.networkOrder[0] : undefined)
  const destination = { host: patch?.host ?? null, port: patch?.port ?? null, patch: patch?.name ?? '' }
  const osc = text(cue['oscString']) || text(cue['customString']) || text(cue['oscMessage'])
  const messageType = number(cue['messageType'])
  if (osc.trim() !== '') return { kind: 'osc', message: osc.trim(), ...destination }
  const plain = text(cue['plainTextString']) || text(cue['udpString'])
  if (plain !== '') return { kind: 'text', message: plain, ...destination }
  const hexCodes = text(cue['hexCodesString'])
  if (hexCodes !== '') return { kind: 'hex', message: hexCodes, ...destination }
  if (messageType === 1 || number(cue['qlabCommand']) !== undefined) {
    const target = text(cue['qlabCueNumber'])
    const command = text(cue['qlabCommand'])
    return { kind: 'qlab', message: `QLab command ${command}${target !== '' ? ` on cue ${target}` : ''}`, ...destination }
  }
  return { kind: 'unknown', message: '', ...destination }
}

function fileCue(value: Archived, patches: Patches, counter: { cues: number }, name: string): QLabCue {
  counter.cues++
  if (counter.cues > MAX_IMPORTED_CUES) {
    throw new Refusal(`“${name}” holds more than ${MAX_IMPORTED_CUES.toLocaleString('en-GB')} cues, which is more than this import converts`)
  }
  const cue = record(value) ?? {}
  const { kind, typeName } = fileKind(cue)
  const out: QLabCue = {
    kind,
    typeName,
    uniqueID: text(cue['uniqueID']),
    number: text(cue['number']),
    name: text(cue['name']),
    notes: text(cue['notes']),
    colorName: text(cue['colorName']),
    armed: flag(cue['armed'], true),
    preWait: number(cue['preWait']) ?? 0,
    postWait: number(cue['postWait']) ?? 0,
    duration: number(cue['duration']) ?? 0,
    continueMode: number(cue['continueMode']) ?? 0
  }

  const targetId = text(cue['cueTargetUniqueID']) || text(cue['cueTargetID']) || text(cue['targetUniqueID'])
  const targetNumber = text(cue['cueTargetNumber']) || text(cue['targetCueNumber'])
  if (targetId !== '' || targetNumber !== '') out.target = { uniqueID: targetId, number: targetNumber }
  if (kind === 'load') {
    // The time a Load cue readies its target to, under the names QLab's versions have used.
    const loadAt = number(cue['loadAt']) ?? number(cue['loadActionAt']) ?? number(cue['loadTime'])
    if (loadAt !== undefined) out.loadAt = loadAt
  }
  const media = fileMedia(cue['fileTarget'] ?? cue['mediaTarget'])
  if (media) out.media = media

  switch (kind) {
    case 'audio':
    case 'video': {
      out.startTime = number(cue['startTime'])
      out.endTime = number(cue['endTime'])
      out.playCount = number(cue['playCount'])
      out.infiniteLoop = flag(cue['infiniteLoop'], false)
      const slices = fileSlices(cue['slices'])
      if (slices !== undefined) out.slices = slices
      const last = record(cue['lastSlice'])
      if (last !== null) out.lastSlice = { playCount: number(last['playCount']) ?? 1, infiniteLoop: flag(last['infiniteLoop'], false) }
      out.rate = number(cue['rate']) ?? number(cue['playbackRate'])
      const entries = matrixEntries(cue['levels'], 'level')
      if (entries.length > 0) {
        out.levels = { master: levelAt(entries, 0, 0), left: levelAt(entries, 0, 1), right: levelAt(entries, 0, 2) }
      }
      break
    }
    case 'fade': {
      const fade = record(cue['fade'])
      let live = matrixEntries(fade ?? undefined, 'end').filter(entry => entry.live)
      // A fade that keeps its targets as a level matrix rather than a fade description.
      if (live.length === 0) {
        live = matrixEntries(cue['levels'], 'level')
      }
      const master = levelAt(live, 0, 0)
      const outputs = live.filter(entry => entry.row === 0 && entry.column > 0).sort((a, b) => a.column - b.column)
      let pan: number | null = null
      if (outputs.length >= 2) {
        const left = gain(outputs[0].value) ?? 0
        const right = gain(outputs[outputs.length - 1].value) ?? 0
        pan = left + right <= 0 ? 0 : Math.max(-1, Math.min(1, (right - left) / (left + right)))
      }
      out.fadeTo = { master, pan }
      out.stopTargetWhenDone = flag(cue['stopTargetWhenDone'], false)
      break
    }
    case 'devamp':
      // QLab 5's archive names the inspector's two checkboxes after QLab 4's: "start next cue
      // when target reaches the end of the current slice" and "stop target when it reaches the
      // end of the current slice". Its OSC names are `startNextCueWhenSliceEnds` and
      // `stopTargetWhenSliceEnds`, read the same way.
      out.stopTargetWhenDone = flag(cue['stopTargetWhenDone'] ?? cue['stopTargetWhenSliceEnds'], false)
      out.startNextAtSliceEnd = flag(cue['fireNextCueAtMomentLoopEnds'] ?? cue['startNextCueWhenSliceEnds'], false)
      out.devampType = number(cue['devampType'])
      break
    case 'group': {
      out.groupMode = number(cue['groupMode']) ?? number(cue['mode'])
      const children = cue['cues']
      out.children = Array.isArray(children) ? children.map(child => fileCue(child, patches, counter, name)) : []
      break
    }
    case 'midi':
      out.midi = fileMidi(cue, patches)
      break
    case 'network':
      out.network = fileNetwork(cue, patches)
      break
    case 'script':
      out.script = text(cue['source']) || text(cue['scriptSource'])
      break
    case 'light':
      out.detail = text(cue['commandText']) || text(cue['lightCommandText'])
      break
    case 'text':
      out.detail = text(cue['text']) || text(cue['titlesAttributedString']) || text(cue['attributedString'])
      break
  }
  return out
}

/**
 * Every patch the settings describe, wherever in them it is: a record with a unique id and
 * a host is a network destination, one with a destination name is a MIDI port. Searched to
 * a fixed depth, with every record visited once.
 */
function readPatches(settings: Archived): Patches {
  const patches: Patches = { network: new Map(), networkOrder: [], midi: new Map() }
  const seen = new Set<object>()
  const visit = (value: Archived, depth: number): void => {
    if (depth > MAX_SETTINGS_DEPTH || value === null || typeof value !== 'object') return
    if (isBytes(value) || value instanceof Date) return
    if (seen.has(value)) return
    seen.add(value)
    if (Array.isArray(value)) {
      value.forEach(item => visit(item, depth + 1))
      return
    }
    const data = record(value['data']) ?? value
    const id = text(data['uniqueID']) || text(value['uniqueID'])
    if (id !== '') {
      const clients = data['clientStates']
      const client = Array.isArray(clients) ? record(clients.find(isRecord)) : null
      const host = text(client?.['host']) || text(data['host']) || text(data['destinationIPAddress'])
      if (host !== '' || client !== null) {
        const port = number(client?.['port']) ?? number(data['port']) ?? number(data['destinationPort']) ?? null
        const patch = { name: text(data['name']), host: host || null, port }
        if (!patches.network.has(id)) patches.networkOrder.push(patch)
        patches.network.set(id, patch)
      } else if (text(data['destinationName']) !== '') {
        patches.midi.set(id, text(data['destinationName']))
      }
    }
    for (const key of Object.keys(value)) visit(value[key], depth + 1)
  }
  visit(settings, 0)
  return patches
}
