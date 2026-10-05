// The app says its own name. It was WinsLab before it was Cuerunner, the rename went through
// every file once, and the old name then came back: fifteen of the sentences a load refuses a
// file with said "this version of WinsLab", and five suites pinned that wording, so every test
// was green while an operator was told about a product they had never installed.
//
// What this holds is the sources the app is built from — `src/`, text files only — because a
// sentence written there is one the window can show. The business documents, the changelog's
// old URLs and the planning artifacts keep the name as history; they are not read here.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SOURCES = /\.(ts|tsx|css|html)$/

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return SOURCES.test(entry.name) ? [path] : []
  })
}

describe('the name the app calls itself', () => {
  it('is never the one it had before the rename', () => {
    const stale = sourceFiles('src').filter(path => /winslab/i.test(readFileSync(path, 'utf8')))
    expect(stale, 'these sources still say WinsLab').toEqual([])
  })
})
