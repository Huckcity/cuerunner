// Tests for scripts/build-native-audio.mjs. The object-path case is the one that broke
// the Windows lane: the source arrives with backslashes there, and a name derived from
// the path instead of the file put a `D:\...` inside the object directory.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { fileURLToPath } from 'url'

// @ts-ignore — js file, no type declarations
import { darwinBuildFlags, findOnPath, objectName } from './build-native-audio.mjs'

describe('objectName', () => {
  it('names a Windows source by its file, not by its path', () => {
    const source = 'D:\\a\\cuerunner\\cuerunner\\native\\audio\\third_party\\stb_vorbis.c'
    expect(objectName(source, '.obj')).toBe('stb_vorbis.obj')
  })

  it('names a POSIX source the same way', () => {
    expect(objectName('/home/adam/dev/cuerunner/native/audio/third_party/cJSON.c', '.o')).toBe('cJSON.o')
    expect(objectName('native/audio/src/engine.cpp', '.o')).toBe('engine.o')
  })

  it('strips only the extension', () => {
    expect(objectName('dr_mp3.cpp', '.o')).toBe('dr_mp3.o')
    expect(objectName('m4a_macos.cpp', '.obj')).toBe('m4a_macos.obj')
  })
})

describe('findOnPath', () => {
  let rootDir: string
  let binDir: string

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-native-test-'))
    binDir = path.join(rootDir, 'bin')
    fs.mkdirSync(binDir)
  })

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true })
  })

  it('finds an executable on PATH', () => {
    const cl = path.join(binDir, 'cl.EXE')
    fs.writeFileSync(cl, '', 'utf8')
    // The stored name is cl.EXE, which is what PATHEXT is for.
    expect(findOnPath('cl', binDir, 'win32')).toBe(cl)
    expect(findOnPath('cl', binDir, 'linux')).toBeNull()
  })

  it('returns null when nothing on PATH matches', () => {
    expect(findOnPath('cl', binDir, 'win32')).toBeNull()
    expect(findOnPath('g++', binDir, 'linux')).toBeNull()
  })

  it('searches every PATH entry, ignoring the empty ones', () => {
    const gcc = path.join(binDir, 'gcc')
    fs.writeFileSync(gcc, '', 'utf8')
    const pathEnv = `${path.delimiter}${path.join(rootDir, 'missing')}${path.delimiter}${binDir}`
    expect(findOnPath('gcc', pathEnv, 'linux')).toBe(gcc)
  })
})

// The universal-dmg invariant, held here because it is the engine's build flags and the
// packaging declaration that have to agree: the dmg carries one app staging per
// architecture, both stagings carry the same engine binary, and `@electron/universal`
// refuses to merge a file that is identical on both sides unless its path is declared
// architecture-independent. v0.14.0's first packaging run died exactly there:
//
//   ⨯ Detected file "Contents/Resources/audio/cuerunner-audio" that's the same in both
//     x64 and arm64 builds and not covered by the x64ArchFiles rule

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative: string): string => fs.readFileSync(path.join(root, relative), 'utf8')

interface UniversalReading {
  pkg: Record<string, any>
  buildScript: string
  readme: string
}

const LIVE: UniversalReading = {
  pkg: JSON.parse(read('package.json')),
  buildScript: read('scripts/build-native-audio.mjs'),
  readme: read('README.md')
}

/** The glob electron-builder is handed, as a matcher: `**` spans directories, `*` does not. */
function matcher(glob: string): RegExp {
  const source = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*')
  return new RegExp(`^${source}$`)
}

/**
 * A universal dmg is only buildable when three things agree, and packaging proves it the
 * hard way: the target must be `universal`, the engine the app carries must be one binary
 * for both architectures, and the path it is packaged at must be declared in
 * `x64ArchFiles` — declared for the engine, and never for the app's own executable, which
 * has to stay per-architecture. A per-architecture target asks nothing of any of it.
 */
