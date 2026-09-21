// The lane claims, held to the workflows that run them and to the copy that states them.
//
// `_bmad-output/specs/spec-cuerunner/quality-and-proof.md` is the record: two tables saying
// where each lane runs and which claim each lane carries today. The harness decides what a lane
// may claim (INTEGRATION-HARNESS.md §2, §11); the record says what each claim's status is; and
// the page modules keep their own words — website/docs/lane-claims.mjs is the copy's side of
// the record. This guard holds the last two to the first's YAML facts: a lane row to its
// workflow file, a claim's evidence to the lane's own job (the capture it replays, the gate it
// sets) and a proved row's to what the repository holds, and the phrase to the claims no lane
// has carried, so a claim cannot outrun the lane behind it (AD-24).
//
// Every check is a pure function of what it reads, so the second describe hands them a record
// the repository would never write and gets each failure back by name. The failure paths are
// what hold the record; a passing run on its own says only that nothing has drifted yet.
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { readRecord, tableRows } from '../src/main/license/catalog'

// @ts-ignore — js file, no type declarations
import { COPY_CLAIMS } from '../website/docs/lane-claims.mjs'
// @ts-ignore — js file, no type declarations
import { NOT_YET_PROVED } from '../website/docs/pro.mjs'
// @ts-ignore — js file, no type declarations
import { PAGES } from '../website/docs/pages.mjs'
// @ts-ignore — js file, no type declarations
import { renderPage } from '../website/build-docs.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

/** The record this guard reads: the companion whose subtitle is "which lane owns which claim". */
const RECORD = path.join(root, '_bmad-output', 'specs', 'spec-cuerunner', 'quality-and-proof.md')

/** The lanes table's header, as the record spells it: a renamed column is not this table. */
const LANES_HEADER = ['Lane', 'Workflow', 'Job', 'Trigger', 'Runner', 'Tag'] as const

/** The claims table's header, and the three words its status column may hold. */
const CLAIMS_HEADER = ['Claim', 'Lane', 'Status', 'Evidence'] as const
const STATUSES: Record<string, true> = { proved: true, unproven: true, unclaimed: true }

/** The mark the lane column carries for a claim no lane carries, and the capture path evidence names. */
const NO_LANE = '—'
const CAPTURE = /integration\/fixtures\/[\w./-]+\.json/g

/** The two shapes a workflow gate is written in: an environment variable, and a `workflow_dispatch` input. */
const SCREAMING = /^[A-Z][A-Z0-9_]{2,}$/
const SNAKE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/

/** One row of the record's lanes table, read as the columns it sits under. */
interface Lane {
  lane: string
  workflow: string
  job: string
  trigger: string
  runner: string
  tag: string
}

/**
 * One row of the record's claims table: what it claims, on what lane, and its evidence — the
 * evidence cell as the record writes it, its gates still in backticks, because that is where a
 * row cites the workflow values it rests on.
 */
interface Claim {
  claim: string
  lane: string
  status: string
  evidence: string
}

/** One claim the copy makes, as website/docs/lane-claims.mjs declares it. */
interface Declaration {
  page: string
  claim: string
  lane: string
  words: string
}

/** The status a claim row states, read as the record's three words are written. */
function statusOf(claim: Claim): string {
  return claim.status.toLowerCase()
}

/** The record's lanes table: one row per lane-and-job, the markdown's own emphasis off its cells. */
function lanesOf(markdown: string): Lane[] {
  return tableRows(markdown, LANES_HEADER).map((row) => {
    const [lane, workflow, job, trigger, runner, tag] = row.map((cell) => cell.replace(/[`*]/g, '').trim())
    return { lane, workflow, job, trigger, runner, tag }
  })
}

/**
 * The record's claims table: one row per claim, in file order. The evidence cell is kept as the
 * record writes it — the gate names it cites sit in backticks — while the three cells a check
 * compares by value come back with the markdown's own emphasis off.
 */
function claimsOf(markdown: string): Claim[] {
  return tableRows(markdown, CLAIMS_HEADER).map((row) => {
    const [claim, lane, status] = row.slice(0, 3).map((cell) => cell.replace(/[`*]/g, '').trim())
    return { claim, lane, status, evidence: row[3] }
  })
}

/** The workflow a lane row names, read whole: a file the record names and cannot be read is loud. */
function readWorkflow(file: string): string {
  try {
    return fs.readFileSync(path.join(root, file), 'utf-8')
  } catch (cause) {
    throw new Error(
      `lane claims: the record's lanes table names ${file}, which cannot be read (${(cause as Error).message}): a lane row held to a file that is not there passes against nothing`
    )
  }
}

/**
 * The kinds a workflow's `on:` declares, and the line `on:` sits on. The block form's keys are
 * the kinds; an `on:` this guard cannot read as kinds is a loud failure rather than a trigger
 * set with nothing in it.
 */
