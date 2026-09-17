#!/usr/bin/env node
/**
 * Makes sure the native playback engine (and, when asked, the packaged Linux M4A
 * decoder) exist before a command that needs them runs.
 *
 * It is deliberately idempotent: the engine is rebuilt only when a source, a vendored
 * header or the build script is newer than the binary, or when the ASIO state differs
 * from the one the last build stamped (a change no mtime in this tree can show), and the
 * FFmpeg helper — a pinned release whose inputs never change — is never rebuilt once it
 * is present. Every developer command that needs the engine routes through here (npm
 * pre-hooks), so a fresh checkout needs no manual build step and a warm checkout pays
 * only a stat().
 *
 *   node scripts/ensure-native.mjs                 # engine only
 *   node scripts/ensure-native.mjs --with-decoders # engine + Linux M4A helper
 *   node scripts/ensure-native.mjs --force         # rebuild regardless
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describeAsioState } from './asio-sdk.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const audioRoot = join(repoRoot, 'native', 'audio')
const buildScript = join(repoRoot, 'scripts', 'build-native-audio.mjs')
const ffmpegScript = join(repoRoot, 'scripts', 'build-ffmpeg-linux.mjs')
const binaryName = process.platform === 'win32' ? 'cuerunner-audio.exe' : 'cuerunner-audio'
const enginePath = join(audioRoot, 'build', binaryName)
const asioStamp = join(audioRoot, 'build', 'asio.stamp')
const decoderPath = join(audioRoot, 'build', 'decoders', 'ffmpeg')

const withDecoders = process.argv.includes('--with-decoders')
const force = process.argv.includes('--force')
const sourceExtensions = ['.c', '.cc', '.cpp', '.h', '.hpp', '.cxx']

function newestSourceMtime(directory) {
  let newest = 0
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      newest = Math.max(newest, newestSourceMtime(path))
      continue
    }
    if (!sourceExtensions.some((extension) => entry.name.endsWith(extension))) continue
    newest = Math.max(newest, statSync(path).mtimeMs)
  }
  return newest
}

function engineIsStale() {
  if (!existsSync(enginePath)) return true
  const built = statSync(enginePath).mtimeMs
  const newestInput = Math.max(
    newestSourceMtime(join(audioRoot, 'src')),
    newestSourceMtime(join(audioRoot, 'third_party')),
    statSync(buildScript).mtimeMs
  )
  if (newestInput > built) return true

  // The ASIO SDK is not in this tree, so an SDK that appeared, moved or went away since
  // the last build is invisible to the scan above; the build script stamps the state it
  // built with, and these two strings are the comparison. A missing stamp reads as
  // changed — as does one a misconfigured variable would now produce, which is a rebuild
  // that the build script then fails with its own explanation.
  if (!existsSync(asioStamp)) return true
  return readFileSync(asioStamp, 'utf8').trim() !== describeAsioState()
}

function run(script) {
  console.log(`[ensure-native] ${script.replace(repoRoot + '/', '')}`)
  execFileSync('node', [script], { stdio: 'inherit', cwd: repoRoot, timeout: 3600_000 })
}

if (force || engineIsStale()) {
  run(buildScript)
} else {
  console.log(`[ensure-native] engine up to date (${enginePath.replace(repoRoot + '/', '')})`)
}

if (withDecoders) {
  if (process.platform !== 'linux') {
    console.log('[ensure-native] M4A decoder: not needed here (the platform codec is used)')
  } else if (!existsSync(decoderPath)) {
    // The helper is a pinned release built from a verified tarball; once it exists, the
    // build script and this check both leave it alone.
    run(ffmpegScript)
  } else {
    console.log(`[ensure-native] M4A decoder up to date (${decoderPath.replace(repoRoot + '/', '')})`)
  }
}
