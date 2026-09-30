// The release path, held to what it says about itself.
//
// The path this replaces published whatever happened to build and said nothing about what that
// was: `build.yml` warned on its own run page, shipped an unsigned installer to the GitHub
// release, mirrored it to the `latest/` the site's download cards point at, and named it signed
// nowhere; the Steinberg agreement that permits publishing a build linked against the ASIO SDK
// was a sentence in the checklist that nothing enforced; and a `workflow_dispatch` from a branch
// was enough to manufacture a release. The workflow now records what each artifact is — from the
// configuration that gates its signing, never from text written beside it — composes a section into
// the notes from those recordings, withholds the ASIO-linked installer until the agreement's record
// is committed, and publishes only from a tag ref. The packaging run itself is started by
// `release.yml`, which dispatches it for the tag semantic-release just cut, because a release
// published with the repository's own token creates no workflow run: that is why no release since
// 2026-07-11 carries installers, and the chain those two files make is asserted here as well.
//
// This guard holds the three halves of that to each other. The workflow's own mechanics — a
// trigger, a `needs:`, a job-level `if:`, the `with:` a step is handed — are read as facts and
// compared with what they must be for the claims to hold. The two shell commands that decide what
// a release says and carries — the composer that writes the notes and the file list, and the
// mirror that copies that list — are extracted and *executed* against the states a run can be in,
// so their behaviour is checked by reading what they do rather than by matching their source: a
// script this guard only read would be a script whose text agreed with the guard and nothing else.
// And the three prose files that describe the path, the SDK's own dependency record and the tree
// are read as the repository holds them.
//
// Every check is a pure function of what it reads, so the describes below hand them the states
// the repository would never commit and get each failure back by name. A passing run otherwise
// says only that nothing has drifted yet.
import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { CREDENTIALS, IDENTIFIERS } from './trusted-signing.ts'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Reads a file the guard cannot run without: an absent one is a failure, never a skip. */
function read(relative: string): string {
  try {
    return fs.readFileSync(path.join(root, relative), 'utf-8')
  } catch (cause) {
    throw new Error(`release path: ${relative} cannot be read — ${(cause as Error).message}`)
  }
}

const BUILD = '.github/workflows/build.yml'
const RELEASE = '.github/workflows/release.yml'
const CHECKLIST = '.github/RELEASE_CHECKLIST.md'
const README = 'README.md'
const PROOF = '_bmad-output/specs/spec-cuerunner/quality-and-proof.md'
const DEPENDENCIES = 'native/audio/third_party/DEPENDENCIES.json'
const VITEST = 'vitest.config.ts'
const DOCS_GUARD = 'scripts/docs-build.test.ts'
const PACKAGE = 'package.json'
const NUMBERS_GUARD = 'scripts/published-numbers.test.ts'

/** The two surfaces that link the mirror, one hand-written and one rendered from `docs/`. */
const INDEX = 'website/index.html'
const GUIDES = 'website/docs/guides.mjs'

/** The host the download links point at, and the release notes' own address. */
const DOWNLOADS = 'https://pub.cuerunner.app/latest/'
const RELEASE_NOTES = 'https://github.com/Huckcity/cuerunner/releases/latest'

/** The jobs that package, the job that runs the two guards they wait on, and the mirror. */
const PACKAGING = ['build-windows', 'build-mac', 'build-linux']
const GUARD_JOB = 'test'
const COMPOSE_STEP = 'Compose the state section and the file list'
const PUBLISH_STEP = 'Publish the release'
const MIRROR_STEP = 'Upload to R2'

/**
 * One packaging job's recording: the step that states what it built, and the outputs the release
 * job reads off it. The names are the workflow's; a job that records nothing fails the check
 * below with the line its job sits on.
 */
interface Recording {
  job: string
  step: string
  outputs: Record<string, string>
}

/** The script that decides what a Windows build signs with, and the only thing that may. */
const SIGNING_DECISION = 'scripts/trusted-signing.ts'

const RECORDINGS: Recording[] = [
  {
    job: 'build-windows',
    step: 'Record what this installer is',
    outputs: {
      installer: '${{ steps.publish.outputs.installer }}',
      certificate: '${{ steps.publish.outputs.certificate }}',
      asio: '${{ steps.publish.outputs.asio }}'
    }
  },
  {
    job: 'build-mac',
    step: 'Record what this build is',
    outputs: {
      dmg: '${{ steps.publish.outputs.dmg }}',
      certificate: '${{ steps.publish.outputs.certificate }}',
      notarised: '${{ steps.publish.outputs.notarised }}'
    }
  },
  {
    job: 'build-linux',
    step: 'Record what this build is',
    outputs: { appimage: '${{ steps.publish.outputs.appimage }}' }
  }
]

/**
 * The recordings the composer is handed, as the release job passes them: one reference per
 * output a packaging job publishes. A composer that stopped reading one would write a sentence
 * about an artifact from nothing the run recorded.
 */
const COMPOSER_INPUTS = [
  '${{ needs.build-windows.outputs.installer }}',
  '${{ needs.build-windows.outputs.certificate }}',
  '${{ needs.build-windows.outputs.asio }}',
  '${{ needs.build-mac.outputs.dmg }}',
  '${{ needs.build-mac.outputs.certificate }}',
  '${{ needs.build-mac.outputs.notarised }}',
  '${{ needs.build-linux.outputs.appimage }}'
]

/**
 * The state words the two halves say to each other: the output a recording writes, and the
 * composer's `case` subject that reads it. A recording that wrote `yes` where the composer's arms
 * say `on` is a release job that dies on its first real run, and the executed checks below cannot
 * catch it — they feed the composer the words it already accepts, which is exactly how that
 * mismatch got in. The macOS pair is one case over two recorded states, hence the position.
 */
const STATE_VOCABULARY = [
  { job: 'build-windows', output: 'certificate', subject: '$WINDOWS_CERTIFICATE', position: 0 },
  { job: 'build-windows', output: 'asio', subject: '$WINDOWS_ASIO', position: 0 },
  { job: 'build-mac', output: 'certificate', subject: '$MAC_CERTIFICATE:$MAC_NOTARISED', position: 0 },
  { job: 'build-mac', output: 'notarised', subject: '$MAC_CERTIFICATE:$MAC_NOTARISED', position: 1 }
]

/**
 * What gates each platform's signing, and therefore what a recording has to read before it may
 * call a build signed.
 *
 * macOS gates on the certificate secret itself: electron-builder reads an empty `CSC_LINK` as
 * "do not sign", so the secret's presence is the whole of the decision. Windows cannot work
 * that way — `win.azureSignOptions` makes electron-builder's signer refuse the build when it
 * cannot authenticate rather than skip signing (electron-builder#9623), so the identity is
 * decided in one step, by `scripts/trusted-signing.ts`, from the four resource identifiers and
 * the three Entra credentials. That step's `signed` answer is what the recording, the
 * verification and the packaging step all read, and it is a record in the same sense the macOS
 * secret is: it can say no.
 */
type CertificateGate = { secret: string } | { decision: string }

const CERTIFICATE_GATES: Record<string, CertificateGate> = {
  'build-mac': { secret: 'MAC_CSC_LINK' },
  'build-windows': { decision: SIGNING_DECISION }
}

/** The whole reading the checks are functions of: two workflows, the prose held to them, and the
 *  two surfaces that link the mirror. */
interface Reading {
  build: string
  release: string
  checklist: string
  readme: string
  proof: string
  vitest: string
  dependencies: string
  index: string
  guides: string
  /** The packaged build config, because what it declares is one of the release path's facts. */
  package: string
}

const LIVE: Reading = {
  build: read(BUILD),
  release: read(RELEASE),
  checklist: read(CHECKLIST),
  readme: read(README),
  proof: read(PROOF),
  vitest: read(VITEST),
  dependencies: read(DEPENDENCIES),
  index: read(INDEX),
  guides: read(GUIDES),
  package: read(PACKAGE)
}

/**
 * The live reading with one thing changed — in one field, or in every field that holds it — and
 * a failure when the text to change is not there. A case that silently changed nothing would
 * assert against the live tree and pass while testing nothing.
 */
function doctored(reading: Reading, from: string, to: string, only?: keyof Reading): Reading {
  const next = { ...reading }
  let changed = 0
  for (const [key, value] of Object.entries(next) as Array<[keyof Reading, string]>) {
    if (only !== undefined && key !== only) continue
    if (!value.includes(from)) continue
    next[key] = value.replaceAll(from, to)
    changed += 1
  }
  if (changed === 0) {
    throw new Error(
      `release path: this case doctors \`${from}\`${only === undefined ? '' : ` in ${only}`}, which the live reading does not hold — the case is not testing what it says`
    )
  }
  return next
}

/** The lines of a step's command that are code, with the comments explaining it left out. */
function commands(script: string): string {
  return script
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n')
}

/** One kind a workflow's `on:` declares, with the `types:` a release event is narrowed to. */
interface Trigger {
  kind: string
  types: string[]
  line: number
}

/**
 * The kinds a workflow's `on:` declares, and the lines they sit on. The block form's keys are
 * the kinds and the `types:` beneath one are what it narrows to; an `on:` this guard cannot read
 * as kinds is a loud failure rather than a trigger set with nothing in it.
 */
function triggersOf(yaml: string, file: string): Trigger[] {
  const lines = yaml.split('\n')
  const start = lines.findIndex((line) => /^on:\s*(\S.*)?$/.test(line))
  if (start === -1) {
    throw new Error(`release path: ${file} declares no \`on:\`, so what starts it is not a fact this guard can read`)
  }
  const inline = (/^on:\s*(\S.*)?$/.exec(lines[start])?.[1] ?? '').trim()
  const list = (value: string): string[] =>
    value
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '')
  if (inline !== '') {
    if (!inline.startsWith('[') || !inline.endsWith(']')) {
      throw new Error(`release path: ${file}:${start + 1} writes \`on: ${inline}\`, which this guard does not read as trigger kinds`)
    }
    return list(inline).map((kind) => ({ kind, types: [], line: start + 1 }))
  }
  const triggers: Trigger[] = []
  for (let index = start + 1; index < lines.length && !/^\S/.test(lines[index]); index++) {
    const kind = /^ {2}([A-Za-z_][\w-]*):\s*(.*?)\s*$/.exec(lines[index])
    if (kind === null) continue
    const types = kind[2].startsWith('[') ? list(kind[2]) : []
    for (let after = index + 1; after < lines.length && /^ {4}\S/.test(lines[after]); after++) {
      const narrowed = /^ {4}types:\s*(.*?)\s*$/.exec(lines[after])
      if (narrowed !== null) types.push(...list(narrowed[1]))
    }
    triggers.push({ kind: kind[1], types, line: index + 1 })
  }
  return triggers
}

/** One job's own lines, with the line its key sits on. */
interface Job {
  file: string
  name: string
  line: number
  lines: string[]
}

/**
 * The lines of one job of a workflow — its key line included — or nothing when the file declares
 * no job by that name. The block ends where the next job key begins.
 */
function jobOrNull(yaml: string, file: string, name: string): Job | null {
  const lines = yaml.split('\n')
  const jobs = lines.findIndex((line) => /^jobs:\s*$/.test(line))
  if (jobs === -1) return null
  for (let index = jobs + 1; index < lines.length; index++) {
    if (!new RegExp(`^ {2}${name}:\\s*$`).test(lines[index])) continue
    let end = lines.length
    for (let after = index + 1; after < lines.length; after++) {
      if (/^ {2}[A-Za-z_][\w-]*:\s*$/.test(lines[after]) || /^\S/.test(lines[after])) {
        end = after
        break
      }
    }
    return { file, name, line: index + 1, lines: lines.slice(index, end) }
  }
  return null
}

/** The same, loud: a check that cannot find the job it is about fails with the file it read. */
function jobOf(yaml: string, file: string, name: string): Job {
  const job = jobOrNull(yaml, file, name)
  if (job === null) {
    throw new Error(`release path: ${file} declares no \`${name}\` job, and this guard cannot read the release path from a file that has none`)
  }
  return job
}

/** The value a job states for one of its own keys — `if:`, `needs:` — or '' when it states none. */
function jobValue(job: Job, key: string): string {
  for (const line of job.lines) {
    const setting = new RegExp(`^ {4}${key}:\\s*(.*?)\\s*$`).exec(line)
    if (setting !== null) return setting[1]
  }
  return ''
}

/** The nested mapping a job states under one of its own keys — `outputs:` — as key → value. */
function jobMapping(job: Job, key: string): Record<string, string> {
  const values: Record<string, string> = {}
  const start = job.lines.findIndex((line) => new RegExp(`^ {4}${key}:\\s*$`).test(line))
  if (start === -1) return values
  for (let index = start + 1; index < job.lines.length; index++) {
    const line = job.lines[index]
    if (line.trim() === '') continue
    const entry = /^ {6}([A-Za-z_][\w-]*):\s*(.*?)\s*$/.exec(line)
    if (entry === null) break
    values[entry[1]] = entry[2]
  }
  return values
}

/**
 * The permissions a workflow grants, as `scope: access` pairs. The workflow-level block is what
 * a job inherits when it states none of its own, which is how this repository's release workflow
 * is written; a job that states its own is read on top of it.
 */
function permissionsOf(yaml: string): Record<string, string> {
  const values: Record<string, string> = {}
  const lines = yaml.split('\n')
  const start = lines.findIndex((line) => /^permissions:\s*$/.test(line))
  if (start === -1) return values
  for (let index = start + 1; index < lines.length; index++) {
    const line = lines[index]
    if (line.trim() === '' || /^\s*#/.test(line)) continue
    const entry = /^ {2}([A-Za-z_-]+):\s*(.*?)\s*$/.exec(line)
    if (entry === null) break
    values[entry[1]] = entry[2]
  }
  return values
}

/** The jobs a job waits on: the `[ a, b ]` list, or the `- a` lines of the block form. */
function needsOf(job: Job): string[] {
  const inline = jobValue(job, 'needs')
  if (inline !== '') {
    return inline
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '')
  }
  const start = job.lines.findIndex((line) => /^ {4}needs:\s*$/.test(line))
  if (start === -1) return []
  const named: string[] = []
  for (let index = start + 1; index < job.lines.length; index++) {
    const entry = /^ {6}-\s+(\S+)\s*$/.exec(job.lines[index])
    if (entry === null) break
    named.push(entry[1])
  }
  return named
}

