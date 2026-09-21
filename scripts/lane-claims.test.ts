// The lane claims, held to the workflows that run them and to the copy that states them.
//
// `_bmad-output/specs/spec-cuerunner/quality-and-proof.md` is the record: two tables saying
// where each lane runs and which claim each lane carries today. The harness decides what a lane
// may claim (INTEGRATION-HARNESS.md §2, §11); the record says what each claim's status is; the
// page modules keep their own words — website/docs/lane-claims.mjs is the copy's side of the
// record — and `scripts/lane-status.mjs` is the run's: the lane words, the tag-to-lane binding,
// the claim the ASIO lane reports and the report both producers leave behind. This guard holds
// the last three to the first's YAML facts: a lane row to its workflow file, the suite it names
// and the runner it runs on (the `e2e` job's Windows half included, whose runner is the matrix
// entry its step's `if:` selects), a claim's evidence to the lane's own job — the capture it
// replays, the report its run writes, the gate it sets — and a proved row's to what the
// repository holds, the phrase to the claims no lane has carried, and the run's vocabulary to
// the record's words, so a claim cannot outrun the lane behind it (AD-24).
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
// @ts-ignore — js file, no type declarations
import {
  ASIO_CLAIM,
  ASIO_LANE,
  CLAIM_STATUSES,
  LANES as RUN_LANES,
  LANE_STATUSES,
  SUITE_REPORT,
  TAG_LANES,
  UNTAGGED_LANE
} from './lane-status.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

/** The record this guard reads: the companion whose subtitle is "which lane owns which claim". */
const RECORD = path.join(root, '_bmad-output', 'specs', 'spec-cuerunner', 'quality-and-proof.md')

/** The lanes table's header, as the record spells it: a renamed column is not this table. */
const LANES_HEADER = ['Lane', 'Workflow', 'Job', 'Trigger', 'Runner', 'Tag', 'Suite'] as const

/** The claims table's header, and the three words its status column may hold. */
const CLAIMS_HEADER = ['Claim', 'Lane', 'Status', 'Evidence'] as const
const STATUSES: Record<string, true> = { proved: true, unproven: true, unclaimed: true }

/** The mark the lane column carries for a claim no lane carries, and the paths evidence names. */
const NO_LANE = '—'
const CAPTURE = /integration\/fixtures\/[\w./-]+\.json/g
const REPORT = /test-results\/[\w./-]+\.json/g

/**
 * The labels that name a kind of runner rather than one machine: what a homelab label list
 * carries before its own name (`[self-hosted, windows, x64, win-ci]`). A proved row has to name
 * one label outside these, because "a Windows runner" is not a machine a reader can go and look
 * at, and `windows` alone would satisfy a check about naming the machine.
 */
const RUNNER_KINDS = ['self-hosted', 'linux', 'windows', 'macos', 'x64', 'arm64']

/** The integration suite's Playwright config, and the reporter this guard holds it to registering. */
const INTEGRATION_CONFIG = 'integration/playwright.config.ts'
const REPORTER = 'lane-status.reporter.ts'

/** The two shapes a workflow gate is written in: an environment variable, and a `workflow_dispatch` input. */
const SCREAMING = /^[A-Z][A-Z0-9_]{2,}$/
const SNAKE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/

/** The labels a runner cell states, markdown's own brackets off it. */
function labelsOf(runner: string): string[] {
  return runner
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((label) => label.trim())
    .filter((label) => label !== '')
}

