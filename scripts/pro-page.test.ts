// The free-versus-Pro page, held to the record it states and to the claims it makes.
//
// `website/pro.html` is the page a buyer reads before choosing, and nothing read it: the
// catalogue is held to the gates by src/main/license/classification.test.ts, while the page's
// free/Pro rows were its own words. The tables are declared rows now (website/docs/pro.mjs),
// so this guard can hold that declaration both ways — every identifier and cue type a column
// names carries the class the record gives it, every Pro class the record holds is named in a
// Pro column, and the free cue types are the ones `CUE_TYPES` minus `PRO_CUE_TYPES` declares —
// and can hold the claims no lane in this project can prove to the phrase the page carries
// for them (AD-24).
//
// Every check is a pure function of what it reads, so the second describe can hand it a page
// the repository would never commit and get the failure back by name. The failure paths are
// what hold the page; a passing run on its own says only that nothing has drifted yet.

import { describe, expect, it } from 'vitest'
import { CUE_TYPES, PRO_CUE_TYPES } from '../src/shared/cue'
import { BOUNDARY_HEADER, boundaryItems, classOf, readRecord, recordPath, tableRows } from '../src/main/license/catalog'
import type { BoundaryItem, GateClass } from '../src/main/license/catalog'

// @ts-ignore — js file, no type declarations
import { FREE_ROWS, NOT_YET_PROVED, PRO, PRO_ROWS, cueSentence } from '../website/docs/pro.mjs'
// @ts-ignore — js file, no type declarations
import { renderPage } from '../website/build-docs.mjs'

/** One cell of a row as this guard reads it: the row it sits in, its class, and what it names. */
interface Cell {
  row: string
  class: GateClass
  identifiers: string[]
  cues: string[]
  notYetProved?: string
}

/**
 * A row's cell, with the fields a row may leave out filled in. The field a cell sits under on
 * the page — `free` or `pro` — is the class it claims, so the two are one argument here.
 */
function cell(row: string, className: GateClass, named: {
  identifiers?: string[]
  cues?: string[]
  notYetProved?: string
}): Cell {
  return {
    row,
    class: className,
    identifiers: named.identifiers ?? [],
    cues: named.cues ?? [],
    notYetProved: named.notYetProved
  }
}

/** Every cell the page declares, in table order: the free table's, then the Pro table's two columns. */
const CELLS: Cell[] = [
  ...FREE_ROWS.map(row => cell(row.label, 'free', row.free)),
  ...PRO_ROWS.flatMap(row => [cell(row.label, 'free', row.free), cell(row.label, 'pro', row.pro)])
]

/** Everything the checks read, in one value: a case below hands them a mutation of it. */
interface Reading {
  cells: Cell[]
  record: BoundaryItem[]
  cueTypes: ReadonlySet<string>
  proCueTypes: ReadonlySet<string>
  rendered: string
}

/** The page this guard reads, found by its own path rather than by where it sits in the list. */
const PRO_PAGE = PRO.find((page: { path: string }) => page.path === 'pro.html')
if (PRO_PAGE === undefined) {
  throw new Error('website/docs/pro.mjs no longer declares pro.html: this guard reads the buyer page by its path')
}

/** The page as the repository holds it, and the record as the code holds it. */
const LIVE: Reading = {
  cells: CELLS,
  record: boundaryItems(readRecord()),
  cueTypes: new Set<string>(CUE_TYPES),
  proCueTypes: new Set<string>(PRO_CUE_TYPES),
  rendered: renderPage(PRO_PAGE)
}

/** The cells of one class, which is the column they sit in. */
function cellsOfClass(reading: Reading, className: GateClass): Cell[] {
  return reading.cells.filter(entry => entry.class === className)
}

/** The Pro classes the record and the code hold that no Pro column on the page names. */
function missingProClasses(reading: Reading): string[] {
  const pro = cellsOfClass(reading, 'pro')
  const identifiers = new Set(pro.flatMap(entry => entry.identifiers))
  const named = new Set(pro.flatMap(entry => entry.cues.map(name => name.toLowerCase())))
  return [
    ...reading.record
      .filter(item => item.class === 'pro' && !identifiers.has(item.identifier))
      .map(
        item =>
          `the record classes \`${item.identifier}\` Pro and no Pro column on the page names it: the page needs the row that carries it ("${item.item}")`
      ),
    ...[...reading.proCueTypes]
      .filter(type => !named.has(type))
      .map(type => `the code declares the cue type "${type}" Pro and no Pro column on the page names it`)
  ]
}