/** One step of a job: the keys these checks read, and the command a `run:` step executes. */
interface Step {
  line: number
  name: string
  id: string
  uses: string
  if: string
  shell: string
  run: string
  env: Record<string, string>
  with: Record<string, string>
}

/**
 * The steps a job declares, in file order. A step's own keys are the ones at its `- ` marker's
 * column plus two — which is where the marker's own inline key lands once the dash is off — so a
 * `name:` inside a `with:` block is never read as the step's name.
 */
function stepsOf(job: Job): Step[] {
  const start = job.lines.findIndex((line) => /^ {4}steps:\s*$/.test(line))
  if (start === -1) return []
  const markers: number[] = []
  for (let index = start + 1; index < job.lines.length; index++) {
    if (/^ {6}-\s+\S/.test(job.lines[index])) markers.push(index)
  }
  return markers.map((at, position) =>
    readStep(job.lines.slice(at, markers[position + 1] ?? job.lines.length), job.line + at)
  )
}

/** The step a job names, or nothing when it declares none by that name. */
function stepOrNull(job: Job, name: string): Step | null {
  return stepsOf(job).find((step) => step.name === name) ?? null
}

/** One step, read from its own lines: the keys at the step's level, and its block scalars. */
function readStep(lines: string[], line: number): Step {
  const indent = /^(\s*)-/.exec(lines[0])?.[1].length ?? 6
  const key = indent + 2
  const body = [lines[0].replace(/^(\s*)-\s/, '$1  '), ...lines.slice(1)]
  const keys: Record<string, { at: number; value: string }> = {}
  for (const [index, text] of body.entries()) {
    const setting = new RegExp(`^ {${key}}([A-Za-z_][\\w-]*):\\s*(.*?)\\s*$`).exec(text)
    if (setting !== null) keys[setting[1]] = { at: index, value: setting[2] }
  }
  const scalar = (name: string): string => {
    const found = keys[name]
    if (found === undefined) return ''
    if (!/^[|>][-+]?$/.test(found.value)) return found.value
    const content: string[] = []
    for (let index = found.at + 1; index < body.length; index++) {
      const text = body[index]
      if (text.trim() === '') {
        content.push('')
        continue
      }
      if (text.length - text.trimStart().length <= key) break
      content.push(text)
    }
    while (content.length > 0 && content[content.length - 1] === '') content.pop()
    const common = Math.min(
      ...content.filter((text) => text.trim() !== '').map((text) => text.length - text.trimStart().length)
    )
    return content.map((text) => (text.trim() === '' ? '' : text.slice(common))).join('\n')
  }
  const mapping = (name: string): Record<string, string> => {
    const values: Record<string, string> = {}
    const found = keys[name]
    if (found === undefined) return values
    for (let index = found.at + 1; index < body.length; index++) {
      const text = body[index]
      if (text.trim() === '' || /^\s*#/.test(text)) continue
      const entry = new RegExp(`^ {${key + 2}}([A-Za-z_][\\w-]*):\\s*(.*?)\\s*$`).exec(text)
      if (entry === null) break
      values[entry[1]] = entry[2]
    }
    return values
  }
  return {
    line,
    name: scalar('name'),
    id: scalar('id'),
    uses: scalar('uses'),
    if: scalar('if'),
    shell: scalar('shell'),
    run: scalar('run'),
    env: mapping('env'),
    with: mapping('with')
  }
}

/**
 * The record the ASIO gate reads, as the workflow names it. Read from the workflow rather than
 * written here, because the gate, the checklist, the README and the proof record all have to
 * call it the same thing.
 */
function recordOf(build: string): string {
  const match = /native\/audio\/third_party\/[\w.-]*ASIO-AGREEMENT\.md/.exec(build)
  if (match === null) {
    throw new Error(
      `release path: ${BUILD} names no ASIO agreement record, and the gate the checklist, the README and the proof record describe reads one`
    )
  }
  return match[0]
}

/**
 * A release is dispatched and nothing else starts it; a build starts when a release is
 * published, and can also be run by hand so the path is exercisable without publishing.
 */
function triggerProblems(reading: Reading): string[] {
  const problems: string[] = []
  const kinds = triggersOf(reading.release, RELEASE).map((trigger) => trigger.kind)
  if (kinds.join(', ') !== 'workflow_dispatch') {
    problems.push(
      `${RELEASE} declares on: ${kinds.join(', ') || '(nothing)'}; a release happens when it is dispatched by hand and at no other time, which is what makes a merge to main publish nothing`
    )
  }
  const build = triggersOf(reading.build, BUILD)
  const published = build.find((trigger) => trigger.kind === 'release')
  if (published === undefined) {
    problems.push(
      `${BUILD} declares no \`release\` trigger, so nothing starts a build when semantic-release publishes one`
    )
  } else if (published.types.join(', ') !== 'published') {
    problems.push(
      `${BUILD}:${published.line} starts a build from the \`release\` event with types: ${published.types.join(', ') || 'none'}; this path packages a published release, and the trigger says which event that is`
    )
  }
  if (!build.some((trigger) => trigger.kind === 'workflow_dispatch')) {
    problems.push(
      `${BUILD} declares no \`workflow_dispatch\`, so this path cannot be run without publishing — which is how a dispatch is exercised and watched`
    )
  }
  return problems
}

/**
 * Every packaging job waits on the job that runs `scripts/docs-build.test.ts` and
 * `scripts/published-numbers.test.ts` inside `npm test`, so a release can neither publish pages
 * the render drifted from nor numbers no run produced. The guards are read from the job's own
 * steps and the vitest include rather than trusted to the job's name.
 */
function guardGateProblems(reading: Reading): string[] {
  const problems: string[] = []
  const test = jobOrNull(reading.build, BUILD, GUARD_JOB)
  if (test === null) {
    problems.push(
      `${BUILD} declares no \`${GUARD_JOB}\` job, so no job holds ${DOCS_GUARD} and ${NUMBERS_GUARD} for the packaging jobs to wait on`
    )
  } else {
    const commands = stepsOf(test).map((step) => step.run)
    if (!commands.some((command) => /(^|\s)npm test(\s|$)/.test(command))) {
      problems.push(
        `${BUILD}:${test.line}'s \`${GUARD_JOB}\` job runs no \`npm test\`, so the job the packaging jobs wait on is not the one that runs ${DOCS_GUARD} and ${NUMBERS_GUARD}`
      )
    }
  }
  for (const name of PACKAGING) {
    const job = jobOrNull(reading.build, BUILD, name)
    if (job === null) {
      problems.push(`${BUILD} declares no \`${name}\` job, and the release path the prose describes packages on it`)
      continue
    }
    if (!needsOf(job).includes(GUARD_JOB)) {
      problems.push(
        `${BUILD}:${job.line}'s \`${name}\` job does not wait on \`${GUARD_JOB}\`, the job that runs the docs-render guard and the numbers-from-runs guard: packaging may start before either has passed`
      )
    }
  }
  if (!reading.vitest.includes('scripts/**/*.test.ts')) {
    problems.push(
      `${VITEST} does not include \`scripts/**/*.test.ts\`, so \`npm test\` runs neither ${DOCS_GUARD} nor ${NUMBERS_GUARD}`
    )
  }
  for (const file of [DOCS_GUARD, NUMBERS_GUARD]) {
    if (!fs.existsSync(path.join(root, file))) {
      problems.push(`${file} is not in the tree, and the packaging jobs claim to wait on the run that passes it`)
    }
  }
  return problems
}

/**
 * Each packaging job records what it built, and each recording reads the configuration that
 * gates its platform's signing — `MAC_CSC_LINK` on macOS, the Trusted Signing decision on
 * Windows — so no release can call a build signed on any other ground. The three states a
 * certificate can be in are written down here as the branches the recording makes, because a
 * recording that cannot say `no` is how a hand-written `signed` gets into a release.
 */
function recordingProblems(reading: Reading): string[] {
  const problems: string[] = []
  for (const recording of RECORDINGS) {
    const job = jobOrNull(reading.build, BUILD, recording.job)
    if (job === null) {
      problems.push(`${BUILD} declares no \`${recording.job}\` job, and the release notes are composed from what it records`)
      continue
    }
    const outputs = jobMapping(job, 'outputs')
    for (const [key, value] of Object.entries(recording.outputs)) {
      if ((outputs[key] ?? '') !== value) {
        problems.push(
          `${BUILD}:${job.line}'s \`${recording.job}\` job does not publish \`${key}\` as \`${value}\`, so the release job cannot compose the notes from what this build recorded`
        )
      }
    }
    const step = stepOrNull(job, recording.step)
    if (step === null) {
      problems.push(
        `${BUILD}:${job.line}'s \`${recording.job}\` job has no \`${recording.step}\` step, so nothing in it states what it built and the notes have nothing to name`
      )
      continue
    }
    if (step.id !== 'publish') {
      problems.push(
        `${BUILD}:${step.line}'s \`${recording.step}\` step is not \`id: publish\`, which is what the job's outputs read from`
      )
    }
    for (const key of Object.keys(recording.outputs)) {
      if (!new RegExp(`\\b${key}=`).test(step.run)) {
        problems.push(
          `${BUILD}:${step.line}'s \`${recording.step}\` step writes no \`${key}=\`, so the \`${key}\` output it publishes is written nowhere`
        )
      }
    }
    const gate = CERTIFICATE_GATES[recording.job]
    if (gate === undefined) {
      // The AppImage is the artifact this pipeline cannot sign, and the guard's other half —
      // that this job names no signing tool or secret — is what keeps the sentence true. The
      // comments in the job are left out of this reading, so explaining the absence of a
      // signing step does not fail it.
      const named = commands(job.lines.join('\n'))
      if (/CSC_LINK|codesign|spctl|stapler|notarytool|cosign|sigstore|osslsigncode|\bgpg\b|--sign/.test(named)) {
        problems.push(
          `${BUILD}:${job.line}'s \`${recording.job}\` job names a signing secret or a signing tool (\`CSC_LINK\`, \`codesign\`, \`spctl\`, \`stapler\`, \`notarytool\`, \`cosign\`, \`gpg\`, \`sigstore\`, \`osslsigncode\`, \`--sign\`), and the notes name every AppImage unsigned because this pipeline signs none of them`
        )
      }
      continue
    }
    if (recording.job === 'build-mac') {
      const pairing = /if\s*\[[^\n]*\bcertificate\b[^\n]*\bAPPLE_ID\b[^\n]*\bAPPLE_TEAM_ID\b[^\n]*\]/
      if (!pairing.test(commands(step.run))) {
        problems.push(
          `${BUILD}:${step.line}'s \`${recording.step}\` step derives \`notarised\` from the Apple credentials alone, so a build with no certificate could record itself notarised: the composer's arms pair the two, and the pairing has to be in the recording`
        )
      }
    }
    if ('secret' in gate) {
      if ((step.env[gate.secret] ?? '') !== `\${{ secrets.${gate.secret} }}`) {
        problems.push(
          `${BUILD}:${step.line}'s \`${recording.step}\` step does not read \`secrets.${gate.secret}\`, the secret that gates this platform's signing: a state recorded from anywhere else is a claim, not a record`
        )
      }
      if (!new RegExp(`(\\$env:|\\$\\{?)${gate.secret}\\b`).test(commands(step.run))) {
        problems.push(
          `${BUILD}:${step.line}'s \`${recording.step}\` step is handed \`secrets.${gate.secret}\` and never reads it, so its certificate state says nothing about whether this build was signed`
        )
      }
    } else {
      problems.push(...decisionProblems(reading, job, recording, step))
    }
    for (const word of ['yes', 'no']) {
      if (!new RegExp(`['"]${word}['"]`).test(commands(step.run))) {
        problems.push(
          `${BUILD}:${step.line}'s \`${recording.step}\` step records no \`'${word}'\` state, so a build whose certificate is ${
            word === 'yes' ? 'configured' : 'absent'
          } is a state the notes can never name`
        )
      }
    }
  }
  return problems
}

/**
 * The Windows gate. Signing is configured per run by `scripts/trusted-signing.ts`, from the four
 * resource identifiers the Trusted Signing account is named by and the three Entra credentials
 * its signer authenticates with; the step that runs it answers `yes` or `no`, and the packaging
 * step, the signature check and the recording all read that answer. This holds those three to it,
 * and holds the tree to the reason the decision exists at all: `win.azureSignOptions` cannot be
 * declared in `package.json`, because electron-builder's Windows signer refuses the build when it
 * cannot authenticate rather than shipping unsigned — so a static declaration turns every
 * unsigned build into a failed one, which is the opposite of the promise this pipeline makes.
 */
function decisionProblems(reading: Reading, job: Job, recording: Recording, step: Step): string[] {
  const problems: string[] = []
  if (!fs.existsSync(path.join(root, SIGNING_DECISION))) {
    problems.push(
      `${SIGNING_DECISION} is not in the tree, and \`${recording.job}\` decides what it signs by running it: nothing else in this repository is allowed to make that decision`
    )
    return problems
  }
  const packaged = JSON.parse(reading.package) as { build?: { win?: { azureSignOptions?: unknown } } }
  if (packaged.build?.win?.azureSignOptions != null) {
    problems.push(
      `${PACKAGE} declares \`build.win.azureSignOptions\`, so every build is configured to sign and a build with no identity configured fails electron-builder's pre-flight instead of shipping unsigned: the identity is decided per run, by \`${SIGNING_DECISION}\``
    )
  }
  const decision = stepsOf(job).find((each) => commands(each.run).includes(SIGNING_DECISION))
  if (decision === undefined) {
    problems.push(
      `${BUILD}:${job.line}'s \`${recording.job}\` job runs no \`${SIGNING_DECISION}\`, so nothing decides what this build signs with: the service is configured for every run or for none, and neither is a decision this pipeline can record`
    )
    return problems
  }
  const name = decision.name === '' ? 'unnamed' : `\`${decision.name}\``
  if (decision.id === '') {
    problems.push(
      `${BUILD}:${decision.line}'s ${name} step runs \`${SIGNING_DECISION}\` with no \`id:\`, so the packaging, verification and recording steps below it have nothing to read`
    )
    return problems
  }
  for (const identifier of Object.keys(IDENTIFIERS)) {
    if ((decision.env[identifier] ?? '') !== `\${{ vars.${identifier} }}`) {
      problems.push(
        `${BUILD}:${decision.line}'s ${name} step does not read \`vars.${identifier}\`, one of the four resource identifiers \`${SIGNING_DECISION}\` decides from: a decision that is missing one is a refused build, not an unsigned one`
      )
    }
  }
  for (const credential of CREDENTIALS) {
    if ((decision.env[credential] ?? '') !== `\${{ secrets.${credential} }}`) {
      problems.push(
        `${BUILD}:${decision.line}'s ${name} step does not read \`secrets.${credential}\`, one of the three credentials \`${SIGNING_DECISION}\` decides from: a decision that is missing one is a refused build, not an unsigned one`
      )
    }
  }
  const answer = `\${{ steps.${decision.id}.outputs.signed }}`
  if ((step.env.SIGNED ?? '') !== answer) {
    problems.push(
      `${BUILD}:${step.line}'s \`${recording.step}\` step does not read \`${answer}\`, the state the signing decision answered: a certificate state recorded from anywhere else is a claim, not a record`
    )
  }
  if (!/\$env:SIGNED\b/.test(commands(step.run))) {
    problems.push(
      `${BUILD}:${step.line}'s \`${recording.step}\` step is handed \`${answer}\` and never reads it, so its certificate state says nothing about whether this build was signed`
    )
  }
  const packaging = stepsOf(job).find((each) => /\bnpm run dist:win\b/.test(commands(each.run)))
  if (packaging === undefined) {
    problems.push(
      `${BUILD}:${job.line}'s \`${recording.job}\` job runs no \`npm run dist:win\`, so nothing in it is packaged and the state this recording reports describes no file`
    )
    return problems
  }
  if (!packaging.run.includes(`\${{ steps.${decision.id}.outputs.args }}`)) {
    problems.push(
      `${BUILD}:${packaging.line}'s \`${packaging.name}\` step configures Trusted Signing itself rather than taking the flags \`${SIGNING_DECISION}\` decided on, so what signs this build is whatever that step happens to hard-code — and the decision the recording reads says nothing about it`
    )
  }
  for (const credential of CREDENTIALS) {
    if ((packaging.env[credential] ?? '') !== `\${{ secrets.${credential} }}`) {
      problems.push(
        `${BUILD}:${packaging.line}'s \`${packaging.name}\` step does not read \`secrets.${credential}\`: the signer authenticates with the three credentials, and a build handed fewer of them refuses to sign rather than shipping unsigned`
      )
    }
  }
  return problems
}

/**
 * The values a recording's own script can write for one of its outputs, as the branches it spells:
 * a shell branch (`certificate='no'`) or a PowerShell assignment whose branch blocks hold the
 * literals (`$asio = if ($env:ASIO -eq 'yes') { 'on' } else { 'off' }`). A comparison operand is
 * not a value the recording can write, so only the literals inside a branch body are read, and a
 * recording whose states this guard cannot read at all comes back empty rather than as a pass.
 */
function recordedStates(script: string, key: string): string[] {
  const values = new Set<string>()
  for (const match of script.matchAll(new RegExp(`\\b${key}=(['"])([^'"]+)\\1`, 'g'))) values.add(match[2])
  for (const line of script.split('\n')) {
    if (!new RegExp(`\\$${key}\\s*=`).test(line)) continue
    for (const branch of line.matchAll(/\{\s*'([^']+)'\s*\}/g)) values.add(branch[1])
  }
  return [...values]
}

/**
 * The values a `case` block of the composer accepts, read from its own arms: the pattern before
 * each body, one value per `:`-separated position. The `*` arm is the refusal, not a value, so it
 * is left out of the set the recordings are held to.
 */
function acceptedValues(script: string, subject: string, position: number): string[] {
  const lines = script.split('\n')
  const start = lines.findIndex((line) => line.includes(`case "${subject}" in`))
  if (start === -1) {
    throw new Error(
      `release path: the composer has no \`case "${subject}" in\` block, so the values its recordings hand it cannot be read`
    )
  }
  const values = new Set<string>()
  for (let index = start + 1; index < lines.length; index++) {
    if (/^\s*esac\s*$/.test(lines[index])) break
    const arm = /^\s*([\w*:]+)\)/.exec(lines[index])
    if (arm === null) continue
    const part = arm[1].split(':')[position]
    if (part !== undefined && part !== '*') values.add(part)
  }
  return [...values]
}

/**
 * The macOS verification the notes rest on. A dmg is named signed and notarised only because that
 * job checked it with `codesign`, Gatekeeper's own `spctl` and the stapler — the second of those
 * is what catches an app that is signed but not notarised — so the step has to run (nothing may
 * skip it) and has to fail (no `|| true`), because a check whose failure is swallowed verifies
 * nothing while the notes still call the result a record.
 */
function verificationProblems(reading: Reading): string[] {
  const problems: string[] = []
  const job = jobOrNull(reading.build, BUILD, 'build-mac')
  if (job === null) return problems
  const step = stepsOf(job).find((each) => /codesign|spctl|stapler/.test(each.run))
  if (step === undefined) {
    problems.push(
      `${BUILD}:${job.line}'s \`build-mac\` job runs no verification of the app it packages, and the notes name its dmg signed and notarised on the strength of one`
    )
    return problems
  }
  const script = commands(step.run)
  for (const command of ['codesign --verify', 'spctl --assess', 'stapler validate']) {
    if (!script.includes(command)) {
      problems.push(
        `${BUILD}:${step.line}'s \`${step.name}\` step does not run \`${command}\`, which is what makes "signed and notarised" in the notes a record rather than a claim`
      )
    }
  }
  if (step.if !== '') {
    problems.push(
      `${BUILD}:${step.line}'s \`${step.name}\` step is conditional (\`if: ${step.if}\`), so a run can package a dmg it never verified`
    )
  }
  for (const line of script.split('\n')) {
    if (/(codesign|spctl|stapler)/.test(line) && /\|\|\s*(true|:)\b/.test(line)) {
      problems.push(
        `${BUILD}:${step.line}'s \`${step.name}\` step swallows a verification failure with \`|| true\` on the line that runs \`${line.trim()}\`: a check whose failure is ignored verifies nothing, and the notes still call its result a record`
      )
    }
  }
  return problems
}

/**
 * The words the recordings write and the words the composer's arms read, held to each other. The
 * two blocks are only ever run against each other's expectations by the executed checks below —
 * which feed the composer its own vocabulary — so a recording that wrote `yes` where the composer
 * says `on` is invisible to them and fatal on a real run. This reads both sides out of the
 * workflow instead: the values a recording's branches can write, and the values the `case` block
 * that reads that output accepts.
 */
function vocabularyProblems(reading: Reading): string[] {
  const problems: string[] = []
  const job = jobOrNull(reading.build, BUILD, 'release')
  const compose = job === null ? null : stepOrNull(job, COMPOSE_STEP)
  if (compose === null) return problems
  for (const link of STATE_VOCABULARY) {
    const recorder = jobOrNull(reading.build, BUILD, link.job)
    const recording = RECORDINGS.find((each) => each.job === link.job)
    const step = recorder === null || recording === undefined ? null : stepOrNull(recorder, recording.step)
    if (step === null) continue
    const written = recordedStates(commands(step.run), link.output)
    if (written.length === 0) {
      problems.push(
        `${BUILD}:${step.line}'s \`${recording?.step}\` step writes no \`${link.output}\` state this guard can read, so nothing here says the composer's arms can read what it writes`
      )
      continue
    }
    const accepted = acceptedValues(compose.run, link.subject, link.position)
    for (const value of written) {
      if (!accepted.includes(value)) {
        problems.push(
          `${BUILD}:${step.line}'s \`${recording?.step}\` step writes \`${link.output}=${value}\`, which the composer's \`case "${link.subject}" in\` does not accept (it reads ${accepted.map((each) => `\`${each}\``).join(', ') || 'nothing'}): the state the recorder writes is not one the composer reads, and the release job would die on its first real run`
        )
      }
    }
  }
  return problems
}

/**
 * The Windows job's shell-less steps are plain commands. A Windows runner's `run:` steps default
 * to `pwsh` — this repository's own vendor workflow says so where it quotes a tag for exactly
 * that reason — so a step carrying a POSIX script without naming a POSIX shell dies at its first
 * `if [`, and that is the job that builds the installer the release publishes. The macOS and
 * Linux jobs run where the default is a POSIX shell, which is why this reads the Windows one.
 */
function shellProblems(reading: Reading): string[] {
  const problems: string[] = []
  const windows = jobOrNull(reading.build, BUILD, 'build-windows')
  if (windows === null) return problems
  for (const step of stepsOf(windows)) {
    if (step.run === '' || step.shell !== '') continue
    if (/\bthen\b|\bfi\b|\bdone\b|if \[|\[ -[a-z]/.test(step.run)) {
      problems.push(
        `${BUILD}:${step.line}'s \`${step.name || 'unnamed'}\` step runs a POSIX shell script with no \`shell:\`, and a Windows runner's default is pwsh: it fails at its first \`if [\`, taking the installer this release publishes with it`
      )
    }
  }
  return problems
}

