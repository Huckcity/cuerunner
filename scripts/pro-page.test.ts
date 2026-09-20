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

import { describe, expect, it } from 'vitest'
import { CUE_TYPES, PRO_CUE_TYPES } from '../src/shared/cue'
import { boundaryItems, readRecord } from '../src/main/license/catalog'
import type { GateClass } from '../src/main/license/catalog'

// @ts-ignore — js file, no type declarations
import { FREE_ROWS, NOT_YET_PROVED, PRO, PRO_ROWS } from '../website/docs/pro.mjs'
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

const record = boundaryItems(readRecord())
const rendered: string = renderPage(PRO[0])

/** The cue types the code has, and the ones it refuses without a licence. */
const cueTypes = new Set<string>(CUE_TYPES)
const proCueTypes = new Set<string>(PRO_CUE_TYPES)

/**
 * The cue types each class of column names, lower-cased back to the identifiers the code uses:
 * a column says "MSC" where the code says `msc`.
 */
const CUE_NAMES: Record<GateClass, Set<string>> = {
  free: new Set(CELLS.filter(entry => entry.class === 'free').flatMap(entry => entry.cues.map(name => name.toLowerCase()))),
  pro: new Set(CELLS.filter(entry => entry.class === 'pro').flatMap(entry => entry.cues.map(name => name.toLowerCase())))
}

describe('the free-versus-Pro page', () => {
  it('names every Pro class the record holds, in a Pro column', () => {
    const identifiers = new Set(CELLS.filter(entry => entry.class === 'pro').flatMap(entry => entry.identifiers))
    const cueNames = CUE_NAMES.pro
    expect([
      ...record
        .filter(item => item.class === 'pro' && !identifiers.has(item.identifier))
        .map(
          item =>
            `the record classes \`${item.identifier}\` Pro and no Pro column on the page names it: the page needs the row that carries it ("${item.item}")`
        ),
      ...[...PRO_CUE_TYPES]
        .filter(type => !cueNames.has(type))
        .map(type => `the code declares the cue type "${type}" Pro and no Pro column on the page names it`)
    ]).toEqual([])
  })

  it('holds every identifier a column names to the class the record gives it', () => {
    expect(
      CELLS.flatMap(entry =>
        entry.identifiers.flatMap(identifier => {
          const item = record.find(candidate => candidate.identifier === identifier)
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
    ).toEqual([])
  })

  it('holds every cue type a column names to the class the code declares', () => {
    expect(
      CELLS.flatMap(entry =>
        entry.cues.flatMap(name => {
          const type = name.toLowerCase()
          if (!cueTypes.has(type)) {
            return [`the page's "${entry.row}" row names the cue type "${name}", which the code does not have`]
          }
          const declared: GateClass = proCueTypes.has(type) ? 'pro' : 'free'
          return declared === entry.class
            ? []
            : [`the page's "${entry.row}" row names the cue type "${name}" as ${entry.class}, and the code declares it ${declared}`]
        })
      )
    ).toEqual([])
  })

  it('names the free cue types the code declares, all of them', () => {
    expect([...CUE_NAMES.free].sort()).toEqual(CUE_TYPES.filter(type => !proCueTypes.has(type)).sort())
  })

  it('carries the shared phrase at every claim nothing here has proved', () => {
    const claims = CELLS.filter(entry => entry.notYetProved !== undefined)
    const carried = rendered.split(NOT_YET_PROVED).length - 1
    expect([
      ...claims
        .filter(entry => !rendered.includes(`${entry.notYetProved} ${NOT_YET_PROVED}`))
        .map(entry => `the page states "${entry.notYetProved}" in its "${entry.row}" row and the phrase is not at the claim: ${NOT_YET_PROVED}`),
      ...(carried === claims.length
        ? []
        : [
            `the page carries the phrase ${carried} time(s) for the ${claims.length} claim(s) its rows declare: a row that lost the phrase, or one that carries it without declaring the claim`
          ])
    ]).toEqual([])
  })
})
