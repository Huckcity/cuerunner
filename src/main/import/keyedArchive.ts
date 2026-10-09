// An NSKeyedArchiver archive, turned back into a tree.
//
// Apple's keyed archiver writes an object graph as a binary plist: a flat `$objects`
// list whose first entry is the `$null` placeholder, objects that point at each other by
// UID, each custom object carrying a `$class` UID that names its class, and a `$top`
// dictionary that says which object is the root. That format is documented by Apple's own
// Foundation headers and by every tool that has ever read one; nothing here is specific to
// QLab, which is only the program that happened to archive its workspace this way.
//
// What comes back is plain data. Foundation's own containers are unwrapped into what they
// hold — an NSArray is a list, an NSDictionary an object, an NSString a string — and every
// other object becomes a record with its class name under `$class`, so the reader above
// this one matches on class names and property names and never sees a UID.
//
// The graph is allowed cycles (a cue points at the group that lists it). A reference back
// to an object still being resolved reads as null, and every object is resolved once, so
// the work is bounded by the number of objects the file holds.

import { PlistError, PlistUid, isBytes, parseBinaryPlist, type PlistDict, type PlistValue } from './bplist'

/** A custom archived object: its class, and its properties. */
export interface ArchivedObject {
  $class: string
  [key: string]: Archived
}

/** A dictionary the archive held as an NSDictionary. Unlike an object, it has no `$class`. */
export type ArchivedDict = { [key: string]: Archived }

export type Archived =
  | null
  | boolean
  | number
  | string
  | Date
  | Uint8Array
  | Archived[]
  | ArchivedObject
  | ArchivedDict

/** How deep an archive's objects may nest before it is refused rather than followed. */
const MAX_DEPTH = 192

/** Decodes an NSKeyedArchiver archive and returns its root object. */
export function unarchive(bytes: Uint8Array): Archived {
  const top = parseBinaryPlist(bytes)
  if (!isDict(top)) throw new PlistError('it is a property list, but not an archive')
  const objects = top['$objects']
  const roots = top['$top']
  if (!Array.isArray(objects) || objects.length === 0 || !isDict(roots)) {
    throw new PlistError('it is a property list, but not a keyed archive')
  }
  // `root` is what NSKeyedArchiver's own encoders name it; anything else is a writer that
  // archived under a key of its own, whose first entry is then the root.
  const root = roots['root'] ?? Object.values(roots)[0]
  if (!(root instanceof PlistUid)) throw new PlistError('its archive does not say where the root object is')
  return new Resolver(objects).follow(root.index, 0)
}

/** Whether a value is an archived custom object, and if a class is named, that one. */
export function isArchivedObject(value: Archived | undefined, className?: string): value is ArchivedObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  if (isBytes(value) || value instanceof Date) return false
  const named = (value as ArchivedDict)['$class']
  if (typeof named !== 'string') return false
  return className === undefined || named === className
}

/** Whether a value is a record of any kind: an archived object or an unwrapped dictionary. */
export function isRecord(value: Archived | undefined): value is ArchivedDict {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    !(isBytes(value)) && !(value instanceof Date)
}

function isDict(value: PlistValue): value is PlistDict {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    !(isBytes(value)) && !(value instanceof Date) && !(value instanceof PlistUid)
}

class Resolver {
  private readonly memo = new Map<number, Archived>()
  private readonly resolving = new Set<number>()

  constructor(private readonly objects: PlistValue[]) {}

  follow(index: number, depth: number): Archived {
    const done = this.memo.get(index)
    if (done !== undefined) return done
    // A back-reference to something still being built: the cycle every cue tree has.
    if (this.resolving.has(index)) return null
    if (index >= this.objects.length) throw new PlistError('an object refers to one the archive does not hold')
    this.resolving.add(index)
    const value = this.value(this.objects[index], depth)
    this.resolving.delete(index)
    this.memo.set(index, value)
    return value
  }

  private value(value: PlistValue, depth: number): Archived {
    if (depth > MAX_DEPTH) throw new PlistError('its objects nest deeper than a workspace does')
    if (value instanceof PlistUid) return this.follow(value.index, depth + 1)
    if (value === '$null') return null
    if (Array.isArray(value)) return value.map(item => this.value(item, depth + 1))
    if (isDict(value)) return this.object(value, depth)
    return value
  }

  private className(dict: PlistDict): string | null {
    const ref = dict['$class']
    if (!(ref instanceof PlistUid)) return null
    const described = this.objects[ref.index]
    if (!isDict(described)) return null
    const name = described['$classname']
    return typeof name === 'string' ? name : null
  }

  private object(dict: PlistDict, depth: number): Archived {
    const className = this.className(dict)
    const field = (key: string): Archived => {
      const raw = dict[key]
      return raw === undefined ? null : this.value(raw, depth + 1)
    }
    switch (className) {
      case 'NSString':
      case 'NSMutableString':
        return field('NS.string')
      // The words, without the styling: a title's text and some notes are kept this way.
      case 'NSAttributedString':
      case 'NSMutableAttributedString':
        return field('NSString')
      case 'NSArray':
      case 'NSMutableArray':
      case 'NSSet':
      case 'NSMutableSet':
      case 'NSOrderedSet':
      case 'NSMutableOrderedSet': {
        const items = field('NS.objects')
        return Array.isArray(items) ? items : []
      }
      case 'NSDictionary':
      case 'NSMutableDictionary': {
        const keys = field('NS.keys')
        const values = field('NS.objects')
        const out: ArchivedDict = Object.create(null) as ArchivedDict
        if (Array.isArray(keys) && Array.isArray(values)) {
          const count = Math.min(keys.length, values.length)
          for (let i = 0; i < count; i++) {
            const key = keys[i]
            out[typeof key === 'string' ? key : String(key)] = values[i]
          }
        }
        return out
      }
      case 'NSData':
      case 'NSMutableData': {
        const data = field('NS.bytes') ?? field('NS.data')
        return isBytes(data) ? data : new Uint8Array(0)
      }
      case 'NSDate':
      case 'NSMutableDate': {
        const time = field('NS.time')
        return typeof time === 'number' ? new Date((time + 978307200) * 1000) : null
      }
      case 'NSUUID': {
        const raw = field('NS.uuidbytes')
        return isBytes(raw) && raw.length === 16 ? uuidString(raw) : null
      }
      default: {
        const out: ArchivedObject = Object.create(null) as ArchivedObject
        out.$class = className ?? ''
        for (const key of Object.keys(dict)) {
          if (key.startsWith('$')) continue
          out[key] = this.value(dict[key], depth + 1)
        }
        return out
      }
    }
  }
}

function uuidString(bytes: Uint8Array): string {
  const hex = Buffer.from(bytes).toString('hex').toUpperCase()
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
