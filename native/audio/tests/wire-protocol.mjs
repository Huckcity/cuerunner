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
 * (nothing is routed by the chain and missing from the table), every event the engine
 * emits carries exactly the fields its type declares, the greeting a connection opens with
 * and `info()` report the one protocol the declaration carries, and the bounds the declaration
 * carries are enforced — a stamped verb beyond the schedule horizon is refused naming it,
 * a streaming voice reports the ring it holds, and the total streaming budget refuses the
 * voice that would exceed it.
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

/**
 * The bounds both ends share, as this build declares them — the same table
 * src/shared/audio.ts carries, printed beside the verbs so that
 * src/main/audio/audioWire.test.ts can hold the two equal. Read here rather than typed
 * into this file, so a check below refuses against the declared figure itself.
 */
const limits = declaration.limits ?? {}
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
check(
  'the declaration carries every bound with its value and its regime',
  Object.keys(limits).length > 0 &&
    Object.values(limits).every(
      (limit) => typeof limit?.value === 'number' && limit.value > 0 && (limit.regime === 'refuse' || limit.regime === 'clamp-and-report')
    ),
  JSON.stringify(limits)
)

const workDir = mkdtempSync(join(tmpdir(), 'cuerunner-wire-protocol-'))
let sockets = 0

/** A media file long enough to outlive the checks below: the streaming bounds need one. */
const fixturePath = join(repoRoot, 'native', 'audio', 'tests', 'fixtures', 'long-tone.mp3')

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

    // A cache-backed voice holds no ring: `streamBytes` is the streaming half of the
    // per-voice bound, and 0 is what says the voice is playing from decoded memory.
    await client.request('prepare', { cueId: 'tone', filePath: fixturePath })
    const cachedStart = await client.request('start', { cueId: 'tone', whenMs: 0, options: {} })
    const cachedInfo = await client.request('info')
    const cachedVoice = cachedInfo.result?.activeCues?.find((voice) => voice.cueId === 'tone')
    check(
      'a cache-backed voice reports no streaming ring',
      cachedStart.ok === true && cachedVoice !== undefined && cachedVoice.streamBytes === 0 && cachedInfo.result?.media?.streamingVoices === 0,
      JSON.stringify({ start: cachedStart, voice: cachedVoice, media: cachedInfo.result?.media })
    )

    // The schedule horizon refuses, and it covers every verb whose declaration carries a
    // `whenMs` — derived from the declaration rather than a second list here, so a verb
    // that gains one is covered the moment its declaration does.
    const horizonMs = limits.scheduleHorizonMs?.value
    const stamped = declaredVerbs.filter((verb) => declaration.verbs[verb]?.whenMs !== undefined)
    const missed = []
    for (const verb of stamped) {
      const params = { cueId: 'never-prepared', whenMs: horizonMs + 600_000 }
      if (verb === 'start') params.options = {}
      const reply = await client.request(verb, params)
      const message = reply.error?.message ?? ''
      if (reply.ok !== false || reply.error?.code !== 'limit' || !message.includes(String(horizonMs))) {
        missed.push(`${verb}: ${JSON.stringify(reply)}`)
      }
    }
    check(
      'every stamped verb is refused beyond the horizon, naming it',
      stamped.length > 0 && missed.length === 0,
      JSON.stringify(missed)
    )
    const afterRefusals = await client.request('clock')
    check(
      'the connection stays usable after a refusal',
      afterRefusals.ok === true && typeof afterRefusals.result?.clockMs === 'number',
      JSON.stringify(afterRefusals)
    )

    const info = await client.request('info')
    check(
      'info reports the protocol the greeting declared',
      info.ok === true && info.result?.protocol === declaration.protocol,
      JSON.stringify(info?.result?.protocol)
    )
    // The bounds an engine with no limit flags runs with are the declaration's own: the
    // figures it reports in force are the values the same build printed a moment ago.
    check(
      'a default-configured engine reports the declared bounds in force',
      info.result?.cache?.limitBytes === limits.cacheMaxBytes?.value &&
        info.result?.cache?.maxFiles === limits.cacheMaxFiles?.value &&
        info.result?.cache?.maxFileBytes === limits.cacheMaxFileBytes?.value &&
        info.result?.media?.streamBufferLimitBytes === limits.streamMaxTotalBytes?.value,
      JSON.stringify({
        cache: [info.result?.cache?.limitBytes, info.result?.cache?.maxFiles, info.result?.cache?.maxFileBytes],
        streamBufferLimitBytes: info.result?.media?.streamBufferLimitBytes
      })
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

// The declaration is what the engine says it is: the protocol a greeting opens a
// connection with and the one `info()` reports are the same number the declaration
// carries, because the build has one home for it and nothing can be told another.
{
  const own = await startEngine([])
  try {
    check('an engine starts', own.connected, own.connected ? '' : `${own.error?.message}\n${own.stderr()}`)
    if (own.connected) {
      const greeting = own.client.greetings[0]
      check(
        'the greeting a connection opens with declares the protocol --protocol prints',
        greeting !== undefined && greeting.protocol === declaration.protocol,
        JSON.stringify(greeting)
      )
      const info = await own.client.request('info')
      check(
        'and info() reports the same one',
        info.ok === true && info.result?.protocol === declaration.protocol,
        JSON.stringify(info?.result?.protocol)
      )
    }
  } finally {
    await stopEngine(own)
  }
}

// The streaming bounds, on the silent backend and with the flags set narrow enough to
// reach them: the per-voice ring is what a voice reports, and the total budget refuses
// the voice that would take the pool past it rather than allocating it.
{
  const perVoiceCap = 100_000
  const totalBudget = 150_000
  const stream = await startEngine([
    '--cache-max-file-bytes', '1000',
    '--stream-max-bytes-per-voice', String(perVoiceCap),
    '--stream-max-total-bytes', String(totalBudget)
  ])
  try {
    check('an engine with the streaming flags starts', stream.connected, stream.connected ? '' : `${stream.error?.message}\n${stream.stderr()}`)
    if (stream.connected) {
      const { client } = stream
      const prepared = await client.request('prepare', { cueId: 'stream-a', filePath: fixturePath })
      check(
        'a file above the per-file bound is reported as streaming',
        prepared.ok === true && prepared.result?.streaming === true,
        JSON.stringify(prepared)
      )

      const first = await client.request('start', { cueId: 'stream-a', whenMs: 0, options: {} })
      check('the first streaming voice is within the budget', first.ok === true, JSON.stringify(first))
      let info = null
      for (let attempt = 0; attempt < 50; attempt++) {
        info = await client.request('info')
        if (info.result?.activeCues?.some((voice) => voice.cueId === 'stream-a')) break
        await sleep(20)
      }
      const voice = info?.result?.activeCues?.find((entry) => entry.cueId === 'stream-a')
      check(
        'a streaming voice reports the ring it holds, and it is the pool’s own figure',
        voice !== undefined && voice.streamBytes > 0 && voice.streamBytes <= perVoiceCap && voice.streamBytes === info.result?.media?.streamBufferBytes,
        JSON.stringify({ voice, media: info?.result?.media })
      )

      await client.request('prepare', { cueId: 'stream-b', filePath: fixturePath })
      const second = await client.request('start', { cueId: 'stream-b', whenMs: 0, options: {} })
      check(
        'a voice past the total budget is refused, naming the bound',
        second.ok === false && second.error?.code === 'limit' && /streamMaxTotalBytes/.test(second.error?.message ?? '') && (second.error?.message ?? '').includes(String(totalBudget)),
        JSON.stringify(second)
      )
      const after = await client.request('info')
      check(
        'the refusal left the first voice playing and the total inside the budget',
        after.result?.media?.streamBufferBytes <= totalBudget &&
          after.result?.activeCues?.some((entry) => entry.cueId === 'stream-a') === true &&
          after.result?.activeCues?.some((entry) => entry.cueId === 'stream-b') === false,
        JSON.stringify({ media: after.result?.media, cues: after.result?.activeCues?.map((entry) => entry.cueId) })
      )
    }
  } finally {
    await stopEngine(stream)
  }

  // A cap below the engine's 4096-frame floor: the floor must not raise the ring past
  // what the caller declared, so the achieved figure is the cap, not the floor.
  const subFloorCap = 1000
  const tiny = await startEngine([
    '--cache-max-file-bytes', '1000',
    '--stream-max-bytes-per-voice', String(subFloorCap)
  ])
  try {
    check('an engine with a sub-floor per-voice cap starts', tiny.connected, tiny.connected ? '' : `${tiny.error?.message}\n${tiny.stderr()}`)
    if (tiny.connected) {
      await tiny.client.request('prepare', { cueId: 'tiny', filePath: fixturePath })
      const started = await tiny.client.request('start', { cueId: 'tiny', whenMs: 0, options: {} })
      let info = null
      for (let attempt = 0; attempt < 50; attempt++) {
        info = await tiny.client.request('info')
        if (info.result?.activeCues?.some((voice) => voice.cueId === 'tiny')) break
        await sleep(20)
      }
      const voice = info?.result?.activeCues?.find((entry) => entry.cueId === 'tiny')
      check(
        'a ring below the frame floor still honours the byte cap',
        started.ok === true && voice !== undefined && voice.streamBytes > 0 && voice.streamBytes <= subFloorCap,
        JSON.stringify({ started, voice })
      )
    }
  } finally {
    await stopEngine(tiny)
  }
}

rmSync(workDir, { recursive: true, force: true })
console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures === 0 ? 0 : 1)
