// A missing file found under the name cloud storage or a zip tool gave it.
//
// A show's audio that went through Google Drive, a zip made on another system, or a Windows
// copy of a Mac folder comes back with the characters those places cannot keep in a name
// replaced by `_` — `IT'S SURE A NICE VIEW HERE.mp3` arrives as `IT_S SURE A NICE VIEW
// HERE.mp3` — and a Mac's decomposed accents can arrive composed, or the other way round. The
// show still names the file it was saved with. So where the exact path is not there, the
// folder it would be in is read and a file whose name differs only by those characters is
// taken — when it is the only one. Two that could both be it is not a guess this makes: the
// cue stays missing and the caller says which files they were.
//
// Bounded: a folder is read to a fixed number of entries, once per relink, through a cache
// the caller holds; nothing below it is searched.

import { opendirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

/** The characters a cloud drive, a zip tool or a Windows copy replaces with `_` in a file name. */
const REPLACED = /['’":/?<>|*\\]/g

/** How many entries of one folder are read for a name. A folder of audio is far smaller. */
export const MAX_FOLDER_ENTRIES = 10_000

/** A name as it compares across those places: composed, and with each replaced character `_`. */
export function foldedName(name: string): string {
  return name.normalize('NFC').replace(REPLACED, '_')
}

/** The names of the files in a folder, to the bound, or null when it cannot be read. */
export type ListFolder = (folder: string) => string[] | null

/** Reads a folder's file names to `MAX_FOLDER_ENTRIES`, without reading the rest of it. */
export const listFolder: ListFolder = folder => {
  let handle: ReturnType<typeof opendirSync> | null = null
  try {
    handle = opendirSync(folder)
    const names: string[] = []
    for (let entry = handle.readSync(); entry !== null && names.length < MAX_FOLDER_ENTRIES; entry = handle.readSync()) {
      if (entry.isFile() || entry.isSymbolicLink()) names.push(entry.name)
    }
    return names
  } catch {
    return null
  } finally {
    try {
      handle?.closeSync()
    } catch {
      // Already closed, or never opened: nothing to give back.
    }
  }
}

/** What a look for a renamed file found: the one file, or every file it could be. */
export type RenamedMatch = { path: string } | { ambiguous: string[] }

/**
 * The file in `wanted`'s folder whose name folds to the same as `wanted`'s, where it differs
 * from it: the path when exactly one does, every candidate when several do, null for none.
 * `listings` keeps each folder's names for the rest of one relink.
 */
export function renamedFile(
  wanted: string,
  list: ListFolder = listFolder,
  listings: Map<string, string[] | null> = new Map()
): RenamedMatch | null {
  const folder = dirname(wanted)
  const name = basename(wanted)
  const target = foldedName(name)
  if (!listings.has(folder)) listings.set(folder, list(folder))
  const names = listings.get(folder)
  if (!names) return null
  const matches = names.filter(candidate => candidate !== name && foldedName(candidate) === target)
  if (matches.length === 0) return null
  if (matches.length > 1) return { ambiguous: matches.map(match => join(folder, match)).sort() }
  return { path: join(folder, matches[0]) }
}
