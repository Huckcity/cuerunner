#!/usr/bin/env node
// The lanes CI runs, run from here: the same commands on the homelab's own machines, over
// ssh, without waiting for the runner queue.
//
// The workflow is the authority on *what* a lane is (`npm run typecheck`, `npm test`,
// `npm run test:native`, `npm run test:integration`, `npm run test:e2e`), and this script does
// not re-implement any of them: it ships the working tree to a host and runs the same command
// there. What it adds is a way to ask before a push, at whatever scope is wanted, and a report
// that says what each host actually did — a run says what it did, not what it proves
// (`scripts/lane-status.mjs`, AD-24).
//
//   npm run local-ci                        # every host, its own default lanes
//   npm run local-ci -- --hosts=win         # one host
//   npm run local-ci -- --lanes=unit        # one lane, wherever it is meaningful
//   npm run local-ci -- --list              # what would run, and where, without running it
//
// Hosts and their doors (all env-overridable):
//
//   linux  this machine. The whole gate, e2e included: `scripts/run-e2e.js` gives Electron a
//          private Xvfb display, which is why Linux is the one platform that can run that lane
//          from a terminal at all.
//   win    `adam@192.168.0.210` — the NUC that runs the Windows lanes for CI (`nuc-win-1`),
//          key `~/.ssh/id_ed25519_winvm`. It already holds the runner's Node tool cache and its
//          MSVC/ASIO provisioning, so the native build works there without setting anything up.
//   mac    `adam@mac.local` — the Mac mini (`mac-mini-1`). It needs Remote Login on before this
//          script can reach it; a host that does not answer is a `skipped` row, not a failure.
//
// What no host can do over ssh is the e2e lane: an Electron window needs a desktop session,
// which is why CI runs that lane from a launchd agent in the Mac's login session and from the
// Windows runner's own session. Asking for it remotely reports that reason instead of trying.
//
// The tree travels as a tar over ssh — nothing here has to be committed, and `node_modules`,
// `.git` and the build outputs stay behind. A host keeps what it was last sent and installs
// only when `package-lock.json` changed, so a lane's second run is the lane.

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative } from 'node:path'

/** Every lane this can run, and the one command the workflow runs for it. */
export const LANES = {
  typecheck: { run: 'npm run typecheck', gui: false, what: 'both TypeScript projects' },
  // `npm test` has a pretest hook that builds the C++ engine, so this lane needs a compiler:
  // MSVC on Windows (imported below), and whatever the host already uses elsewhere.
  unit: { run: 'npm test', gui: false, what: 'vitest, after building the native engine' },
  native: {
    run: 'npm run test:native',
    gui: false,
    linux: true,
    what: 'the ten native scripts, ending in the matrix bench'
  },
  integration: {
    run: 'npm run test:integration',
    gui: false,
    linux: true,
    what: 'the integration suite (its vendor halves skip without a console named)'
  },
  e2e: { run: 'npm run test:e2e', gui: true, what: 'Playwright against real Electron, on a display' }
}

/** Where a host keeps the tree it was last sent, under that host's home. */
export const REMOTE_DIR = 'cuerunner-local-ci'

/** What the tar never carries: build products, the toolchain, and the history. */
export const EXCLUDES = ['node_modules', '.git', 'out', 'dist', 'test-results', 'playwright-report']

/**
 * The hosts, their doors, and the lanes each one is worth running.
 *
 * `linux` is local (`ssh: ''`). The two remotes get the lanes that say something about *that*
 * platform — a typecheck and a unit run — because the native and integration lanes are built
 * Linux-first (CI runs them on `ubox` alone) and the e2e lane wants a desktop the runner owns.
 */
export function hosts(env = process.env) {
  return {
    linux: {
      key: 'linux', platform: 'linux', label: 'linux', ssh: env.LOCAL_CI_LINUX ?? '',
      lanes: ['typecheck', 'unit', 'native', 'integration', 'e2e']
    },
    win: {
      key: 'win', platform: 'win32', label: 'windows',
      ssh: env.LOCAL_CI_WIN ?? 'adam@192.168.0.210',
      keyFile: env.LOCAL_CI_WIN_KEY ?? '~/.ssh/id_ed25519_winvm',
      lanes: ['typecheck', 'unit']
    },
    mac: {
      key: 'mac', platform: 'darwin', label: 'macos',
      ssh: env.LOCAL_CI_MAC ?? 'adam@mac.local',
      keyFile: env.LOCAL_CI_MAC_KEY ?? '',
      lanes: ['typecheck', 'unit']
    }
  }
}