/** One row of the record's lanes table, read as the columns it sits under. */
interface Lane {
  lane: string
  workflow: string
  job: string
  trigger: string
  runner: string
  tag: string
  suite: string
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
    const [lane, workflow, job, trigger, runner, tag, suite] = row.map((cell) => cell.replace(/[`*]/g, '').trim())
    return { lane, workflow, job, trigger, runner, tag, suite }
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
 * The label list a value states — `[self-hosted, linux, x64, ubox]` — or nothing when this guard
 * cannot read it as one, so a matrix expression comes back unread rather than as a list of
 * nothing.
 */
function labelList(value: string): string[] | null {
  if (!value.startsWith('[') || !value.endsWith(']')) return null
  return value.slice(1, -1).split(',').map((label) => label.trim()).filter((label) => label !== '')
}

/**
 * The label list a job's `runs-on` states, and the line it sits on — or nothing when the job
 * carries no `runs-on` at all. A value this guard cannot read as a label list — a matrix
 * expression, say — comes back with `labels` null: the caller resolves it through the step that
 * names the entry, or says it cannot.
 */
function runsOn(block: { line: number; lines: string[] }): { line: number; labels: string[] | null } | null {
  for (const [index, line] of block.lines.entries()) {
    const setting = /^\s*runs-on:\s*(.*?)\s*$/.exec(line)
    if (setting === null) continue
    return { line: block.line + index, labels: labelList(setting[1]) }
  }
  return null
}

/** One entry of a job's `matrix.include:`, as its own lines: which labels and which runner it names. */
interface MatrixEntry {
  line: number
  lines: string[]
}

/**
 * The `include:` entries of a job's matrix, in file order. A job whose matrix this guard cannot
 * read as a list of entries comes back with none, and the caller says so rather than guessing.
 */
function matrixEntries(block: { line: number; lines: string[] }): MatrixEntry[] {
  const start = block.lines.findIndex((line) => /^\s*matrix:\s*$/.test(line))
  if (start === -1) return []
  const include = block.lines.findIndex((line, index) => index > start && /^\s*include:\s*$/.test(line))
  if (include === -1) return []
  const includeIndent = block.lines[include].length - block.lines[include].trimStart().length
  const entries: MatrixEntry[] = []
  let entry: MatrixEntry | null = null
  for (let line = include + 1; line < block.lines.length; line++) {
    const text = block.lines[line]
    if (text.trim() === '') continue
    // A line that leaves the entries' own level ends the list: the matrix is over.
    if (text.length - text.trimStart().length <= includeIndent) break
    if (/^\s*-\s+\S/.test(text)) {
      entry = { line: block.line + line, lines: [] }
      entries.push(entry)
    }
    if (entry !== null) entry.lines.push(text)
  }
  return entries
}

/** The step a job runs a command in: its own lines, the line its `run:` sits on, and that command. */
interface Step {
  line: number
  lines: string[]
  command: string
}

/**
 * Every `run:` step of a job: the command it runs — a `|` or `>` block scalar's lines included —
 * the line that command sits on, and the step's own lines. Only a real `run:` line counts, so a
 * commented-out one is not a lane's suite, and the step's lines are what a check reads its `if:`
 * and its `--grep` from.
 */
function runSteps(block: { line: number; lines: string[] }): Step[] {
  const steps: Step[] = []
  for (const [index, line] of block.lines.entries()) {
    const run = /^\s*(?:-\s+)?run:\s*(.*?)\s*$/.exec(line)
    if (run === null) continue
    let said = run[1]
    if (/^[|>][-+]?$/.test(said)) {
      const indent = line.length - line.trimStart().length
      const script: string[] = []
      for (let after = index + 1; after < block.lines.length; after++) {
        const next = block.lines[after]
        if (next.trim() !== '' && next.length - next.trimStart().length <= indent) break
        script.push(next)
      }
      said = script.join('\n')
    }
    // The step starts at its own `- ` marker, or at the top of the job when the first `run:` is
    // a bare one; it ends where the next step begins.
    let start = 0
    for (let before = index; before >= 0; before--) {
      if (/^\s*-\s+\S/.test(block.lines[before])) {
        start = before
        break
      }
    }
    let end = block.lines.length
    for (let after = index + 1; after < block.lines.length; after++) {
      if (/^\s*-\s+\S/.test(block.lines[after])) {
        end = after
        break
      }
    }
    steps.push({ line: block.line + index, lines: block.lines.slice(start, end), command: said })
  }
  return steps
}

/** The step a job runs a command in, or nothing when no step of it runs that command. */
function stepFor(block: { line: number; lines: string[] }, command: string): Step | null {
  return runSteps(block).find((step) => step.command.includes(command)) ?? null
}

/** One artifact upload of a job: the paths it names, and whether it runs whatever the job's outcome. */
interface Upload {
  line: number
  paths: string[]
  always: boolean
}

/**
 * Every `actions/upload-artifact` step of a job: the paths it names — an inline value or a block
 * scalar's lines — and whether it runs on a green run too. A report a workflow keeps only when
 * the job failed is a report a reader of a green run never sees, which is the state the lane
 * statuses exist to end, so both are read here rather than the paths alone.
 */
function uploadSteps(block: { line: number; lines: string[] }): Upload[] {
  const uploads: Upload[] = []
  for (const [index, text] of block.lines.entries()) {
    if (!/^\s*uses:\s*actions\/upload-artifact@/.test(text)) continue
    let start = 0
    for (let before = index; before >= 0; before--) {
      if (/^\s*-\s+\S/.test(block.lines[before])) {
        start = before
        break
      }
    }
    let end = block.lines.length
    for (let after = index + 1; after < block.lines.length; after++) {
      if (/^\s*-\s+\S/.test(block.lines[after])) {
        end = after
        break
      }
    }
    const lines = block.lines.slice(start, end)
    const paths: string[] = []
    for (let line = 0; line < lines.length; line++) {
      const said = /^\s*(?:-\s+)?path:\s*(.*?)\s*$/.exec(lines[line])
      if (said === null) continue
      if (!/^[|>][-+]?$/.test(said[1])) {
        paths.push(said[1])
        continue
      }
      const indent = lines[line].length - lines[line].trimStart().length
      for (let after = line + 1; after < lines.length; after++) {
        if (lines[after].trim() === '') continue
        if (lines[after].length - lines[after].trimStart().length <= indent) break
        paths.push(lines[after].trim())
      }
    }
    const condition = lines.map((line) => /^\s*if:\s*(.*?)\s*$/.exec(line)?.[1]).find((said) => said !== undefined)
    uploads.push({ line: block.line + start, paths, always: condition === undefined || condition === 'always()' })
  }
  return uploads
}

/**
 * The runner a matrix job's step resolves to: the entry whose `label:` the step's own `if:`
 * names — the `e2e` job's Windows step says `runner.os == 'Windows'`, and the entry labelled
 * `windows` carries the runner that half runs on — read for its `runner:` label list, with the
 * line that list sits on. A condition this guard cannot read, an entry no label matches, or an
 * entry with no `runner:` comes back with `labels` null and a `why` the caller puts in its
 * failure, because a runner read off nothing would pass against anything.
 */
function matrixRunner(
  block: { line: number; lines: string[] },
  step: Step
): { line: number; labels: string[] | null; why: string } {
  let condition = ''
  for (const text of step.lines) {
    const said = /^\s*if:\s*(.*?)\s*$/.exec(text)
    if (said !== null) {
      condition = said[1]
      break
    }
  }
  const named = condition === '' ? null : /runner\.os\s*==\s*['"]([\w-]+)['"]/.exec(condition)
  if (named === null) {
    return {
      line: step.line,
      labels: null,
      why: `the step running \`${step.command.split('\n')[0]}\` (${step.line + 1}) states ${
        condition === '' ? 'no `if:`' : `\`if: ${condition}\``
      }, which names no matrix label`
    }
  }
  const label = named[1].toLowerCase()
  let entry: MatrixEntry | null = null
  for (const candidate of matrixEntries(block)) {
    if (candidate.lines.some((text) => new RegExp(`^\\s*(?:-\\s+)?label:\\s*${label}\\s*$`, 'i').test(text))) {
      entry = candidate
      break
    }
  }
  if (entry === null) {
    return {
      line: step.line,
      labels: null,
      why: `\`if: ${condition}\` names the matrix label ${label}, and no include entry carries it`
    }
  }
  const said = `${entry.line + 1}`
  for (const [index, text] of entry.lines.entries()) {
    const runner = /^\s*(?:-\s+)?runner:\s*(.*?)\s*$/.exec(text)
    if (runner === null) continue
    const labels = labelList(runner[1])
    return labels === null
      ? {
          line: entry.line + index,
          labels: null,
          why: `the entry labelled ${label} (${said}) carries a \`runner:\` this guard does not read as a label list`
        }
      : { line: entry.line + index, labels, why: '' }
  }
  return {
    line: entry.line,
    labels: null,
    why: `the entry labelled ${label} (${said}) declares no \`runner:\``
  }
}