/** Every identifier a column names, held to the class the record gives it. */
function identifierClassProblems(reading: Reading): string[] {
  return reading.cells.flatMap(entry =>
    entry.identifiers.flatMap(identifier => {
      const item = reading.record.find(candidate => candidate.identifier === identifier)
      if (item === undefined) {
        return [
          `the page's "${entry.row}" row names \`${identifier}\` as ${entry.class}, and the record's boundary table does not name it at all`
        ]
      }
      return item.class === entry.class
        ? []
        : [`the page's "${entry.row}" row names \`${identifier}\` as ${entry.class}, and the record classes it ${item.class}`]
    })
  )
}

/** Every cue type a column names, held to the class the code declares. */
function cueClassProblems(reading: Reading): string[] {
  return reading.cells.flatMap(entry =>
    entry.cues.flatMap(name => {
      const type = name.toLowerCase()
      if (!reading.cueTypes.has(type)) {
        return [`the page's "${entry.row}" row names the cue type "${name}", which the code does not have`]
      }
      const declared: GateClass = reading.proCueTypes.has(type) ? 'pro' : 'free'
      return declared === entry.class
        ? []
        : [`the page's "${entry.row}" row names the cue type "${name}" as ${entry.class}, and the code declares it ${declared}`]
    })
  )
}

/** The free cue types the code declares, held both ways to the ones the page names as free. */
function freeCueListProblems(reading: Reading): string[] {
  const named = new Set(cellsOfClass(reading, 'free').flatMap(entry => entry.cues.map(name => name.toLowerCase())))
  const declared = [...reading.cueTypes].filter(type => !reading.proCueTypes.has(type))
  return [
    ...declared
      .filter(type => !named.has(type))
      .map(type => `the code declares the cue type "${type}" free and no free column on the page names it`),
    ...[...named]
      .filter(type => !declared.includes(type))
      .map(type => `the page names "${type}" as a free cue type and the code does not declare it free`)
  ]
}

/** The claims no lane can prove, each held to the shared phrase at the claim and to nowhere else. */
function phraseProblems(reading: Reading): string[] {
  const claims = reading.cells.filter(entry => entry.notYetProved !== undefined)
  const carried = reading.rendered.split(NOT_YET_PROVED).length - 1
  return [
    ...claims
      .filter(entry => !reading.rendered.includes(`${entry.notYetProved} ${NOT_YET_PROVED}`))
      .map(
        entry =>
          `the page states "${entry.notYetProved}" in its "${entry.row}" row and the phrase is not at the claim: ${NOT_YET_PROVED}`
      ),
    ...(carried === claims.length
      ? []
      : [
          `the page carries the phrase ${carried} time(s) for the ${claims.length} claim(s) its rows declare: a row that lost the phrase, or one that carries it without declaring the claim`
        ])
  ]
}

/** The words a count is written in at the head of the sentence, read back as the number they state. */
const COUNT_WORDS: Record<string, number> = {
  no: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12
}

describe('the free-versus-Pro page', () => {
  it('names every Pro class the record holds, in a Pro column', () => {
    expect(missingProClasses(LIVE)).toEqual([])
  })

  it('holds every identifier a column names to the class the record gives it', () => {
    expect(identifierClassProblems(LIVE)).toEqual([])
  })

  it('holds every cue type a column names to the class the code declares', () => {
    expect(cueClassProblems(LIVE)).toEqual([])
  })

  it('names the free cue types the code declares, all of them', () => {
    expect(freeCueListProblems(LIVE)).toEqual([])
  })

  it('carries the shared phrase at every claim nothing here has proved', () => {
    expect(phraseProblems(LIVE)).toEqual([])
  })

  it('opens the cue stack with the count of free cue types the code declares', () => {
    // The count is the one word in that sentence the list does not produce: a COUNT table off
    // by one would ship "Ten cue types" over an eleven-type list with every other check green.
    const declared = CUE_TYPES.filter(type => !LIVE.proCueTypes.has(type)).length
    const stated = /<td>The cue stack<\/td><td>(\w+) cue type/.exec(LIVE.rendered)?.[1] ?? ''
    const said = stated === '' ? Number.NaN : COUNT_WORDS[stated.toLowerCase()] ?? Number(stated)
    expect(said, `the cue stack row opens with "${stated}", which is not the count of free cue types this guard reads`).toBe(
      declared
    )
  })

  it('stays a sentence when the free cue list is one type or none', () => {
    expect(cueSentence(['audio'])).toMatch(/^One cue type — audio — /)
    expect(cueSentence([])).toMatch(/^No cue types — /)
  })
})