/**
 * The release job's notes and file list are composed from the recordings, and what it publishes
 * is what it composed: `body_path` from the composer's own output rather than a file of its own,
 * `files:` from the same step's list rather than a glob over the download directory, and
 * `append_body` so semantic-release's commit-derived body is added to rather than replaced.
 */
function notesProblems(reading: Reading): string[] {
  const problems: string[] = []
  const job = jobOrNull(reading.build, BUILD, 'release')
  if (job === null) {
    problems.push(`${BUILD} declares no \`release\` job, so nothing publishes the release the pipeline packages`)
    return problems
  }
  const waits = needsOf(job)
  for (const name of PACKAGING) {
    if (!waits.includes(name)) {
      problems.push(
        `${BUILD}:${job.line}'s \`release\` job does not wait on \`${name}\`, so it could publish a release whose notes are composed from a state that never ran`
      )
    }
  }
  const compose = stepOrNull(job, COMPOSE_STEP)
  if (compose === null) {
    problems.push(
      `${BUILD}:${job.line}'s \`release\` job runs no \`${COMPOSE_STEP}\` step, so the notes carry nothing the run recorded and the file list is whatever the download step happened to leave`
    )
  } else {
    for (const reference of COMPOSER_INPUTS) {
      if (!Object.values(compose.env).includes(reference)) {
        problems.push(
          `${BUILD}:${compose.line}'s \`${COMPOSE_STEP}\` step does not read \`${reference}\`, so the sentence it writes about that artifact rests on nothing its job recorded`
        )
      }
    }
    if (!/body=/.test(compose.run) || !/files<</.test(compose.run) || !/mirror<</.test(compose.run)) {
      problems.push(
        `${BUILD}:${compose.line}'s \`${COMPOSE_STEP}\` step publishes no \`body=\`, \`files<<\` and \`mirror<<\` outputs, so the release step has neither notes nor a list to publish and the mirror has none to copy`
      )
    }
    if (!/GITHUB_RUN_ID/.test(compose.run)) {
      problems.push(
        `${BUILD}:${compose.line}'s \`${COMPOSE_STEP}\` step's section names no run, so a page carrying two appended sections cannot be read back to the run that wrote either`
      )
    }
    const owned = ['release-notes.md', 'release-files.txt', 'SHA256SUMS']
    const missing = owned.filter((file) => !compose.run.includes(`: > ${file}`))
    if (missing.length !== 0) {
      problems.push(
        `${BUILD}:${compose.line}'s \`${COMPOSE_STEP}\` step does not create ${missing.join(' and ')}, so a reused self-hosted workspace would carry the previous run's lines into the published section, list and digests`
      )
    }
    if (!compose.run.includes(recordOf(reading.build))) {
      problems.push(
        `${BUILD}:${compose.line}'s \`${COMPOSE_STEP}\` step names no ASIO agreement record, so a withheld Windows installer would be described without saying what it was withheld for`
      )
    }
  }
  const outputs = jobMapping(job, 'outputs')
  if ((outputs.files ?? '') !== '${{ steps.notes.outputs.files }}') {
    problems.push(
      `${BUILD}:${job.line}'s \`release\` job publishes no \`files\` output composed by the notes step, so the release page carries no list the notes were composed from`
    )
  }
  if ((outputs.mirror ?? '') !== '${{ steps.notes.outputs.mirror }}') {
    problems.push(
      `${BUILD}:${job.line}'s \`release\` job publishes no \`mirror\` output composed by the notes step, so the mirror has no list to copy and would have to search for one`
    )
  }
  const publish = stepOrNull(job, PUBLISH_STEP)
  if (publish === null) {
    problems.push(`${BUILD}:${job.line}'s \`release\` job runs no \`${PUBLISH_STEP}\` step, so the notes are composed and published nowhere`)
  } else {
    if (publish.with.body_path !== '${{ steps.notes.outputs.body }}') {
      problems.push(
        `${BUILD}:${publish.line}'s \`${PUBLISH_STEP}\` step writes a body that is not the composed section (\`body_path: ${publish.with.body_path || '(none)'}\`)`
      )
    }
    if (publish.with.append_body !== 'true') {
      problems.push(
        `${BUILD}:${publish.line}'s \`${PUBLISH_STEP}\` step does not set \`append_body: true\`, so the composed section would replace semantic-release's commit-derived body instead of being added to it`
      )
    }
    if (publish.with.files !== '${{ steps.notes.outputs.files }}') {
      problems.push(
        `${BUILD}:${publish.line}'s \`${PUBLISH_STEP}\` step publishes files of its own choosing (\`files: ${publish.with.files || '(none)'}\`) rather than the list the notes were composed from`
      )
    }
    if (publish.with.fail_on_unmatched_files !== 'true') {
      problems.push(
        `${BUILD}:${publish.line}'s \`${PUBLISH_STEP}\` step does not fail on an unmatched file, so a recorded artifact that never arrived would leave the notes describing a release the page does not carry`
      )
    }
  }
  return problems
}

/**
 * `release.yml` starts the packaging run for the tag it just cut. A release published with the
 * repository's own `GITHUB_TOKEN` creates no workflow run — which is why every release since
 * 2026-07-11 carries no installers and the site's download cards point at 404s — so this
 * dispatch, not the `release: published` trigger, is the path that publishes anything. It has to
 * name a tag: `build.yml`'s publishing jobs admit a tag ref and nothing else, while the ref
 * `release.yml` was started from is `main`. It runs after semantic-release, whose tag it
 * resolves from the repository, and it is an `actions: write` call on the job's own token.
 */