/**
 * The record's lanes table against the workflows it names. Every row is held to the file it
 * points at: the job has to be declared there, the `on:` kinds have to be the ones the row
 * states, the job's `runs-on` the runner — or, where the job runs a matrix, the entry the
 * suite's own step selects — and the `run:` step that runs the row's suite has to carry the
 * row's tag and no other. Both sides are named — the row and the workflow line — because that
 * is what a reader needs to fix it.
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
    const suite = stepFor(block, entry.suite)
    if (suite === null) {
      problems.push(
        `the record's \`${entry.lane}\` lane row names \`${entry.suite}\` as the suite, and no \`run:\` step of ${entry.workflow}'s \`${entry.job}\` job runs it`
      )
    }
    const runner = runsOn(block)
    const statedLabels = labelsOf(entry.runner)
    const same = (labels: string[]): boolean =>
      [...new Set(statedLabels)].sort().join(', ') === [...new Set(labels)].sort().join(', ')
    if (runner !== null && runner.labels !== null) {
      if (!same(runner.labels)) {
        problems.push(
          `the record's \`${entry.lane}\` lane row names ${entry.runner} as the runner, and ${entry.workflow}:${runner.line} declares [${runner.labels.join(', ')}]`
        )
      }
    } else if (runner === null) {
      problems.push(
        `the record's \`${entry.lane}\` lane row names ${entry.runner} as the runner, and ${entry.workflow}'s \`${entry.job}\` job declares no \`runs-on\``
      )
    } else if (suite === null) {
      problems.push(
        `the record's \`${entry.lane}\` lane row names ${entry.runner} as the runner, and ${entry.workflow}'s \`${entry.job}\` job runs on a matrix (${entry.workflow}:${runner.line}) with no \`${entry.suite}\` step to read the entry from`
      )
    } else {
      const resolved = matrixRunner(block, suite)
      if (resolved.labels === null) {
        problems.push(
          `the record's \`${entry.lane}\` lane row names ${entry.runner} as the runner, and the step running \`${entry.suite}\` selects a matrix entry this guard cannot read: ${resolved.why} (${entry.workflow}:${resolved.line})`
        )
      } else if (!same(resolved.labels)) {
        problems.push(
          `the record's \`${entry.lane}\` lane row names ${entry.runner} as the runner, and the matrix entry the \`${entry.suite}\` step selects declares [${resolved.labels.join(', ')}] (${entry.workflow}:${resolved.line})`
        )
      }
    }
    if (suite !== null) {
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
      return {
        entry,
        lines: block?.lines ?? [],
        runs: block === null ? [] : runSteps(block).map((step) => step.command)
      }
    })
    const where = rows.map((entry) => `${entry.workflow}'s \`${entry.job}\` job`).join(', ')
    for (const capture of [...new Set([...claim.evidence.matchAll(CAPTURE)].map((match) => match[0]))]) {
      if (jobs.some((job) => job.lines.some((line) => line.includes(capture)))) continue
      problems.push(
        `the record's "${claim.claim}" row rests on ${capture}, and none of the ${claim.lane} lane's own jobs names it (${where})`
      )
    }
    for (const report of [...new Set([...claim.evidence.matchAll(REPORT)].map((match) => match[0]))]) {
      // A `run:` step, not any line of the job: an upload step names the report too, and an
      // artifact path is not what wrote the file.
      if (jobs.some((job) => job.runs.some((command) => command.includes(report)))) continue
      problems.push(
        `the record's "${claim.claim}" row rests on ${report}, and no \`run:\` step of the ${claim.lane} lane's own jobs writes it (${where})`
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
 *
 * A proved row whose evidence is a run rather than a committed capture — the ASIO lane's, whose
 * driver belongs to the machine — is held by `reportEvidenceProblems` instead.
 */