/** `--hosts=win,mac` / `--lanes=unit`, with the defaults above filled in. */
export function plan(argv, env = process.env) {
  const flags = new Map()
  for (const arg of argv) {
    const [name, value = ''] = arg.replace(/^--/, '').split('=')
    flags.set(name, value)
  }
  const asked = (flags.get('lanes') ?? '').split(',').map(name => name.trim()).filter(Boolean)
  const names = (flags.get('hosts') ?? 'linux,win,mac').split(',').map(name => name.trim()).filter(Boolean)
  const table = hosts(env)

  const noHost = names.find(name => table[name] === undefined)
  if (noHost !== undefined) throw new Error(`no such host: ${noHost}`)
  const noLane = asked.find(name => LANES[name] === undefined)
  if (noLane !== undefined) throw new Error(`no such lane: ${noLane}`)

  const steps = []
  for (const name of names) {
    for (const lane of asked.length > 0 ? asked : table[name].lanes) {
      steps.push({ host: table[name], lane, ...LANES[lane] })
    }
  }
  return { steps, list: flags.has('list'), host: names }
}

/** Whether a step can run where it was asked to; if not, the reason a reader is given. */
export function refusal(step) {
  if (step.gui && step.host.ssh !== '') {
    return "needs a desktop session: CI runs it from the runner in that machine's login session"
  }
  if (step.linux && step.host.platform !== 'linux') {
    return `a Linux lane: CI runs it on ubox, and ${step.host.label} has no build of it`
  }
  return null
}

/** The tar that ships this tree. */
export function tarArgs(excludes = EXCLUDES) {
  return ['czf', '-', ...excludes.map(name => `--exclude=${name}`), '.']
}

/** The ssh argv for one command on one host: the key it needs, and no interactive prompt. */
export function sshArgs(host, argvBody) {
  return [
    'ssh',
    ...(host.keyFile === undefined || host.keyFile === '' ? [] : ['-i', host.keyFile.replace(/^~/, homedir())]),
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=8',
    '-o', 'StrictHostKeyChecking=accept-new',
    host.ssh,
    argvBody
  ]
}

/**
 * The same, as `spawn` wants it: the binary apart from its arguments. Every call site goes
 * through this, because handing the whole array to `spawn` as its arguments makes `ssh` the
 * host it tries to reach.
 */
export function sshCommand(host, argvBody) {
  const [command, ...args] = sshArgs(host, argvBody)
  return { command, args }
}

/**
 * What the host's shell needs before a lane runs: the Node its runner already has, MSVC on
 * PATH for the engine build, and the ASIO SDK where the workflow looks for it.
 *
 * A prologue rather than a setup step, because each lane is one ssh session: these variables
 * have to be set in *that* shell, and importing vcvars in an earlier session would leave
 * nothing behind. The default shell on the Windows box is PowerShell, so the body is
 * PowerShell and the ssh client hands it over untouched.
 */
export function prologue(host) {
  if (host.platform === 'win32') {
    return [
      // PowerShell refuses to run `npm.ps1` on a machine whose execution policy says so, and
      // the shim it refuses is the one a bare `npm` resolves to. Both ends are covered: the
      // policy for this process, and `npm.cmd` in `npmCommand` below, because a lane hands
      // commands to its own children (`npx` in `scripts/run-e2e.js`) that this line cannot.
      `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force -ErrorAction SilentlyContinue | Out-Null`,
      `$node = Get-ChildItem 'C:\\actions-runner\\_work\\_tool\\node' -Directory -ErrorAction SilentlyContinue | Sort-Object Name | Select-Object -Last 1`,
      `if ($node) { $tool = Join-Path $node.FullName 'x64'; if (Test-Path $tool) { $env:PATH = "$tool;$env:PATH" } }`,
      `$vs = & "\${env:ProgramFiles(x86)}\\Microsoft Visual Studio\\Installer\\vswhere.exe" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null`,
      `if ($vs) { cmd /c "\`"$vs\\VC\\Auxiliary\\Build\\vcvars64.bat\`" >nul && set" | ForEach-Object { if ($_ -match '^([^=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1], $matches[2]) } } }`,
      `if (Test-Path 'C:\\asio-sdk\\ASIOSDK\\common\\asio.h') { $env:CUERUNNER_ASIO_SDK = 'C:\\asio-sdk\\ASIOSDK' }`
    ].join('; ')
  }
  return [
    `if [ -d "$HOME/actions-runner/_work/_tool/node" ]; then`,
    `tool=$(find "$HOME/actions-runner/_work/_tool/node" -maxdepth 3 -name node -type f 2>/dev/null | sort | tail -1);`,
    `[ -n "$tool" ] && PATH="$(dirname "$tool"):$PATH" && export PATH;`,
    `fi`
  ].join(' ')
}

