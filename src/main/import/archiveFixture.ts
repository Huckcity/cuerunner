// Test support: binary plists and NSKeyedArchiver archives, written from plain values, so
// the import's tests build the QLab workspaces they read rather than carrying files
// nobody can inspect. The unit tests and the e2e spec both use it; the app never does.
//
// The writer follows the same published layout the reader does (CFBinaryPList.c): objects,
// then an offset table, then the 32-byte trailer. The archiver writes what Foundation's
// does — `$archiver`, `$version`, `$top.root`, `$objects` starting with `$null`, a class
// description per class — which is all the reader asks of an archive.

import { PlistUid, isBytes } from './bplist'

/** A real number, written as one even when its value is whole (QLab's times are reals). */
export class Real {
  constructor(readonly value: number) {}
}

export type WritableValue =
  | null
  | boolean
  | number
  | Real
  | string
  | Date
  | Uint8Array
  | PlistUid
  | WritableValue[]
  | { [key: string]: WritableValue }

const APPLE_EPOCH_SECONDS = 978307200

function bytesFor(value: number): number {
  if (value < 0x100) return 1
  if (value < 0x10000) return 2
  if (value < 0x100000000) return 4
  return 8
}

function uintBytes(value: number, size: number): number[] {
  const out: number[] = []
  let rest = value
  for (let i = 0; i < size; i++) {
    out.unshift(rest % 256)
    rest = Math.floor(rest / 256)
  }
  return out
}

function isPlainObject(value: WritableValue): value is { [key: string]: WritableValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    !(isBytes(value)) && !(value instanceof Date) && !(value instanceof PlistUid) && !(value instanceof Real)
}

/** A whole value as a binary plist. */
export function writeBinaryPlist(top: WritableValue): Buffer {
  // Flatten: every value gets an index, containers hold their children's indices.
  type Node = { value: WritableValue; refs: number[] }
  const nodes: Node[] = []
  const add = (value: WritableValue): number => {
    const index = nodes.length
    const node: Node = { value, refs: [] }
    nodes.push(node)
    if (Array.isArray(value)) node.refs = value.map(add)
    else if (isPlainObject(value)) {
      const keys = Object.keys(value)
      node.refs = [...keys.map(key => add(key)), ...keys.map(key => add(value[key]))]
    }
    return index
  }
  add(top)
  const refSize = bytesFor(nodes.length)

  const lengthMarker = (type: number, length: number): number[] => {
    if (length < 15) return [(type << 4) | length]
    const size = bytesFor(length)
    return [(type << 4) | 0xf, 0x10 | Math.log2(size), ...uintBytes(length, size)]
  }

  const encode = (node: Node): number[] => {
    const value = node.value
    if (value === null) return [0x00]
    if (value === false) return [0x08]
    if (value === true) return [0x09]
    if (value instanceof PlistUid) {
      const size = bytesFor(value.index)
      return [0x80 | (size - 1), ...uintBytes(value.index, size)]
    }
    if (value instanceof Real || (typeof value === 'number' && !Number.isInteger(value))) {
      const buffer = Buffer.alloc(8)
      buffer.writeDoubleBE(value instanceof Real ? value.value : value)
      return [0x23, ...buffer]
    }
    if (typeof value === 'number') {
      if (value < 0) {
        const buffer = Buffer.alloc(8)
        buffer.writeBigInt64BE(BigInt(value))
        return [0x13, ...buffer]
      }
      const size = bytesFor(value)
      return [0x10 | Math.log2(size), ...uintBytes(value, size)]
    }
    if (value instanceof Date) {
      const buffer = Buffer.alloc(8)
      buffer.writeDoubleBE(value.getTime() / 1000 - APPLE_EPOCH_SECONDS)
      return [0x33, ...buffer]
    }
    if (isBytes(value)) return [...lengthMarker(0x4, value.length), ...value]
    if (typeof value === 'string') {
      // ASCII when it is, UTF-16 big-endian when it is not: the two encodings the reader takes.
      if (/^[\x00-\x7f]*$/.test(value)) return [...lengthMarker(0x5, value.length), ...Buffer.from(value, 'latin1')]
      const units = Buffer.from(value, 'utf16le')
      for (let i = 0; i < units.length; i += 2) [units[i], units[i + 1]] = [units[i + 1], units[i]]
      return [...lengthMarker(0x6, units.length / 2), ...units]
    }
    const refs = node.refs.flatMap(ref => uintBytes(ref, refSize))
    if (Array.isArray(value)) return [...lengthMarker(0xa, value.length), ...refs]
    return [...lengthMarker(0xd, node.refs.length / 2), ...refs]
  }

  const body: number[] = [...Buffer.from('bplist00', 'latin1')]
  const offsets: number[] = []
  for (const node of nodes) {
    offsets.push(body.length)
    for (const byte of encode(node)) body.push(byte)
  }
  const offsetTable = body.length
  const offsetSize = bytesFor(offsetTable)
  for (const offset of offsets) for (const byte of uintBytes(offset, offsetSize)) body.push(byte)
  const trailer = [0, 0, 0, 0, 0, 0, offsetSize, refSize, ...uintBytes(nodes.length, 8), ...uintBytes(0, 8), ...uintBytes(offsetTable, 8)]
  return Buffer.from([...body, ...trailer])
}

