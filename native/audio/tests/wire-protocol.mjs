#!/usr/bin/env node
/**
 * The wire's declaration acceptance: the engine opens a connection by declaring the
 * protocol and verb set it speaks, and refuses a request its declaration does not allow —
 * an unknown verb, a field that is missing, of the wrong type, or null where null is not
 * a value of its own — while a well-formed request that omits an optional field still
 * takes the declared default.
 *
 * The declaration itself is held against src/shared/audio.ts by
 * src/main/audio/audioWire.test.ts, which spawns this same `--protocol` output; this
 * harness walks the declaration against the live engine: every verb it carries is answered
 * (nothing is routed by the chain and missing from the table), every event the engine emits
 * carries exactly the fields its type declares, and an engine told to declare another
 * protocol says so in its greeting and in `info()`.
 *
 *   node native/audio/tests/wire-protocol.mjs [--binary path]
 */
import { execFileSync, spawn } from 'node:child_process'
import { connect } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const defaultBinary = join(repoRoot, 'native', 'audio', 'build', `cuerunner-audio${process.platform === 'win32' ? '.exe' : ''}`)
const binaryIndex = process.argv.indexOf('--binary')
const binary = binaryIndex >= 0 ? process.argv[binaryIndex + 1] : process.env.CUERUNNER_AUDIO_BIN ?? defaultBinary

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

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms))

class EngineClient {
  constructor(socketPath) {
    this.socketPath = socketPath
    this.buffer = ''
    this.nextId = 1
    this.pending = new Map()
    this.greetings = []
    this.events = []
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
    if (message.greeting === true) {
      this.greetings.push(message)
      return
    }
    if (typeof message.id === 'number') {
      const pending = this.pending.get(message.id)
      if (pending === undefined) return
      this.pending.delete(message.id)
      // The whole reply, refusals included: what is under test is the error, not a
      // rejection from the client hiding the code and message.
      pending.resolve(message)
      return
    }
    if (message.event) this.events.push(message.event)
  }

