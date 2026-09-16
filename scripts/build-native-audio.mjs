#!/usr/bin/env node
/**
 * Builds the native playback engine (native/audio) into native/audio/build/.
 *
 * The engine is plain C++17 with a C compiler for the two vendored C files; there is
 * no CMake, no Rust and no package manager step. Windows builds with MSVC — the WASAPI
 * backend and the Media Foundation M4A decoder link against SDK libraries — and Linux
 * and macOS build with g++/clang++.
 *
 * ASIO is opt-in per machine and never part of the default build: Steinberg's SDK
 * cannot be redistributed with the repository, so the backend and the SDK's own host
 * sources compile only when WINSLAB_ASIO_SDK resolves to an SDK root on Windows
 * (scripts/asio-sdk.mjs). The resolved state is stamped into the build directory so
 * ensure-native.mjs can tell that a build without ASIO is not a build with it.
 *
 * Usage:
 *   node scripts/build-native-audio.mjs [--debug] [--clean]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  ASIO_SDK_ENV,
  ASIO_SDK_INCLUDE_DIRS,
  ASIO_SDK_SOURCES,
  NOT_CONFIGURED,
  describeAsioState,
  resolveAsioSdk
} from './asio-sdk.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const audioRoot = join(repoRoot, 'native', 'audio')
const srcDir = join(audioRoot, 'src')
const thirdPartyDir = join(audioRoot, 'third_party')
const buildDir = join(audioRoot, 'build')
const objectDir = join(buildDir, 'obj')
// The ASIO state this build was made with; ensure-native.mjs reads it, because an SDK
// that appeared, moved or vanished is invisible to an mtime scan of the tree.
const asioStampPath = join(buildDir, 'asio.stamp')

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
  const sdk = resolveAsioSdk()
  const asio = sdk.enabled && isWindows
  // Resolved once, before anything compiles, and written after everything did: this is
  // the state the objects are built from, which is what a later build has to match.
  const asioState = describeAsioState(sdk)

  if (asio) {
    console.log(`native-audio: ASIO enabled (${sdk.dir})`)
  } else if (!isWindows) {
    // The backend is a Windows one, so a variable set on another platform is ignored
    // rather than failed on — the machine is not a machine ASIO builds for.
    console.log('native-audio: ASIO off (Windows only)')
  } else if (sdk.reason !== NOT_CONFIGURED) {
    // Set, but not to an SDK root: somebody believes ASIO is in this build, and a build
    // that silently had none would be the last place that gets discovered.
    console.error(`native-audio: ${sdk.reason}`)
    process.exit(1)
  } else {
    console.log(`native-audio: ASIO off (${ASIO_SDK_ENV} is not set)`)
  }

  const sources = readdirSync(srcDir)
    .filter((name) => name.endsWith('.cpp'))
    // Platform-specific files compile only on their platform (they are guarded, so
    // compiling them elsewhere is a silent no-op — skipping is just faster and clearer).
    .filter((name) => {
      if (name === 'm4a_windows.cpp') return isWindows
      if (name === 'm4a_macos.cpp') return process.platform === 'darwin'
      // The ASIO backend is Windows-only, and it includes the SDK: without a resolved
      // SDK its includes would be a missing-header error rather than a build without
      // ASIO, so it is excluded from the build entirely instead.
      if (name === 'asio_backend.cpp') return asio
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
    // ASIO, when it is in this build at all, is in it for every engine source: a
    // translation unit that saw a different set of feature macros than its neighbours
    // would disagree with them about the structures they share. The SDK's include
    // directories ride along, because the backend's own headers are what include
    // common/asio.h.
    const asioFlags = asio
      ? ['/DWINSLAB_ASIO=1', ...ASIO_SDK_INCLUDE_DIRS.map((dir) => `/I${join(sdk.dir, dir)}`)]
      : []
    const objects = []
    for (const name of sources) {
      const object = join(objectDir, objectName(name))
      run(msvc, [...compileFlags, ...asioFlags, `/I${srcDir}`, `/I${thirdPartyDir}`, '/c', join(srcDir, name), `/Fo${object}`])
      objects.push(object)
    }
    for (const source of cSources) {
      const object = join(objectDir, objectName(source))
      run(msvc, ['/nologo', '/TC', '/W3', '/D_CRT_SECURE_NO_WARNINGS', debug ? '/Od' : '/O2', '/MD', `/I${thirdPartyDir}`, '/c', source, `/Fo${object}`])
      objects.push(object)
    }
    // The SDK's own host sources are compiled from the SDK rather than vendored, under
    // the engine's flags — /D_CRT_SECURE_NO_WARNINGS included, which is what keeps its
    // strcpy/strcmp calls warnings rather than errors. There is no /WX here, so what the
    // SDK warns about is reported and not fatal.
    for (const relative of asio ? ASIO_SDK_SOURCES : []) {
      const source = join(sdk.dir, relative)
      const object = join(objectDir, objectName(source))
      run(msvc, [...compileFlags, ...asioFlags, '/c', source, `/Fo${object}`])
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

  // After the binary, never before: a stamp written by a build that failed would tell
  // ensure-native.mjs there is nothing to do about an engine that was not produced.
  writeFileSync(asioStampPath, `${asioState}\n`)
}

// Importable for its helpers: only a direct invocation builds anything.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