function dispatchProblems(reading: Reading): string[] {
  const problems: string[] = []
  const job = jobOrNull(reading.release, RELEASE, 'release')
  if (job === null) {
    problems.push(`${RELEASE} declares no \`release\` job, and the packaging run this repository starts comes from it`)
    return problems
  }
  const steps = stepsOf(job)
  const cut = steps.findIndex((step) => /\bsemantic-release\b/.test(step.run))
  if (cut === -1) {
    problems.push(
      `${RELEASE}:${job.line}'s \`release\` job runs no \`semantic-release\`, so there is no tag for a packaging run to be started for`
    )
    return problems
  }
  const dispatch = steps.findIndex((step) => /actions\/workflows\/build\.yml\/dispatches/.test(step.run))
  if (dispatch === -1) {
    problems.push(
      `${RELEASE}:${job.line}'s \`release\` job starts no packaging run: nothing dispatches \`build.yml\`, and the release this workflow publishes with the repository's own token starts no workflow by itself — which is how a release comes to carry no installers at all`
    )
    return problems
  }
  if (dispatch < cut) {
    problems.push(
      `${RELEASE}:${steps[dispatch].line}'s dispatch runs before \`semantic-release\`, so it would package the tag the previous release cut rather than this one`
    )
  }
  const command = commands(steps[dispatch].run)
  if (!/git describe --tags|git tag --points-at/.test(command)) {
    problems.push(
      `${RELEASE}:${steps[dispatch].line}'s dispatch resolves no tag from the repository, so the ref it sends is not known to be the tag this run cut`
    )
  }
  if (/\$\{\{\s*github\.ref_name\s*\}\}/.test(steps[dispatch].run)) {
    problems.push(
      `${RELEASE}:${steps[dispatch].line}'s dispatch sends \`github.ref_name\`, which is the branch this workflow was started from (\`main\`) rather than the tag it cut, and \`build.yml\`'s publishing jobs admit a tag ref and nothing else`
    )
  }
  const sent = /\\?"ref\\?"\s*:\s*\\?"\$?\{?([\w]+)\}?\\?"/.exec(steps[dispatch].run)
  if (sent === null) {
    problems.push(
      `${RELEASE}:${steps[dispatch].line}'s dispatch sends no \`ref\` naming the tag this run cut, so the packaging run would be started for whatever the endpoint defaults to`
    )
  } else if (!new RegExp(`\\b${sent[1]}=[^\\n]*(git describe --tags|git tag --points-at)`).test(command)) {
    problems.push(
      `${RELEASE}:${steps[dispatch].line}'s dispatch sends \`ref\` from \`${sent[1]}\`, which this workflow never sets to the tag it cut: \`build.yml\`'s publishing jobs admit a tag ref and nothing else`
    )
  }
  const noting = steps.find(
    (step) => step.line !== steps[dispatch].line && /(\w+)=\$\(git describe --tags --abbrev=0/.test(step.run)
  )
  if (noting === undefined || noting.id === '') {
    problems.push(
      `${RELEASE}:${job.line}'s release job notes no tag from before the release, so the dispatch cannot tell a tag this run cut from one that was already there: a run that published nothing would start a packaging run for the previous tag`
    )
  } else {
    const earlier = /(\w+)=\$\(git describe --tags --abbrev=0/.exec(noting.run)?.[1] ?? ''
    const reference = `\${{ steps.${noting.id}.outputs.${earlier} }}`
    const binding = Object.entries(steps[dispatch].env).find(([, value]) => value === reference)
    if (binding === undefined) {
      problems.push(
        `${RELEASE}:${steps[dispatch].line}'s dispatch reads no \`${reference}\`, the tag this run started from: nothing tells it whether semantic-release cut one, so it would start a packaging run for a tag this run never published`
      )
    } else if (!new RegExp(`\\[\\s*"\\$\\w+"\\s*=\\s*"\\$${binding[0]}"\\s*\\]`).test(command)) {
      problems.push(
        `${RELEASE}:${steps[dispatch].line}'s dispatch does not skip when the tag it resolved equals \`$${binding[0]}\` (the script compares it with something other than \`=\`): inverted, it starts a packaging run for a tag this run did not cut; never equal, it starts one for every run`
      )
    }
  }
  const granted = { ...permissionsOf(reading.release), ...jobMapping(job, 'permissions') }
  if ((granted.actions ?? '') !== 'write') {
    problems.push(
      `${RELEASE}:${job.line}'s \`release\` job is granted \`actions: ${granted.actions || 'nothing'}\`, and the workflow-dispatch endpoint is an \`actions: write\` call: the dispatch would answer 403 and the release would carry no installers`
    )
  }
  return problems
}

/**
 * Publication waits on a tag ref — and still on the jobs it needs: a job-level `if:` replaces
 * the default `success()` condition, so a gate that tests the ref and forgets the result of the
 * packaging jobs would publish from a run whose recording is missing. It must not test the
 * triggering event either: the packaging run this repository starts is a `workflow_dispatch` for
 * the tag, and a gate that asked for a `release` event would publish nothing from it.
 */
function publishGateProblems(reading: Reading): string[] {
  const problems: string[] = []
  for (const name of ['release', 'upload-r2']) {
    const job = jobOrNull(reading.build, BUILD, name)
    if (job === null) {
      problems.push(`${BUILD} declares no \`${name}\` job, and this guard holds its publication gate`)
      continue
    }
    const condition = jobValue(job, 'if')
    if (!/github\.ref_type\s*==\s*'tag'/.test(condition)) {
      problems.push(
        `${BUILD}:${job.line}'s \`${name}\` job publishes on any ref: its \`if:\` is \`${condition || '(nothing)'}\`, which does not test \`github.ref_type == 'tag'\``
      )
    }
    if (!/success\(\)/.test(condition)) {
      problems.push(
        `${BUILD}:${job.line}'s \`${name}\` job's \`if:\` drops \`success()\`, which a job-level condition replaces: it would run after a packaging job failed and publish a release whose notes rest on a state that never arrived`
      )
    }
    if (/github\.event_name/.test(condition)) {
      problems.push(
        `${BUILD}:${job.line}'s \`${name}\` job's \`if:\` gates on \`github.event_name\`, and the run that packages this repository's releases is the \`workflow_dispatch\` \`release.yml\` starts: the release would publish nothing`
      )
    }
  }
  return problems
}

/**
 * The ASIO gate. The workflow's only ASIO signal is the SDK probe, so the recording reads the
 * probe's own output and nothing invents a second one; the installer is withheld when the probe
 * found an SDK and the agreement's record is not committed — the record's absence is the state
 * the gate reads, never a placeholder — and the upload step is conditional on the recorded
 * installer, so a withheld build cannot upload one behind the notes' back. The SDK itself stays
 * out of the tree: what licenses it lives in the dependency record, which is where the
 * "never committed" claim is read.
 */
function asioProblems(reading: Reading): string[] {
  const problems: string[] = []
  const windows = jobOrNull(reading.build, BUILD, 'build-windows')
  if (windows === null) {
    problems.push(`${BUILD} declares no \`build-windows\` job, and the ASIO gate the prose describes is in it`)
    return problems
  }
  const record = recordOf(reading.build)
  const probe = stepOrNull(windows, 'Locate the ASIO SDK')
  if (probe === null) {
    problems.push(
      `${BUILD}:${windows.line}'s \`build-windows\` job runs no SDK probe, so whether this build linked ASIO rests on nothing the job states`
    )
  } else {
    const lines = commands(probe.run).split('\n')
    const warned = lines.find((line) => line.includes('::warning::'))
    if (warned === undefined || !/found=no\b/.test(warned)) {
      problems.push(
        `${BUILD}:${probe.line}'s probe answers "no SDK" without \`found=no\` on the branch that warns: the two answers swapped read a build with no SDK as one that linked it, and the withhold gate follows the probe`
      )
    }
    const set = lines.findIndex((line) => /CUERUNNER_ASIO_SDK=%ASIO%.*GITHUB_ENV/.test(line))
    if (set === -1 || !lines.slice(set + 1).some((line) => /found=yes\b/.test(line))) {
      problems.push(
        `${BUILD}:${probe.line}'s probe names no \`found=yes\` after the branch that found an SDK (the one setting \`CUERUNNER_ASIO_SDK\`), so neither answer is bound to what the probe found`
      )
    }
  }
  const recording = stepOrNull(windows, 'Record what this installer is')
  if (recording === null) {
    problems.push(`${BUILD}:${windows.line}'s \`build-windows\` job records no installer state, so the ASIO gate has nothing to withhold`)
    return problems
  }
  const script = commands(recording.run)
  if (probe !== null && recording.env.ASIO !== `\${{ steps.${probe.id}.outputs.found }}`) {
    problems.push(
      `${BUILD}:${recording.line}'s recording does not read the SDK probe's own output (\`ASIO: ${recording.env.ASIO || '(none)'}\`), so this job would answer "did this build link ASIO" from somewhere other than the probe`
    )
  }
  if (!script.includes(record)) {
    problems.push(
      `${BUILD}:${recording.line}'s recording never names \`${record}\`, so the state it decides on is not the record the checklist and the README tell a release engineer to commit`
    )
  }
  const sized = /\$(\w+)\s*=[^\n]*\$(\w+)[^\n]*\.Length\s+-gt\s+0/.exec(script)
  if (sized === null) {
    problems.push(
      `${BUILD}:${recording.line}'s recording decides whether the agreement is recorded without reading the record's size (\`$… = … $… .Length -gt 0\`): an empty file where the record should be would satisfy it, and the record the README and the checklist describe carries a date and the parties`
    )
  }
  const withhold = /\$withheld\s*=[^\n]*/.exec(script)?.[0] ?? ''
  const negated = sized === null ? /-and\s+-not\s+\$/.test(withhold) : new RegExp(`-and\\s+-not\\s+\\$${sized[1]}\\b`).test(withhold)
  if (!negated) {
    problems.push(
      `${BUILD}:${recording.line}'s recording does not withhold *unless* the agreement is unrecorded (\`$withheld = … -and -not $${sized?.[1] ?? 'recorded'}\`): without the negation the installer publishes whether or not the agreement is recorded, which is the one thing this gate exists to prevent`
    )
  }
  if (!/::warning::/.test(script) || !/withheld/.test(script)) {
    problems.push(
      `${BUILD}:${recording.line}'s recording withholds an installer with no \`::warning::\` naming what withheld it: the checklist tells a release engineer to read that warning`
    )
  }
  if (!/\$published\s*=\s*if\s*\(\s*\$withheld\s*\)\s*\{\s*''\s*\}/.test(script)) {
    problems.push(
      `${BUILD}:${recording.line}'s recording writes an installer name whatever it decided, so a build that links the SDK with no recorded agreement would publish its installer anyway`
    )
  }
  const upload = stepOrNull(windows, 'Upload installer')
  if (upload === null) {
    problems.push(`${BUILD}:${windows.line}'s \`build-windows\` job uploads no installer, and the exe the notes name comes from that upload`)
  } else if (!/steps\.publish\.outputs\.installer\s*!=\s*''/.test(upload.if)) {
    problems.push(
      `${BUILD}:${upload.line}'s upload runs on \`${upload.if || '(no condition)'}\` rather than on the recorded installer, so the installer a withheld build declined to publish would be uploaded anyway`
    )
  }
  for (const [name, pathField] of Object.entries({ 'build-windows': 'installer', 'build-mac': 'dmg', 'build-linux': 'appimage' })) {
    const job = jobOrNull(reading.build, BUILD, name)
    if (job === null) continue
    const uploader = stepsOf(job).find((step) => step.uses.startsWith('actions/upload-artifact'))
    if (uploader === undefined) continue
    if (uploader.with.path !== `dist/\${{ steps.publish.outputs.${pathField} }}`) {
      problems.push(
        `${BUILD}:${uploader.line}'s \`${name}\` job uploads \`${uploader.with.path}\` rather than the file it recorded, so the artifact the notes name and the artifact this run carries can part company`
      )
    }
  }
  const dependencies = JSON.parse(reading.dependencies) as {
    dependencies?: Array<{ name?: string }>
    notIncluded?: Array<{ name?: string; reason?: string }>
  }
  const excluded = (dependencies.notIncluded ?? []).find((entry) => /ASIO/i.test(entry.name ?? ''))
  if (excluded === undefined) {
    problems.push(
      `${DEPENDENCIES} no longer declares the ASIO SDK as not included, which is where the claim that it is never committed is read`
    )
  } else if (!/agreement/i.test(excluded.reason ?? '') || !(excluded.reason ?? '').includes(record)) {
    problems.push(
      `${DEPENDENCIES}'s ASIO entry names neither the signed agreement nor \`${record}\` as what publishing a linked build rests on, and both the gate and the prose read that record`
    )
  }
  if ((dependencies.dependencies ?? []).some((entry) => /ASIO/i.test(entry.name ?? ''))) {
    problems.push(`${DEPENDENCIES} now vendors the ASIO SDK, whose licence forbids redistributing it`)
  }
  return problems
}

/**
 * The mirror copies the release job's composed list and searches for nothing: a `find` over the
 * downloaded artifacts would be a second list, and a second list is how `latest/` comes to carry
 * an installer the notes called withheld. It reads the *mirror* list and not the release page's,
 * which names the sums file the mirror composes for itself under the names it writes; and what it
 * copies, what it writes as digests and what it removes are read off a stub CLI by the cases
 * below rather than asserted from this step's text.
 */
function mirrorProblems(reading: Reading): string[] {
  const problems: string[] = []
  const job = jobOrNull(reading.build, BUILD, 'upload-r2')
  if (job === null) {
    problems.push(`${BUILD} declares no \`upload-r2\` job, and the download host the site points at is filled from it`)
    return problems
  }
  if (!needsOf(job).includes('release')) {
    problems.push(
      `${BUILD}:${job.line}'s \`upload-r2\` job does not wait on \`release\`, so the mirror could copy artifacts the release page never carried`
    )
  }
  const upload = stepOrNull(job, MIRROR_STEP)
  if (upload === null) {
    problems.push(`${BUILD}:${job.line}'s \`upload-r2\` job runs no \`${MIRROR_STEP}\` step, so nothing fills the download host`)
    return problems
  }
  if (upload.env.FILES !== '${{ needs.release.outputs.mirror }}') {
    problems.push(
      `${BUILD}:${upload.line}'s \`${MIRROR_STEP}\` step does not read the mirror list (\`FILES: ${upload.env.FILES || '(none)'}\`), so it would copy the release page's list instead: that list names the sums file, which no suffix places, and the two surfaces would name files the other does not serve`
    )
  }
  if (/\bfind\b/.test(commands(upload.run)) || /artifacts\//.test(commands(upload.run))) {
    problems.push(
      `${BUILD}:${upload.line}'s \`${MIRROR_STEP}\` step searches the downloaded artifacts for files to copy: that is a second list, and it would mirror an installer the release withheld`
    )
  }
  return problems
}

/**
 * The names the mirror writes, read off the one map the step declares them in: `NAMES`, a
 * space-separated list of `suffix=name` pairs. Read from the workflow rather than written here,
 * because the site's links have to name what the mirror actually writes; a step whose map this
 * guard cannot read is a loud failure, not a pass with nothing to hold the cards to.
 */
function mirrorNames(reading: Reading): string[] {
  const job = jobOrNull(reading.build, BUILD, 'upload-r2')
  const step = job === null ? null : stepOrNull(job, MIRROR_STEP)
  if (step === null) {
    throw new Error(
      `release path: ${BUILD}'s \`upload-r2\` job runs no \`${MIRROR_STEP}\` step, so the names it writes cannot be read and the site's links cannot be held to them`
    )
  }
  const declared = /(?:^|\n)\s*NAMES='([^']*)'/.exec(step.run)?.[1] ?? ''
  const names = declared
    .split(/\s+/)
    .filter((pair) => pair !== '')
    .map((pair) => /^[^=]+=(.+)$/.exec(pair)?.[1] ?? '')
  if (names.length === 0 || names.some((name) => name === '')) {
    throw new Error(
      `release path: ${BUILD}'s \`${MIRROR_STEP}\` step declares \`NAMES='${declared}'\`, which this guard does not read as a space-separated \`suffix=name\` map: the names the mirror writes are what the site's links are held to, so there has to be something to read`
    )
  }
  return names
}