/**
 * A lane's command as the host has to spell it: Windows runs `npm.cmd`, because a bare `npm`
 * is `npm.ps1` there and an execution policy can refuse it.
 */
export function npmCommand(host, run) {
  return host.platform === 'win32' && run.startsWith('npm ') ? `npm.cmd ${run.slice(4)}` : run
}

/** A body for the host's own shell: one command per line, failing at the first failure. */
export function body(host, lines) {
  return lines.join(host.platform === 'win32' ? '; ' : ' && ')
}

/** The shell's own quoting of a path, for the host's platform. */
export function quote(host, path) {
  return host.platform === 'win32' ? `'${path}'` : `"${path}"`
}

/** The tree's digest, so an unchanged one is not shipped twice in a run. */
let cachedDigest = null
export function treeDigest() {
  if (cachedDigest !== null) return cachedDigest
  const hash = createHash('sha256')
  for (const file of walk(process.cwd())) hash.update(file + '\n')
  hash.update(lockHash())
  cachedDigest = hash.digest('hex').slice(0, 16)
  return cachedDigest
}

function lockHash() {
  const lock = join(process.cwd(), 'package-lock.json')
  return existsSync(lock) ? createHash('sha256').update(readFileSync(lock)).digest('hex').slice(0, 16) : 'none'
}

function* walk(dir, depth = 0) {
  if (depth > 6) return
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDES.includes(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(path, depth + 1)
    else if (entry.isFile()) yield relative(process.cwd(), path)
  }
}

/** Every line under its lane's name, so two hosts' streams stay readable apart. */
export function prefix(name, chunk) {
  return String(chunk)
    .split('\n')
    .filter((line, index, lines) => index < lines.length - 1 || line !== '')
    .map(line => `[${name}] ${line}\n`)
    .join('')
}

/** Runs a command and answers its exit code, streaming its output under `name`. */
function stream(command, args, name, cwd = process.cwd()) {
  return new Promise(resolve => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.on('data', chunk => process.stdout.write(prefix(name, chunk)))
    child.stderr.on('data', chunk => process.stderr.write(prefix(name, chunk)))
    child.on('error', error => {
      process.stdout.write(`[${name}] ${error.message}\n`)
      resolve(1)
    })
    child.on('close', code => resolve(code ?? 1))
  })
}

/** Runs one command on one host, quietly, and answers its stdout (null when it did not answer). */
function ask(host, line) {
  return new Promise(resolve => {
    const { command, args } = sshCommand(host, line)
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', chunk => { out += chunk })
    child.on('error', () => resolve(null))
    child.on('close', code => resolve(code === 0 ? out.trim() : null))
  })
}

/** The tar, piped straight into an unpack on the far side of the ssh connection. */
function ship(host, where, name) {
  return new Promise(resolve => {
    const tar = spawn('tar', tarArgs(), { cwd: process.cwd() })
    const unpack = sshCommand(host, `tar xzf - -C ${quote(host, where)}`)
    const ssh = spawn(unpack.command, unpack.args, { stdio: ['pipe', 'pipe', 'pipe'] })
    tar.stdout.pipe(ssh.stdin)
    ssh.stdout.on('data', chunk => process.stdout.write(prefix(name, chunk)))
    ssh.stderr.on('data', chunk => process.stderr.write(prefix(name, chunk)))
    tar.stderr.on('data', chunk => process.stderr.write(prefix(name, chunk)))
    tar.on('error', () => ssh.kill())
    ssh.on('close', code => resolve(code ?? 1))
  })
}