// ─── The archiver ─────────────────────────────────────────────────────────────

/** An object the archive writes as a custom class: `$class` and its properties. */
export interface ArchiveObject {
  $class: string
  [key: string]: ArchiveInput
}

/** An NSDictionary, as opposed to a custom object: keys and values with no class of their own. */
export class Dict {
  constructor(readonly entries: { [key: string]: ArchiveInput }) {}
}

/** An NSURL, the way QLab 4 records a file. */
export class Url {
  constructor(readonly relative: string, readonly base: string | null = null) {}
}

/** An NSMutableString, which archives as an object rather than inline. */
export class MutableString {
  constructor(readonly text: string) {}
}

export type ArchiveInput =
  | null
  | boolean
  | number
  | Real
  | string
  | Date
  | Uint8Array
  | Dict
  | Url
  | MutableString
  | ArchiveInput[]
  | ArchiveObject

/** A value archived the way NSKeyedArchiver archives it. */
export function writeKeyedArchive(root: ArchiveInput): Buffer {
  const objects: WritableValue[] = ['$null']
  const classes = new Map<string, number>()

  const classRef = (name: string, chain: string[]): PlistUid => {
    const known = classes.get(name)
    if (known !== undefined) return new PlistUid(known)
    const index = objects.length
    objects.push({ $classname: name, $classes: [name, ...chain, 'NSObject'] })
    classes.set(name, index)
    return new PlistUid(index)
  }

  const place = (value: WritableValue): PlistUid => {
    objects.push(value)
    return new PlistUid(objects.length - 1)
  }

  /** A value as it sits in a property: numbers and booleans inline, everything else by reference. */
  const encode = (value: ArchiveInput): WritableValue => {
    if (value === null) return new PlistUid(0)
    if (typeof value === 'boolean' || typeof value === 'number' || value instanceof Real) return value
    if (typeof value === 'string' || isBytes(value) || value instanceof Date) return place(value)
    const index = objects.length
    objects.push(null)
    let encoded: WritableValue
    if (Array.isArray(value)) {
      encoded = { 'NS.objects': value.map(encode), $class: classRef('NSArray', []) }
    } else if (value instanceof Dict) {
      const keys = Object.keys(value.entries)
      encoded = {
        'NS.keys': keys.map(key => encode(key)),
        'NS.objects': keys.map(key => encode(value.entries[key])),
        $class: classRef('NSDictionary', [])
      }
    } else if (value instanceof Url) {
      encoded = {
        'NS.base': value.base === null ? new PlistUid(0) : encode(new Url(value.base)),
        'NS.relative': encode(value.relative),
        $class: classRef('NSURL', [])
      }
    } else if (value instanceof MutableString) {
      encoded = { 'NS.string': value.text, $class: classRef('NSMutableString', ['NSString']) }
    } else {
      const out: { [key: string]: WritableValue } = {}
      for (const key of Object.keys(value)) {
        if (key === '$class') continue
        out[key] = encode((value as ArchiveObject)[key])
      }
      out.$class = classRef(value.$class, [])
      encoded = out
    }
    objects[index] = encoded
    return new PlistUid(index)
  }

  const rootRef = encode(root)
  return writeBinaryPlist({
    $version: 100000,
    $archiver: 'NSKeyedArchiver',
    $top: { root: rootRef },
    $objects: objects
  })
}

