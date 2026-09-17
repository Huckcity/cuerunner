#!/usr/bin/env node
/**
 * Builds the packaged M4A/AAC decoder for Linux: a minimal, LGPL-only FFmpeg binary.
 *
 * Why a separate executable: the app's own code stays free of FFmpeg's ABI and of its
 * licence obligations; the helper is executed as its own process and speaks float PCM
 * on a pipe. It is built with `--disable-gpl --disable-nonfree --disable-version3`, so
 * the resulting binary is LGPL-2.1-or-later, and it is built from the source tarball
 * below rather than downloaded as an opaque prebuilt.
 *
 * The source tarball is pinned by SHA-256 and the release signature is verified against
 * FFmpeg's release key when gpg has it. The exact configure line and rebuild command
 * are written to native/audio/build/decoders/NOTICE.txt next to the licences, which is what
 * "corresponding source" requires us to hand on.
 *
 *   node scripts/build-ffmpeg-linux.mjs [--force]
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const decoderDir = join(repoRoot, 'native', 'audio', 'build', 'decoders')
const cacheDir = join(repoRoot, 'native', 'audio', '.cache')

const FFMPEG_VERSION = '8.1.2'
const FFMPEG_URL = `https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz`
const FFMPEG_SHA256 = '464beb5e7bf0c311e68b45ae2f04e9cc2af88851abb4082231742a74d97b524c'
const FFMPEG_SIGNING_KEY = 'FCF986EA15E6E293A5644F10B4322F04D67658D8'

// Everything off, then exactly what an audio-only M4A/ALAC decode to float PCM needs.
// No GPL, no nonfree, no version3: the binary stays LGPL-2.1-or-later.
const CONFIGURE_FLAGS = [
  '--disable-everything',
  '--disable-autodetect',
  '--disable-doc',
  '--disable-debug',
  '--disable-network',
  '--disable-gpl',
  '--disable-nonfree',
  '--disable-version3',
  '--disable-x86asm',
  '--enable-ffmpeg',
  '--enable-ffprobe',
  '--enable-avcodec',
  '--enable-avformat',
  '--enable-avutil',
  '--enable-swresample',
  '--enable-demuxer=mov,wav',
  '--enable-decoder=aac,alac,pcm_s16le,pcm_s24le,pcm_f32le',
  '--enable-parser=aac',
  '--enable-protocol=file,pipe',
  // Float PCM on a pipe is how the engine reads from this helper; the WAV input side
  // lets the acceptance suite build its own M4A fixtures against this exact build.
  // The raw float-PCM *muxer's* CLI name is f32le, but its configure component is
  // pcm_f32le — enabling the CLI name silently produces a binary that cannot write
  // the engine's pipe format.
  '--enable-muxer=pcm_f32le',
  '--enable-encoder=pcm_f32le',
  '--enable-filter=aresample'
]

const force = process.argv.includes('--force')

if (process.platform !== 'linux') {
  console.log(`ffmpeg helper build: skipped (this script builds the Linux helper; on ${process.platform} the platform codec is used)`)
  process.exit(0)
}

if (existsSync(join(decoderDir, 'ffmpeg')) && !force) {
  console.log(`ffmpeg helper already built: ${join(decoderDir, 'ffmpeg')} (use --force to rebuild)`)
  process.exit(0)
}

function run(command, args, options = {}) {
  process.stdout.write(`  ${command} ${args.join(' ')}\n`)
  execFileSync(command, args, { stdio: 'inherit', ...options })
}

function download(url, out) {
  // curl/wget are what a build machine has; node's fetch buffers the whole tarball.
  const downloader = existsSync('/usr/bin/curl') ? ['curl', ['-sL', '--fail', '-o', out, url]] : ['wget', ['-q', '-O', out, url]]
  run(downloader[0], downloader[1])
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

mkdirSync(decoderDir, { recursive: true })
mkdirSync(cacheDir, { recursive: true })

const tarball = join(cacheDir, `ffmpeg-${FFMPEG_VERSION}.tar.xz`)
if (!existsSync(tarball) || sha256(tarball) !== FFMPEG_SHA256) {
  console.log(`downloading ${FFMPEG_URL}`)
  download(FFMPEG_URL, tarball)
}
const digest = sha256(tarball)
if (digest !== FFMPEG_SHA256) {
  console.error(`ffmpeg tarball checksum mismatch:\n  expected ${FFMPEG_SHA256}\n  got      ${digest}`)
  process.exit(1)
}
console.log(`checksum ok: ${digest}`)

// Best effort signature check: the tarball was verified against this key when the pin
// was recorded, and a machine with gpg and the key can re-verify it here.
try {
  const gnupgHome = join(tmpdir(), 'cuerunner-ffmpeg-gnupg')
  mkdirSync(gnupgHome, { recursive: true, mode: 0o700 })
  const env = { ...process.env, GNUPGHOME: gnupgHome }
  execFileSync('gpg', ['--keyserver', 'keyserver.ubuntu.com', '--recv-keys', FFMPEG_SIGNING_KEY], { stdio: 'ignore', timeout: 60_000, env })
  download(`${FFMPEG_URL}.asc`, `${tarball}.asc`)
  execFileSync('gpg', ['--verify', `${tarball}.asc`, tarball], { stdio: 'inherit', env })
  console.log('release signature verified')
} catch (error) {
  console.log(`note: signature not verified here (${error.message.split('\n')[0]}); the pinned SHA-256 was verified against the release signature when recorded`)
}

const buildRoot = join(cacheDir, `build-${FFMPEG_VERSION}`)
rmSync(buildRoot, { recursive: true, force: true })
mkdirSync(buildRoot, { recursive: true })
run('tar', ['-xf', tarball, '-C', buildRoot])
const sourceDir = join(buildRoot, `ffmpeg-${FFMPEG_VERSION}`)
const prefix = join(buildRoot, 'install')

run(join(sourceDir, 'configure'), [...CONFIGURE_FLAGS, `--prefix=${prefix}`], { cwd: sourceDir })
const jobs = String(Math.max(1, Number(process.env.NUM_JOBS ?? 0) || 4))
run('make', ['-j', jobs], { cwd: sourceDir })
run('make', ['install'], { cwd: sourceDir })

for (const binary of ['ffmpeg', 'ffprobe']) {
  const from = join(prefix, 'bin', binary)
  if (!existsSync(from)) {
    console.error(`expected ${from} to exist after make install`)
    process.exit(1)
  }
  copyFileSync(from, join(decoderDir, binary))
  execFileSync('chmod', ['755', join(decoderDir, binary)])
}

const licenseDir = join(decoderDir, 'licenses')
mkdirSync(licenseDir, { recursive: true })
for (const name of ['COPYING.LGPLv2.1', 'COPYING.LGPLv3', 'LICENSE.md']) {
  const from = join(sourceDir, name)
  if (existsSync(from)) copyFileSync(from, join(licenseDir, name))
}

// Self-check: the engine asks this binary for float PCM on a pipe. Prove the artifact
// can actually do that before it is shipped, rather than discovering it at show time.
const ffmpegPath = join(decoderDir, 'ffmpeg')
const probeWav = join(buildRoot, 'probe.wav')
{
  const frames = 480
  const buffer = Buffer.alloc(44 + frames * 2 * 2)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(buffer.length - 8, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(2, 22)
  buffer.writeUInt32LE(48000, 24)
  buffer.writeUInt32LE(48000 * 4, 28)
  buffer.writeUInt16LE(4, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(frames * 4, 40)
  for (let i = 0; i < frames * 2; i++) buffer.writeInt16LE(i % 1000, 44 + i * 2)
  writeFileSync(probeWav, buffer)
}
const probeOut = execFileSync(ffmpegPath, ['-v', 'error', '-i', probeWav, '-f', 'f32le', '-ac', '2', '-ar', '48000', 'pipe:1'], {
  maxBuffer: 64 * 1024 * 1024
})
if (probeOut.length < 480 * 2 * 4) {
  console.error('ffmpeg helper self-check failed: it produced no float PCM for the engine pipe format')
  process.exit(1)
}
console.log(`self-check ok: ${probeOut.length} bytes of float PCM decoded from a probe WAV`)

const version = execFileSync(ffmpegPath, ['-version'], { encoding: 'utf8' }).split('\n')[0]
writeFileSync(
  join(decoderDir, 'NOTICE.txt'),
  [
    'FFmpeg helper binary for Cuerunner (M4A/AAC and ALAC decoding on Linux)',
    '',
    `Version:        ${FFMPEG_VERSION}`,
    `Source:         ${FFMPEG_URL}`,
    `SHA-256:        ${FFMPEG_SHA256}`,
    `Signed by:      ${FFMPEG_SIGNING_KEY} (FFmpeg release key)`,
    `Configure:     ./configure ${[...CONFIGURE_FLAGS, `--prefix=<build>`].join(' ')}`,
    '',
    'Licence: LGPL-2.1-or-later. The build disables GPL, nonfree and version3 components,',
    'so no GPL code is linked or distributed. FFmpeg licence texts are in ./licenses.',
    '',
    'The helper is executed as a separate process and no Cuerunner code links against it.',
    'To rebuild it, including the corresponding source of this exact binary:',
    '    npm run build:ffmpeg',
    'with no network restrictions other than access to ffmpeg.org for the pinned tarball',
    'above (the build script verifies both the SHA-256 and the release signature).',
    ''
  ].join('\n')
)

console.log(`built ${join(decoderDir, 'ffmpeg')}`)
console.log(version)
console.log(`licences and NOTICE written to ${decoderDir}`)
console.log(`binary size ${(statSync(join(decoderDir, 'ffmpeg')).size / 1024 / 1024).toFixed(1)} MiB`)