/**
 * The two surfaces that hand a buyer a file, held to what the mirror writes. Every `latest/` href
 * one of them carries has to be a name the mirror's own map produces — or the sums file the
 * mirror composes and uploads — and between them they have to account for every name the mirror
 * writes, so a rename on either side fails here rather than at a download. Each has to name the
 * release notes as well: the signature state lives in the notes, so a page that states one of its
 * own would be stating a release it cannot see.
 */
function cardProblems(reading: Reading): string[] {
  const problems: string[] = []
  const published = [...mirrorNames(reading), 'SHA256SUMS']
  const linked = new Set<string>()
  for (const [file, text] of [
    [INDEX, reading.index],
    [GUIDES, reading.guides]
  ] as Array<[string, string]>) {
    const found = [...text.matchAll(/https:\/\/pub\.cuerunner\.app\/latest\/([\w.-]+)/g)].map((link) => link[1])
    if (found.length === 0) {
      problems.push(
        `${file} links no \`${DOWNLOADS}…\` file, so a buyer is handed nothing to download and the mirror's names are held to nothing`
      )
    }
    for (const name of found) {
      linked.add(name)
      if (!published.includes(name)) {
        problems.push(
          `${file} links \`${DOWNLOADS}${name}\`, which is not a name ${BUILD}'s \`${MIRROR_STEP}\` writes (it writes ${published.map((each) => `\`${each}\``).join(', ')}): the card points at a file the mirror never fills, or the name changed on one side only`
        )
      }
    }
    if (!text.includes(RELEASE_NOTES)) {
      problems.push(
        `${file} names no release notes (\`${RELEASE_NOTES}\`), which is where the files' state is stated: the download surface itself claims nothing about a release`
      )
    }
    // The decision both surfaces are held to: they name where the state is stated rather than
    // rendering one. A page deployed on a `website/**` push is built beside no release, so a
    // rendered state is either a fetch to the mirror — CORS this repository cannot set — or a
    // line that goes stale against the release it describes.
    if (/<script\b|fetch\s*\(/.test(text)) {
      problems.push(
        `${file} carries a script or a \`fetch(\`, so the download surface renders a state it cannot know: the release notes state it, and this page ships on a \`website/**\` push rather than beside a release`
      )
    }
  }
  for (const name of published) {
    if (!linked.has(name)) {
      problems.push(
        `no card links \`${DOWNLOADS}${name}\`, and the mirror writes it: a published file no buyer can reach — the digest file is only reachable because a card links it`
      )
    }
  }
  return problems
}

/**
 * A statement one of the three prose files makes about the release path, and the patterns that
 * have to hold for it to be the statement the workflow implements. Each pattern is tied to
 * something read off the workflow — the record its gate tests, the words its warning and its
 * composer use, the ref its publishing jobs test — so prose that drifts from the code fails by
 * name, and the sentences this story replaced are refused outright.
 */
interface Statement {
  file: string
  says: string
  patterns: RegExp[]
  forbids?: RegExp[]
}

/** The statements the checklist, the README and the proof record make, and what each rests on. */
function releaseStatements(reading: Reading): Statement[] {
  const record = recordOf(reading.build)
  return [
    {
      file: CHECKLIST,
      says: 'the ASIO gate withholds an installer built against the SDK when the agreement is not recorded',
      patterns: [new RegExp(`\`${record}\``), /withh(e|o)ld/i]
    },
    {
      file: CHECKLIST,
      says: 'the release notes name what each installer is, in the three states a run can record',
      patterns: [/release notes/i, /signed and notarised/, /unsigned/]
    },
    {
      file: CHECKLIST,
      says: 'the packaging run is started by `release.yml` dispatching `build.yml` for the tag it cut, so a release with no installers means that dispatch did not happen',
      patterns: [/[Dd]ispatch(es|ing)\s+`build\.yml`/, /no installers/]
    },
    {
      file: CHECKLIST,
      says: 'the runbook for a packaging run that never appeared: watch for the run against the tag, start one by hand for that tag, and read an assetless release as a dispatch that did not happen or a run that failed',
      patterns: [/gh workflow run build\.yml --ref/, /no\s+assets/, /run that ran\s+failed|ran\s+failed/]
    },
    {
      file: CHECKLIST,
      says: 'the mirror is checked at the buyer-facing host the site\'s cards point at',
      patterns: [/pub\.cuerunner\.app/, /curl -sI/]
    },
    {
      file: CHECKLIST,
      says: 'the mirror check reads a withheld installer\'s card as the 404 the notes explain, and checks the digest file beside the files it copied',
      patterns: [/404/, /SHA256SUMS/]
    },
    {
      file: CHECKLIST,
      says: 'dispatching, the limitations re-read and signing the agreement itself stay human',
      patterns: [/dispatch/i, /Known Limitations/, /signing the agreement is the human half/i]
    },
    {
      file: README,
      says: 'the pipeline withholds an installer built against the SDK until the agreement is recorded',
      patterns: [new RegExp(record), /withh(e|o)ld/i],
      forbids: [/checklist item, not a build-time one/]
    },
    {
      file: README,
      says: 'the release notes name each artifact signed, signed and notarised, or unsigned',
      patterns: [/release notes/i, /unsigned/i, /\bstate\b/i]
    },
    {
      file: README,
      says: 'nothing publishes from a ref that is not a tag',
      patterns: [/not a tag/i]
    },
    {
      file: README,
      says: 'the packaging run is started by `release.yml` dispatching `build.yml` for the tag it cut, so a release with no installers means that dispatch did not happen',
      patterns: [/[Dd]ispatch(es|ing)\s+`build\.yml`/, /no installers/]
    },
    {
      file: README,
      says: 'the fallback for a release with no packaging run: start `build.yml` by hand for that tag, because an assetless release means neither happened',
      patterns: [/gh workflow run build\.yml --ref/, /no\s+assets/]
    },
    {
      file: README,
      says: 'the mirror serves only what the release published: it removes the `latest/` names this release did not publish, so a withheld installer\'s card is a 404 the notes explain',
      patterns: [/removes every `latest\/`/, /404/]
    },
    {
      file: README,
      says: 'each surface publishes digests composed from the bytes it carries — beside the release\'s assets, and `latest/SHA256SUMS` on the mirror',
      patterns: [/SHA256SUMS/, /latest\/SHA256SUMS/]
    },
    {
      file: README,
      says: 'the download host the site\'s cards point at is `pub.cuerunner.app`',
      patterns: [/pub\.cuerunner\.app/]
    },
    {
      file: PROOF,
      says: 'the packaging run is started by `release.yml` dispatching `build.yml` for the tag it cut',
      patterns: [/[Dd]ispatch(es|ing)\s+`build\.yml`/]
    },
    {
      file: PROOF,
      says: 'the notes name each installer unsigned rather than presenting it as signed',
      patterns: [/release notes/i, /unsigned/i],
      forbids: [/warns and ships unsigned without them/]
    },
    {
      file: PROOF,
      says: 'a build linking the SDK with no recorded agreement has its installer withheld, and the mirror removes the name its card points at',
      patterns: [new RegExp(record), /withh(e|o)ld/i, /404/]
    },
    {
      file: PROOF,
      says: 'each release publishes digests composed from the bytes it carries, on the release page and at `latest/SHA256SUMS`',
      patterns: [/SHA256SUMS/, /latest\/SHA256SUMS/]
    },
    {
      file: PROOF,
      says: 'nothing publishes from a ref that is not a tag',
      patterns: [/not a tag/i]
    }
  ]
}

/** The prose statements that no longer hold: each named with the file that makes it. */
function proseProblems(reading: Reading): string[] {
  const problems: string[] = []
  for (const statement of releaseStatements(reading)) {
    const text = { [CHECKLIST]: reading.checklist, [README]: reading.readme, [PROOF]: reading.proof }[statement.file] ?? ''
    for (const pattern of statement.patterns) {
      if (!pattern.test(text)) {
        problems.push(
          `${statement.file} states no sentence matching ${pattern}: the file has to say that ${statement.says}, which is what ${BUILD} now enforces`
        )
      }
    }
    for (const pattern of statement.forbids ?? []) {
      if (pattern.test(text)) {
        problems.push(
          `${statement.file} still carries ${pattern}: that sentence states the behaviour this release path replaced`
        )
      }
    }
  }
  return problems
}

/** One artifact the composer is handed, and the file the download step would have left it at. */
interface Scenario {
  windowsInstaller?: string
  windowsCertificate?: string
  windowsAsio?: string
  macDmg?: string
  macCertificate?: string
  macNotarised?: string
  linuxAppimage?: string
  /** The file the download step carried, when a recording names one it did not: a run whose
   *  record and upload disagree is the state the composer exists to refuse. */
  carried?: { windows?: string; mac?: string; linux?: string }
}

/** The artifact names a release carries, in the form the runner's filesystem gives them. */
const UNSIGNED: Scenario = {
  windowsInstaller: 'Cuerunner Setup 0.14.0.exe',
  windowsCertificate: 'no',
  windowsAsio: 'off',
  macDmg: 'Cuerunner-0.14.0.dmg',
  macCertificate: 'no',
  macNotarised: 'no',
  linuxAppimage: 'Cuerunner-0.14.0.AppImage'
}

/** The same release with every certificate configured, which is the state the notes must flip. */
const SIGNED: Scenario = {
  ...UNSIGNED,
  windowsCertificate: 'yes',
  windowsAsio: 'on',
  macCertificate: 'yes',
  macNotarised: 'yes'
}

/** The composer's command, as the release job runs it. */
function composerScript(reading: Reading): string {
  const job = jobOf(reading.build, BUILD, 'release')
  const step = stepOrNull(job, COMPOSE_STEP)
  if (step === null || step.run === '') {
    throw new Error(
      `release path: ${BUILD}'s release job runs no \`${COMPOSE_STEP}\` step whose command this guard can read, so the notes cannot be run`
    )
  }
  return step.run
}

/** What the composer wrote: the section it composed, the outputs it published, its digests, and
 *  how it exited. The two lists are read from the `$GITHUB_OUTPUT` file the workflow consumes. */
interface Composed {
  notes: string
  /** The `files` output: what the release page carries, the sums file last. */
  files: string[]
  /** The `mirror` output: what the mirror copies, and no sums file. */
  mirror: string[]
  /** The lines of the `SHA256SUMS` written beside the notes. */
  sums: string[]
  status: number
  errors: string
}

/**
 * The bytes a fixture artifact holds, so the digests composed from it can be predicted: the file
 * carries a line naming itself, which keeps every artifact's digest distinct.
 */
function fixtureBytes(file: string): string {
  return `${file}\n`
}

/** The digest a `SHA256SUMS` line must carry for one fixture artifact: coreutils' own value. */
function digestOf(file: string): string {
  return createHash('sha256').update(fixtureBytes(file)).digest('hex')
}

/** One `name<<MARKER` heredoc of a `$GITHUB_OUTPUT` file, as the lines between its markers. A
 *  composer that never got that far publishes none, which the cases read as an empty list. */