// ─── QLab workspaces ──────────────────────────────────────────────────────────

export interface FixtureList {
  name: string
  uniqueID?: string
  cart?: boolean
  cues: ArchiveObject[]
}

/** A QLab cue: its class and its properties, the way the workspace archives them. */
export function qlabCue(className: string, properties: { [key: string]: ArchiveInput } = {}): ArchiveObject {
  return { $class: className, ...properties }
}

/**
 * A whole QLab workspace file: the outer archive with the workspace's name and settings,
 * and the cue lists as a second archive stored as data inside it — the way QLab saves one.
 *
 * QLab 5 keeps the lists as Group cues — mode 0 a list, mode 5 a cart — under a root group
 * whose id is "[root group of cue lists]": that is what a QLab 5.4 workspace was seen to hold,
 * and the default. `layout: 'classes'` writes each list as a class of its own instead, the
 * shape the reader also takes from other writers.
 */
export function qlabWorkspace(options: { name?: string; lists: FixtureList[]; settings?: Dict; layout?: 'qlab5' | 'classes' }): Buffer {
  const listId = (list: FixtureList): string => list.uniqueID ?? `LIST-${list.name.replace(/\W/g, '')}`
  const cueTree = writeKeyedArchive(options.layout === 'classes'
    ? {
        $class: 'QLabWorkspaceCueTree',
        cues: options.lists.map(list => ({ $class: list.cart ? 'CueCart' : 'CueList', name: list.name, uniqueID: listId(list), cues: list.cues }))
      }
    : {
        $class: 'GroupCue',
        uniqueID: '[root group of cue lists]',
        name: '',
        groupMode: 3,
        cart: new Dict({}),
        cues: options.lists.map(list => ({
          $class: 'GroupCue', name: list.name, uniqueID: listId(list), groupMode: list.cart ? 5 : 0, cart: new Dict({}), cues: list.cues
        }))
      })
  return writeKeyedArchive({
    $class: 'QLabWorkspaceDocument',
    workspaceName: options.name ?? 'Fixture Show',
    settings: options.settings ?? new Dict({}),
    cueLists: new Uint8Array(cueTree)
  })
}

/** A QLab 5 media target: the path relative to the workspace, and where QLab last saw it. */
export function alias(relativePath: string, lastKnownPath = `/Users/sm/Press Night/${relativePath}`): ArchiveObject {
  return { $class: 'F53Alias', relativePath, lastKnownPath }
}

/** One slice marker as QLab 5 archives it: where the slice *ends*, seconds into the file, and how it plays. */
export function audioSlice(time: number, playCount: number, infiniteLoop = false): ArchiveObject {
  return { $class: 'AudioSlice', time: new Real(time), playCount, infiniteLoop }
}

/**
 * A rehearsal track the way a real QLab 5 show cuts one: a count-in that vamps, a bar that is
 * skipped after it, a vamp later on with the bar after it skipped too, and the tail. Its file is
 * `audio/track.wav`, eight seconds; the devamps are cue 1.1 and 1.2, a memo between them.
 *
 *   0–1 s plays once · 1–2 s vamps · 2–3 s skipped (0) · 3–5 s once · 5–6 s vamps · 6–7 s skipped · 7–8 s once
 */
