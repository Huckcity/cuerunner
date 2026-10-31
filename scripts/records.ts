// The repository's written records, read as data: the markdown tables the guards under
// scripts/ hold the code and the site to. Every reader fails loudly when a table is missing or a
// row is malformed: a parser that returned nothing would let a guard pass against nothing.
import { readFileSync } from 'node:fs'

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

/**
 * The record as text, or a failure. A check has no other input, and an empty
 * one would let everything through, so a record that cannot be opened is loud. `at` is the
 * record's own path unless a caller asks for another — the guard proves the loudness against
 * a path that holds nothing.
 */
export function readRecord(at: string): string {
  try {
    return readFileSync(at, 'utf-8')
  } catch (error) {
    throw new Error(
      `the published record could not be read at ${at} (${error instanceof Error ? error.message : String(error)}): the classification checks read the record, so a run that cannot open it must not pass`
    )
  }
}