/** One lane on one host: the tree if it moved, the install if the lockfile did, then the lane. */
async function runStep(step, report) {
  const name = `${step.host.key} ${step.lane}`
  const why = refusal(step)
  if (why !== null) {
    console.log(`[${name}] skipped — ${why}`)
    report.push({ name, status: 'skipped', why })
    return
  }
  if (step.host.ssh === '') {
    const code = await stream('sh', ['-lc', step.run], name)
    report.push({ name, status: code === 0 ? 'passed' : 'failed' })
    return
  }

  const home = await ask(step.host, step.host.platform === 'win32' ? 'echo $env:USERPROFILE' : 'echo $HOME')
  if (home === null) {
    console.log(`[${name}] skipped — ${step.host.ssh} did not answer`)
    report.push({ name, status: 'skipped', why: `${step.host.ssh} did not answer` })
    return
  }
  const where = step.host.platform === 'win32'
    ? `${home}\\${REMOTE_DIR}\\${step.host.key}`
    : `${home}/${REMOTE_DIR}/${step.host.key}`
  const make = step.host.platform === 'win32'
    ? `New-Item -ItemType Directory -Force -Path ${quote(step.host, where)} | Out-Null`
    : `mkdir -p ${quote(step.host, where)}`
  const marker = (file, value) => step.host.platform === 'win32'
    ? `Set-Content -Path ${quote(step.host, `${where}\\.local-ci-${file}`)} -Value '${value}'`
    : `echo ${value} > ${quote(step.host, `${where}/.local-ci-${file}`)}`
  const read = (file) => step.host.platform === 'win32'
    ? `Get-Content ${quote(step.host, `${where}\\.local-ci-${file}`)} -ErrorAction SilentlyContinue`
    : `cat ${quote(step.host, `${where}/.local-ci-${file}`)} 2>/dev/null`

  await ask(step.host, make)
  const digest = treeDigest()
  if ((await ask(step.host, read('tree'))) !== digest) {
    console.log(`[${name}] shipping the working tree to ${step.host.ssh}`)
    const code = await ship(step.host, where, name)
    if (code !== 0) {
      report.push({ name, status: 'failed', why: 'the tree did not arrive' })
      return
    }
    await ask(step.host, marker('tree', digest))
  }

  const lock = lockHash()
  if ((await ask(step.host, read('lock'))) !== lock) {
    console.log(`[${name}] npm ci on ${step.host.ssh}`)
    const install = sshCommand(step.host, body(step.host, [prologue(step.host), `cd ${quote(step.host, where)}`, npmCommand(step.host, 'npm ci --legacy-peer-deps')]))
    const code = await stream(install.command, install.args, name)
    if (code !== 0) {
      report.push({ name, status: 'failed', why: 'npm ci did not finish' })
      return
    }
    await ask(step.host, marker('lock', lock))
  }

  const lane = sshCommand(step.host, body(step.host, [prologue(step.host), `cd ${quote(step.host, where)}`, npmCommand(step.host, step.run)]))
  const code = await stream(lane.command, lane.args, name)
  report.push({ name, status: code === 0 ? 'passed' : 'failed' })
}

async function main() {
  const options = plan(process.argv.slice(2))
  if (options.list) {
    for (const step of options.steps) {
      const why = refusal(step)
      console.log(`${step.host.key} ${step.lane} — ${step.what}${why === null ? '' : ` (would skip: ${why})`}`)
    }
    return 0
  }

  const report = []
  const started = Date.now()
  for (const step of options.steps) await runStep(step, report)

  console.log('')
  for (const row of report) {
    const mark = row.status === 'passed' ? 'ok  ' : row.status === 'skipped' ? 'skip' : 'FAIL'
    console.log(`${mark} ${row.name}${row.why === undefined ? '' : ` — ${row.why}`}`)
  }
  const failed = report.filter(row => row.status === 'failed').length
  const skipped = report.filter(row => row.status === 'skipped').length
  console.log(`${report.length - failed - skipped} passed, ${skipped} skipped, ${failed} failed in ${Math.round((Date.now() - started) / 1000)}s`)
  return failed === 0 ? 0 : 1
}

main().then(code => process.exit(code)).catch(error => {
  console.error(error.message)
  process.exit(2)
})
