// The Wave 3 ledger, held to the inventory, the contract, the claims record and the catalogue.
//
// `_bmad-output/planning-artifacts/epics.md` is the register, and Epic 9's section is the
// ledger: the candidate backlog's rows, and the adopted items' table standing beside them —
// `Kind`, `Identifier` and `Class` in the enforcement record's own columns, plus the commitment
// written into `SPEC.md`, the date, the lane behind the claim and the story. A candidate stops
// being one by gaining a row there, so the register is where a story for an unadopted item would
// be written and where writing it is refused: each id and name is held to the requirements
// inventory's W3 bullets, a candidate to the claims table it may not appear in
// (`quality-and-proof.md`), and an adopted row to the lanes that record names, to
// `capability-catalog.md`'s identifiers, to the claim row that lands with the adoption, and to
// `SPEC.md`'s own sentences — its commitment and any date it promises, never its open questions.
// Story 9.1's gate is only satisfied if the row it admits can be read back against the records it
// claims to satisfy.
//
// Nothing here adopts, classifies or builds anything: the adopted table is empty today, and the
// checks below are the ones the next story's row has to pass. Every check is a pure function of
// what it reads, so the second describe hands them a register the repository would never write
// and gets each refusal back by name; the third proves the reading is loud when a table is
// renamed or its rule line is missing, because a ledger read as empty is a ledger nothing holds.
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { boundaryItems, cueClasses, readRecord, tableRows } from '../src/main/license/catalog'
import type { GateClass } from '../src/main/license/catalog'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

/** The register this guard reads: the epic breakdown, whose Epic 9 section is the ledger. */
const REGISTER = path.join(root, '_bmad-output', 'planning-artifacts', 'epics.md')

/** The contract an adopted row's commitment sentence has to be carried by, read and never written. */
const CONTRACT = path.join(root, '_bmad-output', 'specs', 'spec-cuerunner', 'SPEC.md')

/** The claims record: the lanes an adopted row's lane comes from, and the claims a candidate may not reach. */
const CLAIMS_RECORD = path.join(root, '_bmad-output', 'specs', 'spec-cuerunner', 'quality-and-proof.md')

/** The candidate backlog's header, as the register spells it: a renamed column is not this table. */
const CANDIDATE_HEADER = ['#', 'Candidate', 'Likely class under AD-15', 'What it would arrive as'] as const

/** The adopted items' header: the enforcement record's columns, then what adoption adds to them. */
const ADOPTED_HEADER = ['#', 'Item', 'Kind', 'Identifier', 'Class', 'Commitment', 'Date', 'Lane', 'Story'] as const

/** The claims record's lanes table, read for its `Lane` column — the vocabulary a row's lane is held to. */
const LANES_HEADER = ['Lane', 'Workflow', 'Job', 'Trigger', 'Runner', 'Tag', 'Suite'] as const

/** The claims record's claims table: the rows a candidate's id or name may not appear in. */
const CLAIMS_HEADER = ['Claim', 'Lane', 'Status', 'Evidence'] as const

/** AD-15's three kinds: what a capability is, decided before anything is built. */
const KINDS: Record<string, true> = { 'cue type': true, service: true, surface: true }

/** The two classes the gate enforces, and the mark a cell carries where adoption records nothing. */
const CLASSES: Record<string, true> = { free: true, pro: true }
const NONE = '—'

/** The columns that may record nothing: a date may be unpromised and a claim may stand on no lane. */
const OPTIONAL: Record<string, true> = { Date: true, Lane: true }

/** A day, as the register and the records under `_bmad-output/specs/` write one. */
const DAY = /^\d{4}-\d{2}-\d{2}$/

/** A `domain:verb` identifier: the shape only a new IPC channel takes (AD-16). */
const CHANNEL_SHAPED = /^[a-z][a-z0-9-]*:[a-zA-Z][a-zA-Z0-9-]*$/

