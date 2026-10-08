// The free-versus-Pro line, held to the record it states and to the claims it makes.
//
// `website/pricing.html` is the one commercial page a buyer reads before choosing, and nothing
// read its free/Pro half: the catalogue is held to the gates by
// src/main/license/classification.test.ts, while the page's free/Pro rows were its own words.
// The tables are declared rows now (website/docs/pro.mjs), so this guard can hold that
// declaration both ways — every identifier and cue type a column
// names carries the class the record gives it, every Pro class the record holds is named in a
// Pro column, and the free cue types are the ones `CUE_TYPES` minus `PRO_CUE_TYPES` declares —
// and can hold the claims no lane in this project can prove to the phrase the page carries
// for them (AD-24).
//
// Every check is a pure function of what it reads, so the second describe can hand it a page
// the repository would never commit and get the failure back by name. The failure paths are
// what hold the page; a passing run on its own says only that nothing has drifted yet.
//
// The free/Pro line is stated on surfaces no page module renders, too — the twelve
// `class="pro"` chips the served tree carries on ten pages (eleven rendered from `guides.mjs`
// and `reference.mjs`, one hand-written in `website/redundancy.html`), the hero note on the
// landing page and the README's "eleven cue types" — so those statements are declared beside
// the rows (`PRO_MARKS`, `HERO_NOUNS`) and held here against the tree and the code: the walk
// and the declaration to each other both ways, every claim to the class the record gives it,
// the note to the nouns the declaration lists, the README's count to the free cue types
// `CUE_TYPES` minus `PRO_CUE_TYPES` declares, and every served page but the reliability page
// to carrying no script and no `fetch(` — the site is rendered once and shipped as it stands.

import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CUE_TYPES, PRO_CUE_TYPES } from '../src/shared/cue'
import { BOUNDARY_HEADER, boundaryItems, classOf, readRecord, recordPath, tableRows } from '../src/main/license/catalog'
import type { BoundaryItem, GateClass } from '../src/main/license/catalog'

// @ts-ignore — js file, no type declarations
import { FREE_ROWS, HERO_NOUNS, NOT_YET_PROVED, PRO_MARKS, PRO_ROWS, cueSentence } from '../website/docs/pro.mjs'
// @ts-ignore — js file, no type declarations
import { PRICING } from '../website/docs/pricing.mjs'
// @ts-ignore — js file, no type declarations
import { renderPage } from '../website/build-docs.mjs'

/** The repository root, from this file: scripts → the checkout. */
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

/** The README: the one paragraph stating the free/Pro line for a builder, and the count it opens with. */
const README = 'README.md'

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

/** One Pro chip as the served tree carries it: the page under `website/` and the words it sits on. */
interface Mark {
  page: string
  words: string
}

/** One chip as `website/docs/pro.mjs` declares it: the mark, and the record's class behind it. */
interface DeclaredMark extends Mark {
  identifiers: string[]
  cues: string[]
}

/** One thing the hero note names as Cuerunner Pro, with the record identifiers it claims. */
interface HeroNoun {
  noun: string
  identifiers: string[]
}

/** Everything the checks read, in one value: a case below hands them a mutation of it. */
interface Reading {
  cells: Cell[]
  record: BoundaryItem[]
  cueTypes: ReadonlySet<string>
  proCueTypes: ReadonlySet<string>
  rendered: string
  /** Every page the served tree carries, as the walk reads them: the chips, the hero note and the scripts come from here. */
  pages: Array<{ page: string; text: string }>
  /** The Pro chips the served tree carries, in page order then position order. */
  tree: Mark[]
  /** The chips `website/docs/pro.mjs` declares, with the fields an entry may leave out filled in. */
  marks: DeclaredMark[]
  /** The hero note's Pro nouns, as the module declares them. */
  nouns: HeroNoun[]
  /** The hero note's own words, tags stripped. */
  hero: string
  /** The README's count of the free cue stack, as the word it writes it in and the number that word states. */
  word: string
  count: number
}

/** The page this guard reads, found by its own path rather than by where it sits in the list. */
const PRO_PAGE = PRICING.find((page: { path: string }) => page.path === 'pricing.html')
if (PRO_PAGE === undefined) {
  throw new Error('website/docs/pricing.mjs no longer declares pricing.html: this guard reads the buyer page by its path')
}