function universalProblems(reading: UniversalReading): string[] {
  const problems: string[] = []
  const mac = reading.pkg?.build?.mac ?? {}
  const targets: Array<{ arch?: string[] }> = mac.target ?? []
  const archs = targets.flatMap((target) => target.arch ?? [])
  if (!archs.includes('universal')) return problems

  // electron-builder validates `build` against its own schema and refuses an unknown
  // property, so a `//`-style comment key — the JSON convention this repository uses in
  // tsconfig, and which nothing here reads — fails every `npm run dist:*` on every
  // platform before a file is written. It cost a release run: "configuration.mac has an
  // unknown property '// x64ArchFiles'". Explanations belong in the README.
  const comments: string[] = []
  const walk = (value: unknown, path: string): void => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return
    for (const [key, child] of Object.entries(value)) {
      if (key.startsWith('//')) comments.push(`${path}.${key}`)
      walk(child, `${path}.${key}`)
    }
  }
  walk(reading.pkg?.build ?? {}, 'build')
  for (const comment of comments) {
    problems.push(
      `package.json's \`${comment}\` is a comment key inside electron-builder's config, which is schema-validated: every \`npm run dist:*\` fails with "has an unknown property" — the explanation belongs in the README`
    )
  }

  const resources = (reading.pkg?.build?.extraResources ?? []).find(
    (entry: { to?: string }) => entry.to === 'audio'
  )
  const engine = ((resources?.filter ?? []) as string[]).find((name) => name === 'cuerunner-audio')
  if (engine === undefined) {
    problems.push(
      "package.json's mac target builds a universal app and extraResources no longer packages native/audio/build/cuerunner-audio into it, so the declaration below would cover nothing the dmg actually carries"
    )
  }
  const packaged = `Contents/Resources/${resources?.to ?? 'audio'}/${engine ?? 'cuerunner-audio'}`

  const declared: string = mac.x64ArchFiles ?? ''
  if (declared === '') {
    problems.push(
      "package.json's mac target is `universal` and no `x64ArchFiles` is declared: the engine is one identical file in both app stagings and @electron/universal refuses to merge it, so packaging dies with `Detected file \"Contents/Resources/audio/cuerunner-audio\" ... not covered by the x64ArchFiles rule`"
    )
  } else {
    const covers = matcher(declared)
    if (!covers.test(packaged)) {
      problems.push(
        `package.json declares \`x64ArchFiles: ${declared}\`, which does not cover \`${packaged}\` — the file both stagings carry and the merge refuses`
      )
    }
    if (covers.test('Contents/MacOS/Cuerunner')) {
      problems.push(
        `package.json declares \`x64ArchFiles: ${declared}\`, which also covers the app's own executable under Contents/MacOS: that one is per-architecture, and excusing it is how a universal dmg ships one architecture`
      )
    }
  }

  if (!reading.buildScript.includes('darwinBuildFlags(')) {
    problems.push(
      'scripts/build-native-audio.mjs no longer builds the engine with darwinBuildFlags, so the macOS engine is not the one binary for both architectures the universal dmg requires'
    )
  }
  if (!reading.buildScript.includes('minimumSystemVersion')) {
    problems.push(
      'scripts/build-native-audio.mjs no longer reads build.mac.minimumSystemVersion, so the engine\'s deployment floor can drift from the bundle\'s'
    )
  }
  if (!/darwinFlags/.test(reading.buildScript.split('const compileFlags').at(-1) ?? '')) {
    problems.push(
      'scripts/build-native-audio.mjs defines its compile flags without the darwin flags, so the objects (and the link that reuses them) are built for the host architecture alone'
    )
  }
  if (!/x64ArchFiles/.test(reading.readme) || !/-arch x86_64/.test(reading.readme)) {
    problems.push(
      "README.md's packaging notes no longer state how a universal dmg gets an engine that covers both architectures (the two `-arch` flags and the `x64ArchFiles` declaration)"
    )
  }
  return problems
}

describe('the universal macOS dmg', () => {
  it('builds the engine for both architectures at the bundle\'s own floor', () => {
    expect(darwinBuildFlags('12.0')).toEqual([
      '-arch',
      'x86_64',
      '-arch',
      'arm64',
      '-mmacosx-version-min=12.0'
    ])
  })

  it('holds the target, the engine flags and the packaging declaration to each other', () => {
    expect(universalProblems(LIVE)).toEqual([])
  })

  it('asks nothing of an engine when the target is per-architecture', () => {
    const pkg = { build: { ...LIVE.pkg.build, mac: { ...LIVE.pkg.build.mac, target: [{ target: 'dmg', arch: ['arm64'] }] } } }
    expect(universalProblems({ ...LIVE, pkg })).toEqual([])
  })

  it('names a universal target with no x64ArchFiles declaration', () => {
    const mac = { ...LIVE.pkg.build.mac }
    delete mac.x64ArchFiles
    const problems = universalProblems({ ...LIVE, pkg: { build: { ...LIVE.pkg.build, mac } } })
    expect(problems[0]).toContain('no `x64ArchFiles` is declared')
  })

  it('names a declaration that would excuse the app executable too', () => {
    const mac = { ...LIVE.pkg.build.mac, x64ArchFiles: 'Contents/**' }
    const problems = universalProblems({ ...LIVE, pkg: { build: { ...LIVE.pkg.build, mac } } })
    expect(problems.join('\n')).toContain("app's own executable under Contents/MacOS")
  })

  it('names an engine the packaging no longer carries', () => {
    const extraResources = LIVE.pkg.build.extraResources.map((entry: { to?: string }) =>
      entry.to === 'audio' ? { ...entry, filter: ['decoders/**/*'] } : entry
    )
    const problems = universalProblems({
      ...LIVE,
      pkg: { build: { ...LIVE.pkg.build, extraResources } }
    })
    expect(problems.join('\n')).toContain('extraResources no longer packages')
  })

  it('names a build script that stopped building both architectures', () => {
    const buildScript = LIVE.buildScript.replace(/darwinBuildFlags\(/g, 'someOtherFlags(')
    const problems = universalProblems({ ...LIVE, buildScript })
    expect(problems[0]).toContain('no longer builds the engine with darwinBuildFlags')
  })

  it('names a comment key that would fail electron-builder\'s schema', () => {
    const mac = { ...LIVE.pkg.build.mac }
    mac['// x64ArchFiles'] = 'an explanation in the wrong place'
    const problems = universalProblems({ ...LIVE, pkg: { build: { ...LIVE.pkg.build, mac } } })
    expect(problems[0]).toContain('is a comment key inside electron-builder')
  })

  it('names packaging notes that stopped saying how the dmg gets both architectures', () => {
    const readme = LIVE.readme
      .replace(/x64ArchFiles/g, 'the merge rule')
      .replace(/-arch x86_64/g, 'a two-architecture compile')
    const problems = universalProblems({ ...LIVE, readme })
    expect(problems[0]).toContain("README.md's packaging notes no longer state")
  })
})