/** What a negator in front of a decision phrase records instead: the row saying the decision is not made. */
const NEGATED = /\b(?:no|not|never|without|cannot|can't|isn't|wasn't)\s+(?:\w+\s+){0,2}$/

/** The status a claim with a lane behind it carries, and the one a claim with none carries. */
const LANE_STATUSES: Record<string, true> = { unproven: true, proved: true }
const UNCLAIMED = 'unclaimed'

/** The contract's sections a commitment does not count in: what it leaves open and what it is not. */
const NOT_A_COMMITMENT = ['## Open Questions', '## Non-goals']

/** The inventory's own bullet: `W3-1: Name — what is known about it.` */
const INVENTORY_BULLET = /^W3-(\d+): (.+)$/

/** Epic 9's story headings — two to four hashes, a title or none — which is where a story exists. */
const STORY_HEADING = /^#{2,4} Story 9\.(\d+)(?::.*)?$/

/** Reads a file this guard cannot run without: an input that is not there is a failure, never a skip. */
function readText(at: string, what: string): string {
  try {
    return fs.readFileSync(at, 'utf-8')
  } catch (cause) {
    throw new Error(
      `${what} could not be read at ${at} (${(cause as Error).message}): the ledger is held to it, so a run that cannot open it must not pass`
    )
  }
}

/** A cell as the register means it: the markdown's own backticks and emphasis off, its whitespace one space. */
function plain(cell: string): string {
  return cell.replace(/[`*]/g, '').replace(/\s+/g, ' ').trim()
}

/**
 * Epic 9's own section: its heading to the next `## ` heading, so its tables and its stories are
 * read there and nowhere else. The epic list carries an Epic 9 heading of its own, and a story
 * written anywhere but in this section is not a story this epic holds.
 */
function epicSection(register: string): string {
  const lines = register.split('\n')
  const start = lines.findIndex((line) => line.startsWith('## Epic 9:'))
  if (start === -1) {
    throw new Error(
      'the register carries no "## Epic 9:" section: the ledger lives there, and a section this guard cannot find is not a ledger with nothing in it'
    )
  }
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '))
  return lines.slice(start, end === -1 ? lines.length : end).join('\n')
}

/** One candidate as the requirements inventory declares it: the id and the name the ledger is held to. */
interface Candidate {
  id: string
  name: string
}

/** One row of the adopted items table, read as the columns it sits under. */
interface AdoptedRow {
  id: string
  item: string
  kind: string
  identifier: string
  gateClass: string
  commitment: string
  date: string
  lane: string
  story: string
}

/** One story heading the section carries: the key it names, and the heading as it is written. */
interface Story {
  key: string
  number: number
  heading: string
}

/** The register's W3 inventory bullets, in file order: the one declaration of which candidates exist. */
function inventoryOf(register: string): Candidate[] {
  const candidates: Candidate[] = []
  for (const line of register.split('\n')) {
    const bullet = INVENTORY_BULLET.exec(line)
    if (bullet === null) continue
    // The bullet's name is what precedes its first ` — `; the rest of the line is what is known
    // about the candidate, which no table cell states.
    const [name] = bullet[2].split(' — ')
    candidates.push({ id: `W3-${bullet[1]}`, name: plain(name.replace(/\.$/, '')) })
  }
  return candidates
}

/** The candidate backlog's rows: each candidate's id and name, which are all the ledger shares with it. */
function candidatesOf(section: string): Candidate[] {
  return tableRows(section, CANDIDATE_HEADER).map((cells) => ({ id: plain(cells[0]), name: plain(cells[1]) }))
}

/** The adopted items' rows, in file order. An empty table reads as no rows: the state a gate leaves. */
function adoptedOf(section: string): AdoptedRow[] {
  return tableRows(section, ADOPTED_HEADER).map((cells) => ({
    id: plain(cells[0]),
    item: plain(cells[1]),
    kind: plain(cells[2]),
    identifier: plain(cells[3]),
    gateClass: plain(cells[4]),
    commitment: plain(cells[5]),
    date: plain(cells[6]),
    lane: plain(cells[7]),
    story: plain(cells[8])
  }))
}

/** The `### Story 9.N:` headings the section carries, in file order. */
function storiesOf(section: string): Story[] {
  const stories: Story[] = []
  for (const line of section.split('\n')) {
    const heading = STORY_HEADING.exec(line)
    if (heading !== null) {
      stories.push({ key: `Story 9.${heading[1]}`, number: Number(heading[1]), heading: line.trim() })
    }
  }
  return stories
}

/** The lanes the claims record names: the vocabulary an adopted row's `Lane` cell is held to. */
function lanesOf(record: string): string[] {
  return tableRows(record, LANES_HEADER).map((cells) => plain(cells[0]))
}

/** The claims record's claim rows, as written: the table a candidate's id or name may not appear in. */
function claimsOf(record: string): string[][] {
  return tableRows(record, CLAIMS_HEADER)
}

/** The identifiers the enforcement record already holds, folded to one case, each under the class it holds them by. */
function heldIdentifiers(record: string): Map<string, GateClass> {
  const held = new Map<string, GateClass>()
  for (const item of boundaryItems(record)) held.set(item.identifier.toLowerCase(), item.class)
  for (const [type, gateClass] of cueClasses(record)) held.set(type.toLowerCase(), gateClass)
  return held
}

/** How a refusal names the row it is about: the id it states, or its place where the id is what is missing. */
function rowLabel(row: AdoptedRow, index: number): string {
  return row.id === '' ? `the register's adopted table row ${index + 1}` : `the register's adopted row "${row.id}"`
}

/**
 * The contract's lines outside a set of its sections: what adoption writes into the contract is a
 * statement there, not a question it leaves open or a thing it says the product is not. The section
 * headings stay in, so what sat either side of a cut section is not read as one sentence.
 */
function contractBody(contract: string, headings: readonly string[]): string {
  const lines = contract.split('\n')
  const cut = new Set<number>()
  for (const heading of headings) {
    const start = lines.findIndex((line) => line.trim() === heading)
    if (start === -1) continue
    const end = lines.findIndex((line, index) => index > start && line.startsWith('## '))
    for (let line = start + 1; line < (end === -1 ? lines.length : end); line++) cut.add(line)
  }
  return lines.filter((_, index) => !cut.has(index)).join('\n')
}

/**
 * Whether a date is a day: the shape alone reads `2027-13-01` as one, so the date has to round-trip
 * through the calendar to count as a day the register may state.
 */
function isDay(date: string): boolean {
  if (!DAY.test(date)) return false
  const parsed = new Date(`${date}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date
}

/**
 * The inventory and the two tables, held to each other: a candidate the inventory names sits in
 * exactly one of the tables, under the name the inventory gives it, and no row names a candidate
 * the inventory does not — adoption moves a row rather than copying it, and a candidate in
 * neither table is a state nothing states.
 */
function checkLedger(inventory: Candidate[], candidates: Candidate[], adopted: AdoptedRow[]): string[] {
  const problems: string[] = []
  const rows = [
    ...candidates.map((row) => ({ row, where: 'candidate backlog' })),
    ...adopted.map((row) => ({ row: { id: row.id, name: row.item }, where: 'adopted items' }))
  ]
  for (const candidate of inventory) {
    const carrying = rows.filter((entry) => entry.row.id === candidate.id)
    if (carrying.length === 0) {
      problems.push(
        `the register's inventory names ${candidate.id} ("${candidate.name}"), and neither table carries it: a candidate sits in the backlog or in the adopted items, never nowhere`
      )
      continue
    }
    if (carrying.length > 1) {
      const where = carrying.map((entry) => entry.where).join(', ')
      problems.push(
        `the register carries ${candidate.id} in ${carrying.length} rows (${where}): adoption moves a candidate, it does not copy it`
      )
      continue
    }
    const [entry] = carrying
    if (entry.row.name !== candidate.name) {
      problems.push(
        `the register's ${entry.where} names ${candidate.id} "${entry.row.name}", where the inventory names it "${candidate.name}"`
      )
    }
  }
  for (const entry of rows) {
    if (!inventory.some((candidate) => candidate.id === entry.row.id)) {
      const named = entry.row.id === '' ? `a row with no "#" cell` : entry.row.id
      problems.push(`the register's ${entry.where} carries ${named}, and the inventory names no such candidate`)
    }
  }
  return problems
}

/**
 * The stories Epic 9 carries, held to the adopted rows: a `Story 9.N` (n ≥ 2) heading no adopted
 * row's `Story` cell names is a story created before its item was adopted — at whatever depth it is
 * written, and whether or not it carries a title. Story 9.1 is the gate itself, the one heading
 * that exists without an adopted row behind it.
 */
function checkOrphanStories(stories: Story[], adopted: AdoptedRow[]): string[] {
  const named = new Set(adopted.map((row) => row.story))
  return stories
    .filter((story) => story.number >= 2 && !named.has(story.key))
    .map(
      (story) =>
        `Epic 9 carries the heading "${story.heading}", and no adopted row's "Story" cell names it: a story exists only for a candidate that was adopted first`
    )
}

/** Every adopted row's `Story` cell, held to the headings Epic 9 carries. */
function checkStoryCells(adopted: AdoptedRow[], stories: Story[]): string[] {
  const carried = new Set(stories.map((story) => story.key))
  return adopted.flatMap((row, index) =>
    row.story === '' || carried.has(row.story)
      ? []
      : [`${rowLabel(row, index)} states the story "${row.story}", and Epic 9 carries no such heading`]
  )
}

/**
 * Every adopted cell present and stating something: adoption states each column, and only `Date`
 * and `Lane` record nothing — as `—`, not as an empty cell, because a date may be unpromised and
 * a claim may stand on no lane the record names.
 */
function checkCells(adopted: AdoptedRow[]): string[] {
  return adopted.flatMap((row, index) => {
    const cells = [
      row.id,
      row.item,
      row.kind,
      row.identifier,
      row.gateClass,
      row.commitment,
      row.date,
      row.lane,
      row.story
    ]
    return ADOPTED_HEADER.flatMap((header, column) =>
      cells[column] === '' || (cells[column] === NONE && OPTIONAL[header] !== true)
        ? [
            `${rowLabel(row, index)} states nothing in its "${header}" cell: every column carries a value, and only "Date" and "Lane" record none, as "—"`
          ]
        : []
    )
  })
}

/** Every adopted kind, held to AD-15's three: the kind is decided before the endpoint and purpose. */
function checkKind(adopted: AdoptedRow[]): string[] {
  return adopted.flatMap((row, index) =>
    KINDS[row.kind.toLowerCase()] === true
      ? []
      : [
          `${rowLabel(row, index)} states the kind "${row.kind}", which is not one of AD-15's three (cue type, service, surface)`
        ]
  )
}

/** Every adopted class, held to the two the gate enforces, and recorded where enforcement lives. */
function checkClass(adopted: AdoptedRow[]): string[] {
  return adopted.flatMap((row, index) =>
    CLASSES[row.gateClass.toLowerCase()] === true
      ? []
      : [`${rowLabel(row, index)} states the class "${row.gateClass}", which is neither free nor pro`]
  )
}

/**
 * Every adopted date: a day the contract states too, or `—` where no date is promised. The shape is
 * not enough — `2027-13-01` is not a day and a day `SPEC.md` never states is not a promised date.
 */
function checkDate(adopted: AdoptedRow[], contract: string): string[] {
  const written = plain(contractBody(contract, NOT_A_COMMITMENT))
  return adopted.flatMap((row, index) => {
    if (row.date === NONE) return []
    if (!isDay(row.date)) {
      return [`${rowLabel(row, index)} states the date "${row.date}", which is neither a day (YYYY-MM-DD) nor "—"`]
    }
    return written.includes(row.date)
      ? []
      : [
          `${rowLabel(row, index)} promises the day "${row.date}", and SPEC.md carries no such date: a date is part of what the contract states`
        ]
  })
}

/**
 * Every adopted commitment, held to the contract: the sentence a row commits with has to appear in
 * `SPEC.md` — in the contract itself, not in what it leaves open or names as a non-goal, because a
 * commitment recorded as a question is not one. A row with no sentence commits to nothing.
 */
function checkCommitment(adopted: AdoptedRow[], contract: string): string[] {
  const written = plain(contractBody(contract, NOT_A_COMMITMENT))
  return adopted.flatMap((row, index) => {
    if (row.commitment === '' || row.commitment === NONE) {
      return [
        `${rowLabel(row, index)} states no commitment sentence: adoption writes the commitment into the contract before a story is created for the item`
      ]
    }
    return written.includes(row.commitment)
      ? []
      : [
          `${rowLabel(row, index)} commits to "${row.commitment}", and SPEC.md carries no such sentence: the contract is written before a story is created`
        ]
  })
}

/** Every adopted lane, held to the lanes the claims record names — or to `—`, a claim no lane carries. */
function checkLane(adopted: AdoptedRow[], lanes: string[]): string[] {
  const known = new Set(lanes)
  return adopted.flatMap((row, index) =>
    row.lane === NONE || known.has(row.lane)
      ? []
      : [
          `${rowLabel(row, index)} names the lane "${row.lane}", which the claims record's lanes table does not: a claim stands on a lane the record names, or on none`
        ]
  )
}

/**
 * Every adopted identifier, held to the identifier space as the row is written: the enforcement
 * record's own identifiers, folded to one case so `MIDI:sendTcp` and `midi:sendTcp` are one id, and
 * the identifiers the other adopted rows hold. One the record holds under another class is refused
 * outright — W3-1's name collision with the Pro `companion` service cannot be inherited — while one
 * it already holds otherwise, and one another adopted row holds at another class, are refused unless
 * the row's own commitment records the decision in the words the ledger names, with the identifier
 * behind them: `decision naming` it. And a `domain:verb` identifier is a new IPC channel: AD-16
 * refuses one unless the commitment says `decision to add` it — `no decision naming …` and `no
 * decision to add …` are the row saying the opposite.
 */
function checkIdentifier(adopted: AdoptedRow[], held: Map<string, GateClass>): string[] {
  return adopted.flatMap((row, index) => {
    const problems: string[] = []
    const gateClass = row.gateClass.toLowerCase()
    const identifier = row.identifier.toLowerCase()
    const commitment = row.commitment.toLowerCase()
    // A recorded decision is the phrase and the identifier behind it, with no negator in front:
    // the bare word `decision` records nothing, and `no decision …` records that it is not made.
    const statesDecision = (phrase: string): boolean => {
      const at = commitment.indexOf(`${phrase} ${identifier}`)
      return at !== -1 && !NEGATED.test(commitment.slice(0, at))
    }
    const recordedClass = held.get(identifier)
    if (recordedClass !== undefined) {
      if (CLASSES[gateClass] === true && recordedClass !== gateClass) {
        problems.push(
          `${rowLabel(row, index)} states the identifier "${row.identifier}" as ${gateClass}, and the enforcement record already holds it as ${recordedClass}`
        )
      } else if (!statesDecision('decision naming')) {
        problems.push(
          `${rowLabel(row, index)} states the identifier "${row.identifier}", which the enforcement record already holds, and its commitment records no decision naming it: the row states "decision naming ${row.identifier}"`
        )
      }
    }
    const clash = adopted.findIndex(
      (other, otherIndex) =>
        otherIndex < index &&
        other.identifier.toLowerCase() === identifier &&
        other.gateClass.toLowerCase() !== gateClass
    )
    if (clash !== -1) {
      const other = adopted[clash]
      problems.push(
        `${rowLabel(row, index)} states the identifier "${row.identifier}" as ${gateClass}, and the adopted row "${other.id}" already holds it as ${other.gateClass.toLowerCase()}: one identifier belongs to one class`
      )
    }
    if (CHANNEL_SHAPED.test(row.identifier) && !statesDecision('decision to add')) {
      problems.push(
        `${rowLabel(row, index)} states the channel identifier "${row.identifier}", and its commitment records no decision to add it: AD-16 refuses a new channel unless the commitment states "decision to add ${row.identifier}"`
      )
    }
    return problems
  })
}

/**
 * Every adopted row's claim, held to the claims record: an item's claim row lands with its adoption
 * (AD-24), so the row's `Item` text names the claim, the claim stands on the lane the adopted row
 * names, and its status is the one that lane can carry — `unclaimed` where no lane carries the
 * claim, `unproven` or `proved` where a lane does.
 */
function checkClaimRow(adopted: AdoptedRow[], claims: string[][]): string[] {
  return adopted.flatMap((row, index) => {
    if (row.item === '') return []
    const naming = claims.filter((cells) => plain(cells[0]).includes(row.item))
    if (naming.length === 0) {
      return [
        `${rowLabel(row, index)} is adopted, and the claims record carries no claim row naming "${row.item}": the item's claim row lands with its adoption (AD-24)`
      ]
    }
    return naming.flatMap((cells) => {
      const claim = plain(cells[0])
      const lane = plain(cells[1])
      const status = plain(cells[2]).toLowerCase()
      if (lane !== row.lane) {
        return [
          `the claims record's "${claim}" row stands on the lane "${lane}", and ${rowLabel(row, index)} names the lane "${row.lane}": one lane carries the claim`
        ]
      }
      if (row.lane === NONE && status !== UNCLAIMED) {
        return [
          `the claims record's "${claim}" row is "${status}", and ${rowLabel(row, index)} names no lane: a claim no lane carries is "${UNCLAIMED}"`
        ]
      }
      return row.lane !== NONE && LANE_STATUSES[status] !== true
        ? [
            `the claims record's "${claim}" row is "${status}", and ${rowLabel(row, index)} names the lane "${row.lane}": a claim on a lane is "unproven" until that lane runs, then "proved"`
          ]
        : []
    })
  })
}

/**
 * The claims record, held clear of the candidates: a claim is a statement about what the product
 * does, and a candidate is not one yet — its id or name in the claims table is a claim created for
 * an item nobody adopted. Over every cell the id is read as a whole token and the name in full; the
 * claim's own cell is read for a whole word of the candidate's name too, four characters or more,
 * because that cell is where the claim says what it is about and `Timecode` there is the candidate.
 */
function checkClaims(candidates: Candidate[], claims: string[][]): string[] {
  return claims.flatMap((cells) =>
    candidates.flatMap((candidate) => {
      const words = candidate.name.split(/\W+/).filter((word) => word.length >= 4)
      const claimed = cells.some((cell, column) => {
        const said = plain(cell)
        const ids: string[] = said.match(/\bW3-\d+\b/g) ?? []
        if (said.includes(candidate.name) || ids.includes(candidate.id)) return true
        return column === 0 && words.some((word) => new RegExp(`\\b${word}\\b`, 'i').test(said))
      })
      return claimed
        ? [
            `the claims record's "${plain(cells[0])}" row names the candidate ${candidate.id} ("${candidate.name}"): a claim is created for an item that was adopted, never for one still a candidate`
          ]
        : []
    })
  )
}

/** Everything the checks read, in one value: a case below hands them a mutation of it. */
interface Reading {
  inventory: Candidate[]
  candidates: Candidate[]
  adopted: AdoptedRow[]
  stories: Story[]
  contract: string
  lanes: string[]
  claims: string[][]
  held: Map<string, GateClass>
}

/** The register as the repository holds it, and the section the ledger lives in. */
const REGISTER_TEXT = readText(REGISTER, 'the register')
const SECTION = epicSection(REGISTER_TEXT)
const CLAIMS_TEXT = readRecord(CLAIMS_RECORD)

const LIVE: Reading = {
  inventory: inventoryOf(REGISTER_TEXT),
  candidates: candidatesOf(SECTION),
  adopted: adoptedOf(SECTION),
  stories: storiesOf(SECTION),
  contract: readText(CONTRACT, 'the contract'),
  lanes: lanesOf(CLAIMS_TEXT),
  claims: claimsOf(CLAIMS_TEXT),
  held: heldIdentifiers(readRecord())
}

/** The six candidates the epic names: the floor the ledger is read against, so an emptied register is not a green one. */
const CANDIDATE_FLOOR = ['W3-1', 'W3-2', 'W3-3', 'W3-4', 'W3-5', 'W3-6']

describe('the ledger and the records it is held to', () => {
  it('reads the six candidates and the gate heading the epic holds', () => {
    const absent = CANDIDATE_FLOOR.filter((id) => !LIVE.inventory.some((candidate) => candidate.id === id)).map(
      (id) => `the register's inventory names no ${id}: the six Wave 3 candidates are what this ledger states the state of`
    )
    const gate = LIVE.stories.some((story) => story.key === 'Story 9.1')
    expect([
      ...absent,
      ...(gate ? [] : ['Epic 9 carries no "Story 9.1" heading: the gate this ledger is read under is not there'])
    ]).toEqual([])
  })

  it('reads the records it is held to, rather than nothing', () => {
    expect(LIVE.held.get('companion')).toBe('pro')
    expect(LIVE.lanes.length).toBeGreaterThan(0)
    expect(LIVE.contract).toContain('## Open Questions')
  })

  it('holds the inventory, the backlog and the adopted table to one id and one name each', () => {
    expect(checkLedger(LIVE.inventory, LIVE.candidates, LIVE.adopted)).toEqual([])
  })

  it('holds every adopted cell to the kind, the class and the date adoption writes', () => {
    expect(checkCells(LIVE.adopted)).toEqual([])
    expect(checkKind(LIVE.adopted)).toEqual([])
    expect(checkClass(LIVE.adopted)).toEqual([])
    expect(checkDate(LIVE.adopted, LIVE.contract)).toEqual([])
  })

  it('holds every adopted commitment to the contract it is written into', () => {
    expect(checkCommitment(LIVE.adopted, LIVE.contract)).toEqual([])
  })

  it('holds every adopted lane and identifier to the records that name them', () => {
    expect(checkLane(LIVE.adopted, LIVE.lanes)).toEqual([])
    expect(checkIdentifier(LIVE.adopted, LIVE.held)).toEqual([])
  })

  it('holds every adopted item to the claim row that lands with it', () => {
    expect(checkClaimRow(LIVE.adopted, LIVE.claims)).toEqual([])
  })

  it("holds Epic 9's stories to the adopted rows, both ways", () => {
    expect(checkOrphanStories(LIVE.stories, LIVE.adopted)).toEqual([])
    expect(checkStoryCells(LIVE.adopted, LIVE.stories)).toEqual([])
  })

  it('holds the claims record clear of every candidate', () => {
    expect(checkClaims(LIVE.candidates, LIVE.claims)).toEqual([])
  })
})

/** A row the register would carry once a candidate is adopted: well formed, and mutated a cell at a time. */
function adoptedRow(cells: Partial<AdoptedRow> = {}): AdoptedRow {
  return {
    id: 'W3-2',
    item: 'LTC/MTC timecode',
    kind: 'service',
    identifier: 'timecode',
    gateClass: 'pro',
    commitment: 'LTC/MTC timecode arrives as one cue type and one service.',
    date: NONE,
    lane: NONE,
    story: 'Story 9.2',
    ...cells
  }
}

/** The candidate that row was written from, the contract it was written into and the heading it created. */
const CANDIDATE: Candidate = { id: 'W3-2', name: 'LTC/MTC timecode' }
const CONTRACT_TEXT = 'Adopted: LTC/MTC timecode arrives as one cue type and one service.'
const STORY: Story = {
  key: 'Story 9.2',
  number: 2,
  heading: '### Story 9.2: LTC/MTC timecode enters as a cue type and a service'
}

/** A register carrying one adopted row, read through the section and the table it is written in. */
const REGISTER_WITH_ONE_ROW =
  '## Epic 9: Wave 3 interop\n\n### Adopted items — what adoption requires\n\n' +
  '| # | Item | Kind | Identifier | Class | Commitment | Date | Lane | Story |\n' +
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n' +
  `| W3-2 | LTC/MTC timecode | service | timecode | pro | ${CONTRACT_TEXT} | — | — | Story 9.2 |\n`

/**
 * The register and the records the repository would never write, one refusal at a time: each case
 * fails one thing and gets the message that names it back. The failure paths are what hold the
 * ledger — a passing run on its own says only that nothing has been written yet.
 */
describe('the state the checks exist to refuse', () => {
  it('names the id carried by both tables, or by neither', () => {
    expect(checkLedger([CANDIDATE], [CANDIDATE], [adoptedRow()])).toEqual([
      expect.stringContaining('the register carries W3-2 in 2 rows (candidate backlog, adopted items)')
    ])
    expect(checkLedger([CANDIDATE], [], [])).toEqual([
      expect.stringContaining('the register\'s inventory names W3-2 ("LTC/MTC timecode"), and neither table carries it')
    ])
  })

  it('names the row the inventory does not carry, and both sides of a name that stopped matching', () => {
    expect(checkLedger([CANDIDATE], [CANDIDATE, { id: 'W3-9', name: 'Timecode' }], [])).toEqual([
      expect.stringContaining('the register\'s candidate backlog carries W3-9, and the inventory names no such candidate')
    ])
    expect(checkLedger([CANDIDATE], [{ id: 'W3-2', name: 'Timecode' }], [])).toEqual([
      expect.stringContaining('the register\'s candidate backlog names W3-2 "Timecode", where the inventory names it "LTC/MTC timecode"')
    ])
    expect(checkLedger([CANDIDATE], [], [adoptedRow({ item: 'Timecode' })])).toEqual([
      expect.stringContaining('the register\'s adopted items names W3-2 "Timecode", where the inventory names it "LTC/MTC timecode"')
    ])
  })

  it('names the heading of a story no adopted row carries, at any depth and with or without a title', () => {
    expect(checkOrphanStories([STORY], [])).toEqual([
      expect.stringContaining(
        'Epic 9 carries the heading "### Story 9.2: LTC/MTC timecode enters as a cue type and a service", and no adopted row\'s "Story" cell names it'
      )
    ])
    const deeper = storiesOf('### Story 9.1: the gate\n#### Story 9.2: a story at four hashes\n### Story 9.3\n')
    expect(deeper.map((story) => story.key)).toEqual(['Story 9.1', 'Story 9.2', 'Story 9.3'])
    expect(checkOrphanStories(deeper, [])).toEqual([
      expect.stringContaining('Epic 9 carries the heading "#### Story 9.2: a story at four hashes"'),
      expect.stringContaining('Epic 9 carries the heading "### Story 9.3"')
    ])
    expect(checkOrphanStories([{ key: 'Story 9.1', number: 1, heading: '### Story 9.1: the gate' }], [])).toEqual([])
  })

  it('reads a row through the section and the table into the checks it has to pass', () => {
    const rows = adoptedOf(epicSection(REGISTER_WITH_ONE_ROW))
    expect(rows).toHaveLength(1)
    expect(checkCells(rows)).toEqual([])
    expect(checkKind(rows)).toEqual([])
    expect(checkClass(rows)).toEqual([])
    expect(checkDate(rows, CONTRACT_TEXT)).toEqual([])
    expect(checkCommitment(rows, CONTRACT_TEXT)).toEqual([])
    expect(checkLane(rows, ['peers'])).toEqual([])
    expect(checkIdentifier(rows, new Map())).toEqual([])
    expect(checkStoryCells(rows, [STORY])).toEqual([])
    expect(checkClaimRow(rows, [['LTC/MTC timecode', '—', 'unclaimed', 'no lane has run']])).toEqual([])
  })

  it('names the story cell that resolves to no heading', () => {
    expect(checkStoryCells([adoptedRow({ story: 'Story 9.7' })], [STORY])).toEqual([
      expect.stringContaining('the register\'s adopted row "W3-2" states the story "Story 9.7", and Epic 9 carries no such heading')
    ])
  })

  it('names the row and the cell left without a value', () => {
    expect(checkCells([adoptedRow({ kind: '' })])).toEqual([
      expect.stringContaining('the register\'s adopted row "W3-2" states nothing in its "Kind" cell')
    ])
    expect(checkCells([adoptedRow({ identifier: NONE })])).toEqual([
      expect.stringContaining('the register\'s adopted row "W3-2" states nothing in its "Identifier" cell')
    ])
    expect(checkCells([adoptedRow({ id: '' })])).toEqual([
      expect.stringContaining('the register\'s adopted table row 1 states nothing in its "#" cell')
    ])
  })

  it('names the kind that is not one of AD-15\'s three', () => {
    expect(checkKind([adoptedRow({ kind: 'sockets' })])).toEqual([
      expect.stringContaining('the register\'s adopted row "W3-2" states the kind "sockets", which is not one of AD-15\'s three')
    ])
  })

  it('names the class that is neither free nor pro', () => {
    expect(checkClass([adoptedRow({ gateClass: 'trial' })])).toEqual([
      expect.stringContaining('the register\'s adopted row "W3-2" states the class "trial", which is neither free nor pro')
    ])
  })

  it('names the date that is no day, the day that does not round-trip and the day the contract does not carry', () => {
    expect(checkDate([adoptedRow({ date: 'next quarter' })], CONTRACT_TEXT)).toEqual([
      expect.stringContaining('states the date "next quarter", which is neither a day (YYYY-MM-DD) nor "—"')
    ])
    expect(checkDate([adoptedRow({ date: '2027-13-01' })], CONTRACT_TEXT)).toEqual([
      expect.stringContaining('states the date "2027-13-01", which is neither a day (YYYY-MM-DD) nor "—"')
    ])
    expect(checkDate([adoptedRow({ date: '2027-01-31' })], CONTRACT_TEXT)).toEqual([
      expect.stringContaining('promises the day "2027-01-31", and SPEC.md carries no such date')
    ])
    expect(checkDate([adoptedRow({ date: '2027-01-31' })], 'LTC/MTC timecode ships on 2027-01-31.')).toEqual([])
  })

  it('names the commitment the contract does not carry, and the row that commits to nothing', () => {
    expect(checkCommitment([adoptedRow({ commitment: 'Timecode ships with the night report.' })], CONTRACT_TEXT)).toEqual([
      expect.stringContaining('the register\'s adopted row "W3-2" commits to "Timecode ships with the night report.", and SPEC.md carries no such sentence')
    ])
    expect(checkCommitment([adoptedRow({ commitment: NONE })], CONTRACT_TEXT)).toEqual([
      expect.stringContaining('the register\'s adopted row "W3-2" states no commitment sentence')
    ])
  })

  it('refuses a commitment the contract leaves open or names as a non-goal', () => {
    expect(checkCommitment([adoptedRow()], `## Capabilities\n\nnothing yet\n\n## Open Questions\n\n${CONTRACT_TEXT}\n`)).toEqual([
      expect.stringContaining('and SPEC.md carries no such sentence')
    ])
    expect(checkCommitment([adoptedRow()], `## Non-goals\n\n${CONTRACT_TEXT}\n`)).toEqual([
      expect.stringContaining('and SPEC.md carries no such sentence')
    ])
    expect(checkCommitment([adoptedRow()], `## Capabilities\n\n${CONTRACT_TEXT}\n\n## Open Questions\n\nnothing yet\n`)).toEqual([])
  })

  it('names the lane the claims record does not carry', () => {
    expect(checkLane([adoptedRow({ lane: 'desk' })], ['peers', 'vendor'])).toEqual([
      expect.stringContaining('the register\'s adopted row "W3-2" names the lane "desk", which the claims record\'s lanes table does not')
    ])
  })

  it('names the identifier the enforcement record already holds under another class', () => {
    const held = new Map<string, GateClass>([['companion', 'pro']])
    expect(checkIdentifier([adoptedRow({ identifier: 'companion', gateClass: 'free' })], held)).toEqual([
      expect.stringContaining('the register\'s adopted row "W3-2" states the identifier "companion" as free, and the enforcement record already holds it as pro')
    ])
    // The same class is still a second row for one identifier: refused unless the row's commitment
    // records the decision naming it, and the id is read folded to one case.
    const written = [
      expect.stringContaining('states the identifier "MIDI:send", which the enforcement record already holds, and its commitment records no decision naming it')
    ]
    expect(checkIdentifier([adoptedRow({ identifier: 'MIDI:send', gateClass: 'free' })], new Map([['midi:send', 'free']]))).toEqual(written)
    // The decision is the phrase the ledger names, not the bare word: the opposite said in those
    // words is a row saying the decision is not made.
    expect(
      checkIdentifier(
        [
          adoptedRow({
            identifier: 'MIDI:send',
            gateClass: 'free',
            commitment: 'No decision naming midi:send is recorded yet.'
          })
        ],
        new Map([['midi:send', 'free']])
      )
    ).toEqual(written)
    expect(
      checkIdentifier(
        [
          adoptedRow({
            identifier: 'Companion',
            gateClass: 'pro',
            commitment: 'A decision naming Companion is recorded, under the service already shipped.'
          })
        ],
        held
      )
    ).toEqual([])
  })

  it('names the two adopted rows that hold one identifier at two classes', () => {
    const rows = [adoptedRow({ id: 'W3-2', gateClass: 'pro' }), adoptedRow({ id: 'W3-3', gateClass: 'free' })]
    expect(checkIdentifier(rows, new Map())).toEqual([
      expect.stringContaining('states the identifier "timecode" as free, and the adopted row "W3-2" already holds it as pro')
    ])
  })

  it('names the channel identifier whose commitment records no decision to add it', () => {
    const problems = [
      expect.stringContaining('states the channel identifier "cue:print", and its commitment records no decision to add it')
    ]
    expect(checkIdentifier([adoptedRow({ identifier: 'cue:print', commitment: 'Cue print renders the showfile.' })], new Map())).toEqual(problems)
    // The opposite said in the same words: `decision to add` with a negator in front of it is a row
    // saying the channel is not decided, not one recording that it is.
    expect(
      checkIdentifier([adoptedRow({ identifier: 'cue:print', commitment: 'No decision to add `cue:print` is recorded yet.' })], new Map())
    ).toEqual(problems)
    expect(
      checkIdentifier(
        [adoptedRow({ identifier: 'cue:print', commitment: 'A decision to add cue:print is recorded.' })],
        new Map()
      )
    ).toEqual([])
  })

  it('names the candidate a claim row carries', () => {
    expect(checkClaims([CANDIDATE], [['Eos desk acceptance', 'vendor', 'proved', 'LTC/MTC timecode answered']])).toEqual([
      expect.stringContaining('the claims record\'s "Eos desk acceptance" row names the candidate W3-2 ("LTC/MTC timecode")')
    ])
    expect(checkClaims([CANDIDATE], [['W3-2 acceptance', '—', 'unclaimed', 'x']])).toEqual([
      expect.stringContaining('the claims record\'s "W3-2 acceptance" row names the candidate W3-2')
    ])
    // The claim's own cell is what the claim is about: one word of the candidate's name there is
    // the candidate named, where the same word in an evidence cell is not.
    expect(checkClaims([CANDIDATE], [['Timecode acceptance', '—', 'unclaimed', 'x']])).toEqual([
      expect.stringContaining('the claims record\'s "Timecode acceptance" row names the candidate W3-2 ("LTC/MTC timecode")')
    ])
    expect(checkClaims([CANDIDATE], [['Eos desk acceptance', 'vendor', 'proved', 'the timecode offset holds']])).toEqual([])
    expect(checkClaims([CANDIDATE], [['Eos desk acceptance', 'vendor', 'proved', 'the console answered 3.3.9.25']])).toEqual([])
  })

  it('names the item whose claim row the claims record does not carry, or carries elsewhere', () => {
    const lane = adoptedRow({ lane: 'peers' })
    expect(checkClaimRow([lane], [['LTC/MTC timecode', 'peers', 'proved', 'the lane ran']])).toEqual([])
    expect(checkClaimRow([lane], [['Eos desk acceptance', 'vendor', 'proved', 'x']])).toEqual([
      expect.stringContaining('is adopted, and the claims record carries no claim row naming "LTC/MTC timecode"')
    ])
    expect(checkClaimRow([lane], [['LTC/MTC timecode', 'vendor', 'proved', 'x']])).toEqual([
      expect.stringContaining('the claims record\'s "LTC/MTC timecode" row stands on the lane "vendor", and the register\'s adopted row "W3-2" names the lane "peers"')
    ])
    expect(checkClaimRow([adoptedRow()], [['LTC/MTC timecode', '—', 'proved', 'x']])).toEqual([
      expect.stringContaining('a claim no lane carries is "unclaimed"')
    ])
    expect(checkClaimRow([lane], [['LTC/MTC timecode', 'peers', 'unclaimed', 'x']])).toEqual([
      expect.stringContaining('a claim on a lane is "unproven" until that lane runs, then "proved"')
    ])
  })

  it('reads a promised day, a named lane and a decided channel as a row adoption would write', () => {
    expect(checkDate([adoptedRow({ date: '2027-01-31' })], 'LTC/MTC timecode ships on 2027-01-31.')).toEqual([])
    expect(checkLane([adoptedRow({ lane: 'peers' })], ['peers', 'vendor'])).toEqual([])
    expect(checkCommitment([adoptedRow()], CONTRACT_TEXT)).toEqual([])
    expect(checkKind([adoptedRow({ kind: 'cue type' })])).toEqual([])
    expect(checkClass([adoptedRow({ gateClass: 'free' })])).toEqual([])
    expect(checkStoryCells([adoptedRow()], [STORY])).toEqual([])
  })
})

/**
 * The register the guard reads, and a register it cannot read is a failure rather than an empty
 * pass: a ledger compared against nothing is the vacuous run the record exists to prevent.
 * catalog.ts holds the reader the free/Pro guard reads its record through, so a renamed table
 * fails both the same way.
 */
describe('the register the guard reads', () => {
  it('reads the inventory bullets — the name before the dash, the id whole, wherever the bullet sits', () => {
    expect(
      inventoryOf('W3-1: Remote command/query plus a Bitfocus Companion module — specified as free, unbuilt\nW3-2: LTC/MTC timecode.\n')
    ).toEqual([
      { id: 'W3-1', name: 'Remote command/query plus a Bitfocus Companion module' },
      { id: 'W3-2', name: 'LTC/MTC timecode' }
    ])
    // The id is read whole: `W3-10:` is not the inventory's `W3-1`.
    const tenth = inventoryOf('W3-10: a candidate past the sixth\n')
    expect(tenth).toEqual([{ id: 'W3-10', name: 'a candidate past the sixth' }])
    expect(tenth.some((candidate) => candidate.id === 'W3-1')).toBe(false)
    // The scan is the whole register, so a bullet-shaped line outside the inventory is read as a
    // candidate — and the ledger check then refuses the candidate no table carries.
    const stray = inventoryOf('Some prose about the epic.\n\nW3-7: A line that looks like a bullet.\n')
    expect(stray).toEqual([{ id: 'W3-7', name: 'A line that looks like a bullet' }])
    expect(checkLedger(stray, [], [])).toEqual([
      expect.stringContaining('the register\'s inventory names W3-7 ("A line that looks like a bullet"), and neither table carries it')
    ])
  })

  it("slices Epic 9's own section: its heading, never a mention of it or an entry under another epic", () => {
    const register =
      '### Epic 9: Wave 3 interop (uncommitted, no dates)\n**Carries:** W3-1 … W3-6\n\n' +
      '## Epic 9: Wave 3 interop (uncommitted, no dates)\n\n### Story 9.1: the gate\n\n## UX Design Requirements Coverage\n'
    expect(epicSection(register)).toBe('## Epic 9: Wave 3 interop (uncommitted, no dates)\n\n### Story 9.1: the gate\n')
    // The last section in the register: there is no heading after it to slice to.
    expect(epicSection('## Epic 9: Wave 3 interop\n\nthe last section\n')).toBe('## Epic 9: Wave 3 interop\n\nthe last section\n')
  })

  it('fails loudly when the register is not at the path it names', () => {
    expect(() => readText(`${REGISTER}.moved`, 'the register')).toThrow('could not be read at')
  })

  it('fails loudly when Epic 9 is renamed or gone', () => {
    expect(() => epicSection('## Epic 8: another epic\n\nthe section under it\n')).toThrow(
      'carries no "## Epic 9:" section'
    )
  })

  it('fails loudly on a register whose tables are renamed, malformed or absent', () => {
    expect(() => candidatesOf('## Epic 9: Wave 3\n\n### Candidate backlog\n\nno table under this heading\n')).toThrow(
      'carries no "# | Candidate | Likely class under AD-15 | What it would arrive as" table'
    )
    expect(() => adoptedOf('| # | Item | Kind | Identifier | Class | Commitment | Date | Lane | Story |')).toThrow(
      'has no rule line under its header'
    )
    expect(() =>
      adoptedOf(
        '| # | Item | Kind | Identifier | Class | Commitment | Date | Lane | Story |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n| W3-2 | LTC/MTC timecode |'
      )
    ).toThrow('has a row of 2 cells where its header has 9')
  })

  it('fails loudly on a claims record whose lanes or claims table is not there', () => {
    expect(() => lanesOf('# no table here')).toThrow('carries no "Lane | Workflow | Job | Trigger | Runner | Tag | Suite" table')
    expect(() => claimsOf('# no table here')).toThrow('carries no "Claim | Lane | Status | Evidence" table')
  })
})