function outputLines(output: string, name: string): string[] {
  const match = new RegExp(`(?:^|\\n)${name}<<([^\\n]*)\\n([\\s\\S]*?)\\n\\1(?:\\n|$)`).exec(output)
  if (match === null) return []
  const lines = match[2].split('\n')
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/**
 * The composer, run. The script is the one the workflow would execute, so what is checked is
 * the section a release would carry; the artifacts it names are written where the download step
 * would have left them, and the environment is the outputs the packaging jobs would have set.
 */
function compose(script: string, scenario: Scenario): Composed {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'release-path-'))
  fs.writeFileSync(path.join(directory, 'compose.sh'), script, 'utf-8')
  for (const [artifact, name] of [
    ['Cuerunner-windows', scenario.carried?.windows ?? scenario.windowsInstaller],
    ['Cuerunner-mac', scenario.carried?.mac ?? scenario.macDmg],
    ['Cuerunner-linux', scenario.carried?.linux ?? scenario.linuxAppimage]
  ] as Array<[string, string | undefined]>) {
    if (name === undefined || name === '') continue
    const relative = ['artifacts', artifact, name].join('/')
    fs.mkdirSync(path.join(directory, 'artifacts', artifact), { recursive: true })
    fs.writeFileSync(path.join(directory, 'artifacts', artifact, name), fixtureBytes(relative))
  }
  const output = path.join(directory, 'github-output.txt')
  fs.writeFileSync(output, '')
  // The previous run's files, as a reused self-hosted workspace would still hold them: what the
  // composer publishes has to be this run's, so every case below runs against them.
  fs.writeFileSync(path.join(directory, 'release-notes.md'), 'a previous run wrote this line\n')
  fs.writeFileSync(path.join(directory, 'release-files.txt'), 'artifacts/a-previous-run.exe\n')
  fs.writeFileSync(path.join(directory, 'SHA256SUMS'), 'a previous run wrote this line\n')
  const run = spawnSync('bash', ['compose.sh'], {
    cwd: directory,
    encoding: 'utf-8',
    env: {
      PATH: process.env.PATH ?? '',
      GITHUB_OUTPUT: output,
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_REPOSITORY: 'owner/repo',
      GITHUB_RUN_ID: '4242',
      WINDOWS_INSTALLER: scenario.windowsInstaller ?? '',
      WINDOWS_CERTIFICATE: scenario.windowsCertificate ?? '',
      WINDOWS_ASIO: scenario.windowsAsio ?? '',
      MAC_DMG: scenario.macDmg ?? '',
      MAC_CERTIFICATE: scenario.macCertificate ?? '',
      MAC_NOTARISED: scenario.macNotarised ?? '',
      LINUX_APPIMAGE: scenario.linuxAppimage ?? ''
    }
  })
  const wrote = (name: string): string => fs.readFileSync(path.join(directory, name), 'utf-8')
  const composed: Composed = {
    notes: fs.existsSync(path.join(directory, 'release-notes.md')) ? wrote('release-notes.md') : '',
    files: outputLines(wrote('github-output.txt'), 'files'),
    mirror: outputLines(wrote('github-output.txt'), 'mirror'),
    sums: fs.existsSync(path.join(directory, 'SHA256SUMS'))
      ? wrote('SHA256SUMS').split('\n').filter((line) => line !== '')
      : [],
    status: run.status ?? 1,
    errors: `${run.stdout ?? ''}${run.stderr ?? ''}`
  }
  fs.rmSync(directory, { recursive: true, force: true })
  return composed
}

/** The mirror's command, as the upload-r2 job runs it. */
function mirrorScript(reading: Reading): string {
  const job = jobOf(reading.build, BUILD, 'upload-r2')
  const step = stepOrNull(job, MIRROR_STEP)
  if (step === null || step.run === '') {
    throw new Error(
      `release path: ${BUILD}'s \`upload-r2\` job runs no \`${MIRROR_STEP}\` step whose command this guard can read, so the mirror cannot be run`
    )
  }
  return step.run
}

/** What the mirror did, as the `aws s3` calls it ran and the sums file it left behind. */
interface Mirrored {
  status: number
  copies: Array<{ from: string; to: string }>
  removals: string[]
  sums: string[]
  errors: string
}

/**
 * The mirror, run against a stub `aws`, so what it would copy, digest and remove is read rather
 * than assumed: the files the list names are written where the download step would have left
 * them, with bytes of their own so the digests it composes can be predicted, and every command
 * the step issues is logged. A withheld installer is absent from the list, so a mirror that
 * copies the list cannot carry it. A call whose argument matches `refuse` exits nonzero the way
 * a refused CLI call does — logged first, because the step's `set -eu` is what has to stop it.
 */
function mirror(script: string, files: string[], refuse = ''): Mirrored {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'release-path-r2-'))
  fs.writeFileSync(path.join(directory, 'mirror.sh'), script, 'utf-8')
  fs.mkdirSync(path.join(directory, 'bin'))
  fs.writeFileSync(
    path.join(directory, 'bin', 'aws'),
    '#!/bin/sh\n' +
      'for argument in "$@"; do printf "%s\\n" "$argument" >> "$AWS_LOG"; done\n' +
      'printf -- "---\\n" >> "$AWS_LOG"\n' +
      'if [ -n "$AWS_REFUSE" ]; then\n' +
      '  for argument in "$@"; do\n' +
      '    case "$argument" in\n' +
      '      $AWS_REFUSE) echo "stub aws: refused $argument" >&2; exit 1 ;;\n' +
      '    esac\n' +
      '  done\n' +
      'fi\n',
    { mode: 0o755 }
  )
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true })
    fs.writeFileSync(path.join(directory, file), fixtureBytes(file))
  }
  // The previous run's sums, as a reused workspace would still hold them: what the mirror writes
  // has to be this run's digests, so every case below runs against them.
  fs.writeFileSync(path.join(directory, 'SHA256SUMS'), 'a previous run wrote this line\n')
  const log = path.join(directory, 'aws.log')
  fs.writeFileSync(log, '')
  const run = spawnSync('bash', ['mirror.sh'], {
    cwd: directory,
    encoding: 'utf-8',
    env: {
      PATH: `${path.join(directory, 'bin')}:${process.env.PATH ?? ''}`,
      AWS_LOG: log,
      AWS_REFUSE: refuse,
      FILES: files.join('\n'),
      R2_BUCKET: 'bucket',
      R2_ENDPOINT: 'https://example.r2.cloudflarestorage.com',
      TAG: 'v0.14.0'
    }
  })
  const copies: Array<{ from: string; to: string }> = []
  const removals: string[] = []
  for (const call of fs.readFileSync(log, 'utf-8').split('---\n')) {
    const [tool, verb, from, to] = call.split('\n').filter((line) => line !== '')
    if (tool === 's3' && verb === 'cp') copies.push({ from, to })
    if (tool === 's3' && verb === 'rm') removals.push(from)
  }
  const mirrored: Mirrored = {
    status: run.status ?? 1,
    copies,
    removals,
    sums: fs.readFileSync(path.join(directory, 'SHA256SUMS'), 'utf-8').split('\n').filter((line) => line !== ''),
    errors: `${run.stdout ?? ''}${run.stderr ?? ''}`
  }
  fs.rmSync(directory, { recursive: true, force: true })
  return mirrored
}

describe('the release path the repository holds', () => {
  it('starts a build from a published release, and a release from nothing but the dispatch', () => {
    expect(triggerProblems(LIVE)).toEqual([])
  })

  it('starts the packaging run for the tag release.yml just cut', () => {
    expect(dispatchProblems(LIVE)).toEqual([])
  })

  it('publishes a release through that dispatch, for the ref it sends', () => {
    // The chain as one acceptance, across both files: a release is dispatched by hand and
    // published by nothing else; that run dispatches the packaging workflow for the tag
    // semantic-release cut; and the packaging workflow admits a tag ref and asks nothing about
    // the triggering event, so the dispatched run is a publishing run. This is the link that was
    // missing — a `release: published` trigger the release's own token never fires — and the
    // three checks below hold one link each.
    expect(triggerProblems(LIVE)).toEqual([])
    expect(dispatchProblems(LIVE)).toEqual([])
    expect(publishGateProblems(LIVE)).toEqual([])
  })

  it('holds every packaging job behind the run that carries the docs and numbers guards', () => {
    expect(guardGateProblems(LIVE)).toEqual([])
  })

  it('records what each build is, from the configuration that gates its signing', () => {
    expect(recordingProblems(LIVE)).toEqual([])
  })

  it('says the same state words on both sides of a recording', () => {
    expect(vocabularyProblems(LIVE)).toEqual([])
  })

  it('runs the Windows job\'s shell code in a shell that exists there', () => {
    expect(shellProblems(LIVE)).toEqual([])
  })

  it('composes the notes and the file list from those recordings', () => {
    expect(notesProblems(LIVE)).toEqual([])
  })

  it('publishes only from a tag ref', () => {
    expect(publishGateProblems(LIVE)).toEqual([])
  })

  it('withholds an ASIO-linked installer whose agreement is not recorded', () => {
    expect(asioProblems(LIVE)).toEqual([])
  })

  it('verifies the macOS app it calls signed and notarised', () => {
    expect(verificationProblems(LIVE)).toEqual([])
  })

  it('mirrors the composed list and searches for nothing', () => {
    expect(mirrorProblems(LIVE)).toEqual([])
  })

  it('holds the site\'s download links to the names the mirror writes', () => {
    expect(cardProblems(LIVE)).toEqual([])
  })

  it('states, in the prose a release engineer reads, what the workflow implements', () => {
    expect(proseProblems(LIVE)).toEqual([])
  })
})

