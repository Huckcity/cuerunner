// The published free/Pro record, read as data.
//
// `_bmad-output/specs/spec-cuerunner/capability-catalog.md` is the record: the one place the
// free/Pro line is stated in words, and the tables a build check reads. Two guards read it —
// src/main/license/classification.test.ts holds it to the code's gates, and
// scripts/pro-page.test.ts holds the site's free-versus-Pro page to it — and both have to read
// the same tables the same way, so the reading lives here rather than in either test.
//
// The record is the input, so every reader here fails loudly when a table is missing, a row is
// malformed or a class is neither of the two: a parser that returned nothing would let both
// guards pass against nothing.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The repository root, from this file: src/main/license → the checkout. */
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/** Where the record lives: the input of every check below, named for the failures it writes. */
export const recordPath = join(root, '_bmad-output', 'specs', 'spec-cuerunner', 'capability-catalog.md')

/** The class a row states and the code enforces: what costs, and what does not. */
export type GateClass = 'free' | 'pro'

/** One row of the record's boundary table: what it names, of what kind, and as what class. */
export interface BoundaryItem {
  item: string
  kind: 'service' | 'channel'
  identifier: string
  class: GateClass
}

export const BOUNDARY_HEADER = ['Item', 'Kind', 'Identifier', 'Class'] as const
export const CUE_TABLE_HEADER = ['Type', 'Key', 'What it does'] as const

/** One markdown table line's cells, or nothing when the line is not a table row. */
export function rowCells(line: string): string[] {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return []
  return trimmed.slice(1, -1).split('|').map(cell => cell.trim())
}

/**
 * The rows of the record's table whose header is `header`, in file order — never an empty
 * list for a table that is not there. Every check below reads these rows, so a renamed
 * header or a table that moved stops the run instead of reading as a boundary with nothing
 * in it.
 */
export function tableRows(markdown: string, header: readonly string[]): string[][] {
  const lines = markdown.split('\n')
  const start = lines.findIndex(line => {
    const cells = rowCells(line)
    return cells.length === header.length && header.every((cell, index) => cells[index] === cell)
  })
  if (start === -1) {
    throw new Error(
      `the record carries no "${header.join(' | ')}" table: the classes are read from its rows, so a table this check cannot find is not a boundary with nothing to say`
    )
  }
  // The line under a header row is the table's rule, and it has to be one: without it the
  // header belongs to no table this reader knows how to read.
  const rule = rowCells(lines[start + 1] ?? '')
  if (rule.length !== header.length || !rule.every(cell => /^:?-{2,}:?$/.test(cell))) {
    throw new Error(
      `the record's "${header.join(' | ')}" table has no rule line under its header: ${lines[start + 1] ?? 'the record ends there'}`
    )
  }
  const rows: string[][] = []
  for (let line = start + 2; line < lines.length; line++) {
    const cells = rowCells(lines[line])
    if (cells.length === 0) {
      // A line that opens like a row and does not close like one is the table going wrong,
      // not the table ending: reading it as the end would drop every row after it.
      if (lines[line].trimStart().startsWith('|')) {
        throw new Error(`the record's "${header.join(' | ')}" table has a line that is not a row: ${lines[line]}`)
      }
      break
    }
    if (cells.length !== header.length) {
      throw new Error(
        `the record's "${header.join(' | ')}" table has a row of ${cells.length} cells where its header has ${header.length}: ${lines[line]}`
      )
    }
    rows.push(cells)
  }
  return rows
}

/** The class a record cell states. Anything else is named rather than read as free. */
export function classOf(cell: string): GateClass {
  const text = cell.replace(/[`*]/g, '').trim().toLowerCase()
  if (text === 'free' || text === 'pro') return text
  throw new Error(`the record states the class "${cell}", which is neither free nor Pro`)
}

/**
 * The record as text, or a failure. The free/Pro checks have no other input, and an empty
 * one would let every class through, so a record that cannot be opened is loud. `at` is the
 * record's own path unless a caller asks for another — the guard proves the loudness against
 * a path that holds nothing.
 */
export function readRecord(at: string = recordPath): string {
  try {
    return readFileSync(at, 'utf-8')
  } catch (error) {
    throw new Error(
      `the published record could not be read at ${at} (${error instanceof Error ? error.message : String(error)}): the classification checks read the record, so a run that cannot open it must not pass`
    )
  }
}

/**
 * The record's boundary table, parsed: each row under the identifier the code knows it by.
 * A row of a kind this file cannot resolve is a loud failure, not a skipped row, because a
 * class for something nothing here can look up is exactly the vacuous pass the record
 * exists to prevent.
 */
export function boundaryItems(markdown: string): BoundaryItem[] {
  return tableRows(markdown, BOUNDARY_HEADER).map(cells => {
    const kind = cells[1].toLowerCase()
    const identifier = cells[2].replace(/`/g, '').trim()
    if (kind !== 'service' && kind !== 'channel') {
      throw new Error(
        `the record names "${identifier}" with kind "${cells[1]}"; this check resolves services and channels, so the row would compare against nothing`
      )
    }
    if (identifier === '') {
      throw new Error(`the record's boundary table has a ${kind} row with no identifier: ${cells.join(' | ')}`)
    }
    return { item: cells[0], kind, identifier, class: classOf(cells[3]) }
  })
}

/** The cue table's rows as type → class, which is where the record states a cue's class. */
export function cueClasses(markdown: string): Map<string, GateClass> {
  return new Map(
    tableRows(markdown, CUE_TABLE_HEADER).map(cells => [cells[0].replace(/`/g, '').trim(), classOf(cells[1])])
  )
}