function onKinds(yaml: string, file: string): { line: number; kinds: string[] } {
  const lines = yaml.split('\n')
  const start = lines.findIndex((line) => /^on:\s*(\S.*)?$/.test(line))
  if (start === -1) {
    throw new Error(`lane claims: ${file} declares no \`on:\`, and the record's lanes table says when its job runs`)
  }
  const inline = (/^on:\s*(\S.*)?$/.exec(lines[start])?.[1] ?? '').trim()
  if (inline !== '') {
    if (!inline.startsWith('[') || !inline.endsWith(']')) {
      throw new Error(`lane claims: ${file}:${start + 1} writes \`on: ${inline}\`, which this guard does not read as kinds`)
    }
    const kinds = inline.slice(1, -1).split(',').map((kind) => kind.trim()).filter((kind) => kind !== '')
    return { line: start + 1, kinds }
  }
  const kinds: string[] = []
  for (let line = start + 1; line < lines.length && !/^\S/.test(lines[line]); line++) {
    const key = /^  ([A-Za-z_][\w-]*):/.exec(lines[line])
    if (key !== null) kinds.push(key[1])
  }
  return { line: start + 1, kinds }
}

/**
 * One job's own lines, with the line its key sits on — or nothing when the workflow declares no
 * such job. The block ends at the next job key or at the first line that leaves the jobs block.
 */
function jobLines(yaml: string, job: string, file: string): { line: number; lines: string[] } | null {
  const lines = yaml.split('\n')
  const jobs = lines.findIndex((line) => /^jobs:\s*$/.test(line))
  if (jobs === -1) {
    throw new Error(`lane claims: ${file} declares no \`jobs:\`, and the record's lanes table says a job of it runs a lane`)
  }
  for (let line = jobs + 1; line < lines.length; line++) {
    const key = /^  ([A-Za-z_][\w-]*):\s*$/.exec(lines[line])
    if (key === null || key[1] !== job) continue
    let end = lines.length
    for (let after = line + 1; after < lines.length; after++) {
      if (/^\S/.test(lines[after]) || /^  [A-Za-z_][\w-]*:\s*$/.test(lines[after])) {
        end = after
        break
      }
    }
    return { line: line + 1, lines: lines.slice(line, end) }
  }
  return null
}

/**
 * The label list a job's `runs-on` states, and the line it sits on — or nothing when the job
 * carries no `runs-on` at all. A value this guard cannot read as a label list — a matrix
 * expression, say — comes back with `labels` null rather than as a list of nothing.
 */
function runsOn(block: { line: number; lines: string[] }): { line: number; labels: string[] | null } | null {
  for (const [index, line] of block.lines.entries()) {
    const setting = /^\s*runs-on:\s*(.*?)\s*$/.exec(line)
    if (setting === null) continue
    const listed = setting[1].startsWith('[') && setting[1].endsWith(']')
    const labels = listed
      ? setting[1].slice(1, -1).split(',').map((label) => label.trim()).filter((label) => label !== '')
      : null
    return { line: block.line + index, labels }
  }
  return null
}

/**
 * The step a job runs the integration suite in: the `run:` value — a `|` or `>` block scalar's
 * lines included — and the line that value sits on. Only a real `run:` line counts, so a
 * commented-out one is not a lane's suite, and only that line's command is read for the tag: a
 * `--grep` on another step belongs to that step.
 */
function suiteStep(block: { line: number; lines: string[] }): { line: number; command: string } | null {
  for (const [index, line] of block.lines.entries()) {
    const run = /^\s*(?:-\s+)?run:\s*(.*?)\s*$/.exec(line)
    if (run === null) continue
    let command = run[1]
    if (/^[|>][-+]?$/.test(command)) {
      const indent = line.length - line.trimStart().length
      const script: string[] = []
      for (let after = index + 1; after < block.lines.length; after++) {
        const next = block.lines[after]
        if (next.trim() !== '' && next.length - next.trimStart().length <= indent) break
        script.push(next)
      }
      command = script.join('\n')
    }
    if (command.includes('npm run test:integration')) return { line: block.line + index, command }
  }
  return null
}

/**
 * The record's lanes table against the workflows it names. Every row is held to the file it
 * points at: the job has to be declared there, the `on:` kinds have to be the ones the row
 * states, the job's `runs-on` the runner, and the `run:` step that runs the suite has to carry
 * the row's tag and no other. Both sides are named — the row and the workflow line — because
 * that is what a reader needs to fix it.
 */