/**
 * The page the repository would never commit, one failure at a time: each case changes one
 * thing in the live reading and asserts the check names it. These are the states the checks
 * exist to refuse — the drifting row, the class sold the wrong way, the phrase dropped — and
 * nothing else in the suite exercises them.
 */
describe('the page the checks exist to refuse', () => {
  it('names a Pro class the page stops carrying', () => {
    const dropped = CELLS.map(entry =>
      entry.row === 'The network' && entry.class === 'pro' ? { ...entry, identifiers: [] } : entry
    )
    expect(missingProClasses({ ...LIVE, cells: dropped })).toEqual([
      expect.stringContaining('the record classes `presence` Pro and no Pro column on the page names it')
    ])
  })

  it('names both sides when a Pro column declares a free identifier', () => {
    const sold = CELLS.map(entry =>
      entry.row === 'Scenes and the desk' && entry.class === 'pro'
        ? { ...entry, identifiers: [...entry.identifiers, 'midi:sendTcp'] }
        : entry
    )
    expect(identifierClassProblems({ ...LIVE, cells: sold })).toEqual([
      expect.stringContaining('the page\'s "Scenes and the desk" row names `midi:sendTcp` as pro, and the record classes it free')
    ])
  })

  it('names both sides when a column declares a cue type the code classes the other way', () => {
    const crossed = CELLS.map(entry =>
      entry.row === 'The script' && entry.class === 'free' ? { ...entry, cues: [...entry.cues, 'scene'] } : entry
    )
    expect(cueClassProblems({ ...LIVE, cells: crossed })).toEqual([
      expect.stringContaining('the page\'s "The script" row names the cue type "scene" as free, and the code declares it pro')
    ])
  })

  it('names a free cue type the page stops carrying', () => {
    const stale = CELLS.map(entry =>
      entry.row === 'The cue stack' && entry.class === 'free'
        ? { ...entry, cues: entry.cues.filter(type => type !== 'devamp') }
        : entry
    )
    expect(freeCueListProblems({ ...LIVE, cells: stale })).toEqual([
      expect.stringContaining('the code declares the cue type "devamp" free and no free column on the page names it')
    ])
  })

  it('names the row whose phrase is gone, and the count that no longer matches it', () => {
    // The words are the module's own: the engine row's claim is the one that moves when a lane
    // behind it changes, so this case reads what the module declares rather than a copy of it.
    const engine = CELLS.find(entry => entry.row === 'The engine' && entry.notYetProved !== undefined)
    if (engine === undefined) {
      throw new Error('website/docs/pro.mjs declares no claim on the engine row: this case edits the row whose phrase it drops')
    }
    const missing = LIVE.rendered.replace(`${engine.notYetProved} ${NOT_YET_PROVED}`, `${engine.notYetProved}`)
    expect(phraseProblems({ ...LIVE, rendered: missing })).toEqual([
      expect.stringContaining(`the page states "${engine.notYetProved}" in its "The engine" row and the phrase is not at the claim`),
      expect.stringContaining('the page carries the phrase 3 time(s) for the 4 claim(s)')
    ])
  })

  it('fails a phrase a row carries without declaring the claim', () => {
    const undeclared = LIVE.rendered.replace('<td>The waveform</td>', `<td>${NOT_YET_PROVED} The waveform</td>`)
    expect(phraseProblems({ ...LIVE, rendered: undeclared })).toEqual([
      expect.stringContaining('the page carries the phrase 5 time(s) for the 4 claim(s)')
    ])
  })
})

/**
 * The guard reads the record, and a record it cannot read is a failure rather than an empty
 * pass: a class compared against nothing is the vacuous run the record exists to prevent.
 * classification.test.ts holds the same reader for the code-side guard.
 */
describe('the record the guard reads', () => {
  it('fails loudly when the record is not at the path it names', () => {
    expect(() => readRecord(`${recordPath}.moved`)).toThrow('the published record could not be read at')
  })

  it('fails loudly on a record it cannot parse', () => {
    expect(() => tableRows('# nothing to read here', BOUNDARY_HEADER)).toThrow(
      'carries no "Item | Kind | Identifier | Class" table'
    )
    expect(() => classOf('enterprise')).toThrow('states the class "enterprise", which is neither free nor Pro')
    const rogue = [
      '| Item | Kind | Identifier | Class |',
      '| --- | --- | --- | --- |',
      '| Scenes view | surface | `scenes` | Pro |'
    ].join('\n')
    expect(() => boundaryItems(rogue)).toThrow('names "scenes" with kind "surface"')
  })
})