function provedEvidenceProblems(
  claims: Claim[],
  captures: Map<string, string>,
  lanes: Lane[]
): string[] {
  return claims.flatMap((claim) => {
    if (statusOf(claim) !== 'proved') return []
    const files = [...new Set([...claim.evidence.matchAll(CAPTURE)].map((match) => match[0]))]
    const reports = [...new Set([...claim.evidence.matchAll(REPORT)].map((match) => match[0]))]
    if (files.length === 0 && reports.length === 0) {
      return [
        `the record's "${claim.claim}" row is proved and its evidence names neither a capture under integration/fixtures nor a report a lane writes: nothing in the repository is held to it`
      ]
    }
    // Both halves are checked when both are named: a row that rests on a capture and on a run
    // is held to each of them, not to whichever this guard happened to read first.
    return [...files.flatMap((file) => {
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
    }), ...reportEvidenceProblems(claim, reports, lanes)]
  })
}

/**
 * The run half of a proved row's evidence: the lane's own report, whose driver belongs to the
 * machine and no fixture can stand for. What the repository can hold is that the row names a
 * report, that the report is one the lane's own job writes (checked where the captures are) and
 * that the row names the machine that run happened on: the labels a homelab runner carries
 * before its own name are a kind of machine, and a claim proved on a machine nobody can name is
 * not evidence.
 */
function reportEvidenceProblems(claim: Claim, reports: string[], lanes: Lane[]): string[] {
  if (reports.length === 0) return []
  const machines = [
    ...new Set(
      lanes
        .filter((entry) => entry.lane === claim.lane)
        .flatMap((entry) => labelsOf(entry.runner))
        .filter((label) => !RUNNER_KINDS.includes(label))
    )
  ]
  if (machines.length > 0 && !machines.some((label) => claim.evidence.includes(label))) {
    return [
      `the record's "${claim.claim}" row is proved on a run, and its evidence names no machine that run happened on: the \`${claim.lane}\` lane runs on ${machines.join(', ')}, and a kind of runner is not a machine a reader can go and look at`
    ]
  }
  return []
}

/**
 * The suite's reporter, held to the config that registers it, and every report a workflow keeps,
 * held to the path a producer in that job writes. The `integration` job uploads what
 * `lane-status.reporter.ts` writes, so a config that stopped registering it would leave that
 * upload naming a file nothing produces; an upload path no `run:` step writes is an artifact a
 * reader opens and finds empty; and a job that runs the suite — or asks a lane for a report —
 * has to keep it in an upload that runs on a green run too, because a status a failing job keeps
 * and a passing one drops is the state the lane statuses exist to end (AD-24).
 */
function laneUploadProblems(lanes: Lane[], workflows: Map<string, string>): string[] {
  return lanes.flatMap((entry) => {
    const yaml = workflows.get(entry.workflow)
    if (yaml === undefined) return []
    const block = jobLines(yaml, entry.job, entry.workflow)
    if (block === null) return []
    const runs = runSteps(block).map((step) => step.command)
    const asked = [
      ...new Set(runs.flatMap((command) => [...command.matchAll(/--report\s+(\S+)/g)].map((match) => match[1])))
    ]
    const uploads = uploadSteps(block)
    const kept = (path: string): boolean =>
      uploads.some(
        (upload) =>
          upload.always &&
          upload.paths.some(
            (said) => said === path || said === 'test-results' || (said.endsWith('/') && path.startsWith(said))
          )
      )
    const problems = uploads
      .flatMap((upload) => upload.paths)
      .filter((path) => !path.endsWith('/'))
      .filter((path) => path !== SUITE_REPORT && !asked.includes(path))
      .map(
        (path) =>
          `the record's \`${entry.lane}\` lane row is a lane of ${entry.workflow}'s \`${entry.job}\` job, whose upload step names ${path}: no \`run:\` step of that job writes it (the suite writes ${SUITE_REPORT}, and a lane's own report is what its own step passes to \`--report\`)`
      )
    if (runs.some((command) => command.includes('npm run test:integration')) && !kept(SUITE_REPORT)) {
      problems.push(
        `the record's \`${entry.lane}\` lane row is a lane of ${entry.workflow}'s \`${entry.job}\` job, which runs the suite and keeps no ${SUITE_REPORT} on a green run: the run's own statuses would not survive it`
      )
    }
    for (const path of asked) {
      if (kept(path)) continue
      problems.push(
        `the record's \`${entry.lane}\` lane row is a lane of ${entry.workflow}'s \`${entry.job}\` job, which asks a lane for ${path} and uploads nothing an always-running step carries it in: a status left in the job summary alone is gone when the log scrolls`
      )
    }
    return problems
  })
}

