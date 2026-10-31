#!/usr/bin/env node
// Lints `.github/workflows/` where a pull request can see it.
//
// The workflow files are the one part of this repository no lane reads. A misspelled key or a
// broken expression in one typechecks, lints nothing and ships, and the first thing that
// notices is a release or a nightly that does not start — which is the most expensive place
// to find it. `actionlint` is the tool for it, and `AGENTS.md` already asks for it by hand;
// this runs the same command in a lane so the hand is not the only thing holding it.
//
// What it checks, read from the run that proved it: a structural error — a job with a
// misspelled key — fails with a diagnostic naming the file, line and column, and exits 1.
// An expression typo inside a `run:` body does *not* fail it, so this is a structural linter
// and not a substitute for reading the shell it lints.
//
// The tool: an `actionlint` already on PATH is used as it is (a developer's own install, a
// runner that provisions one). Otherwise the pinned release is fetched for linux-x64 and
// unpacked into `.cache/actionlint`, checked against the digest the release publishes — the
// same shape `build-ffmpeg-linux.mjs` uses for its source. Anywhere else the script says what
// to install rather than pretending to have run: a check that cannot run is not a check that
// passed.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** The release this pins, and the digest its own `checksums.txt` publishes for this asset. */
const VERSION = '1.7.12'
const ASSET = `actionlint_${VERSION}_linux_amd64.tar.gz`
const URL = `https://github.com/rhysd/actionlint/releases/download/v${VERSION}/${ASSET}`
const SHA256 = '8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8'

const cacheDir = join(root, '.cache', 'actionlint')
const binary = join(cacheDir, 'actionlint')

function onPath(name) {
  for (const dir of String(process.env.PATH ?? '').split(':')) {
    if (!dir) continue
    const candidate = join(dir, name)
    if (existsSync(candidate)) return candidate
  }
  return null
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function download(url, out) {
  // curl/wget are what a build machine has; node's fetch buffers the whole tarball.
  const hasCurl = existsSync('/usr/bin/curl')
  const command = hasCurl ? 'curl' : 'wget'
  const args = hasCurl ? ['-sSL', '--fail', '-o', out, url] : ['-q', '-O', out, url]
  // shellcheck's `info` notes are style, and actionlint fails on any of them.
  execFileSync(command, args, { stdio: 'inherit', env: { ...process.env, SHELLCHECK_OPTS: '--severity=warning' } })
}

/** The linting tool, from PATH or from the pin. */
function tool() {
  const installed = onPath('actionlint')
  if (installed !== null) return installed
  if (process.platform !== 'linux' || process.arch !== 'x64') {
    console.error(
      `no actionlint on PATH, and this script only knows how to fetch it for linux-x64.\n` +
        `Install it (brew install actionlint, or the ${VERSION} release for this platform) and run again.`
    )
    process.exit(1)
  }
  // A cached binary is used only when the stamp beside it says it is this release: the
  // tarball is verified on every fetch, and the stamp is what keeps a stale unpack from
  // being linted with.
  const stamp = join(cacheDir, 'VERSION')
  if (existsSync(binary) && existsSync(stamp) && readFileSync(stamp, 'utf-8').trim() === VERSION) {
    return binary
  }
  mkdirSync(cacheDir, { recursive: true })
  const tarball = join(cacheDir, ASSET)
  console.log(`fetching ${URL}`)
  download(URL, tarball)
  const digest = sha256(tarball)
  if (digest !== SHA256) {
    console.error(`actionlint tarball checksum mismatch:\n  expected ${SHA256}\n  got      ${digest}`)
    process.exit(1)
  }
  execFileSync('tar', ['-xzf', tarball, '-C', cacheDir, 'actionlint'], { stdio: 'inherit' })
  chmodSync(binary, 0o755)
  writeFileSync(join(cacheDir, 'VERSION'), `${VERSION}\n`)
  return binary
}

const actionlint = tool()
// The files are named rather than discovered: actionlint's own search walks up from the
// working directory, and a run whose inputs depend on where it was started is a run whose
// answer does too.
const workflowDir = join(root, '.github', 'workflows')
const workflows = readdirSync(workflowDir)
  .filter(name => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort()
  .map(name => join('.github', 'workflows', name))
try {
  // `-color=false`: a log is read in a terminal that would render the escapes as noise.
  // shellcheck's `info` and `style` notes are opinion, and actionlint fails on any of them.
  execFileSync(actionlint, ['-color=false', ...workflows], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, SHELLCHECK_OPTS: '--severity=warning' }
  })
  console.log(`workflows lint clean (${VERSION}${actionlint === binary ? ', pinned' : ', from PATH'})`)
} catch (error) {
  // actionlint's own diagnostics are already on stderr; the exit code is what CI reads.
  process.exit(typeof error.status === 'number' ? error.status : 1)
}
