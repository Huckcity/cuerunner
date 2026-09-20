// The platform and runtime floors, held to the things that ship them: the macOS floor the
// packaged app declares to the system, and the Node floor the package declares to npm. The
// declaration is the source, and the prose follows it.
//
// Neither used to be declared. The README, the landing page and the contract each said macOS
// 12+ while `build.mac` carried nothing, so no package told macOS 12 was its floor, and with no
// `engines` field an install on a Node older than CI's was not even warned about. Nothing read
// the sentences either, so the two could drift silently — which is what this reads them for, the
// way scripts/theme.test.ts reads App.css rather than a copy of its values. It sits among the
// script tests for the same reason that one does: reading files is Node's to do.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Reads a file the guard cannot run without: an absent input is a failure, never a skip. */
function read(relative: string): string {
  try {
    return fs.readFileSync(path.join(root, relative), 'utf-8')
  } catch (cause) {
    throw new Error(`published floors: ${relative} cannot be read — ${(cause as Error).message}`)
  }
}

/**
 * A version reduced to the major it states. Both declarations are written as a whole major —
 * `"12.0"`, `">=24"` — because that is all the prose can state: "macOS 12+" and "Node 24"
 * promise the whole major runs, so a floor finer than it disagrees with the prose it is held to.
 */
function declaredMajor(version: string, where: string): number {
  const match = /^(?:>=\s*)?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(version.trim())
  if (match === null) throw new Error(`published floors: ${where} is "${version}", which names no version`)
  const [, major, minor = '0', patch = '0'] = match
  if (minor !== '0' || patch !== '0') {
    throw new Error(
      `published floors: ${where} is "${version}", a floor finer than the whole major its prose states`
    )
  }
  return Number(major)
}

interface Manifest {
  engines?: { node?: unknown }
  build?: { mac?: { minimumSystemVersion?: unknown } }
}

const manifest = JSON.parse(read('package.json')) as Manifest

/** Reads a declaration the guard cannot run without: missing is a failure, not an empty pass. */
function declared(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`published floors: package.json declares no ${field}`)
  }
  return value.trim()
}

/** A floor statement, with the file and line it was read from. */
interface Statement {
  file: string
  line: number
  text: string
  major: number
}

const MACOS_FIELD = 'package.json build.mac.minimumSystemVersion'
const NODE_FIELD = 'package.json engines.node'
const MACOS = declared(manifest.build?.mac?.minimumSystemVersion, 'build.mac.minimumSystemVersion')
const NODE = declared(manifest.engines?.node, 'engines.node')
const MACOS_MAJOR = declaredMajor(MACOS, MACOS_FIELD)
const NODE_MAJOR = declaredMajor(NODE, NODE_FIELD)

/**
 * Every `macOS <N>` mention in a text — the floor is the only reason these files name a macOS
 * version, so the `+` is optional and the case is free: "macOS 12 or later" is the same statement,
 * and a rewording must not become invisible to the guard.
 */
function macOSStatements(file: string, text: string): Statement[] {
  const found: Statement[] = []
  text.split('\n').forEach((line, index) => {
    for (const match of line.matchAll(/macOS\s+(\d+(?:\.\d+)*)/gi)) {
      found.push({ file, line: index + 1, text: match[0], major: declaredMajor(match[1], `${file}:${index + 1}`) })
    }
  })
  return found
}

/** The statements that disagree with a declaration, each naming its file and both values. */
function disagreements(statements: Statement[], field: string, declaration: string, major: number): string[] {
  return statements
    .filter((each) => each.major !== major)
    .map((each) => `${each.file}:${each.line} says "${each.text}", but ${field} is "${declaration}"`)
}