/** The integration suite's Playwright config, read whole: a config this guard cannot read is loud. */
function readIntegrationConfig(): string {
  try {
    return fs.readFileSync(path.join(root, INTEGRATION_CONFIG), 'utf-8')
  } catch (cause) {
    throw new Error(
      `lane claims: ${INTEGRATION_CONFIG} cannot be read (${(cause as Error).message}): the suite's reporter is registered there, and this guard checks that it still is`
    )
  }
}

/**
 * The registration itself: the config has to name the reporter module, and it may not hand it a
 * report path other than the one the workflows upload — a registration that writes somewhere
 * else leaves the uploaded artifact a run behind.
 */
function registrationProblems(config: string): string[] {
  const problems: string[] = []
  if (!config.includes(REPORTER)) {
    problems.push(
      `${INTEGRATION_CONFIG} registers no ${REPORTER}: the suite reports its lanes through it, and without the registration a job writes no status at all`
    )
  }
  const override = /report:\s*['"]([^'"]+)['"]/.exec(config)?.[1]
  if (override !== undefined && override !== SUITE_REPORT) {
    problems.push(
      `${INTEGRATION_CONFIG} hands ${REPORTER} the report path ${override}, and the workflows upload ${SUITE_REPORT}: the run's statuses would land where nothing fetches them`
    )
  }
  return problems
}

/**
 * The lanes the run's vocabulary names, held both ways to the record's lanes table: a lane a
 * report can speak about is one the record declares, and every lane the record declares is one
 * the report can speak about. A lane row with no name in the module is a lane whose statuses
 * nothing can report; a name with no row is a report of a lane a reader cannot look up.
 */
function laneVocabularyProblems(lanes: Lane[]): string[] {
  const declared = [...new Set(lanes.map((entry) => entry.lane))]
  return [
    ...RUN_LANES.filter((lane: string) => !declared.includes(lane)).map(
      (lane: string) =>
        `scripts/lane-status.mjs names the \`${lane}\` lane, and the record's lanes table declares no lane of that name (${declared.join(', ')})`
    ),
    ...declared
      .filter((lane) => !RUN_LANES.includes(lane))
      .map(
        (lane) =>
          `the record's lanes table declares the \`${lane}\` lane, and scripts/lane-status.mjs names no lane of that name (${RUN_LANES.join(', ')})`
      )
  ]
}

/**
 * The tag-to-lane binding, held both ways to the record's lanes table: every tag a lane row
 * carries is one the run binds to that row's lane, and every tag the run binds is one the record
 * writes down. A test's tag is what its job selects it by, so a tag bound to the wrong lane — or
 * to no lane the record names — is a status filed under the wrong claim. The lane an untagged
 * test belongs to has to be a lane the record rows untagged, which is the row whose job greps
 * nothing.
 */
function tagBindingProblems(lanes: Lane[]): string[] {
  const problems: string[] = []
  for (const entry of lanes) {
    if (entry.tag === NO_LANE) continue
    const bound: string | undefined = TAG_LANES[entry.tag]
    if (bound === undefined) {
      problems.push(
        `the record's \`${entry.lane}\` lane row carries the tag ${entry.tag}, and scripts/lane-status.mjs binds no lane to it`
      )
    } else if (bound !== entry.lane) {
      problems.push(
        `the record's \`${entry.lane}\` lane row carries the tag ${entry.tag}, and scripts/lane-status.mjs binds it to the \`${bound}\` lane`
      )
    }
  }
  for (const tag of Object.keys(TAG_LANES)) {
    if (!lanes.some((entry) => entry.tag === tag)) {
      problems.push(
        `scripts/lane-status.mjs binds ${tag} to the \`${TAG_LANES[tag]}\` lane, and the record's lanes table carries no row with that tag`
      )
    }
  }
  if (!lanes.some((entry) => entry.lane === UNTAGGED_LANE && entry.tag === NO_LANE)) {
    problems.push(
      `scripts/lane-status.mjs gives a test with no tag to the \`${UNTAGGED_LANE}\` lane, and the record carries no untagged row for it`
    )
  }
  return problems
}

/**
 * The words a run may state, held to the record's: the two vocabularies are deliberately
 * different — a run says what it did, the record says what may be claimed — so a word doing both
 * jobs is how a lane that skipped starts reading as a claim that holds.
 */
function laneWordProblems(claims: Claim[]): string[] {
  const claimWords = new Set(claims.map((claim) => statusOf(claim)))
  return LANE_STATUSES.filter((word: string) => claimWords.has(word)).map(
    (word: string) =>
      `scripts/lane-status.mjs states a lane's status as "${word}", and the record states a claim's status in the same word: the run's words and the record's are two vocabularies`
  )
}

/**
 * The claim the ASIO lane reports and the words it may state for it, held to the record: the
 * claim has to be one of its rows, on the lane that reports it, and the words have to be the
 * record's own three — the lane states a run's status in the record's vocabulary, so a word the
 * record does not use is a status no reader of the record can look up.
 */