function laneProblems(lanes: Lane[], workflows: Map<string, string>): string[] {
  return lanes.flatMap((entry) => {
    const yaml = workflows.get(entry.workflow)
    if (yaml === undefined) {
      return [`the record's \`${entry.lane}\` lane row names ${entry.workflow}, which this reading does not hold`]
    }
    const block = jobLines(yaml, entry.job, entry.workflow)
    if (block === null) {
      return [
        `the record's \`${entry.lane}\` lane row names ${entry.workflow}'s \`${entry.job}\` job, and that file declares no job by that name`
      ]
    }
    const problems: string[] = []
    const on = onKinds(yaml, entry.workflow)
    const statedKinds = entry.trigger.split(',').map((kind) => kind.trim()).filter((kind) => kind !== '')
    if ([...new Set(statedKinds)].sort().join(', ') !== [...new Set(on.kinds)].sort().join(', ')) {
      problems.push(
        `the record's \`${entry.lane}\` lane row says ${entry.workflow}'s \`${entry.job}\` job runs on ${statedKinds.join(', ')}, and \`on:\` (${entry.workflow}:${on.line}) declares ${on.kinds.join(', ')}`
      )
    }
    const runner = runsOn(block)
    if (runner === null || runner.labels === null) {
      problems.push(
        `the record's \`${entry.lane}\` lane row names ${entry.runner} as the runner, and ${entry.workflow}'s \`${entry.job}\` job declares ${
          runner === null ? 'no `runs-on`' : `a \`runs-on\` this guard does not read as a label list (${entry.workflow}:${runner.line})`
        }`
      )
    } else {
      const statedLabels = entry.runner.replace(/^\[|\]$/g, '').split(',').map((label) => label.trim()).filter((label) => label !== '')
      if ([...new Set(statedLabels)].sort().join(', ') !== [...new Set(runner.labels)].sort().join(', ')) {
        problems.push(
          `the record's \`${entry.lane}\` lane row names ${entry.runner} as the runner, and ${entry.workflow}:${runner.line} declares [${runner.labels.join(', ')}]`
        )
      }
    }
    const suite = suiteStep(block)
    if (suite === null) {
      problems.push(
        `the record's \`${entry.lane}\` lane row names ${entry.workflow}'s \`${entry.job}\` job as the lane's, and no \`run:\` step of that job runs \`npm run test:integration\``
      )
    } else {
      const tags = [...suite.command.matchAll(/--grep\s+"([^"]*)"/g)].map((match) => match[1])
      const elsewhere = block.lines.flatMap((line, index) =>
        block.line + index === suite.line || !line.includes('--grep') ? [] : [`${entry.workflow}:${block.line + index}`]
      )
      const aside = elsewhere.length === 0 ? '' : `; the \`--grep\` at ${elsewhere.join(', ')} is another step's`
      const ran = tags.length === 0 ? 'no `--grep`' : `\`--grep "${tags[0]}"\``
      if (entry.tag === NO_LANE && tags.length > 0) {
        problems.push(
          `the record's \`${entry.lane}\` lane row says the lane is untagged, and ${entry.workflow}:${suite.line} runs the suite with ${ran}${aside}`
        )
      } else if (entry.tag !== NO_LANE && (tags.length !== 1 || tags[0] !== entry.tag)) {
        problems.push(
          `the record's \`${entry.lane}\` lane row names ${entry.tag} as the tag, and ${entry.workflow}:${suite.line} runs the suite with ${ran}${aside}`
        )
      }
    }
    return problems
  })
}

/**
 * The gate names a claim's evidence cites in backticks: a `workflow_dispatch` input
 * (`desk_host`) or an environment variable (`AH_MIDI_PORT`) — the two shapes a gate is written
 * in here, and the two a row can cite to say how its lane is driven.
 */
function citedGates(claim: Claim): string[] {
  return [...claim.evidence.matchAll(/`([^`]+)`/g)]
    .map((match) => match[1])
    .filter((token) => SCREAMING.test(token) || SNAKE.test(token))
}

/**
 * Every claim's evidence, held to the lane it stands on: a capture the row names has to be one
 * of the lane's own jobs names — the replay a claim rests on is not evidence if the lane that
 * carries it stopped running it — and a gate the row cites has to be one the lane's own jobs
 * reads, rather than a string that survives somewhere else in the file. The evidence is the
 * part of a row a reader trusts without opening the YAML, so a workflow changed under it fails
 * here rather than leaving the record reading true.
 */
function laneEvidenceProblems(claims: Claim[], lanes: Lane[], workflows: Map<string, string>): string[] {
  return claims.flatMap((claim) => {
    const rows = lanes.filter((entry) => entry.lane === claim.lane)
    if (rows.length === 0) return []
    const problems: string[] = []
    const jobs = rows.map((entry) => {
      const block = jobLines(workflows.get(entry.workflow) ?? '', entry.job, entry.workflow)
      return { entry, lines: block?.lines ?? [] }
    })
    const where = rows.map((entry) => `${entry.workflow}'s \`${entry.job}\` job`).join(', ')
    for (const capture of [...new Set([...claim.evidence.matchAll(CAPTURE)].map((match) => match[0]))]) {
      if (jobs.some((job) => job.lines.some((line) => line.includes(capture)))) continue
      problems.push(
        `the record's "${claim.claim}" row rests on ${capture}, and none of the ${claim.lane} lane's own jobs names it (${where})`
      )
    }
    for (const gate of [...new Set(citedGates(claim))]) {
      if (jobs.some((job) => job.lines.some((line) => line.includes(gate)))) continue
      problems.push(
        `the record's "${claim.claim}" row cites the gate \`${gate}\`, and none of the ${claim.lane} lane's own jobs names it (${where})`
      )
    }
    return problems
  })
}

/** Every claim's status, held to the three words the record's claims table states. */
function statusProblems(claims: Claim[]): string[] {
  const words = Object.keys(STATUSES).join(', ')
  return claims
    .filter((claim) => STATUSES[statusOf(claim)] !== true)
    .map((claim) => `the record's "${claim.claim}" row states the status "${claim.status}", which is none of ${words}`)
}

/** Every claim's lane, held to a lane the lanes table names — or to `—` where no lane carries it. */
function laneNameProblems(claims: Claim[], lanes: Lane[]): string[] {
  const named = [...new Set(lanes.map((entry) => entry.lane))]
  return claims.flatMap((claim) => {
    if (statusOf(claim) === 'unclaimed') {
      return claim.lane === NO_LANE
        ? []
        : [
            `the record's "${claim.claim}" row is unclaimed and names ${claim.lane} as its lane: no lane carries it, so the lane column is \`${NO_LANE}\``
          ]
    }
    if (claim.lane === NO_LANE) {
      return [
        `the record's "${claim.claim}" row names no lane and is not unclaimed: the lane that would carry it is one of ${named.join(', ')}`
      ]
    }
    return named.includes(claim.lane)
      ? []
      : [
          `the record's "${claim.claim}" row names the ${claim.lane} lane, and the lanes table names none of that name (${named.join(', ')})`
        ]
  })
}