/** Every page under website/, as text: the landing page is where the site states the floor. */
function sitePages(): Array<{ file: string; text: string }> {
  let entries: string[]
  try {
    entries = fs.readdirSync(path.join(root, 'website'), { recursive: true, encoding: 'utf-8' })
  } catch (cause) {
    throw new Error(`published floors: website/ cannot be walked — ${(cause as Error).message}`)
  }
  const pages = entries.filter((entry) => entry.endsWith('.html')).sort()
  if (pages.length === 0) throw new Error('published floors: website/ has no pages to read')
  return pages.map((entry) => {
    const file = `website/${entry.split(path.sep).join('/')}`
    return { file, text: read(file) }
  })
}

/**
 * The Node floors the README's prerequisites state — the support statement, not its history: the
 * README also documents a Node 26 install bug and the CI lane list, which are not floors. Each
 * bullet's first mention is the floor the declaration is held to; every mention on the bullet,
 * including a version only exercised beside it, has to be one a lane pins, so a clause like
 * "Node 26 is exercised too" cannot outlive the lane that exercises it.
 */
function readmePrerequisites(text: string): { floors: Statement[]; named: Statement[] } {
  const lines = text.split('\n')
  const heading = lines.findIndex((line) => /^#+\s*Prerequisites\s*$/i.test(line))
  if (heading === -1) throw new Error('published floors: README.md has no Prerequisites section')
  const floors: Statement[] = []
  const named: Statement[] = []
  for (let index = heading + 1; index < lines.length && !lines[index].startsWith('#'); index += 1) {
    if (!/^[-*]\s+\S/.test(lines[index])) continue
    for (const [position, match] of [...lines[index].matchAll(/Node (\d+(?:\.\d+)*)\b/g)].entries()) {
      const statement = {
        file: 'README.md',
        line: index + 1,
        text: match[0],
        major: declaredMajor(match[1], `README.md:${index + 1}`)
      }
      named.push(statement)
      if (position === 0) floors.push(statement)
    }
  }
  return { floors, named }
}

/**
 * Every Node the workflows pin by `node-version:` — a scalar, a `[24, 26]` list, or a
 * `${{ matrix.node-version }}` that defers to a list the same file declares and is resolved to it.
 * Nothing is skipped silently: a value-less key, an expression the guard cannot resolve and a
 * `node-version-file:` (a pin that lives in another file) each fail, so no lane can drop below the
 * floor unseen.
 */
function ciNodeStatements(): Statement[] {
  const directory = '.github/workflows'
  let names: string[]
  try {
    names = fs.readdirSync(path.join(root, directory)).filter((name) => /\.ya?ml$/.test(name)).sort()
  } catch (cause) {
    throw new Error(`published floors: ${directory}/ cannot be read — ${(cause as Error).message}`)
  }
  const found: Statement[] = []
  for (const name of names) {
    const file = `${directory}/${name}`
    let matrix = false
    const deferred: number[] = []
    read(file).split('\n').forEach((line, index) => {
      const where = `${file}:${index + 1}`
      if (/^\s*node-version-file:/.test(line)) {
        throw new Error(`published floors: ${where} pins node-version-file, whose contents the guard does not read`)
      }
      const setting = /^\s*node-version:\s*(.*?)\s*$/.exec(line)
      if (setting === null) return
      if (setting[1] === '') throw new Error(`published floors: ${where} sets node-version: with no value`)
      if (setting[1].startsWith('${{')) {
        if (!/^\$\{\{\s*matrix\.node-version\s*\}\}$/.test(setting[1])) {
          throw new Error(`published floors: ${where} pins node-version "${setting[1]}", which the guard cannot resolve`)
        }
        deferred.push(index + 1)
        return
      }
      const list = setting[1].startsWith('[')
      const listed = list ? setting[1].replace(/^\[|\]$/g, '').split(',') : [setting[1]]
      matrix = matrix || list
      for (const pin of listed) {
        const value = pin.trim().replace(/^['"]|['"]$/g, '')
        const match = /^(\d+)(?:\.\d+)*(?:\.(?:x|X|\*))?$/.exec(value)
        if (match === null) {
          throw new Error(`published floors: ${where} pins node-version "${value}", which names no Node major`)
        }
        found.push({ file, line: index + 1, text: value, major: Number(match[1]) })
      }
    })
    if (deferred.length > 0 && !matrix) {
      throw new Error(
        `published floors: ${file}:${deferred[0]} defers to matrix.node-version, which ${file} never declares`
      )
    }
  }
  if (found.length === 0) {
    throw new Error(`published floors: no node-version: in ${directory}/, so nothing states the Node CI builds on`)
  }
  return found
}

const README = read('README.md')
const CONTRACT = '_bmad-output/specs/spec-cuerunner/SPEC.md'

/**
 * The contract's companions, which state the floor too. Their matches are checked the same way,
 * but a companion that stops naming the number is not a failure: the presence check lives with
 * the README, the site and the contract, where the statement is the contract's own.
 */
const COMPANIONS = [
  '_bmad-output/planning-artifacts/architecture/architecture-cuerunner-2026-09-17/ARCHITECTURE-SPINE.md',
  '_bmad-output/specs/spec-cuerunner/capability-catalog.md'
]

describe('the macOS floor', () => {
  const readme = macOSStatements('README.md', README)
  const contract = macOSStatements(CONTRACT, read(CONTRACT))
  const site = sitePages().flatMap((page) => macOSStatements(page.file, page.text))
  const companions = COMPANIONS.flatMap((file) => macOSStatements(file, read(file)))

  it('matches every macOS floor the README states', () => {
    expect(readme.length, 'README.md states no "macOS <N>+" floor').toBeGreaterThan(0)
    expect(disagreements(readme, MACOS_FIELD, MACOS, MACOS_MAJOR)).toEqual([])
  })

  it('matches every macOS floor the site states', () => {
    expect(site.length, 'no page under website/ states a "macOS <N>" floor').toBeGreaterThan(0)
    expect(disagreements(site, MACOS_FIELD, MACOS, MACOS_MAJOR)).toEqual([])
  })

  it('matches every macOS floor the contract states', () => {
    expect(contract.length, `${CONTRACT} states no "macOS <N>+" floor`).toBeGreaterThan(0)
    expect(disagreements(contract, MACOS_FIELD, MACOS, MACOS_MAJOR)).toEqual([])
  })

  it("matches every macOS floor the contract's companions state", () => {
    expect(disagreements(companions, MACOS_FIELD, MACOS, MACOS_MAJOR)).toEqual([])
  })
})

describe('the Node floor', () => {
  const readme = readmePrerequisites(README)

  it('matches the README prerequisite', () => {
    expect(readme.floors.length, 'README.md states no Node floor under Prerequisites').toBeGreaterThan(0)
    expect(disagreements(readme.floors, NODE_FIELD, NODE, NODE_MAJOR)).toEqual([])
  })

  it('names only Nodes a CI lane pins', () => {
    const pinned = new Set(ciNodeStatements().map((lane) => lane.major))
    expect(
      readme.named
        .filter((each) => !pinned.has(each.major))
        .map((each) => `${each.file}:${each.line} names ${each.text}, and no CI lane pins ${each.major}`)
    ).toEqual([])
  })

  it('is the oldest Node CI pins', () => {
    const lanes = ciNodeStatements()
    const below = lanes.filter((lane) => lane.major < NODE_MAJOR)
    expect(
      below.map((lane) => `${lane.file}:${lane.line} pins Node ${lane.text}, below ${NODE_FIELD} "${NODE}"`)
    ).toEqual([])
    const pinned = [...new Set(lanes.map((lane) => lane.major))].sort((a, b) => a - b)
    expect(pinned, `CI pins ${pinned.join(', ')}, and no lane builds on ${NODE_FIELD} "${NODE}"`).toContain(NODE_MAJOR)
  })
})