/**
 * The words a count is written in at the head of the sentence, read back as the number they state:
 * shared by the cue stack's own sentence and the README's, which state the same list.
 */
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
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20
}

/**
 * Every page under `website/` a deploy serves, as it stands: the hand-written ones and the ones
 * the docs build renders. `deploy-website.yml` uploads the tree itself, so the committed `.html`
 * is what a visitor reads, and it is what the chips, the hero note and the scripts are read from.
 */
function servedPages(): Array<{ page: string; text: string }> {
  let entries: string[]
  try {
    entries = fs.readdirSync(path.join(root, 'website'), { recursive: true, encoding: 'utf-8' })
  } catch (cause) {
    throw new Error(`the served tree's Pro marks: website/ cannot be walked — ${(cause as Error).message}`)
  }
  const pages = entries
    .map(entry => entry.split(path.sep).join('/'))
    .filter(entry => entry.endsWith('.html'))
    .sort()
  if (pages.length === 0) {
    throw new Error("the served tree's Pro marks: website/ holds no page to read, so a pass here would mean nothing")
  }
  return pages.map(page => {
    try {
      return { page, text: fs.readFileSync(path.join(root, 'website', page), 'utf-8') }
    } catch (cause) {
      throw new Error(`the served tree's Pro marks: website/${page} cannot be read — ${(cause as Error).message}`)
    }
  })
}

/** A file the guard holds the site to, or a failure: a source it cannot read would hold nothing. */
function readFile(relative: string): string {
  try {
    return fs.readFileSync(path.join(root, relative), 'utf-8')
  } catch (cause) {
    throw new Error(
      `the free/Pro checks read ${relative}, which cannot be read — ${(cause as Error).message}: a statement compared against nothing is the vacuous run this guard exists to prevent`
    )
  }
}

/**
 * The hero note's own words, tags stripped — or a failure. The note is the only place the landing
 * page states the free/Pro line, and `website/index.html` is hand-written, so it is found by its
 * class rather than by a line number: a page that moves it is a page this check has to be told about.
 */