/** Every claim named once: two rows for one claim are two statuses for one thing. */
function claimNameProblems(claims: Claim[]): string[] {
  const counts = new Map<string, number>()
  for (const claim of claims) counts.set(claim.claim, (counts.get(claim.claim) ?? 0) + 1)
  return [...counts]
    .filter(([, count]) => count > 1)
    .map(([name, count]) => `the record's claims table names "${name}" ${count} times: a claim has one row and one status`)
}

/** The captures the record's evidence names, as the repository holds them: the files that are there. */
function capturesOf(claims: Claim[]): Map<string, string> {
  const files = [...new Set(claims.flatMap((claim) => [...claim.evidence.matchAll(CAPTURE)].map((match) => match[0])))]
  const reads = files.flatMap((file) => {
    try {
      return [[file, fs.readFileSync(path.join(root, file), 'utf-8')] as const]
    } catch {
      // A capture the record names and the repository does not hold is the check's to report,
      // with the row that named it — not a skip that leaves the row looking proved.
      return []
    }
  })
  return new Map(reads)
}

/**
 * Every `proved` row's evidence, held to what the repository holds. The capture the row names
 * has to be there, its provenance has to carry the version, where the version came from, when
 * it was recorded and by what — and that source has to be the console, because a version the
 * app reported is not desk acceptance. The row has to state the version and the day itself, so
 * a console re-recorded at a new version fails this rather than leaving the old figure standing.
 */
function provedEvidenceProblems(claims: Claim[], captures: Map<string, string>): string[] {
  return claims.flatMap((claim) => {
    if (statusOf(claim) !== 'proved') return []
    const files = [...new Set([...claim.evidence.matchAll(CAPTURE)].map((match) => match[0]))]
    if (files.length === 0) {
      return [
        `the record's "${claim.claim}" row is proved and its evidence names no capture under integration/fixtures: nothing in the repository is held to it`
      ]
    }
    return files.flatMap((file) => {
      const text = captures.get(file)
      if (text === undefined) {
        return [`the record's "${claim.claim}" row is proved on ${file}, which the repository does not hold`]
      }
      let capture: { provenance?: Record<string, unknown> }
      try {
        capture = JSON.parse(text)
      } catch (cause) {
        return [`the record's "${claim.claim}" row is proved on ${file}, which cannot be read as JSON (${(cause as Error).message})`]
      }
      const provenance = capture?.provenance
      if (typeof provenance !== 'object' || provenance === null) {
        return [
          `the record's "${claim.claim}" row is proved on ${file}, and that file carries no provenance: a capture whose origin is unknown cannot be evidence`
        ]
      }
      const field = (name: string): string => (typeof provenance[name] === 'string' ? (provenance[name] as string) : '')
      const problems = ['version', 'versionSource', 'recordedAt', 'recordedBy']
        .filter((name) => field(name) === '')
        .map((name) => `the record's "${claim.claim}" row is proved on ${file}, whose provenance names no \`${name}\``)
      const source = field('versionSource')
      if (source !== '' && source !== 'console') {
        problems.push(
          `the record's "${claim.claim}" row is proved on ${file}, whose provenance reads the version from \`${source}\`: the console's own answer is what carries "${claim.claim}", never what the app reported`
        )
      }
      const version = field('version')
      if (version !== '' && !claim.evidence.includes(version)) {
        problems.push(
          `the record's "${claim.claim}" row is proved and states no \`${version}\`, the version ${file}'s provenance records`
        )
      }
      const day = field('recordedAt').slice(0, 10)
      if (day !== '' && !claim.evidence.includes(day)) {
        problems.push(`the record's "${claim.claim}" row is proved and states no \`${day}\`, the day ${file} was recorded`)
      }
      return problems
    })
  })
}

/**
 * The pages the declarations are written on, rendered by their own paths and read as a reader
 * reads them — the tags off, the whitespace collapsed, the entities as the page writes them. A
 * page the site does not render is loud rather than a claim checked against nothing.
 */
function pagesOf(declarations: Declaration[]): Map<string, string> {
  return new Map(
    [...new Set(declarations.map((entry) => entry.page))].map((page) => {
      const rendered = PAGES.find((candidate: { path: string }) => candidate.path === page)
      if (rendered === undefined) {
        throw new Error(
          `lane claims: website/docs/lane-claims.mjs declares a claim on ${page}, and website/docs/pages.mjs renders no such page`
        )
      }
      return [page, renderPage(rendered).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()]
    })
  )
}

/**
 * Every claim the copy makes, held to the row it names: the row has to be there, the lane the
 * declaration stands on has to be the row's, the words have to be on the page, and the phrase
 * has to sit immediately behind them exactly when the row says no lane has carried the claim.
 */