export function rehearsalTrackWorkspace(): Buffer {
  const cue = qlabCue
  return qlabWorkspace({
    name: 'Rehearsal Tracks',
    lists: [{
      name: 'Main Cue List',
      uniqueID: 'LIST-RT',
      cues: [
        cue('AudioCue', {
          uniqueID: 'RT1', number: '1', name: '', fileTarget: alias('audio/track.wav'),
          startTime: new Real(0), endTime: new Real(8), playCount: 1, infiniteLoop: false,
          slices: [
            audioSlice(1, 1), audioSlice(2, 4, true), audioSlice(3, 0), audioSlice(5, 1), audioSlice(6, 1, true), audioSlice(7, 0)
          ],
          lastSlice: { $class: 'AudioSlice', time: new Real(0), playCount: 1, infiniteLoop: false }
        }),
        cue('DevampCue', {
          uniqueID: 'DV1', number: '1.1', name: 'Devamp bar 1', cueTargetUniqueID: 'RT1',
          devampType: 1, stopTargetWhenDone: false, fireNextCueAtMomentLoopEnds: false
        }),
        cue('MemoCue', { uniqueID: 'MM1', number: '', name: 'Auto segue into the bus', notes: 'Watch the MD' }),
        cue('DevampCue', {
          uniqueID: 'DV2', number: '1.2', name: 'Devamp bar 9', cueTargetUniqueID: 'RT1',
          devampType: 1, stopTargetWhenDone: false, fireNextCueAtMomentLoopEnds: false
        })
      ]
    }]
  })
}

/** An audio cue's level matrix with its master and, where given, its first two outputs. */
export function levels(master: number, left?: number, right?: number): ArchiveObject {
  const entries: ArchiveObject[] = [{ $class: 'AudioLevelEntry', row: 0, column: 0, initialLevel: new Real(master), trimLevel: new Real(1) }]
  if (left !== undefined) entries.push({ $class: 'AudioLevelEntry', row: 0, column: 1, initialLevel: new Real(left), trimLevel: new Real(1) })
  if (right !== undefined) entries.push({ $class: 'AudioLevelEntry', row: 0, column: 2, initialLevel: new Real(right), trimLevel: new Real(1) })
  return { $class: 'AudioLevelMatrix', entries }
}

/** A fade's targets: the live crosspoints it moves, each to its end value. */
export function fadeTo(entries: Array<{ row: number; column: number; end: number; live?: boolean }>): ArchiveObject {
  return {
    $class: 'FadeDescription',
    entries: entries.map(entry => ({
      $class: 'FadeEntry',
      row: entry.row,
      column: entry.column,
      startValue: new Real(1),
      endValue: new Real(entry.end),
      live: entry.live ?? true
    }))
  }
}

/** The workspace's patches: one network destination and one MIDI port. */
export function pressNightSettings(): Dict {
  return new Dict({
    Network: new Dict({
      networkPatches: [new Dict({
        data: new Dict({
          uniqueID: 'NP1',
          name: 'Lighting desk',
          clientStates: [new Dict({ host: '10.0.0.5', port: 8000 })]
        })
      })]
    }),
    MIDI: new Dict({ midiPatches: [new Dict({ uniqueID: 'MP1', destinationName: 'Network Session 1' })] })
  })
}

/**
 * A workspace holding one of nearly everything QLab has: every cue the import maps, every
 * one it holds as a placeholder, every group mode, and a cart. The unit tests and the e2e
 * spec both read it.
 */