function claimVocabularyProblems(claims: Claim[]): string[] {
  const problems: string[] = []
  const row = claims.find((claim) => claim.claim === ASIO_CLAIM)
  if (row === undefined) {
    problems.push(
      `scripts/lane-status.mjs reports the claim "${ASIO_CLAIM}", and the record's claims table has no row by that name`
    )
  } else if (row.lane !== ASIO_LANE) {
    problems.push(
      `scripts/lane-status.mjs reports the claim "${ASIO_CLAIM}" for the \`${ASIO_LANE}\` lane, and the record's row for it names ${row.lane} as its lane`
    )
  }
  const stated = [...new Set(claims.map((claim) => statusOf(claim)))]
  for (const word of CLAIM_STATUSES) {
    if (!stated.includes(word)) {
      problems.push(
        `scripts/lane-status.mjs states the claim status "${word}", and the record's claims table writes no row in it (${stated.join(', ')})`
      )
    }
  }
  for (const word of stated) {
    if (!CLAIM_STATUSES.includes(word)) {
      problems.push(
        `the record states the claim status "${word}", and scripts/lane-status.mjs declares no word of that name (${CLAIM_STATUSES.join(', ')})`
      )
    }
  }
  return problems
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
  config: string
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
  config: readIntegrationConfig(),
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

  it('holds every lane row to the workflow, job, trigger, runner, tag and suite it names', () => {
    expect(laneProblems(LIVE.lanes, LIVE.workflows)).toEqual([])
  })

  it('names the lanes the run can report, and only those', () => {
    expect(laneVocabularyProblems(LIVE.lanes)).toEqual([])
  })

  it('binds every tag to the lane the record gives it', () => {
    expect(tagBindingProblems(LIVE.lanes)).toEqual([])
  })

  it('states a run in words the record does not state a claim in', () => {
    expect(laneWordProblems(LIVE.claims)).toEqual([])
  })

  it('reports the ASIO claim on the lane the record gives it, in the record words', () => {
    expect(claimVocabularyProblems(LIVE.claims)).toEqual([])
  })

  it('registers the suite reporter, and uploads what the lanes write', () => {
    expect(registrationProblems(LIVE.config)).toEqual([])
    expect(laneUploadProblems(LIVE.lanes, LIVE.workflows)).toEqual([])
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

  it('holds every proved row to the capture or the report its evidence names', () => {
    expect(provedEvidenceProblems(LIVE.claims, LIVE.captures, LIVE.lanes)).toEqual([])
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
        "the record's `peers` lane row names `npm run test:integration` as the suite, and no `run:` step of .github/workflows/ci.yml's `integration` job runs it"
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
        "the record's `peers` lane row names `npm run test:integration` as the suite, and no `run:` step of .github/workflows/ci.yml's `unit-test` job runs it"
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

  it('names a lane the run reports that the record does not declare', () => {
    const without = LIVE.lanes.filter((entry) => entry.lane !== 'asio')
    expect(laneVocabularyProblems(without)).toEqual([
      expect.stringContaining(
        'scripts/lane-status.mjs names the `asio` lane, and the record\'s lanes table declares no lane of that name (peers, vendor, hardware)'
      )
    ])
  })

  it('names a lane the record declares that the run cannot report', () => {
    const extra = [...LIVE.lanes, { ...LIVE.lanes[0], lane: 'nightly' }]
    expect(laneVocabularyProblems(extra)).toEqual([
      expect.stringContaining(
        'the record\'s lanes table declares the `nightly` lane, and scripts/lane-status.mjs names no lane of that name'
      )
    ])
  })

  it('names a tag the run binds to a lane the record gives it to another one', () => {
    const swapped = LIVE.lanes.map((entry) => (entry.tag === '@ah' ? { ...entry, lane: 'peers' } : entry))
    expect(tagBindingProblems(swapped)).toEqual([
      expect.stringContaining('the record\'s `peers` lane row carries the tag @ah, and scripts/lane-status.mjs binds it to the `vendor` lane')
    ])
  })

  it('names a tag the record carries and the run binds to nothing', () => {
    const renamed = LIVE.lanes.map((entry) => (entry.tag === '@hardware' ? { ...entry, tag: '@desk' } : entry))
    expect(tagBindingProblems(renamed)).toEqual([
      expect.stringContaining('the record\'s `hardware` lane row carries the tag @desk, and scripts/lane-status.mjs binds no lane to it'),
      expect.stringContaining('scripts/lane-status.mjs binds @hardware to the `hardware` lane, and the record\'s lanes table carries no row with that tag')
    ])
  })

  it('names a lane word the record states a claim in', () => {
    const same = LIVE.claims.map((claim) => (claim.claim === 'Firmware equality' ? { ...claim, status: 'skipped' } : claim))
    expect(laneWordProblems(same)).toEqual([
      expect.stringContaining(
        'scripts/lane-status.mjs states a lane\'s status as "skipped", and the record states a claim\'s status in the same word'
      )
    ])
  })

  it('names the ASIO claim the record does not carry, or carries on another lane', () => {
    const renamed = LIVE.claims.map((claim) => (claim.claim === ASIO_CLAIM ? { ...claim, claim: 'Driver hosting' } : claim))
    expect(claimVocabularyProblems(renamed)).toEqual([
      expect.stringContaining(`scripts/lane-status.mjs reports the claim "${ASIO_CLAIM}", and the record's claims table has no row by that name`)
    ])
    const moved = LIVE.claims.map((claim) => (claim.claim === ASIO_CLAIM ? { ...claim, lane: 'hardware' } : claim))
    expect(claimVocabularyProblems(moved)).toEqual([
      expect.stringContaining(`the record's row for it names hardware as its lane`)
    ])
  })

  it('names a claim word the run cannot state, and a word the record never writes', () => {
    const invented = LIVE.claims.map((claim) =>
      claim.claim === 'A&H desk acceptance' ? { ...claim, status: 'unverified' } : claim
    )
    expect(claimVocabularyProblems(invented)).toEqual([
      expect.stringContaining(
        'the record states the claim status "unverified", and scripts/lane-status.mjs declares no word of that name (proved, unproven, unclaimed)'
      )
    ])
    // A record that writes only one of the three: the ASIO lane would report statuses no row of
    // the record can be looked up under.
    const thin = [{ claim: ASIO_CLAIM, lane: ASIO_LANE, status: 'proved', evidence: '' }]
    expect(claimVocabularyProblems(thin)).toEqual([
      expect.stringContaining('scripts/lane-status.mjs states the claim status "unproven", and the record\'s claims table writes no row in it'),
      expect.stringContaining('scripts/lane-status.mjs states the claim status "unclaimed", and the record\'s claims table writes no row in it')
    ])
  })

  it('names a row held to a runner another matrix entry carries', () => {
    const moved = LIVE.lanes.map((entry) => (entry.lane === 'asio' ? { ...entry, runner: '[self-hosted, linux, x64, ubox]' } : entry))
    const problems = laneProblems(moved, LIVE.workflows)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain(
      'the record\'s `asio` lane row names [self-hosted, linux, x64, ubox] as the runner, and the matrix entry the `npm run test:native:asio` step selects declares [self-hosted, windows, x64, win-ci]'
    )
    expect(problems[0], 'the failure names the workflow line').toMatch(/ci\.yml:\d+/)
  })

  it('names a matrix job whose step selects no entry this guard can read', () => {
    const ci = '.github/workflows/ci.yml'
    const blind = new Map(LIVE.workflows)
    blind.set(ci, (blind.get(ci) ?? '').replace("if: runner.os == 'Windows'\n        shell: cmd\n        run: |\n          if \"%CUERUNNER_ASIO_SDK%\"", "if: runner.os == 'FreeBSD'\n        shell: cmd\n        run: |\n          if \"%CUERUNNER_ASIO_SDK%\""))
    const problems = laneProblems(LIVE.lanes, blind)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain("names the matrix label freebsd, and no include entry carries it")
  })

  it('names a proved row resting on a report no lane job writes', () => {
    const moved = LIVE.claims.map((claim) =>
      claim.claim === ASIO_CLAIM
        ? { ...claim, evidence: claim.evidence.replace('test-results/asio-lane.json', 'test-results/asio-gone.json') }
        : claim
    )
    expect(laneEvidenceProblems(moved, LIVE.lanes, LIVE.workflows)).toEqual([
      expect.stringContaining(
        "the record's \"ASIO hosting\" row rests on test-results/asio-gone.json, and no `run:` step of the asio lane's own jobs writes it"
      )
    ])
  })

  it('names a proved row whose evidence names the machine it ran on nowhere', () => {
    const nameless = LIVE.claims.map((claim) =>
      claim.claim === ASIO_CLAIM
        ? { ...claim, evidence: 'the run left `test-results/asio-lane.json` behind' }
        : claim
    )
    expect(provedEvidenceProblems(nameless, LIVE.captures, LIVE.lanes)).toEqual([
      expect.stringContaining(
        'the record\'s "ASIO hosting" row is proved on a run, and its evidence names no machine that run happened on'
      )
    ])
  })

  it('names a proved row whose evidence names only a kind of runner', () => {
    const kindOnly = LIVE.claims.map((claim) =>
      claim.claim === ASIO_CLAIM ? { ...claim, evidence: claim.evidence.replace('`win-ci`', '`windows`') } : claim
    )
    const problems = provedEvidenceProblems(kindOnly, LIVE.captures, LIVE.lanes)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain(
      'the record\'s "ASIO hosting" row is proved on a run, and its evidence names no machine that run happened on'
    )
    expect(problems[0]).toContain('win-ci')
  })

  it('names a row whose report an upload step names and no `run:` step writes', () => {
    const ci = '.github/workflows/ci.yml'
    const unasked = new Map(LIVE.workflows)
    unasked.set(ci, (unasked.get(ci) ?? '').replaceAll(' --report test-results/asio-lane.json', ''))
    expect(laneEvidenceProblems(LIVE.claims, LIVE.lanes, unasked)).toEqual([
      expect.stringContaining(
        "the record's \"ASIO hosting\" row rests on test-results/asio-lane.json, and no `run:` step of the asio lane's own jobs writes it"
      )
    ])
  })

  it('names an upload step whose path no `run:` step of the job writes', () => {
    const ci = '.github/workflows/ci.yml'
    const moved = new Map(LIVE.workflows)
    moved.set(
      ci,
      (moved.get(ci) ?? '').replace('path: test-results/asio-lane.json', 'path: test-results/asio-not-written.json')
    )
    // The renamed path is one nothing writes, and the report the step asked for is no longer
    // kept: the same one edit, and both halves of the check say so.
    expect(laneUploadProblems(LIVE.lanes, moved)).toEqual([
      expect.stringContaining('whose upload step names test-results/asio-not-written.json: no `run:` step of that job writes it'),
      expect.stringContaining('asks a lane for test-results/asio-lane.json and uploads nothing an always-running step carries it in')
    ])
  })

  it('names a job that asks a lane for a report and uploads nothing that carries it', () => {
    const ci = '.github/workflows/ci.yml'
    const dropped = new Map(LIVE.workflows)
    dropped.set(
      ci,
      (dropped.get(ci) ?? '').replace(
        /\n      # What this lane said about the claim[\s\S]*?retention-days: 7\n/,
        '\n'
      )
    )
    expect(laneUploadProblems(LIVE.lanes, dropped)).toEqual([
      expect.stringContaining('asks a lane for test-results/asio-lane.json and uploads nothing an always-running step carries it in')
    ])
  })

  it('names a job that runs the suite and uploads no suite report', () => {
    const ci = '.github/workflows/ci.yml'
    const without = new Map(LIVE.workflows)
    without.set(
      ci,
      (without.get(ci) ?? '')
        .replace(/\n      # The suite's own report[\s\S]*?retention-days: 7\n/, '\n')
        .replace(
          '          name: integration-results\n          path: test-results/',
          '          name: integration-results\n          path: artifacts/'
        )
    )
    expect(laneUploadProblems(LIVE.lanes, without)).toEqual([
      expect.stringContaining('which runs the suite and keeps no test-results/lane-status.json on a green run')
    ])
  })

  it('names a config that registers no reporter, and one that writes elsewhere', () => {
    expect(registrationProblems('# no reporter here')).toEqual([
      expect.stringContaining('integration/playwright.config.ts registers no lane-status.reporter.ts')
    ])
    expect(registrationProblems(`report: [['./lane-status.reporter.ts', { report: 'somewhere/else.json' }]]`)).toEqual([
      expect.stringContaining('hands lane-status.reporter.ts the report path somewhere/else.json')
    ])
  })

  it('fails loudly on a config the guard cannot read', () => {
    expect(() => readIntegrationConfig()).not.toThrow()
  })

  it('names a proved row whose evidence names neither a capture nor a report', () => {
    const unsourced = LIVE.claims.map((claim) =>
      claim.claim === ASIO_CLAIM ? { ...claim, evidence: 'the lane says it ran once' } : claim
    )
    expect(provedEvidenceProblems(unsourced, LIVE.captures, LIVE.lanes)).toEqual([
      expect.stringContaining(
        'the record\'s "ASIO hosting" row is proved and its evidence names neither a capture under integration/fixtures nor a report a lane writes'
      )
    ])
  })

  it('holds a proved row that names a capture and a report to each of them', () => {
    const both = LIVE.claims.map((claim) =>
      claim.claim === ASIO_CLAIM
        ? {
            ...claim,
            evidence:
              'the capture integration/fixtures/vendor/eos-ubox-win.json holds, and the report test-results/asio-lane.json the lane left'
          }
        : claim
    )
    const problems = provedEvidenceProblems(both, LIVE.captures, LIVE.lanes)
    expect(
      problems.some((problem) => problem.includes('states no `3.3.9.25`')),
      'the capture half is read'
    ).toBe(true)
    expect(
      problems.some((problem) => problem.includes('names no machine that run happened on')),
      'and so is the report half'
    ).toBe(true)
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
    expect(provedEvidenceProblems(moved, LIVE.captures, LIVE.lanes)).toEqual([
      expect.stringContaining(
        'the record\'s "Eos desk acceptance" row is proved on integration/fixtures/vendor/eos-gone.json, which the repository does not hold'
      )
    ])
  })

  it('names both sides when a proved row states a version the capture does not hold', () => {
    const stale = LIVE.claims.map((claim) =>
      claim.claim === 'Eos desk acceptance' ? { ...claim, evidence: claim.evidence.replaceAll('3.3.9.25', '3.2.0.1') } : claim
    )
    expect(provedEvidenceProblems(stale, LIVE.captures, LIVE.lanes)).toEqual([
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
    expect(provedEvidenceProblems(LIVE.claims, appSourced, LIVE.lanes)).toEqual([
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
    expect(provedEvidenceProblems(LIVE.claims, provenanceLess, LIVE.lanes)).toEqual([
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
      { page: 'interop.html', claim: 'Live discovery of Dante devices', lane: 'peers', words: 'the devices that announce themselves' }
    ]
    expect(declarationProblems(invented, LIVE.claims, LIVE.pages)).toEqual([
      expect.stringContaining(
        'declares the claim "Live discovery of Dante devices", and the record\'s claims table has no row by that name'
      )
    ])
  })

  it('names both sides when a declaration stands on a lane the record does not give the claim', () => {
    const peer = LIVE.declarations.map((entry) =>
      entry.claim === 'A&H desk acceptance' && entry.page === 'interop.html' ? { ...entry, lane: 'peers' } : entry
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
      'carries no "Lane | Workflow | Job | Trigger | Runner | Tag | Suite" table'
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
