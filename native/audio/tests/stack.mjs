#!/usr/bin/env node
/**
 * Entry-path stack acceptance: Windows gives a thread one MiB of stack, and the engine is
 * several MiB of embedded queues. A daemon that builds its engine on the stack therefore
 * dies before printing a word — which is what Windows did (0xC00000FD, empty stderr, every
 * spec downstream failing).
 *
 * This runs the engine on a one-MiB stack and asserts it still answers. The limit is
 * inherited by the process that is spawned, so the check bites on Linux and on macOS
 * (both measured: the stack-allocated engine dies with SIGSEGV here). Windows has no
 * ulimit, and is covered by the e2e lane's engine-up assertion.
 *
 *   node native/audio/tests/stack.mjs [--binary path]
 */
import { spawn } from 'node:child_process'
import { connect } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const defaultBinary = join(repoRoot, 'native', 'audio', 'build', `winslab-audio${process.platform === 'win32' ? '.exe' : ''}`)
const binaryIndex = process.argv.indexOf('--binary')
const binary = binaryIndex >= 0 ? process.argv[binaryIndex + 1] : process.env.WINSLAB_AUDIO_BIN ?? defaultBinary

/** What Windows gives a thread, and what the engine has to fit in. */
const STACK_KB = 1024

let failures = 0
let checks = 0
function check(name, condition, detail = '') {
  checks++
  if (condition) {
    console.log(`  ok   ${name}`)
  } else {
    failures++
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

class EngineClient {
  constructor(socketPath) {
    this.socketPath = socketPath
    this.buffer = ''
    this.nextId = 1
    this.pending = new Map()
  }

  async connect() {
    this.socket = connect(this.socketPath)
    this.socket.on('data', (chunk) => {
      this.buffer += chunk.toString('utf8')
      let newline = this.buffer.indexOf('\n')
      while (newline >= 0) {
        const line = this.buffer.slice(0, newline)
        this.buffer = this.buffer.slice(newline + 1)
        if (line.trim() !== '') this.handle(line)
        newline = this.buffer.indexOf('\n')
      }
    })
    await new Promise((resolvePromise, rejectPromise) => {
      this.socket.once('connect', resolvePromise)
      this.socket.once('error', rejectPromise)
    })
  }

  handle(line) {
    const message = JSON.parse(line)
    if (typeof message.id !== 'number') return
    const pending = this.pending.get(message.id)
    if (pending === undefined) return
    this.pending.delete(message.id)
    if (message.ok) pending.resolve(message.result)
    else pending.reject(new Error(`${message.error?.code}: ${message.error?.message}`))
  }

  request(verb, params = {}, timeoutMs = 8000) {
    const id = this.nextId++
    const { promise, resolve, reject } = Promise.withResolvers()
    const timer = setTimeout(() => {
      this.pending.delete(id)
      reject(new Error(`the engine did not answer ${verb} within ${timeoutMs} ms`))
    }, timeoutMs)
    this.pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      reject: (error) => {
        clearTimeout(timer)
        reject(error)
      }
    })
    this.socket.write(`${JSON.stringify({ id, verb, ...params })}\n`)
    return promise
  }

  close() {
    for (const [id, pending] of this.pending) {
      this.pending.delete(id)
      pending.reject(new Error('the engine connection closed'))
    }
    this.socket?.destroy()
  }
}

if (process.platform === 'win32') {
  console.log('stack — skipped: Windows is covered by the e2e engine-up assertion')
  process.exit(0)
}

const workDir = mkdtempSync(join(tmpdir(), 'winslab-stack-'))
const socketPath = join(workDir, 'engine.sock')
console.log(`stack — silent backend on a ${STACK_KB} KiB stack`)

// The limit has to be set in the shell that starts the engine: RLIMIT_STACK is inherited.
const command = `ulimit -s ${STACK_KB}; exec "$0" --socket "$1" --backend silent --sample-rate 48000 --buffer-frames 512`
const child = spawn('/bin/sh', ['-c', command, binary, socketPath], { stdio: ['ignore', 'pipe', 'pipe'] })

let stderr = ''
child.stderr.on('data', (chunk) => {
  stderr += chunk.toString()
})

const client = new EngineClient(socketPath)
let connected = true
const connectDeadline = Date.now() + 8000
for (;;) {
  try {
    await client.connect()
    break
  } catch (error) {
    if (Date.now() > connectDeadline || child.exitCode !== null || child.signalCode !== null) {
      connected = false
      console.log(`  the engine did not accept a connection: ${error.message} (${child.signalCode ?? `exit ${child.exitCode}`})\n${stderr}`)
      break
    }
    await sleep(50)
  }
}

try {
  check('the engine starts on a one-MiB stack', connected)

  if (connected) {
    const info = await client.request('info')
    check('it answers with its own info', info?.backend === 'silent', JSON.stringify(info?.backend))
  }
} finally {
  const exited =
    child.exitCode !== null || child.signalCode !== null
      ? Promise.resolve(true)
      : new Promise((resolve) => child.once('exit', () => resolve(true)))
  if (connected) {
    await Promise.race([client.request('shutdown').catch(() => {}), sleep(2000)])
  }
  client.close()
  const killed = await Promise.race([exited, sleep(2000).then(() => false)])
  if (!killed) child.kill('SIGKILL')
  rmSync(workDir, { recursive: true, force: true })
}

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures === 0 ? 0 : 1)