// These two spawn the composer and the mirror, which are POSIX shell scripts the release
// lane runs on Ubuntu: a Windows runner has no `bash` on PATH, and the tools are not meant
// to run there.
describe.skipIf(process.platform === 'win32')('the notes the composer writes', () => {
  const script = composerScript(LIVE)

  it('names the repository\'s own installers unsigned, and never as signed', () => {
    const { notes, files, mirror, sums, status } = compose(script, UNSIGNED)
    expect(status, `the composer exited ${status}: ${notes}`).toBe(0)
    expect(files).toEqual([
      'artifacts/Cuerunner-windows/Cuerunner Setup 0.14.0.exe',
      'artifacts/Cuerunner-mac/Cuerunner-0.14.0.dmg',
      'artifacts/Cuerunner-linux/Cuerunner-0.14.0.AppImage',
      'SHA256SUMS'
    ])
    expect(mirror, 'the mirror list carries a file the mirror composes for itself').toEqual([
      'artifacts/Cuerunner-windows/Cuerunner Setup 0.14.0.exe',
      'artifacts/Cuerunner-mac/Cuerunner-0.14.0.dmg',
      'artifacts/Cuerunner-linux/Cuerunner-0.14.0.AppImage'
    ])
    // The digests the release page carries, under the names the page carries the files by —
    // composed from the bytes this run located, so a line cannot outlive the file it names.
    expect(sums).toEqual([
      `${digestOf('artifacts/Cuerunner-windows/Cuerunner Setup 0.14.0.exe')}  Cuerunner Setup 0.14.0.exe`,
      `${digestOf('artifacts/Cuerunner-mac/Cuerunner-0.14.0.dmg')}  Cuerunner-0.14.0.dmg`,
      `${digestOf('artifacts/Cuerunner-linux/Cuerunner-0.14.0.AppImage')}  Cuerunner-0.14.0.AppImage`
    ])
    expect(notes).toContain('Cuerunner Setup 0.14.0.exe')
    expect(notes).toContain('Cuerunner-0.14.0.dmg')
    expect(notes, 'the notes do not name the sums file they are attached with').toContain('SHA256SUMS')
    expect(notes).toContain('https://github.com/owner/repo/actions/runs/4242')
    expect(notes, 'the section carries a line from the previous run').not.toContain('a previous run wrote this line')
    expect(notes).toMatch(/no Azure Trusted Signing identity is configured/)
    expect(notes).toMatch(/no macOS certificate is configured/)
    expect(notes, 'an unsigned installer is named as signed').not.toMatch(/signed by Azure Trusted Signing/)
    expect(notes, 'an unsigned installer is named as signed').not.toMatch(/signed and notarised/)
  })

  it('names a signed build signed, and a notarised one notarised, from the same recording', () => {
    const { notes, status } = compose(script, SIGNED)
    expect(status).toBe(0)
    expect(notes).toMatch(/signed by Azure Trusted Signing/)
    expect(notes).toMatch(/signed and notarised with the certificate and the Apple credentials/)
    expect(notes).toMatch(/It links Steinberg's ASIO SDK/)
    expect(notes).not.toMatch(/no Azure Trusted Signing identity is configured/)
  })

  it('publishes no exe and names it withheld when the SDK is linked and nothing is recorded', () => {
    const { notes, files, mirror, sums, status } = compose(script, { ...UNSIGNED, windowsInstaller: '', windowsAsio: 'on' })
    expect(status).toBe(0)
    expect(files.some((file) => file.endsWith('.exe'))).toBe(false)
    expect(files).toHaveLength(3)
    expect(mirror.some((file) => file.endsWith('.exe'))).toBe(false)
    expect(mirror).toHaveLength(2)
    expect(sums.map((line) => line.slice(line.indexOf('  ') + 2))).toEqual([
      'Cuerunner-0.14.0.dmg',
      'Cuerunner-0.14.0.AppImage'
    ])
    expect(notes).toMatch(/no installer is published/)
    expect(notes).toContain(recordOf(LIVE.build))
    expect(notes, 'the withheld installer\'s card is left unexplained').toMatch(/404/)
    expect(notes, 'a withheld installer is still described as published').not.toContain('Cuerunner Setup 0.14.0.exe')
  })

  it('refuses to compose a state it cannot describe, rather than writing one', () => {
    const unknown = compose(script, { ...UNSIGNED, windowsCertificate: 'maybe' })
    expect(unknown.status).not.toBe(0)
    expect(unknown.errors).toMatch(/certificate state "maybe"/)
    const unnotarised = compose(script, { ...SIGNED, macNotarised: 'no' })
    expect(unnotarised.status).not.toBe(0)
    expect(unnotarised.errors).toMatch(/no notarisation credentials/)
  })

  it('fails when a recording names a file this run did not carry', () => {
    const missing = compose(script, { ...UNSIGNED, carried: { windows: 'Cuerunner Setup 0.13.0.exe' } })
    expect(missing.status).not.toBe(0)
    expect(missing.errors).toMatch(/hold no file by that name/)
    // A list that quietly dropped the file would be how the notes, the release page and the
    // mirror start saying different things: the composer publishes no list at all, and no short
    // sums file either.
    expect(missing.files, 'the failed composer still published a list').toEqual([])
    expect(missing.mirror, 'the failed composer still published a mirror list').toEqual([])
    expect(missing.sums, 'the failed composer still wrote a sums file').toEqual([])
  })

  it('composes the notes from the words each recorder actually writes', () => {
    // The coupling the other cases cannot see: these values are read out of the recorders' own
    // scripts rather than chosen here, so a recorder that starts writing a word the composer
    // does not read fails this case as well as the vocabulary check above — which is how the
    // `yes`/`off` mismatch between the probe's answer and the composer's arms would have been
    // caught before a release job died on it.
    const windows = stepOrNull(jobOf(LIVE.build, BUILD, 'build-windows'), 'Record what this installer is')
    const mac = stepOrNull(jobOf(LIVE.build, BUILD, 'build-mac'), 'Record what this build is')
    if (windows === null || mac === null) {
      throw new Error('release path: a recording step is missing, so the words the composer is handed cannot be read')
    }
    for (const certificate of recordedStates(commands(windows.run), 'certificate')) {
      for (const asio of recordedStates(commands(windows.run), 'asio')) {
        for (const installer of asio === 'on' ? [UNSIGNED.windowsInstaller, ''] : [UNSIGNED.windowsInstaller]) {
          const composed = compose(script, {
            ...UNSIGNED,
            windowsCertificate: certificate,
            windowsAsio: asio,
            windowsInstaller: installer
          })
          expect(
            composed.status,
            `windows certificate=${certificate} asio=${asio} installer=${installer || '(withheld)'}: ${composed.errors}`
          ).toBe(0)
        }
      }
    }
    for (const certificate of recordedStates(commands(mac.run), 'certificate')) {
      for (const notarised of recordedStates(commands(mac.run), 'notarised')) {
        // A certificate with no notarisation is the one combination the composer refuses on
        // purpose: the verify step fails such a build before this job ever runs.
        if (certificate === 'yes' && notarised === 'no') continue
        const composed = compose(script, { ...UNSIGNED, macCertificate: certificate, macNotarised: notarised })
        expect(composed.status, `mac certificate=${certificate} notarised=${notarised}: ${composed.errors}`).toBe(0)
      }
    }
  })
})

// These two spawn the composer and the mirror, which are POSIX shell scripts the release
// lane runs on Ubuntu: a Windows runner has no `bash` on PATH, and the tools are not meant
// to run there.
describe.skipIf(process.platform === 'win32')('the mirror the composed list fills', () => {
  const script = mirrorScript(LIVE)

  it('copies exactly the files the notes were composed from, under the names the site links', () => {
    const composed = compose(composerScript(LIVE), UNSIGNED)
    const { status, copies, removals, errors } = mirror(script, composed.mirror)
    expect(status, `the mirror exited ${status}: ${errors}`).toBe(0)
    expect(copies.map((copy) => copy.to)).toEqual([
      's3://bucket/versions/v0.14.0/Cuerunner-Setup.exe',
      's3://bucket/latest/Cuerunner-Setup.exe',
      's3://bucket/versions/v0.14.0/Cuerunner.dmg',
      's3://bucket/latest/Cuerunner.dmg',
      's3://bucket/versions/v0.14.0/Cuerunner.AppImage',
      's3://bucket/latest/Cuerunner.AppImage',
      's3://bucket/latest/SHA256SUMS'
    ])
    expect(copies.map((copy) => copy.from)).toEqual([
      'artifacts/Cuerunner-windows/Cuerunner Setup 0.14.0.exe',
      'artifacts/Cuerunner-windows/Cuerunner Setup 0.14.0.exe',
      'artifacts/Cuerunner-mac/Cuerunner-0.14.0.dmg',
      'artifacts/Cuerunner-mac/Cuerunner-0.14.0.dmg',
      'artifacts/Cuerunner-linux/Cuerunner-0.14.0.AppImage',
      'artifacts/Cuerunner-linux/Cuerunner-0.14.0.AppImage',
      'SHA256SUMS'
    ])
    expect(removals, 'a release that published all three names still removed one').toEqual([])
  })

  it('writes the digests of the bytes it copied, under the names it wrote them by', () => {
    const composed = compose(composerScript(LIVE), UNSIGNED)
    const { status, sums, errors } = mirror(script, composed.mirror)
    expect(status, `the mirror exited ${status}: ${errors}`).toBe(0)
    // The buyer's file: the bytes a card hands out, digested under the name the card links —
    // `Cuerunner-Setup.exe` rather than the build's `Cuerunner Setup 0.14.0.exe` — in coreutils'
    // own `<digest>  <name>` form, and with nothing of an earlier run's sums left in it.
    expect(sums).toEqual([
      `${digestOf('artifacts/Cuerunner-windows/Cuerunner Setup 0.14.0.exe')}  Cuerunner-Setup.exe`,
      `${digestOf('artifacts/Cuerunner-mac/Cuerunner-0.14.0.dmg')}  Cuerunner.dmg`,
      `${digestOf('artifacts/Cuerunner-linux/Cuerunner-0.14.0.AppImage')}  Cuerunner.AppImage`
    ])
  })

  it('mirrors no installer the notes name withheld, and removes the name its card points at', () => {
    const withheld = compose(composerScript(LIVE), { ...UNSIGNED, windowsInstaller: '', windowsAsio: 'on' })
    const { status, copies, removals } = mirror(script, withheld.mirror)
    expect(status).toBe(0)
    expect(copies.some((copy) => copy.to.endsWith('Cuerunner-Setup.exe'))).toBe(false)
    expect(copies).toHaveLength(5)
    expect(removals).toEqual(['s3://bucket/latest/Cuerunner-Setup.exe'])
  })

  it('removes every name the list it was handed does not carry', () => {
    const { status, copies, removals } = mirror(script, ['artifacts/Cuerunner-linux/Cuerunner-0.14.0.AppImage'])
    expect(status).toBe(0)
    expect(copies.map((copy) => copy.to)).toEqual([
      's3://bucket/versions/v0.14.0/Cuerunner.AppImage',
      's3://bucket/latest/Cuerunner.AppImage',
      's3://bucket/latest/SHA256SUMS'
    ])
    expect(removals).toEqual(['s3://bucket/latest/Cuerunner-Setup.exe', 's3://bucket/latest/Cuerunner.dmg'])
  })

  it('stops at a refused removal, rather than reading a refusal as a removal that happened', () => {
    // The token that refuses `DeleteObject`: the step fails, and the names after the refused one
    // are left alone rather than reported as removed — which is what `set -eu` and the docs'
    // "a refusal fails the step" rest on.
    const { status, removals, errors } = mirror(
      script,
      ['artifacts/Cuerunner-linux/Cuerunner-0.14.0.AppImage'],
      's3://bucket/latest/Cuerunner-Setup.exe'
    )
    expect(status, `the mirror exited ${status}: ${errors}`).not.toBe(0)
    expect(removals).toEqual(['s3://bucket/latest/Cuerunner-Setup.exe'])
  })

  it('publishes no sums file when a copy failed', () => {
    // The sums upload runs after every copy, so a copy the CLI refuses has to leave
    // `latest/SHA256SUMS` unwritten rather than carrying a short list of digests.
    const composed = compose(composerScript(LIVE), UNSIGNED)
    const { status, copies, errors } = mirror(script, composed.mirror, 's3://bucket/latest/Cuerunner.AppImage')
    expect(status, `the mirror exited ${status}: ${errors}`).not.toBe(0)
    expect(copies.map((copy) => copy.to), 'the refused copy was never attempted').toContain(
      's3://bucket/latest/Cuerunner.AppImage'
    )
    expect(copies.map((copy) => copy.to)).not.toContain('s3://bucket/latest/SHA256SUMS')
  })

  it('refuses a file it cannot place under a name the site links', () => {
    const { status, errors } = mirror(script, ['artifacts/Cuerunner-windows/release-notes.md'])
    expect(status).not.toBe(0)
    expect(errors).toMatch(/cannot place/)
  })
})

/**
 * The states the checks exist to refuse, one change at a time: each case doctors one thing in
 * the live reading and asserts that the check names it. These are what hold the release path —
 * the live run above only says nothing has drifted yet — so each failure has to be one a reader
 * can act on.
 */
describe('the release path the checks exist to refuse', () => {
  it('names a release workflow that can be started by something other than the dispatch', () => {
    expect(triggerProblems(doctored(LIVE, 'on:\n  workflow_dispatch:', 'on:\n  push:\n  workflow_dispatch:'))).toEqual([
      expect.stringContaining('.github/workflows/release.yml declares on: push, workflow_dispatch')
    ])
  })

  it('names a build that no longer starts from a published release', () => {
    expect(triggerProblems(doctored(LIVE, '  release:\n    types: [published]\n', ''))).toEqual([
      expect.stringContaining('declares no `release` trigger')
    ])
    expect(triggerProblems(doctored(LIVE, 'types: [published]', 'types: [created]'))).toEqual([
      expect.stringContaining('starts a build from the `release` event with types: created')
    ])
  })

  it('names a release workflow that dispatches something other than the packaging run', () => {
    const undispatch = doctored(LIVE, 'actions/workflows/build.yml/dispatches', 'actions/workflows/other.yml/dispatches')
    expect(dispatchProblems(undispatch)).toEqual([expect.stringContaining('starts no packaging run')])
  })

  it('names a dispatch pointed at the branch it was started from', () => {
    const branch = doctored(LIVE, '-d "{\\"ref\\":\\"$tag\\"}"', '-d "{\\"ref\\":\\"main\\"}"')
    expect(dispatchProblems(branch)).toEqual([
      expect.stringContaining('sends `ref` from `main`')
    ])
  })

  it('names a dispatch that never asked for the token permission it needs', () => {
    const unprivileged = doctored(LIVE, '  # The packaging dispatch below: the workflow-dispatch endpoint is an `actions: write`\n  # call, and the job\'s token is the one that makes it.\n  actions: write\n', '')
    expect(dispatchProblems(unprivileged)).toEqual([
      expect.stringContaining('is granted `actions: nothing`')
    ])
  })

  it('names a publishing gate that would skip the run this repository starts', () => {
    const eventGated = doctored(
      LIVE,
      "    if: github.ref_type == 'tag' && success()\n    runs-on: [self-hosted, linux, x64, ubox]\n    # The lists the release page",
      "    if: github.ref_type == 'tag' && github.event_name == 'release' && success()\n    runs-on: [self-hosted, linux, x64, ubox]\n    # The lists the release page"
    )
    expect(publishGateProblems(eventGated)).toEqual([
      expect.stringContaining('gates on `github.event_name`')
    ])
  })

  it('names a packaging job that starts before the guards have run', () => {
    const problems = guardGateProblems(doctored(LIVE, '  build-mac:\n    needs: [ test, test-e2e ]', '  build-mac:\n    needs: [ test-e2e ]'))
    expect(problems).toEqual([expect.stringContaining("`build-mac` job does not wait on `test`")])
  })

  it('names the test job that stopped running the suite the guards live in', () => {
    expect(guardGateProblems(doctored(LIVE, '      - name: Unit tests\n        run: npm test', '      - name: Unit tests\n        run: npm run typecheck'))).toEqual([
      expect.stringContaining('runs no `npm test`')
    ])
  })

  it('names a recording that is no longer handed what the signing decision answered', () => {
    const hidden = doctored(
      LIVE,
      '          SIGNED: ${{ steps.signing.outputs.signed }}\n          ASIO: ${{ steps.asio.outputs.found }}',
      '          ASIO: ${{ steps.asio.outputs.found }}'
    )
    expect(recordingProblems(hidden)).toEqual([
      expect.stringContaining('does not read `${{ steps.signing.outputs.signed }}`')
    ])
  })

  it('names a signing decision that is no longer handed what it decides from', () => {
    const missing = doctored(
      LIVE,
      '          AZURE_TENANT_ID: ${{ secrets.AZURE_TENANT_ID }}\n          AZURE_CLIENT_ID: ${{ secrets.AZURE_CLIENT_ID }}\n          AZURE_CLIENT_SECRET: ${{ secrets.AZURE_CLIENT_SECRET }}\n        run: |\n          $plan =',
      '          AZURE_TENANT_ID: ${{ secrets.AZURE_TENANT_ID }}\n        run: |\n          $plan ='
    )
    expect(recordingProblems(missing)).toEqual([
      expect.stringContaining('does not read `secrets.AZURE_CLIENT_ID`, one of the three credentials'),
      expect.stringContaining('does not read `secrets.AZURE_CLIENT_SECRET`, one of the three credentials')
    ])
  })

  it('names a packaging step that configures its own signing rather than asking', () => {
    const own = doctored(
      LIVE,
      "          $signArgs = @(ConvertFrom-Json '${{ steps.signing.outputs.args }}' | Where-Object { $_ })",
      "          $signArgs = @('--config.win.azureSignOptions.publisherName=CN=Cuerunner Ltd')"
    )
    expect(recordingProblems(own)).toEqual([
      expect.stringContaining('configures Trusted Signing itself rather than taking the flags')
    ])
  })

  it('names a packaged config that configures signing for every build in the tree', () => {
    const declared = doctored(
      LIVE,
      '    "win": {\n      "target": [',
      '    "win": {\n      "azureSignOptions": {\n        "publisherName": "CN=Cuerunner Ltd",\n        "endpoint": "https://weu.codesigning.azure.net",\n        "certificateProfileName": "cuerunner",\n        "codeSigningAccountName": "cuerunner"\n      },\n      "target": [',
      'package'
    )
    expect(recordingProblems(declared)).toEqual([
      expect.stringContaining('declares `build.win.azureSignOptions`')
    ])
  })

  it('names a certificate state that is no longer read from the configuration that gates signing', () => {
    const hardcoded = doctored(
      LIVE,
      "$certificate = if ($env:SIGNED -eq 'yes') { 'yes' } else { 'no' }",
      "$certificate = 'yes'"
    )
    expect(recordingProblems(hardcoded)).toEqual([
      expect.stringContaining('never reads it'),
      expect.stringContaining("records no `'no'` state")
    ])
  })

  it('names a job whose recording is no longer what the release job reads', () => {
    const rewired = doctored(
      LIVE,
      '      installer: ${{ steps.publish.outputs.installer }}\n      certificate: ${{ steps.publish.outputs.certificate }}',
      '      installer: ${{ steps.publish.outputs.installer }}\n      certificate: ${{ steps.publish.outputs.signed }}'
    )
    expect(recordingProblems(rewired)).toEqual([
      expect.stringContaining('does not publish `certificate` as `${{ steps.publish.outputs.certificate }}`')
    ])
  })

  it('names a release whose notes are not the composed section', () => {
    const globbed = doctored(
      LIVE,
      '          files: ${{ steps.notes.outputs.files }}\n          fail_on_unmatched_files: true',
      '          files: artifacts/**/*\n          fail_on_unmatched_files: true'
    )
    expect(notesProblems(globbed)).toEqual([
      expect.stringContaining('publishes files of its own choosing (`files: artifacts/**/*`)')
    ])
  })

  it('names a release job that publishes no list for the mirror to copy', () => {
    const unexported = doctored(
      LIVE,
      '    outputs:\n      files: ${{ steps.notes.outputs.files }}\n      mirror: ${{ steps.notes.outputs.mirror }}\n',
      '    outputs:\n      mirror: ${{ steps.notes.outputs.mirror }}\n'
    )
    expect(notesProblems(unexported)).toEqual([
      expect.stringContaining('publishes no `files` output composed by the notes step')
    ])
  })

  it('names a release job that publishes no mirror list', () => {
    const unexported = doctored(
      LIVE,
      '    outputs:\n      files: ${{ steps.notes.outputs.files }}\n      mirror: ${{ steps.notes.outputs.mirror }}\n',
      '    outputs:\n      files: ${{ steps.notes.outputs.files }}\n'
    )
    expect(notesProblems(unexported)).toEqual([
      expect.stringContaining('publishes no `mirror` output composed by the notes step')
    ])
  })

  it('names a release body that would replace semantic-release\'s notes', () => {
    expect(notesProblems(doctored(LIVE, '          append_body: true', '          append_body: false'))).toEqual([
      expect.stringContaining('does not set `append_body: true`')
    ])
  })

  it('names a release job whose composer stopped reading a recording', () => {
    expect(notesProblems(doctored(LIVE, '          WINDOWS_ASIO: ${{ needs.build-windows.outputs.asio }}\n', ''))).toEqual([
      expect.stringContaining('does not read `${{ needs.build-windows.outputs.asio }}`')
    ])
  })

  it('names publication that no longer waits on the tag ref', () => {
    const onBranch = doctored(
      LIVE,
      "    if: github.ref_type == 'tag' && success()\n    runs-on: [self-hosted, linux, x64, ubox]\n    # The lists the release page",
      "    if: github.ref_type == 'branch' && success()\n    runs-on: [self-hosted, linux, x64, ubox]\n    # The lists the release page"
    )
    expect(publishGateProblems(onBranch)).toEqual([
      expect.stringContaining("which does not test `github.ref_type == 'tag'`")
    ])
  })

  it('names a gate that dropped the jobs it needs by testing the ref', () => {
    const forgotten = doctored(
      LIVE,
      "    if: github.ref_type == 'tag' && success()\n    runs-on: [self-hosted, linux, x64, ubox]\n    # The lists the release page",
      "    if: github.ref_type == 'tag'\n    runs-on: [self-hosted, linux, x64, ubox]\n    # The lists the release page"
    )
    expect(publishGateProblems(forgotten)).toEqual([expect.stringContaining('drops `success()`')])
  })

  it('names an ASIO gate that reads something other than the SDK probe', () => {
    const invented = doctored(LIVE, '          ASIO: ${{ steps.asio.outputs.found }}', '          ASIO: yes')
    expect(asioProblems(invented)).toEqual([
      expect.stringContaining("does not read the SDK probe's own output")
    ])
  })

  it('names an installer that would be uploaded after being withheld', () => {
    const uploaded = doctored(LIVE, "        if: steps.publish.outputs.installer != ''\n        uses: actions/upload-artifact@v7", '        uses: actions/upload-artifact@v7')
    expect(asioProblems(uploaded)).toEqual([
      expect.stringContaining('rather than on the recorded installer')
    ])
  })

  it('names an upload that stopped being the file its job recorded', () => {
    expect(asioProblems(doctored(LIVE, '          path: dist/${{ steps.publish.outputs.dmg }}', '          path: dist/*.dmg'))).toEqual([
      expect.stringContaining('uploads `dist/*.dmg` rather than the file it recorded')
    ])
  })

  it('names a mirror that searches the downloaded artifacts for something to copy', () => {
    const searched = doctored(
      LIVE,
      '          while IFS= read -r file; do',
      '          EXE=$(find artifacts -name "*.exe" | head -1)\n          while IFS= read -r file; do'
    )
    expect(mirrorProblems(searched)).toEqual([
      expect.stringContaining('searches the downloaded artifacts for files to copy')
    ])
  })

  it('names a mirror that copies a list of its own', () => {
    const own = doctored(
      LIVE,
      '          FILES: ${{ needs.release.outputs.mirror }}',
      '          FILES: /tmp/files.txt'
    )
    expect(mirrorProblems(own)).toEqual([expect.stringContaining('does not read the mirror list')])
  })

  it('names a mirror handed the release page\'s list, which names its own sums file', () => {
    const pages = doctored(
      LIVE,
      '          FILES: ${{ needs.release.outputs.mirror }}',
      '          FILES: ${{ needs.release.outputs.files }}'
    )
    expect(mirrorProblems(pages)).toEqual([expect.stringContaining('does not read the mirror list')])
  })

  it('names a card that links a file the mirror does not write', () => {
    const renamed = doctored(
      LIVE,
      'https://pub.cuerunner.app/latest/Cuerunner.dmg',
      'https://pub.cuerunner.app/latest/Cuerunner-universal.dmg',
      'guides'
    )
    expect(cardProblems(renamed)).toEqual([
      expect.stringContaining('links `https://pub.cuerunner.app/latest/Cuerunner-universal.dmg`')
    ])
  })

  it('names a mirror name the cards stopped linking', () => {
    const renamed = doctored(LIVE, 'AppImage=Cuerunner.AppImage', 'AppImage=Cuerunner-test.AppImage', 'build')
    expect(cardProblems(renamed)).toEqual([
      expect.stringContaining('links `https://pub.cuerunner.app/latest/Cuerunner.AppImage`'),
      expect.stringContaining('no card links `https://pub.cuerunner.app/latest/Cuerunner-test.AppImage`')
    ])
  })

  it('names a mirror whose names this guard cannot read', () => {
    const unreadable = doctored(
      LIVE,
      "NAMES='exe=Cuerunner-Setup.exe dmg=Cuerunner.dmg AppImage=Cuerunner.AppImage'",
      "NAMES='Cuerunner-Setup.exe Cuerunner.dmg'"
    )
    expect(() => cardProblems(unreadable)).toThrow(/does not read as a space-separated/)
  })

  it('names a download surface that renders a state of its own', () => {
    const scripted = doctored(
      LIVE,
      '        Cuerunner is distributed outside the app stores: the',
      '        <script>fetch("https://pub.cuerunner.app/latest/SHA256SUMS")</script>\n        Cuerunner is distributed outside the app stores: the',
      'guides'
    )
    expect(cardProblems(scripted)).toEqual([expect.stringContaining('carries a script or a `fetch(`')])
  })

  it('names a download surface that stopped naming the release notes', () => {
    const silent = doctored(LIVE, 'https://github.com/Huckcity/cuerunner/releases/latest', 'https://github.com/Huckcity/cuerunner/releases', 'index')
    expect(cardProblems(silent)).toEqual([
      expect.stringContaining('names no release notes')
    ])
  })

  it('names a download surface that would render a state it cannot know', () => {
    const rendered = doctored(
      LIVE,
      '<section id="download" class="panel reveal delay-3">',
      '<section id="download" class="panel reveal delay-3"><script>fetch(\'./release.json\')</script>',
      'index'
    )
    expect(cardProblems(rendered)).toEqual([expect.stringContaining('carries a script')])
  })

  it('names a mirror that does not wait on the release it copies', () => {
    const earlier = doctored(LIVE, '  upload-r2:\n    needs: release\n', '  upload-r2:\n')
    expect(mirrorProblems(earlier)).toEqual([
      expect.stringContaining('does not wait on `release`')
    ])
  })

  it('names a POSIX script left to run under the Windows default shell', () => {
    const posix = doctored(
      LIVE,
      '      - name: Build and package\n        shell: pwsh\n        env:\n          AZURE_TENANT_ID: ${{ secrets.AZURE_TENANT_ID }}\n          AZURE_CLIENT_ID: ${{ secrets.AZURE_CLIENT_ID }}\n          AZURE_CLIENT_SECRET: ${{ secrets.AZURE_CLIENT_SECRET }}\n        run: |',
      '      - name: Build and package\n        env:\n          AZURE_TENANT_ID: ${{ secrets.AZURE_TENANT_ID }}\n        run: |\n          if [ -z "$AZURE_CLIENT_SECRET" ]; then'
    )
    expect(shellProblems(posix)).toEqual([
      expect.stringContaining("runs a POSIX shell script with no `shell:`")
    ])
  })

  it('names a recording that writes a state the composer cannot read', () => {
    // The defect this check exists for: the recorder publishing the probe's own word (`yes`)
    // where the composer's arms say `on`, which no executed check can see because they hand the
    // composer the words it already accepts.
    const probeWord = doctored(
      LIVE,
      "$asio = if ($env:ASIO -eq 'yes') { 'on' } else { 'off' }",
      "$asio = if ($env:ASIO -eq 'yes') { 'yes' } else { 'no' }"
    )
    expect(vocabularyProblems(probeWord)).toEqual([
      expect.stringContaining('writes `asio=yes`'),
      expect.stringContaining('the state the recorder writes is not one the composer reads')
    ])
  })

  it('names the composer that stopped reading a word its recording writes', () => {
    const arms = doctored(
      LIVE,
      "              on) windows=\"$windows. It links Steinberg's ASIO SDK",
      "              yes) windows=\"$windows. It links Steinberg's ASIO SDK"
    )
    expect(vocabularyProblems(arms)).toEqual([
      expect.stringContaining("the composer's `case \"$WINDOWS_ASIO\" in` does not accept")
    ])
  })

  it('names the macOS pair drifting apart', () => {
    const notarised = doctored(LIVE, "            notarised='yes'", "            notarised='on'")
    expect(vocabularyProblems(notarised)).toEqual([expect.stringContaining('writes `notarised=on`')])
  })

  it('names a recording whose state this guard cannot read at all', () => {
    const unreadable = doctored(
      LIVE,
      "          $certificate = if ($env:SIGNED -eq 'yes') { 'yes' } else { 'no' }",
      '          $certificate = "signed"'
    )
    expect(vocabularyProblems(unreadable)).toEqual([
      expect.stringContaining('writes no `certificate` state this guard can read')
    ])
  })

  it('names an ASIO gate that publishes whether or not the record is there', () => {
    const inverted = doctored(LIVE, '$withheld = $asio -eq \'on\' -and -not $recorded', "$withheld = $asio -eq 'on' -and $recorded")
    expect(asioProblems(inverted)).toEqual([
      expect.stringContaining('does not withhold *unless* the agreement is unrecorded')
    ])
  })

  it('names an ASIO gate that an empty record would satisfy', () => {
    const placeholder = doctored(
      LIVE,
      '          $recorded = $null -ne $agreement -and $agreement.Length -gt 0\n',
      '          $recorded = Test-Path native/audio/third_party/ASIO-AGREEMENT.md\n'
    )
    expect(asioProblems(placeholder)).toEqual([
      expect.stringContaining("decides whether the agreement is recorded without reading the record's size")
    ])
  })

  it('names a probe whose two answers are swapped', () => {
    const swapped = doctored(
      LIVE,
      'echo found=no>>"%GITHUB_OUTPUT%" & exit /b 0)\n          echo CUERUNNER_ASIO_SDK=%ASIO%>>"%GITHUB_ENV%"\n          echo found=yes>>"%GITHUB_OUTPUT%"',
      'echo found=yes>>"%GITHUB_OUTPUT%" & exit /b 0)\n          echo CUERUNNER_ASIO_SDK=%ASIO%>>"%GITHUB_ENV%"\n          echo found=no>>"%GITHUB_OUTPUT%"'
    )
    const problems = asioProblems(swapped)
    expect(problems).toContainEqual(expect.stringContaining('answers "no SDK" without `found=no`'))
    expect(problems).toContainEqual(expect.stringContaining('names no `found=yes` after the branch that found an SDK'))
  })

  it('names a macOS verification that would not fail a bad build', () => {
    const swallowed = doctored(LIVE, 'xcrun stapler validate "$DMG"', 'xcrun stapler validate "$DMG" || true')
    expect(verificationProblems(swallowed)).toEqual([
      expect.stringContaining('swallows a verification failure with `|| true`')
    ])
  })

  it('names a macOS verification that stopped checking Gatekeeper\'s assessment', () => {
    const incomplete = doctored(LIVE, 'spctl --assess --type execute --verbose=2 "$APP"\n', '')
    expect(verificationProblems(incomplete)).toEqual([
      expect.stringContaining('does not run `spctl --assess`')
    ])
  })

  it('names a release job that cannot tell a cut tag from an old one', () => {
    const compared = doctored(LIVE, 'if [ "$tag" = "$BEFORE" ]; then', 'if [ "$tag" != "$BEFORE" ]; then')
    expect(dispatchProblems(compared)).toEqual([
      expect.stringContaining('does not skip when the tag it resolved equals `$BEFORE`')
    ])
  })

  it('names a dispatch that reads no pre-release tag at all', () => {
    const unbound = doctored(LIVE, '          BEFORE: ${{ steps.tags.outputs.before }}\n', '          BEFORE: \'\'\n')
    expect(dispatchProblems(unbound)).toEqual([
      expect.stringContaining('dispatch reads no `${{ steps.tags.outputs.before }}`')
    ])
  })

  it('names a macOS recording that could call a build notarised with no certificate', () => {
    const unpaired = doctored(
      LIVE,
      '          if [ "$certificate" = \'yes\' ] && [ -n "$APPLE_ID" ]',
      '          if [ -n "$APPLE_ID" ]'
    )
    expect(recordingProblems(unpaired)).toEqual([
      expect.stringContaining('derives `notarised` from the Apple credentials alone')
    ])
  })

  it('names a Linux job that grew a signing step', () => {
    const signed = doctored(
      LIVE,
      '          echo "appimage=$(basename "$APPI")" >> "$GITHUB_OUTPUT"',
      '          cosign sign "$APPI"\n          echo "appimage=$(basename "$APPI")" >> "$GITHUB_OUTPUT"'
    )
    expect(recordingProblems(signed)).toEqual([
      expect.stringContaining('names a signing secret or a signing tool')
    ])
  })

  it('names prose that stopped naming the record the gate reads', () => {
    const renamed = doctored(
      LIVE,
      'native/audio/third_party/ASIO-AGREEMENT.md',
      'native/audio/third_party/ASIO-AGREEMENTS.md',
      'checklist'
    )
    const problems = proseProblems(renamed)
    expect(problems).toEqual([expect.stringContaining('.github/RELEASE_CHECKLIST.md states no sentence matching')])
  })

  it('names the sentence that called the ASIO gate a checklist item', () => {
    const stale = doctored(
      LIVE,
      'The pipeline enforces that',
      'That is a release-checklist item, not a build-time one',
      'readme'
    )
    expect(proseProblems(stale)).toEqual([
      expect.stringContaining('README.md still carries /checklist item, not a build-time one/')
    ])
  })

  it('names the sentence that said the workflow ships unsigned without saying so', () => {
    const stale = doctored(
      LIVE,
      'verifies signatures when\n  the signing configuration is supplied',
      'warns and ships unsigned without them',
      'proof'
    )
    expect(proseProblems(stale)).toEqual([
      expect.stringContaining('still carries /warns and ships unsigned without them/')
    ])
  })
})