export function pressNightWorkspace(): Buffer {
  const cue = qlabCue
  return qlabWorkspace({
    name: 'Press Night',
    settings: pressNightSettings(),
    lists: [
      {
        name: 'Main Cue List',
        uniqueID: 'LIST-MAIN',
        cues: [
          cue('AudioCue', {
            uniqueID: 'A1', number: '1', name: 'Walk-in', notes: 'House open', colorName: 'green',
            fileTarget: alias('audio/walk-in.wav'), levels: levels(0.5), startTime: new Real(1.5), endTime: new Real(30),
            playCount: 1, infiniteLoop: true, rate: new Real(1), preWait: new Real(0), postWait: new Real(2), continueMode: 1
          }),
          cue('FadeCue', {
            uniqueID: 'F2', number: '2', name: 'Fade walk-in', cueTargetUniqueID: 'A1', duration: new Real(5),
            preWait: new Real(1), fade: fadeTo([{ row: 0, column: 0, end: 0 }]), stopTargetWhenDone: true
          }),
          cue('StopCue', { uniqueID: 'S3', number: '3', name: 'Stop walk-in', cueTargetUniqueID: 'A1' }),
          cue('GroupCue', {
            uniqueID: 'G4', number: '4', name: 'Sting stack', groupMode: 2, colorName: 'red',
            cues: [
              cue('AudioCue', { uniqueID: 'A41', number: '4.1', name: 'Bows', fileTarget: alias('audio/bows.wav'), continueMode: 1, postWait: new Real(0.5) }),
              cue('AudioCue', { uniqueID: 'A42', number: '4.2', name: '', fileTarget: alias('audio/gone.wav'), preWait: new Real(0.25) })
            ]
          }),
          cue('GroupCue', {
            uniqueID: 'G5', number: '5', name: 'Random door', groupMode: 4,
            cues: [cue('MemoCue', { uniqueID: 'M51', number: '5.1', name: 'Door A' }), cue('MemoCue', { uniqueID: 'M52', number: '5.2', name: 'Door B' })]
          }),
          cue('WaitCue', { uniqueID: 'W6', number: '6', name: 'Hold', duration: new Real(2.5), continueMode: 2 }),
          cue('MemoCue', { uniqueID: 'M7', number: '7', name: 'Standby LX', notes: 'Call it on the cans', armed: false }),
          cue('MIDICue', { uniqueID: 'X8', number: '8', name: 'Note', messageType: 1, status: 1, channel: 2, byte1: 60, byte2: 100, midiPatchID: 'MP1' }),
          cue('MIDICue', {
            uniqueID: 'X9', number: '9', name: 'LX GO', messageType: 2, commandFormat: 1, command: 1, deviceID: 0,
            qNumber: '12', qList: '1', midiPatchID: 'MP1'
          }),
          cue('MIDICue', { uniqueID: 'X10', number: '10', name: 'Bend', messageType: 1, status: 6, channel: 1, byte1: 0, byte2: 64 }),
          cue('NetworkCue', { uniqueID: 'N11', number: '11', name: 'Desk GO', oscString: '/eos/cue/1/go 1 2.5 "hello world"', networkPatchID: 'NP1' }),
          cue('NetworkCue', { uniqueID: 'N12', number: '12', name: 'Projector', plainTextString: 'PWR ON' }),
          cue('ScriptCue', { uniqueID: 'SC13', number: '13', name: 'Script', source: 'tell application "QLab" to start' }),
          cue('VideoCue', { uniqueID: 'V14', number: '14', name: 'Intro film', fileTarget: alias('video/intro.mov') }),
          cue('LightCue', { uniqueID: 'L15', number: '15', name: 'Blackout', commandText: 'all = 0' }),
          cue('DevampCue', { uniqueID: 'D16', number: '16', name: 'Release vamp', cueTargetUniqueID: 'A1' }),
          cue('StartCue', { uniqueID: 'ST17', number: '17', name: 'Start stings', cueTargetNumber: '4' }),
          cue('TimecodeCue', { uniqueID: 'T18', number: '18', name: 'Timecode' }),
          cue('GroupCue', {
            uniqueID: 'G19', number: '19', name: 'Timeline', groupMode: 3,
            cues: [
              cue('OSCCue', { uniqueID: 'O191', number: '19.1', name: 'Ping', customString: '/ping', preWait: new Real(1) }),
              cue('AudioCue', { uniqueID: 'A192', number: '19.2', name: 'Thunder', fileTarget: alias('audio/bows.wav'), preWait: new Real(2) })
            ]
          }),
          cue('GroupCue', {
            uniqueID: 'G20', number: '20', name: 'Pre-show playlist', groupMode: 6,
            cues: [cue('AudioCue', { uniqueID: 'A201', number: '20.1', name: 'Track 1', fileTarget: alias('audio/walk-in.wav') })]
          }),
          cue('GroupCue', {
            uniqueID: 'G21', number: '21', name: 'Enter group', groupMode: 1,
            cues: [cue('WaitCue', { uniqueID: 'W211', number: '21.1', name: 'Step', duration: new Real(1) })]
          })
        ]
      },
      {
        name: 'Sound FX',
        uniqueID: 'LIST-FX',
        cart: true,
        cues: [cue('AudioCue', { uniqueID: 'A-FX1', number: 'FX1', name: 'Door slam', fileTarget: new Url('file:///Users/sm/Press%20Night/audio/door.wav') })]
      }
    ]
  })
}