function declarationProblems(declarations: Declaration[], claims: Claim[], pages: Map<string, string>): string[] {
  return declarations.flatMap((entry) => {
    const row = claims.find((candidate) => candidate.claim === entry.claim)
    if (row === undefined) {
      return [`website/docs/lane-claims.mjs declares the claim "${entry.claim}", and the record's claims table has no row by that name`]
    }
    const text = pages.get(entry.page)
    if (text === undefined) {
      return [`website/docs/lane-claims.mjs declares the claim "${entry.claim}" on ${entry.page}, which this reading does not render`]
    }
    const problems: string[] = []
    if (row.lane !== entry.lane) {
      problems.push(
        `the copy's "${entry.claim}" claim stands on the ${entry.lane} lane, and the record's row for it names the ${row.lane} lane`
      )
    }
    const says = text.split(entry.words).length - 1
    if (says === 0) {
      problems.push(
        `the copy's "${entry.claim}" claim is declared at "${entry.words}" on ${entry.page}, and that page carries no such words`
      )
      return problems
    }
    if (says > 1) {
      problems.push(
        `the copy's "${entry.claim}" claim is declared at "${entry.words}" on ${entry.page}, and that page carries those words ${says} times: the phrase sits at a claim once, so the claim's words are written once`
      )
    }
    const carried = text.includes(`${entry.words} ${NOT_YET_PROVED}`)
    if (statusOf(row) === 'proved' && carried) {
      problems.push(
        `the copy's "${entry.claim}" claim is proved on the ${row.lane} lane, and ${entry.page} carries the phrase behind its words: "${entry.words} ${NOT_YET_PROVED}"`
      )
    }
    if (statusOf(row) !== 'proved' && !carried) {
      problems.push(
        `the record's "${entry.claim}" row is ${statusOf(row)} and ${entry.page} carries no phrase behind its words: expected "${entry.words} ${NOT_YET_PROVED}"`
      )
    }
    return problems
  })
}

/** Every page's phrases counted against the claims declared for it: one each, and no others. */
function phraseCountProblems(declarations: Declaration[], claims: Claim[], pages: Map<string, string>): string[] {
  return [...pages].flatMap(([page, text]) => {
    const carried = text.split(NOT_YET_PROVED).length - 1
    const expected = declarations
      .filter((entry) => entry.page === page)
      .filter((entry) => {
        const row = claims.find((candidate) => candidate.claim === entry.claim)
        return row !== undefined && statusOf(row) !== 'proved'
      }).length
    return carried === expected
      ? []
      : [
          `${page} carries the phrase ${carried} time(s) for the ${expected} claim(s) declared as carried by no lane: a claim that lost the phrase, or one that carries it without declaring the claim`
        ]
  })
}