  request(verb, params = {}, timeoutMs = 8000) {
    const id = this.nextId++
    const { promise, resolve, reject } = Promise.withResolvers()
    const timer = setTimeout(() => {
      this.pending.delete(id)
      reject(new Error(`the engine did not answer ${verb} within ${timeoutMs} ms`))
    }, timeoutMs)
    this.pending.set(id, {
      resolve: (message) => {
        clearTimeout(timer)
        resolve(message)
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

/** What the engine prints for `--protocol`: the declaration this build speaks. */
const declaration = JSON.parse(execFileSync(binary, ['--protocol'], { encoding: 'utf8' }))
const declaredVerbs = Object.keys(declaration.verbs ?? {})
const declaredEvents = declaration.events ?? {}
console.log(`wire protocol — declaration ${JSON.stringify(declaration.protocol)}, ${declaredVerbs.length} verbs, ${Object.keys(declaredEvents).length} events, binary ${binary}`)
check(
  '--protocol answers with a declaration and its verbs',
  typeof declaration.protocol === 'number' && declaration.verbs !== undefined && declaration.verbs.prepare !== undefined && declaration.verbs.stop !== undefined,
  JSON.stringify(declaration).slice(0, 200)
)
check(
  'it declares the event set, each type with its fields',
  Object.keys(declaredEvents).length > 0 &&
    Object.values(declaredEvents).every(fields => Array.isArray(fields) && fields.length > 0 && fields.every(field => typeof field === 'string')),
  JSON.stringify(declaredEvents).slice(0, 200)
)

const workDir = mkdtempSync(join(tmpdir(), 'cuerunner-wire-protocol-'))
let sockets = 0

/**
 * Spawns an engine on its own socket and connects to it, retrying while it starts. The
 * declaration is written as the connection is accepted, so it is waited for before
 * anything is sent.
 */
async function startEngine(extraArgs = []) {
  // The engine addresses its endpoint the way the platform does: a named pipe on Windows,
  // a unix socket elsewhere (a path like C:\...\x.sock is not a pipe name).
  const socketPath =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\cuerunner-wire-${process.pid}-${sockets++}`
      : join(workDir, `engine-${sockets++}.sock`)
  const child = spawn(binary, ['--socket', socketPath, '--backend', 'silent', '--sample-rate', '48000', ...extraArgs], {
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString()
  })

  const client = new EngineClient(socketPath)
  const connectDeadline = Date.now() + 8000
  for (;;) {
    try {
      await client.connect()
      break
    } catch (error) {
      if (Date.now() > connectDeadline || child.exitCode !== null || child.signalCode !== null) {
        client.close()
        return { client, child, connected: false, stderr: () => stderr, error }
      }
      await sleep(50)
    }
  }
  const greetingDeadline = Date.now() + 2000
  while (client.greetings.length === 0 && Date.now() < greetingDeadline) await sleep(10)
  return { client, child, connected: true, stderr: () => stderr }
}

async function stopEngine(engine) {
  const { client, child } = engine
  const exited =
    child.exitCode !== null || child.signalCode !== null
      ? Promise.resolve(true)
      : new Promise((resolvePromise) => child.once('exit', () => resolvePromise(true)))
  if (engine.connected) {
    await Promise.race([client.request('shutdown').catch(() => {}), sleep(2000)])
  }
  client.close()
  const killed = await Promise.race([exited, sleep(2000).then(() => false)])
  if (!killed) child.kill('SIGKILL')
}

const engine = await startEngine()
try {
  check('the engine accepts a connection', engine.connected, engine.connected ? '' : `${engine.error?.message}\n${engine.stderr()}`)

  if (engine.connected) {
    const { client } = engine
    // Nothing has been sent yet: whatever arrived did so unprompted, as the connection
    // opened.
    const greeting = client.greetings[0]
    check(
      'the connection opens with the declaration',
      client.greetings.length === 1 && greeting.protocol === declaration.protocol && greeting.name !== '' && greeting.version !== '',
      JSON.stringify({ greetings: client.greetings, declaration: declaration.protocol })
    )

    const unknown = await client.request('fly')
    check(
      'an unknown verb is refused by name',
      unknown.ok === false && unknown.error?.code === 'invalid' && /unknown verb 'fly'/.test(unknown.error?.message ?? ''),
      JSON.stringify(unknown)
    )

    const noCue = await client.request('stop', { fadeMs: 0 })
    check(
      'a cue-addressed verb with no cue names cueId, and is not an ok',
      noCue.ok === false && noCue.error?.code === 'invalid' && /cueId/.test(noCue.error?.message ?? ''),
      JSON.stringify(noCue)
    )

    const barePrepare = await client.request('prepare')
    check(
      'prepare with nothing names cueId rather than defaulting it',
      barePrepare.ok === false && barePrepare.error?.code === 'invalid' && /cueId/.test(barePrepare.error?.message ?? ''),
      JSON.stringify(barePrepare)
    )

    const noFile = await client.request('prepare', { cueId: 'a' })
    check(
      'prepare with a cue but no file names filePath',
      noFile.ok === false && noFile.error?.code === 'invalid' && /filePath/.test(noFile.error?.message ?? ''),
      JSON.stringify(noFile)
    )

    const wrongType = await client.request('start', { cueId: 7, options: {} })
    check(
      'a mistyped required field is refused, not coerced',
      wrongType.ok === false && wrongType.error?.code === 'invalid' && /cueId/.test(wrongType.error?.message ?? ''),
      JSON.stringify(wrongType)
    )

    const noOptions = await client.request('start', { cueId: 'a' })
    check(
      'start with no options names options',
      noOptions.ok === false && noOptions.error?.code === 'invalid' && /options/.test(noOptions.error?.message ?? ''),
      JSON.stringify(noOptions)
    )

    const noType = await client.request('simulateDeviceNotification')
    check(
      'the notification hook needs its type',
      noType.ok === false && noType.error?.code === 'invalid' && /type/.test(noType.error?.message ?? ''),
      JSON.stringify(noType)
    )

    // Every present field is held to its declared type — an optional one included, whose
    // wrong value would otherwise be coerced into its default.
    const mistypedOptional = await client.request('stop', { cueId: 'a', fadeMs: '100' })
    check(
      'a mistyped optional field is refused, not defaulted',
      mistypedOptional.ok === false && mistypedOptional.error?.code === 'invalid' && /fadeMs/.test(mistypedOptional.error?.message ?? ''),
      JSON.stringify(mistypedOptional)
    )

    const mistypedNested = await client.request('start', { cueId: 'a', options: { volume: 'loud' } })
    check(
      'a mistyped field inside options names the field it is',
      mistypedNested.ok === false && mistypedNested.error?.code === 'invalid' && /options\.volume/.test(mistypedNested.error?.message ?? ''),
      JSON.stringify(mistypedNested)
    )

    const mistypedCrosspoint = await client.request('start', {
      cueId: 'a',
      options: { outputs: [{ inputChannel: 0, outputChannel: 0, gain: 'loud' }] }
    })
    check(
      'a mistyped crosspoint field names it with its index',
      mistypedCrosspoint.ok === false && mistypedCrosspoint.error?.code === 'invalid' && /outputs\[0\]\.gain/.test(mistypedCrosspoint.error?.message ?? ''),
      JSON.stringify(mistypedCrosspoint)
    )

    // Null is a value of its own only where the declaration says so.
    const nullRegion = await client.request('waveform', { filePath: 'x', startMs: null, endMs: null })
    check(
      'null where the declaration does not allow it is refused',
      nullRegion.ok === false && nullRegion.error?.code === 'invalid' && /startMs/.test(nullRegion.error?.message ?? ''),
      JSON.stringify(nullRegion)
    )

    const nullOutputs = await client.request('routing', { cueId: 'a', outputs: null })
    check(
      'null where the declaration allows it is taken as its own meaning',
      nullOutputs.ok === true && nullOutputs.result?.ok === true,
      JSON.stringify(nullOutputs)
    )

    const defaulted = await client.request('stopAll')
    check(
      'an optional field absent takes the declared default',
      defaulted.ok === true && defaulted.result?.ok === true,
      JSON.stringify(defaulted)
    )

    const clock = await client.request('clock')
    check(
      'a well-formed request is answered as before',
      clock.ok === true && typeof clock.result?.clockMs === 'number' && typeof clock.result?.sessionId === 'string',
      JSON.stringify(clock)
    )

    const info = await client.request('info')
    check(
      'info reports the protocol the greeting declared',
      info.ok === true && info.result?.protocol === declaration.protocol,
      JSON.stringify(info?.result?.protocol)
    )

    // Every verb the declaration carries must be one the dispatch chain answers: a verb
    // routed by the chain and missing from the table (or a table entry the chain does not
    // know) would otherwise only show up when an operator used it.
    const unrouted = []
    for (const verb of declaredVerbs) {
      // `shutdown` ends the process; the cleanup below exercises it.
      if (verb === 'shutdown') continue
      const reply = await client.request(verb)
      if (reply.ok === false && /unknown verb/.test(reply.error?.message ?? '')) unrouted.push(verb)
    }
    check(
      'every verb in the declaration is routed by the engine',
      unrouted.length === 0,
      JSON.stringify(unrouted)
    )

    // The declaration's other half, walked against the live engine: a fixture played to
    // its natural end, a panic, and a device the engine loses — the events the silent
    // backend can be made to produce — with every line the engine wrote held to the fields
    // the declaration names for its type. A field the engine writes and does not declare,
    // or a type it emits without declaring it, is an engine that has drifted from the set
    // this build checks events against.
    const fixture = join(repoRoot, 'native', 'audio', 'tests', 'fixtures', 'tone.w64')
    const firstEvent = client.events.length
    const walked = () => client.events.slice(firstEvent)
    // Waits on the engine's own output rather than on a guessed duration: the condition is
    // polled until it holds or the deadline passes.
    const waitForType = async (type, deadlineMs = 8000) => {
      const deadline = Date.now() + deadlineMs
      while (Date.now() < deadline) {
        if (walked().some(event => event.type === type)) return true
        await sleep(10)
      }
      return false
    }

    const prepared = await client.request('prepare', { cueId: 'walk', filePath: fixture })
    check('the event-walk fixture prepares', prepared.ok === true, JSON.stringify(prepared))
    if (prepared.ok === true) {
      await client.request('start', { cueId: 'walk', options: {} })
      check(
        'the walk plays the fixture to its natural end',
        (await waitForType('ended')) && walked().some(event => event.type === 'ended' && event.reason === 'complete'),
        JSON.stringify(walked())
      )
      await client.request('panic', { fadeMs: 0 })
      check('the walk panics', await waitForType('panic'), JSON.stringify(walked()))
      // The loss the backend callback reports, run through the same classification: it is
      // how the silent backend produces an `error` line, which is what holds that part of
      // the declaration to what the engine really emits.
      await client.request('simulateDeviceNotification', { type: 'stopped', deliberate: false })
      check('the walk loses the device', await waitForType('error'), JSON.stringify(walked()))
    }

    const observedTypes = new Set()
    const mismatched = []
    for (const event of walked()) {
      observedTypes.add(event.type)
      // Own properties only: a type named `constructor` must read as undeclared, not as a
      // function off the prototype.
      const fields = Object.hasOwn(declaredEvents, event.type) ? declaredEvents[event.type] : undefined
      if (fields === undefined) {
        mismatched.push(`${event.type}: emitted but not declared`)
        continue
      }
      const observed = Object.keys(event).sort()
      const declared = [...fields].sort()
      if (JSON.stringify(observed) !== JSON.stringify(declared)) {
        mismatched.push(`${event.type}: [${observed}] instead of declared [${declared}]`)
      }
    }
    check(
      'every event the engine emits carries exactly the fields its declaration names',
      mismatched.length === 0,
      JSON.stringify(mismatched)
    )
    check(
      'the walk saw every event kind this backend produces',
      ['ended', 'error', 'panic', 'state'].every(type => observedTypes.has(type)),
      JSON.stringify([...observedTypes])
    )
  }
} finally {
  await stopEngine(engine)
}

// The declaration is what the engine says it is: an engine asked to declare another
// protocol says so in its greeting and in what `info()` reports, so the two can never
// disagree about which set of verbs the connection is speaking.
{
  const declared = declaration.protocol + 1
  const other = await startEngine(['--declare-protocol', String(declared)])
  try {
    check('an engine told to declare another protocol starts', other.connected, other.connected ? '' : `${other.error?.message}\n${other.stderr()}`)
    if (other.connected) {
      const greeting = other.client.greetings[0]
      check(
        'its greeting declares that protocol',
        greeting !== undefined && greeting.protocol === declared,
        JSON.stringify(greeting)
      )
      const info = await other.client.request('info')
      check(
        'and info() reports the same one',
        info.ok === true && info.result?.protocol === declared,
        JSON.stringify(info?.result?.protocol)
      )
    }
  } finally {
    await stopEngine(other)
  }
}

rmSync(workDir, { recursive: true, force: true })
console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures === 0 ? 0 : 1)
