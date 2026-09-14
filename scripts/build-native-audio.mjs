#!/usr/bin/env node
/**
 * Builds the native playback engine (native/audio) into native/audio/build/.
 *
 * The engine is plain C++17 with a C compiler for the two vendored C files; there is
 * no CMake, no Rust and no package manager step. Windows builds with MSVC — the WASAPI
 * backend and the Media Foundation M4A decoder link against SDK libraries — and Linux
 * and macOS build with g++/clang++.
 *
 * Usage:
 *   node scripts/build-native-audio.mjs [--debug] [--clean]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const audioRoot = join(repoRoot, 'native', 'audio')
const srcDir = join(audioRoot, 'src')
const thirdPartyDir = join(audioRoot, 'third_party')
const buildDir = join(audioRoot, 'build')
const objectDir = join(buildDir, 'obj')

const debug = process.argv.includes('--debug')
const clean = process.argv.includes('--clean')

const isWindows = process.platform === 'win32'
const objectExtension = isWindows ? '.obj' : '.o'
const binaryExtension = isWindows ? '.exe' : ''
const outputName = `winslab-audio${binaryExtension}`
const outputPath = join(buildDir, outputName)

const commonDefines = ['-DWINSLAB_ENGINE=1']

/**
 * The object file for a source path.
 *
 * Taken from the file name alone, and from either separator: the source arrives as a
 * path with whatever separators the platform uses, so mirroring it under obj/ nestles a
 * Windows path inside the object directory — `obj/D:\a\...\stb_vorbis.o` — which no
 * compiler can open. `path.basename` cannot do this on its own: it only splits the
 * separator of the platform it is running on.
 */
export function objectName(source, extension = objectExtension) {
  const file = source.split(/[\\/]/).pop() ?? source
  return file.replace(/\.[^.]+$/, '') + extension
}

/**
 * First match for an executable name on PATH. Windows needs PATHEXT because the file on
 * disk is `cl.EXE`; elsewhere the name is the file name.
 */
export function findOnPath(name, pathEnv = process.env.PATH ?? '', platform = process.platform) {
  const extensions =
    platform === 'win32' ? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';') : ['']
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue
    for (const extension of extensions) {
      const candidate = join(dir, name + extension)
      try {
        if (statSync(candidate).isFile()) return candidate
      } catch {
        // Not in this directory; keep looking.
      }
    }
  }
  return null
}

function run(command, args) {
  process.stdout.write(`  ${command} ${args.join(' ')}\n`)
  execFileSync(command, args, { stdio: 'inherit' })
}

function hasCommand(command) {
  try {
    execFileSync(command, ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function main() {
  const sources = readdirSync(srcDir)
    .filter((name) => name.endsWith('.cpp'))
    // Platform-specific files compile only on their platform (they are guarded, so
    // compiling them elsewhere is a silent no-op — skipping is just faster and clearer).
    .filter((name) => {
      if (name === 'm4a_windows.cpp') return isWindows
      if (name === 'm4a_macos.cpp') return process.platform === 'darwin'
      return true
    })
    .sort()

  const cSources = [join(thirdPartyDir, 'stb_vorbis.c'), join(thirdPartyDir, 'cJSON.c')]

  if (clean) rmSync(buildDir, { recursive: true, force: true })
  mkdirSync(objectDir, { recursive: true })

  // `cl --version` is not a thing — cl reads it as an input file and fails — so the
  // compiler is looked up on PATH instead, the way the toolchain itself presents it.
  const msvc = isWindows ? findOnPath('cl') : null
  if (isWindows && msvc === null) {
    console.error(
      'native-audio: MSVC (cl.exe) is not on PATH. The Windows engine links Media Foundation\n' +
        '  and the WASAPI libraries, so it needs the MSVC toolchain: install Visual Studio Build\n' +
        '  Tools with the C++ workload, or run this from a Developer Command Prompt.'
    )
    process.exit(1)
  }

  if (msvc !== null) {
    // MSVC. miniaudio's WASAPI backend needs the usual Windows libs; the M4A decoder
    // needs Media Foundation.
    const compileFlags = ['/nologo', '/std:c++17', '/EHsc', '/W3', '/D_CRT_SECURE_NO_WARNINGS', debug ? '/Od' : '/O2', '/MD']
    const objects = []
    for (const name of sources) {
      const object = join(objectDir, objectName(name))
      run(msvc, [...compileFlags, `/I${srcDir}`, `/I${thirdPartyDir}`, '/c', join(srcDir, name), `/Fo${object}`])
      objects.push(object)
    }
    for (const source of cSources) {
      const object = join(objectDir, objectName(source))
      run(msvc, ['/nologo', '/TC', '/W3', '/D_CRT_SECURE_NO_WARNINGS', debug ? '/Od' : '/O2', '/MD', `/I${thirdPartyDir}`, '/c', source, `/Fo${object}`])
      objects.push(object)
    }
    run('link', ['/nologo', `/OUT:${outputPath}`, ...objects, 'mfplat.lib', 'mfreadwrite.lib', 'mfuuid.lib', 'shlwapi.lib', 'ole32.lib', 'oleaut32.lib', 'uuid.lib', 'winmm.lib', 'user32.lib', 'advapi32.lib'])
  } else {
    const cxx = process.env.CXX ?? (hasCommand('g++') ? 'g++' : 'clang++')
    const cc = process.env.CC ?? (hasCommand('gcc') ? 'gcc' : 'clang')
    const optimisation = debug ? ['-O0', '-g'] : ['-O2']
    const compileFlags = ['-std=c++17', ...optimisation, '-Wall', '-Wextra', '-Wno-unused-parameter', '-pthread']
    const objects = []
    for (const name of sources) {
      const object = join(objectDir, objectName(name))
      run(cxx, [...compileFlags, ...commonDefines, `-I${srcDir}`, `-I${thirdPartyDir}`, '-c', join(srcDir, name), '-o', object])
      objects.push(object)
    }
    for (const source of cSources) {
      const object = join(objectDir, objectName(source))
      run(cc, ['-std=c11', ...optimisation, '-Wall', '-Wno-unused-function', `-I${thirdPartyDir}`, '-c', source, '-o', object])
      objects.push(object)
    }
    const linkFlags = ['-pthread']
    if (process.platform === 'linux') linkFlags.push('-ldl', '-lm')
    if (process.platform === 'darwin') {
      linkFlags.push('-framework', 'AudioToolbox', '-framework', 'CoreFoundation', '-framework', 'CoreServices', '-framework', 'AudioUnit')
    }
    run(cxx, [...compileFlags, ...objects, '-o', outputPath, ...linkFlags])
  }

  const size = statSync(outputPath).size
  console.log(`built ${outputPath} (${(size / 1024 / 1024).toFixed(1)} MiB)`)
  if (!existsSync(outputPath)) process.exit(1)
}

// Importable for its helpers: only a direct invocation builds anything.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