/** Every claim declared once per page: the phrase sits at a claim once, so the claim is declared once. */
function repeatedDeclarationProblems(declarations: Declaration[]): string[] {
  const counts = new Map<string, number>()
  for (const entry of declarations) {
    const key = `${entry.page} ${entry.claim}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts]
    .filter(([, count]) => count > 1)
    .map(
      ([key, count]) =>
        `website/docs/lane-claims.mjs declares "${key}" ${count} times: the phrase sits at a claim once, so the claim is declared once`
    )
}

/** Everything the checks read, in one value: a case below hands them a mutation of it. */
interface Reading {
  lanes: Lane[]
  claims: Claim[]
  workflows: Map<string, string>
  captures: Map<string, string>
  pages: Map<string, string>
  declarations: Declaration[]
}

/** The record as the repository holds it, and the copy as the pages declare it. */
const RECORD_TEXT = readRecord(RECORD)
const LANES = lanesOf(RECORD_TEXT)
const CLAIMS = claimsOf(RECORD_TEXT)
const DECLARATIONS: Declaration[] = COPY_CLAIMS

const LIVE: Reading = {
  lanes: LANES,
  claims: CLAIMS,
  workflows: new Map([...new Set(LANES.map((entry) => entry.workflow))].map((file) => [file, readWorkflow(file)])),
  captures: capturesOf(CLAIMS),
  pages: pagesOf(DECLARATIONS),
  declarations: DECLARATIONS
}

describe('the lanes and the claims the record states', () => {
  it('reads a record with lanes, claims and copy in it', () => {
    expect(LIVE.lanes.length, 'the record states no lanes').toBeGreaterThan(0)
    expect(LIVE.claims.length, 'the record states no claims').toBeGreaterThan(0)
    expect(LIVE.declarations.length, 'no page declares a claim').toBeGreaterThan(0)
  })

  it('holds every lane row to the workflow, job, trigger, runner and tag it names', () => {
    expect(laneProblems(LIVE.lanes, LIVE.workflows)).toEqual([])
  })

  it('states each claim in one of the record three words', () => {
    expect(statusProblems(LIVE.claims)).toEqual([])
  })

  it('names a lane behind every claim, and the claims no lane carries', () => {
    expect(laneNameProblems(LIVE.claims, LIVE.lanes)).toEqual([])
  })

  it('names every claim once', () => {
    expect(claimNameProblems(LIVE.claims)).toEqual([])
  })

  it('holds every proved row to the capture it names and the provenance the repository holds', () => {
    expect(provedEvidenceProblems(LIVE.claims, LIVE.captures)).toEqual([])
  })

  it("holds every claim's evidence to the lane's own jobs and workflow", () => {
    expect(laneEvidenceProblems(LIVE.claims, LIVE.lanes, LIVE.workflows)).toEqual([])
  })

  it('holds every claim the copy makes to the row that states its status', () => {
    expect(declarationProblems(LIVE.declarations, LIVE.claims, LIVE.pages)).toEqual([])
  })

  it('carries the phrase once per claim no lane has carried, and nowhere else', () => {
    expect(phraseCountProblems(LIVE.declarations, LIVE.claims, LIVE.pages)).toEqual([])
  })

  it('declares each claim once per page', () => {
    expect(repeatedDeclarationProblems(LIVE.declarations)).toEqual([])
  })
})

/**
 * The record and the copy the repository would never commit, one failure at a time: each case
 * changes one thing in the live reading and asserts the check names it. These are the states
 * the checks exist to refuse — a lane whose workflow moved under it, a claim that outran its
 * lane, a phrase that left its claim — and nothing else in the suite exercises them.
 */
describe('the record and the copy the checks exist to refuse', () => {
  it('names a job a workflow does not declare', () => {
    const renamed = LIVE.lanes.map((entry) => (entry.lane === 'peers' ? { ...entry, job: 'harness' } : entry))
    expect(laneProblems(renamed, LIVE.workflows)).toEqual([
      expect.stringContaining(
        "the record's `peers` lane row names .github/workflows/ci.yml's `harness` job, and that file declares no job by that name"
      )
    ])
  })

  it('names both sides when a lane row states a trigger the workflow does not declare', () => {
    const weekly = LIVE.lanes.map((entry) => (entry.job === 'eos-windows' ? { ...entry, trigger: 'schedule' } : entry))
    const problems = laneProblems(weekly, LIVE.workflows)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain(
      "the record's `vendor` lane row says .github/workflows/integration-vendor.yml's `eos-windows` job runs on schedule"
    )
    expect(problems[0]).toContain('declares schedule, workflow_dispatch')
    expect(problems[0], 'the failure names the workflow line').toMatch(/integration-vendor\.yml:\d+/)
  })

  it('names both sides when a lane row states a runner the job does not use', () => {
    const moved = LIVE.lanes.map((entry) =>
      entry.job === 'hardware' ? { ...entry, runner: '[self-hosted, windows, x64, win-ci]' } : entry
    )
    const problems = laneProblems(moved, LIVE.workflows)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain(
      "the record's `hardware` lane row names [self-hosted, windows, x64, win-ci] as the runner"
    )
    expect(problems[0]).toContain('declares [self-hosted, linux, x64, ubox]')
    expect(problems[0], 'the failure names the workflow line').toMatch(/integration-hardware\.yml:\d+/)
  })

  it('names both sides when a lane row states a tag the job does not grep', () => {
    const swapped = LIVE.lanes.map((entry) => (entry.job === 'ah-windows' ? { ...entry, tag: '@vendor' } : entry))
    const problems = laneProblems(swapped, LIVE.workflows)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain("the record's `vendor` lane row names @vendor as the tag")
    expect(problems[0]).toContain('runs the suite with `--grep "@ah"`')
    expect(problems[0], 'the failure names the workflow line').toMatch(/integration-vendor\.yml:\d+/)
  })

  it('names an untagged lane whose job greps a tag', () => {
    const untagged = LIVE.lanes.map((entry) => (entry.job === 'eos-windows' ? { ...entry, tag: NO_LANE } : entry))
    const problems = laneProblems(untagged, LIVE.workflows)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain("the record's `vendor` lane row says the lane is untagged")
    expect(problems[0]).toContain('runs the suite with `--grep "@vendor"`')
  })

  it('refuses a suite line that is only a comment', () => {
    const commented = new Map(LIVE.workflows)
    commented.set(
      '.github/workflows/ci.yml',
      (commented.get('.github/workflows/ci.yml') ?? '').replace(
        '        run: npm run test:integration',
        '        # run: npm run test:integration'
      )
    )
    expect(laneProblems(LIVE.lanes, commented)).toEqual([
      expect.stringContaining(
        "the record's `peers` lane row names .github/workflows/ci.yml's `integration` job as the lane's, and no `run:` step of that job runs `npm run test:integration`"
      )
    ])
  })

  it('names a tag grepped on a step that is not the suite line', () => {
    const moved = new Map(LIVE.workflows)
    const vendor = '.github/workflows/integration-vendor.yml'
    moved.set(
      vendor,
      (moved.get(vendor) ?? '').replace(
        '        run: npm run test:integration -- --grep "@ah"',
        '        run: npm run test:integration\n\n      - name: Grep it somewhere else\n        run: echo --grep "@ah"'
      )
    )
    const problems = laneProblems(LIVE.lanes, moved)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain("the record's `vendor` lane row names @ah as the tag")
    expect(problems[0]).toContain('runs the suite with no `--grep`')
    expect(problems[0], 'the failure names the step that does grep it').toMatch(
      /integration-vendor\.yml:\d+ is another step's/
    )
  })

  it('names a lane whose job never runs the integration suite', () => {
    const joined = LIVE.lanes.map((entry) => (entry.lane === 'peers' ? { ...entry, job: 'unit-test' } : entry))
    expect(laneProblems(joined, LIVE.workflows)).toEqual([
      expect.stringContaining(
        "the record's `peers` lane row names .github/workflows/ci.yml's `unit-test` job as the lane's, and no `run:` step of that job runs `npm run test:integration`"
      )
    ])
  })

  it('names a status outside the record three words', () => {
    const strong = LIVE.claims.map((claim) =>
      claim.claim === 'A&H desk acceptance' ? { ...claim, status: 'proven' } : claim
    )
    expect(statusProblems(strong)).toEqual([
      expect.stringContaining(
        'the record\'s "A&H desk acceptance" row states the status "proven", which is none of proved, unproven, unclaimed'
      )
    ])
  })

  it('names a lane a claim stands on that the lanes table does not name', () => {
    const elsewhere = LIVE.claims.map((claim) =>
      claim.claim === 'The MIDI Control bridge' ? { ...claim, lane: 'nightly' } : claim
    )
    expect(laneNameProblems(elsewhere, LIVE.lanes)).toEqual([
      expect.stringContaining(
        'the record\'s "The MIDI Control bridge" row names the nightly lane, and the lanes table names none of that name'
      )
    ])
  })

  it('names a claim marked unclaimed that still names a lane', () => {
    const carried = LIVE.claims.map((claim) => (claim.claim === 'Firmware equality' ? { ...claim, lane: 'peers' } : claim))
    expect(laneNameProblems(carried, LIVE.lanes)).toEqual([
      expect.stringContaining('the record\'s "Firmware equality" row is unclaimed and names peers as its lane')
    ])
  })

  it('names a claim that names no lane and is not unclaimed', () => {
    const nowhere = LIVE.claims.map((claim) =>
      claim.claim === 'A&H desk acceptance' ? { ...claim, lane: NO_LANE } : claim
    )
    expect(laneNameProblems(nowhere, LIVE.lanes)).toEqual([
      expect.stringContaining('the record\'s "A&H desk acceptance" row names no lane and is not unclaimed')
    ])
  })

  it('names a proved row whose capture the repository does not hold', () => {
    const moved = LIVE.claims.map((claim) =>
      claim.claim === 'Eos desk acceptance'
        ? { ...claim, evidence: claim.evidence.replace('eos-ubox-win.json', 'eos-gone.json') }
        : claim
    )
    expect(provedEvidenceProblems(moved, LIVE.captures)).toEqual([
      expect.stringContaining(
        'the record\'s "Eos desk acceptance" row is proved on integration/fixtures/vendor/eos-gone.json, which the repository does not hold'
      )
    ])
  })

  it('names both sides when a proved row states a version the capture does not hold', () => {
    const stale = LIVE.claims.map((claim) =>
      claim.claim === 'Eos desk acceptance' ? { ...claim, evidence: claim.evidence.replaceAll('3.3.9.25', '3.2.0.1') } : claim
    )
    expect(provedEvidenceProblems(stale, LIVE.captures)).toEqual([
      expect.stringContaining(
        "the record's \"Eos desk acceptance\" row is proved and states no `3.3.9.25`, the version integration/fixtures/vendor/eos-ubox-win.json's provenance records"
      )
    ])
  })

  it('names a capture whose provenance reads the version from the app', () => {
    const fixture = 'integration/fixtures/vendor/eos-ubox-win.json'
    const appSourced = new Map(LIVE.captures)
    appSourced.set(
      fixture,
      (appSourced.get(fixture) ?? '').replace('"versionSource": "console"', '"versionSource": "app"')
    )
    expect(provedEvidenceProblems(LIVE.claims, appSourced)).toEqual([
      expect.stringContaining(
        `the record's "Eos desk acceptance" row is proved on ${fixture}, whose provenance reads the version from \`app\`: the console's own answer is what carries "Eos desk acceptance"`
      ),
      expect.stringContaining(
        `the record's "The peers' wire format" row is proved on ${fixture}, whose provenance reads the version from \`app\`: the console's own answer is what carries "The peers' wire format", never what the app reported`
      )
    ])
  })

  it('names a capture whose provenance is gone or unreadable', () => {
    const fixture = 'integration/fixtures/vendor/eos-ubox-win.json'
    const provenanceLess = new Map(LIVE.captures)
    provenanceLess.set(fixture, '{"exchanges": []}')
    expect(provedEvidenceProblems(LIVE.claims, provenanceLess)).toEqual([
      expect.stringContaining(
        `the record's "Eos desk acceptance" row is proved on ${fixture}, and that file carries no provenance`
      ),
      expect.stringContaining(
        `the record's "The peers' wire format" row is proved on ${fixture}, and that file carries no provenance`
      )
    ])
  })

  it('names a row whose capture the lane no longer runs', () => {
    const repointed = new Map(LIVE.workflows)
    const ci = '.github/workflows/ci.yml'
    repointed.set(
      ci,
      (repointed.get(ci) ?? '').replace(
        'EOS_REPLAY: integration/fixtures/vendor/eos-ubox-win.json',
        'EOS_REPLAY: integration/fixtures/vendor/eos-past.json'
      )
    )
    const problems = laneEvidenceProblems(LIVE.claims, LIVE.lanes, repointed)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain(
      "the record's \"The peers' wire format\" row rests on integration/fixtures/vendor/eos-ubox-win.json"
    )
    expect(problems[0]).toContain("none of the peers lane's own jobs names it (.github/workflows/ci.yml's `integration` job)")
  })

  it('names a gate a lane workflow does not set', () => {
    const renamed = LIVE.claims.map((claim) =>
      claim.claim === 'The MIDI Control bridge'
        ? { ...claim, evidence: claim.evidence.replace('`AH_MIDI_PORT`', '`AH_CONTROL_PORT`') }
        : claim
    )
    expect(laneEvidenceProblems(renamed, LIVE.lanes, LIVE.workflows)).toEqual([
      expect.stringContaining(
        'the record\'s "The MIDI Control bridge" row cites the gate `AH_CONTROL_PORT`, and none of the vendor lane\'s own jobs names it (.github/workflows/integration-vendor.yml\'s `eos-windows` job, .github/workflows/integration-vendor.yml\'s `ah-windows` job)'
      )
    ])
  })

  it('names a claim the record has no row for', () => {
    const invented = [
      ...LIVE.declarations,
      { page: 'interop.html', claim: 'Live discovery', lane: 'peers', words: 'the devices that announce themselves' }
    ]
    expect(declarationProblems(invented, LIVE.claims, LIVE.pages)).toEqual([
      expect.stringContaining(
        'declares the claim "Live discovery", and the record\'s claims table has no row by that name'
      )
    ])
  })

  it('names both sides when a declaration stands on a lane the record does not give the claim', () => {
    const peer = LIVE.declarations.map((entry) =>
      entry.claim === 'A&H desk acceptance' ? { ...entry, lane: 'peers' } : entry
    )
    expect(declarationProblems(peer, LIVE.claims, LIVE.pages)).toEqual([
      expect.stringContaining(
        'the copy\'s "A&H desk acceptance" claim stands on the peers lane, and the record\'s row for it names the hardware lane'
      )
    ])
  })

  it('names the claim whose phrase is gone from its page', () => {
    const missing = new Map(LIVE.pages)
    missing.set(
      'interop.html',
      (missing.get('interop.html') ?? '').replace(
        `an Allen &amp; Heath SQ or Avantis ${NOT_YET_PROVED}`,
        'an Allen &amp; Heath SQ or Avantis'
      )
    )
    expect(declarationProblems(LIVE.declarations, LIVE.claims, missing)).toEqual([
      expect.stringContaining(
        'the record\'s "A&H desk acceptance" row is unproven and interop.html carries no phrase behind its words'
      )
    ])
  })

  it('names the proved claim a page hands the phrase to', () => {
    const marked = new Map(LIVE.pages)
    marked.set(
      'interop.html',
      (marked.get('interop.html') ?? '').replace('An ETC Eos desk,', `An ETC Eos desk ${NOT_YET_PROVED},`)
    )
    expect(declarationProblems(LIVE.declarations, LIVE.claims, marked)).toEqual([
      expect.stringContaining(
        'the copy\'s "Eos desk acceptance" claim is proved on the vendor lane, and interop.html carries the phrase'
      )
    ])
  })

  it('counts a page phrases against the claims its declaration marks', () => {
    const extra = new Map(LIVE.pages)
    extra.set('interop.html', `${extra.get('interop.html') ?? ''} ${NOT_YET_PROVED}`)
    expect(phraseCountProblems(LIVE.declarations, LIVE.claims, extra)).toEqual([
      expect.stringContaining('interop.html carries the phrase 3 time(s) for the 2 claim(s)')
    ])
  })

  it('names a claim whose words a page carries twice', () => {
    const twice = new Map(LIVE.pages)
    twice.set('interop.html', `${twice.get('interop.html') ?? ''} an Allen &amp; Heath SQ or Avantis`)
    expect(declarationProblems(LIVE.declarations, LIVE.claims, twice)).toEqual([
      expect.stringContaining(
        'the copy\'s "A&H desk acceptance" claim is declared at "an Allen &amp; Heath SQ or Avantis" on interop.html, and that page carries those words 2 times'
      )
    ])
  })

  it('names a claim declared twice on one page', () => {
    expect(repeatedDeclarationProblems([...LIVE.declarations, LIVE.declarations[0]])).toEqual([
      expect.stringContaining('declares "interop.html Eos desk acceptance" 2 times')
    ])
  })
})