function heroNote(html: string): string {
  const note = /<p class="hero-note">([\s\S]*?)<\/p>/.exec(html)
  if (note === null) {
    throw new Error(
      'website/index.html carries no `class="hero-note"` paragraph: this guard reads the Pro half of the free/Pro line out of the note that states it'
    )
  }
  return note[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * The README's count of the free cue stack, as the word it writes it in and the number that word
 * states — or a failure. The README's paragraph is the builder-facing half of the free/Pro line,
 * and a paragraph without a count is not one this guard can hold to the code.
 */
function readmeCounts(markdown: string): { word: string; count: number } {
  const word = /cue stack is free[\s\S]{0,80}?\b([\w-]+)[ -]cue types?\b/i.exec(markdown)?.[1]
  if (word === undefined) {
    throw new Error(
      `${README} no longer states the free cue stack's size ("the cue stack is free: … cue types"): this guard reads the count word out of that sentence, so a README without one cannot be held to the cue types the code declares`
    )
  }
  return { word, count: COUNT_WORDS[word.toLowerCase()] ?? Number(word) }
}

/**
 * The elements a chip's words sit in: the heading, cell or list item the marked words are the
 * label of. A chip inside another element (`<td><strong>Scene</strong><span class="pro">`) is read
 * back to the nearest of these, so what a mark says is the label rather than the tag inside it.
 */
const LABEL_TAGS: Record<string, true> = {
  td: true,
  th: true,
  caption: true,
  dt: true,
  dd: true,
  li: true,
  summary: true,
  label: true,
  p: true,
  figcaption: true,
  h1: true,
  h2: true,
  h3: true,
  h4: true,
  h5: true,
  h6: true
}

/** The words a chip sits on: what the element around it says, tags stripped and runs of space closed. */
function markedWords(html: string, attribute: number): string {
  const before = html.slice(0, attribute)
  // The chip's own `<` opens the element the class sits on; the words end there, and start where
  // the nearest label-bearing tag before it closed.
  const chip = before.lastIndexOf('<')
  let opened = -1
  for (const tag of before.matchAll(/<([a-z][\w-]*)(?:\s[^<>]*)?>/gi)) {
    if (LABEL_TAGS[tag[1].toLowerCase()] === true) opened = (tag.index ?? 0) + tag[0].length
  }
  return before
    .slice(opened === -1 ? 0 : opened, chip === -1 ? before.length : chip)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Every Pro chip a page carries, in the order the page writes them: an element whose class list
 * holds `pro` as a whole token — `class="figure promo"` is a figure, not a chip — together with
 * the words it sits on. The attribute is read with either quote, since a hand-written page need
 * not use the generated pages' spelling.
 */
function proMarksIn(page: string, html: string): Mark[] {
  const marks: Mark[] = []
  for (const attribute of html.matchAll(/\bclass=(["'])([^"']*)\1/g)) {
    if (!attribute[2].split(/\s+/).includes('pro')) continue
    marks.push({ page, words: markedWords(html, attribute.index ?? 0) })
  }
  return marks
}

/** A chip as a failure names it: the page, and the words the chip is attached to. */
const markName = (entry: Mark): string =>
  `${entry.page}'s Pro mark on ${entry.words === '' ? 'a chip with no words' : `"${entry.words}"`}`

/** Every page under `website/`, read once for the chips, the hero note and the scripts. */
const PAGES = servedPages()

/** The landing page, found by its own path: the hero note is hand-written and no module renders it. */
const INDEX = PAGES.find(page => page.page === 'index.html')
if (INDEX === undefined) {
  throw new Error('website/index.html is not among the pages this guard walks: the hero note states the free/Pro line there')
}

/** A chip as the module declares it, with the fields an entry may leave out filled in. */
function declaredMark(entry: { page: string; words: string; identifiers?: string[]; cues?: string[] }): DeclaredMark {
  return { page: entry.page, words: entry.words, identifiers: entry.identifiers ?? [], cues: entry.cues ?? [] }
}

/** The page as the repository holds it, and the record as the code holds it. */
const LIVE: Reading = {
  cells: CELLS,
  record: boundaryItems(readRecord()),
  cueTypes: new Set<string>(CUE_TYPES),
  proCueTypes: new Set<string>(PRO_CUE_TYPES),
  rendered: renderPage(PRO_PAGE),
  pages: PAGES,
  tree: PAGES.flatMap(page => proMarksIn(page.page, page.text)),
  marks: PRO_MARKS.map(declaredMark),
  nouns: HERO_NOUNS,
  hero: heroNote(INDEX.text),
  ...readmeCounts(readFile(README))
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

/** The chips the served tree carries and the declarations behind them, each held to the other. */
function markProblems(reading: Reading): string[] {
  const declared = new Set(reading.marks.map(entry => `${entry.page} :: ${entry.words}`))
  const walked = new Set(reading.tree.map(entry => `${entry.page} :: ${entry.words}`))
  return [
    ...reading.tree
      .filter(entry => !declared.has(`${entry.page} :: ${entry.words}`))
      .map(
        entry =>
          `the served tree carries ${markName(entry)} and website/docs/pro.mjs declares no such mark: a chip nobody declared is a class statement no check reads`
      ),
    ...reading.marks
      .filter(entry => !walked.has(`${entry.page} :: ${entry.words}`))
      .map(
        entry =>
          `website/docs/pro.mjs declares ${markName(entry)} and the served tree carries no such chip: the page lost the mark, or the words the chip sat on moved`
      )
  ]
}

/** One claim's identifiers and cue types, held to the class the record — and the code — gives each. */
function classProblems(reading: Reading, claim: string, identifiers: string[], cues: string[]): string[] {
  return [
    ...identifiers.flatMap(identifier => {
      const item = reading.record.find(candidate => candidate.identifier === identifier)
      if (item === undefined) {
        return [`${claim} claims \`${identifier}\`, and the record's boundary table does not name it at all`]
      }
      return item.class === 'pro' ? [] : [`${claim} claims \`${identifier}\`, and the record classes it ${item.class}`]
    }),
    ...cues.flatMap(name => {
      if (!reading.cueTypes.has(name)) {
        return [`${claim} claims the cue type "${name}", which the code does not have`]
      }
      return reading.proCueTypes.has(name) ? [] : [`${claim} claims the cue type "${name}", and the code declares it free`]
    })
  ]
}

/** Every claim the tree or the note makes, held to the record: a chip or a noun standing on a free feature sells nothing. */
function claimProblems(reading: Reading): string[] {
  return [
    ...reading.marks.flatMap(entry =>
      entry.identifiers.length === 0 && entry.cues.length === 0
        ? [
            `website/docs/pro.mjs's mark on "${entry.words}" in ${entry.page} claims nothing: a Pro chip states a class, so the entry needs the record identifier or the cue type behind it`
          ]
        : classProblems(reading, `the Pro mark on "${entry.words}" in ${entry.page}`, entry.identifiers, entry.cues)
    ),
    ...reading.nouns.flatMap(entry =>
      entry.identifiers.length === 0
        ? [
            `website/docs/pro.mjs's hero noun "${entry.noun}" claims nothing: the note states the Cuerunner Pro half, so a noun that names no record identifier states a class nothing holds`
          ]
        : classProblems(reading, `the hero note's "${entry.noun}"`, entry.identifiers, [])
    )
  ]
}

/** The hero note's Pro half, held both ways: the nouns it names are the ones the module declares, listed as it lists them. */
function heroProblems(reading: Reading): string[] {
  if (reading.nouns.length === 0) {
    return [
      'website/docs/pro.mjs declares no hero noun: the note on the landing page states the Cuerunner Pro half, so an empty declaration is a failure rather than a sentence with nothing to hold'
    ]
  }
  const listed =
    reading.nouns.length === 1
      ? reading.nouns[0].noun
      : `${reading.nouns
          .slice(0, -1)
          .map(entry => entry.noun)
          .join(', ')} and ${reading.nouns[reading.nouns.length - 1].noun}`
  // The list is read as the sentence that states it, closed by its full stop: a noun appended
  // after the declared four, or inserted among them, changes the sentence and fails here.
  const sentence = `Cuerunner Pro is ${listed}.`
  return [
    ...reading.nouns
      .filter(entry => !reading.hero.includes(entry.noun))
      .map(
        entry =>
          `website/index.html's hero note does not name ${entry.noun}, which website/docs/pro.mjs declares as part of the Cuerunner Pro half (the record's ${entry.identifiers.map(identifier => `\`${identifier}\``).join(', ')}): a noun the note drops is a Pro statement that stops being made`
      ),
    ...(reading.hero.includes(sentence)
      ? []
      : [
          `website/index.html's hero note does not state the Cuerunner Pro half as "${sentence}", which is how website/docs/pro.mjs declares those nouns: a noun added to the note, dropped from it, or reordered moves the declaration too`
        ])
  ]
}

/** The README's count of the free cue stack, held to the cue types the code declares free. */
function countProblems(reading: Reading): string[] {
  const declared = [...reading.cueTypes].filter(type => !reading.proCueTypes.has(type)).length
  return reading.count === declared
    ? []
    : [
        `${README} states the free cue stack as "${reading.word} cue types" and the code declares ${declared} free cue types (\`CUE_TYPES\` minus \`PRO_CUE_TYPES\`): the count and the list have to be the same size`
      ]
}

/**
 * The one page the site runs JavaScript on. The reliability page renders the nightly soak's own
 * numbers from `./soak-latest.json` when a browser opens it, which no build step can do for a run
 * that has not happened yet, and its own guard (`scripts/published-numbers.test.ts`) executes that
 * script. Every other page is inert, which is what lets a page be read as the file it ships as —
 * and what the tables' overflow mark is CSS rather than a listener.
 */
const RUNS_A_SCRIPT = ['reliability.html']

/** Every served page that carries a script or a `fetch(`, outside the one that reads the nightly run. */
function scriptProblems(reading: Reading): string[] {
  return reading.pages
    .filter(page => !RUNS_A_SCRIPT.includes(page.page) && /<script\b|fetch\s*\(/.test(page.text))
    .map(
      page =>
        `website/${page.page} carries a script or a \`fetch(\`, and the site runs no JavaScript: the pages are rendered once and shipped as they stand, so a state a page works out in the browser is a state nothing here can read`
    )
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

  it('declares every Pro chip the served tree carries, and carries every chip it declares', () => {
    expect(markProblems(LIVE)).toEqual([])
  })

  it('holds every declared claim to the class the record gives it', () => {
    expect(claimProblems(LIVE)).toEqual([])
  })

  it('names the Pro half of the hero note as the note lists it', () => {
    expect(heroProblems(LIVE)).toEqual([])
  })

  it('states the README\'s count of the free cue stack as the code declares it', () => {
    expect(countProblems(LIVE)).toEqual([])
  })

  it('serves no page that runs JavaScript, outside the one the nightly run is read on', () => {
    expect(scriptProblems(LIVE)).toEqual([])
  })

  it('reads a chip whichever quote a page spells its class with', () => {
    expect(proMarksIn('hand.html', "<td>Wireless<span class='pro'>Pro</span></td>")).toEqual([
      { page: 'hand.html', words: 'Wireless' }
    ])
    expect(proMarksIn('hand.html', '<td>Wireless<span class=pro>Pro</span></td>')).toEqual([])
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
    // The count is the declaration's own, not a literal: each claim the page gains moves it,
    // and a number written here would have to be found and bumped by whoever added one.
    const claims = CELLS.filter(entry => entry.notYetProved !== undefined).length
    const missing = LIVE.rendered.replace(`${engine.notYetProved} ${NOT_YET_PROVED}`, `${engine.notYetProved}`)
    expect(phraseProblems({ ...LIVE, rendered: missing })).toEqual([
      expect.stringContaining(`the page states "${engine.notYetProved}" in its "The engine" row and the phrase is not at the claim`),
      expect.stringContaining(`the page carries the phrase ${claims - 1} time(s) for the ${claims} claim(s)`)
    ])
  })

  it('fails a phrase a row carries without declaring the claim', () => {
    const claims = CELLS.filter(entry => entry.notYetProved !== undefined).length
    const undeclared = LIVE.rendered.replace('<td>The waveform</td>', `<td>${NOT_YET_PROVED} The waveform</td>`)
    expect(phraseProblems({ ...LIVE, rendered: undeclared })).toEqual([
      expect.stringContaining(`the page carries the phrase ${claims + 1} time(s) for the ${claims} claim(s)`)
    ])
  })

  it('names a chip the tree grows that no declaration carries', () => {
    const grown = [...LIVE.tree, { page: 'pricing.html', words: 'The second machine' }]
    expect(markProblems({ ...LIVE, tree: grown })).toEqual([
      expect.stringContaining('the served tree carries pricing.html\'s Pro mark on "The second machine" and website/docs/pro.mjs declares no such mark')
    ])
  })

  it('names a declaration the tree stops carrying', () => {
    const gone = LIVE.tree.filter(entry => entry.words !== 'Tablet view')
    expect(markProblems({ ...LIVE, tree: gone })).toEqual([
      expect.stringContaining('website/docs/pro.mjs declares reference/settings.html\'s Pro mark on "Tablet view" and the served tree carries no such chip')
    ])
  })

  it('names a chip a page moves the words of', () => {
    const reworded = LIVE.tree.map(entry =>
      entry.page === 'redundancy.html' ? { ...entry, words: 'Redundant playback, on two machines' } : entry
    )
    expect(markProblems({ ...LIVE, tree: reworded })).toEqual([
      expect.stringContaining('the served tree carries redundancy.html\'s Pro mark on "Redundant playback, on two machines"'),
      expect.stringContaining('website/docs/pro.mjs declares redundancy.html\'s Pro mark on "Redundant playback"')
    ])
  })

  it('names both sides when a chip is moved onto a free feature', () => {
    const sold = LIVE.marks.map(entry => (entry.words === 'Wireless' && entry.page === 'reference/settings.html'
      ? { ...entry, identifiers: ['osc-in'] }
      : entry))
    expect(claimProblems({ ...LIVE, marks: sold })).toEqual([
      expect.stringContaining('the Pro mark on "Wireless" in reference/settings.html claims `osc-in`, and the record classes it free')
    ])
  })

  it('names both sides when a chip claims a cue type the code calls free', () => {
    const crossed = LIVE.marks.map(entry => (entry.words === 'Scene' && entry.page === 'guides/cue-list.html'
      ? { ...entry, cues: ['audio'] }
      : entry))
    expect(claimProblems({ ...LIVE, marks: crossed })).toEqual([
      expect.stringContaining('the Pro mark on "Scene" in guides/cue-list.html claims the cue type "audio", and the code declares it free')
    ])
  })

  it('names a chip that claims nothing at all', () => {
    const bare = LIVE.marks.map(entry =>
      entry.page === 'guides/wireless.html' ? { ...entry, identifiers: [], cues: [] } : entry
    )
    expect(claimProblems({ ...LIVE, marks: bare })).toEqual([
      expect.stringContaining('website/docs/pro.mjs\'s mark on "Watching the radio mics" in guides/wireless.html claims nothing')
    ])
  })

  it('names the noun the hero note drops, and the sentence it no longer states', () => {
    const shortened = LIVE.hero.replace('the tablet and ', '')
    expect(heroProblems({ ...LIVE, hero: shortened })).toEqual([
      expect.stringContaining('website/index.html\'s hero note does not name the tablet'),
      expect.stringContaining('does not state the Cuerunner Pro half as "Cuerunner Pro is the desk, the radios, the tablet and the second machine."')
    ])
  })

  it('names a noun the hero note gains after the four the declaration lists', () => {
    const grown = LIVE.hero.replace('the second machine.', 'the second machine and the night report.')
    expect(heroProblems({ ...LIVE, hero: grown })).toEqual([
      expect.stringContaining('does not state the Cuerunner Pro half as "Cuerunner Pro is the desk, the radios, the tablet and the second machine."')
    ])
  })

  it('names an empty declaration rather than reading a noun off nothing', () => {
    expect(heroProblems({ ...LIVE, nouns: [] })).toEqual([
      expect.stringContaining('website/docs/pro.mjs declares no hero noun')
    ])
  })

  it('composes the list for a single declared noun', () => {
    const one = LIVE.nouns.filter(entry => entry.noun === 'the desk')
    const note = 'The cue stack is free and stays free. Cuerunner Pro is the desk.'
    expect(heroProblems({ ...LIVE, nouns: one, hero: note })).toEqual([])
  })

  it('names a hero noun standing on a free identifier', () => {
    const sold = LIVE.nouns.map(entry =>
      entry.noun === 'the radios' ? { ...entry, identifiers: ['midi:send'] } : entry
    )
    expect(claimProblems({ ...LIVE, nouns: sold })).toEqual([
      expect.stringContaining('the hero note\'s "the radios" claims `midi:send`, and the record classes it free')
    ])
  })

  it('names a hero noun that claims nothing at all', () => {
    // The noun states the Cuerunner Pro half on the landing page: with no identifier behind it
    // that is a Pro class nothing in the record holds, which is what the chips are refused for.
    const bare = LIVE.nouns.map(entry =>
      entry.noun === 'the desk' ? { ...entry, identifiers: [] } : entry
    )
    expect(claimProblems({ ...LIVE, nouns: bare })).toEqual([
      expect.stringContaining('website/docs/pro.mjs\'s hero noun "the desk" claims nothing')
    ])
  })

  it('names a count the README changes', () => {
    const declared = CUE_TYPES.filter(type => !LIVE.proCueTypes.has(type)).length
    expect(countProblems({ ...LIVE, word: 'two', count: 2 })).toEqual([
      expect.stringContaining(`README.md states the free cue stack as "two cue types" and the code declares ${declared} free cue types`)
    ])
  })

  it('fails loudly when the README states no count to read', () => {
    expect(() => readmeCounts('# nothing to read here')).toThrow("README.md no longer states the free cue stack's size")
  })

  it('names a served page that grows a script', () => {
    const scripted = LIVE.pages.map(page =>
      page.page === 'pricing.html' ? { ...page, text: `${page.text}\n<script>scroll()</script>` } : page
    )
    expect(scriptProblems({ ...LIVE, pages: scripted })).toEqual([
      expect.stringContaining('website/pricing.html carries a script or a `fetch(`')
    ])
  })

  it('names a served page that grows a fetch', () => {
    const fetching = LIVE.pages.map(page =>
      page.page === 'support.html' ? { ...page, text: page.text.replace('<h1>', '<h1 data-x="fetch(">') } : page
    )
    expect(scriptProblems({ ...LIVE, pages: fetching })).toEqual([
      expect.stringContaining('website/support.html carries a script or a `fetch(`')
    ])
  })

  it('exempts the one page that carries the script, and only that page', () => {
    const scripted = LIVE.pages.filter(page => /<script\b|fetch\s*\(/.test(page.text)).map(page => page.page)
    expect(scripted).toEqual(RUNS_A_SCRIPT)
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