/**
 * The guard reads the record, and a record it cannot read is a failure rather than an empty
 * pass: a claim compared against nothing is the vacuous run the record exists to prevent.
 * catalog.ts holds the reader the free/Pro guard reads its record through, so a renamed table
 * fails both the same way.
 */
describe('the record the guard reads', () => {
  it('fails loudly when the record is not at the path it names', () => {
    expect(() => readRecord(`${RECORD}.moved`)).toThrow('the published record could not be read at')
  })

  it('fails loudly on a record whose tables are renamed, malformed or absent', () => {
    expect(() => lanesOf('# nothing to read here')).toThrow(
      'carries no "Lane | Workflow | Job | Trigger | Runner | Tag" table'
    )
    expect(() => claimsOf('| Claim | Lane | Status | Evidence |')).toThrow('has no rule line under its header')
    expect(() =>
      claimsOf('| Claim | Lane | Status | Evidence |\n| --- | --- | --- | --- |\n| Firmware equality | — | unclaimed |')
    ).toThrow('has a row of 3 cells where its header has 4')
  })

  it('fails loudly on a workflow the lanes table names and the repository does not hold', () => {
    expect(() => readWorkflow('.github/workflows/lanes.yml')).toThrow(
      'names .github/workflows/lanes.yml, which cannot be read'
    )
  })

  it('fails loudly on a page the copy declares and the site does not render', () => {
    expect(() => pagesOf([{ page: 'lanes.html', claim: 'x', lane: 'peers', words: 'x' }])).toThrow(
      'declares a claim on lanes.html, and website/docs/pages.mjs renders no such page'
    )
  })
})
