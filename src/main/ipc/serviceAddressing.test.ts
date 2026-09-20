// The gate that fails when a channel outside the four show channels addresses a service.
//
// AD-16's first rule is that four channels may address a service and no others, and the
// parity gate cannot hold it: it compares channel *sets*, so a channel added tomorrow
// whose handler forwards its caller's service id, action or settings into the show
// runtime passes every assertion of it and quietly becomes a fifth route — one that skips
// the host's ordering (refusal, then takes-no-commands, then not-running) and leaves the
// status record every panel draws describing something that no longer happened.
//
// So the surface is executed, not read. The real `registerIpcHandlers()` runs against a
// mocked `ipcMain` (the electron model the parity and refusal tests already use), the
// show runtime is mocked so every call it receives is recorded with its arguments, and
// every channel that registration handled is invoked with a payload built from *its own*
// sentinel: an object that answers the sentinel for any name a handler reads, a second
// one shaped like a request a validation would accept, and the sentinel itself for the
// channels that take a bare string. A channel whose own data turns up in a recorded call
// has addressed a service. The permitted set is the declaration's (`SHOW_CHANNELS`), so a
// route added or renamed there is covered without editing this file: the assertions name
// its members and nothing else, with one exception — the synthetic channel in the last
// two cases, which names a channel this app does not have.
//
// Attribution is by provenance, not by stack: a channel is judged against its own
// sentinel alone, so settings the runtime already holds from an earlier probe, or an id
// the code names itself, is not mistaken for caller data — `redundancy:configure`'s
// fixed-id restart stays legal and AD-16's serialisation bullet holds.
//
// The check is a function over a channel→handler map, which is what lets the last two
// cases hand it a surface this app has no part of: publish-shaped channels that forward
// their caller's payload to a service, one of them reading names this file never lists.
// A check written inline against the registered surface could not be falsified that way.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import type { BrowserWindow } from 'electron'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { APP_CHANNELS } from '../../shared/ipc/app'
import { LICENSE_CHANNELS } from '../../shared/ipc/license'
import { REDUNDANCY_CHANNELS } from '../../shared/ipc/redundancy'
import { SHOW_CHANNELS } from '../../shared/ipc/show'
import { registerIpcHandlers } from './handlers'
import { registerWindowIpcHandlers, type WindowHandlerDeps } from './windowHandlers'
import type { ShowRuntime } from '../show/runtime'

/** One registered handler, as Electron calls it. */
type ChannelHandler = (event: unknown, payload?: unknown) => unknown

/** One call the IPC layer made into the service-facing runtime, with what it carried. */
interface RuntimeCall {
  /** The runtime's own verb: `configure`, `snapshot`, `command`, `restart`, … */
  verb: string
  args: unknown[]
}

/** A channel whose own probe data reached the runtime: a route to a service. */
interface Addressing {
  channel: string
  /** The verbs that carried it, in the order they were reached. */
  verbs: string[]
}

/**
 * What one probe of a surface did: the calls each channel's probe made, and the channels
 * whose own data reached the runtime.
 */
interface Probe {
  /** Per channel, the calls made while it was being probed, in order. */
  windows: Map<string, RuntimeCall[]>
  addressing: Addressing[]
}

/**
 * What the mocked ends recorded, shared between the module mocks and the test body.
 * `vi.hoisted` because the electron and runtime factories are hoisted above this file's
 * imports and have to close over the same recorders the tests read.
 */
const ends = vi.hoisted(() => {
  /** The registered surface, as the real `ipcMain` holds it: channel → handler. */
  const registered = new Map<string, ChannelHandler>()
  /** Every call the IPC layer made into the runtime, in order. */
  const calls: RuntimeCall[] = []
  /** The stub the mocked factory handed `handlers.ts`, for the guard's self-check. */
  const stub: { current: ShowRuntime | null } = { current: null }
  /** Every app event main registered, so the quit's teardown can be replayed at the end. */
  const appOn: Array<{ event: string; listener: () => unknown }> = []
  /** Where `app.getPath('userData')` points; the electron factory fills it in. */
  const userData = { path: '' }
  return { registered, calls, stub, appOn, userData }
})

/**
 * The Pro gate, held open for the one channel that sits behind it. A machine's configure
 * is Pro-gated in main, and what this file pins is what it does once it runs; the gate
 * itself is the licence suite's subject.
 */
const licenseGate = vi.hoisted(() => ({ pro: false }))

vi.mock('../../shared/license', async importOriginal => ({
  ...(await importOriginal()) as Record<string, unknown>,
  isPro: () => licenseGate.pro
}))

// The factory is hoisted above this file's imports, so a statically imported binding
// would still be in its temporal dead zone when it runs: node's own modules are pulled in
// here instead, which is the only way the temporary directory can exist before
// `handlers.ts` asks for electron.
vi.mock('electron', async () => {
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  // A real directory, as the refusal test uses: registration reads the licence and this
  // machine's redundancy settings from `userData`, and the probes write them back.
  ends.userData.path = mkdtempSync(join(tmpdir(), 'cuerunner-addressing-'))
  return {
    app: {
      getPath: () => ends.userData.path,
      isPackaged: false,
      on: (event: string, listener: () => unknown) => {
        ends.appOn.push({ event, listener })
      }
    },
    ipcMain: {
      handle: (channel: string, handler: unknown) => {
        // Electron refuses a second handler on a live channel; modelling that refusal
        // means the surface this gate reads is the one main actually ends up with.
        if (ends.registered.has(channel)) {
          throw new Error(`Attempted to register a second handler for '${channel}'`)
        }
        ends.registered.set(channel, handler as ChannelHandler)
      },
      removeHandler: (channel: string) => ends.registered.delete(channel)
    },
    // The dialogs answer "cancelled", so a probe never waits on an operator: it asks what
    // a channel forwards, not what it does with a file someone chose.
    dialog: {
      showOpenDialog: () => Promise.resolve({ canceled: true, filePaths: [] }),
      showSaveDialog: () => Promise.resolve({ canceled: true, filePath: undefined }),
      showMessageBox: () => Promise.resolve({ response: 1, checkboxChecked: false })
    },
    net: { fetch: () => Promise.resolve(undefined) },
    BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null }
  }
})

vi.mock('../show/runtime', async importOriginal => ({
  ...(await importOriginal()) as Record<string, unknown>,
  // The runtime is the app's only door into a service — it owns the host and the services
  // — so a call to it is where a channel's own data has to appear for that channel to
  // have addressed anything. Every verb is recorded with the arguments it was given, and
  // `defaultServices` stays real so the registration runs against a launch's services.
  createShowRuntime: (): ShowRuntime => {
    const record = <T>(verb: string, answer: T): ((...args: unknown[]) => T) => (...args) => {
      ends.calls.push({ verb, args })
      return answer
    }
    const stub: ShowRuntime = {
      configure: record('configure', Promise.resolve()),
      snapshot: record('snapshot', { at: 0, services: [], devices: [], alerts: [], events: [] }),
      command: record('command', Promise.resolve({ ok: true })),
      restart: record('restart', Promise.resolve({ ok: true })),
      subscribe: record('subscribe', () => () => {}),
      alert: record('alert', undefined),
      close: record('close', undefined)
    }
    ends.stub.current = stub
    return stub
  }
}))

/** The event Electron hands a handler; nothing here reads it but the window lookups. */
const PROBE_EVENT = { sender: {} }

/** A channel's own probe data, unique to that channel, which is what attributes a call. */
function sentinelFor(channel: string): string {
  return `service-addressing-probe:${channel}`
}

/**
 * The names a probe object holds. The textual ones carry the sentinel — a service id, an
 * action, a payload, a set of settings — so a handler that reads one and passes it on
 * carries the sentinel too. The few this app's requests type as numbers or booleans hold
 * plausible values instead: a number cannot hold a sentinel, nothing a caller addresses a
 * service with is a number, and a probe must not hand a handler a NaN to do arithmetic
 * with (`NetworkClient.request` would take one for a timeout).
 */
function probeFields(sentinel: string): Record<string, unknown> {
  return {
    service: sentinel,
    serviceId: sentinel,
    id: sentinel,
    action: sentinel,
    cmd: sentinel,
    command: sentinel,
    settings: sentinel,
    payload: sentinel,
    value: sentinel,
    message: sentinel,
    host: sentinel,
    path: sentinel,
    enabled: true,
    port: 53000,
    timeout: 10_000,
    whenMs: 0
  }
}

/**
 * A probe object: the fields above, and the sentinel for any other name a handler asks for
 * — so a channel that reads `payload.serviceId` when this file's list says `service`, or
 * `payload.target` when it says nothing at all, is caught rather than missed. A name the
 * object holds answers its held value; a name it does not hold answers the sentinel.
 */
function probeObject(sentinel: string): Record<string, unknown> {
  return new Proxy(probeFields(sentinel), {
    get: (target, key) => (typeof key === 'string' ? target[key] ?? sentinel : Reflect.get(target, key))
  })
}

/**
 * A probe shaped like a request a handler's own validation would accept: the same names in
 * the same places, and the nested objects a request nests. A channel that refuses the
 * object above — `payload.settings` is a string there, not a set of settings — still
 * carries the sentinel through this one when it validates its payload and forwards it.
 */
function probeRequest(sentinel: string): Record<string, unknown> {
  const named = probeObject(sentinel)
  return {
    ...named,
    settings: named,
    payload: named,
    options: { timeout: 10_000, cwd: sentinel, env: { [sentinel]: sentinel } }
  }
}

/**
 * A channel's probe, in the shapes a payload arrives in: the two objects above, one
 * answering the sentinel for any name a handler reads and one a validation would accept,
 * and the sentinel itself, for the channels that take a bare string (an id, a path, a
 * licence key).
 */
function probeValues(sentinel: string): unknown[] {
  return [probeObject(sentinel), probeRequest(sentinel), sentinel]
}

/** Whether `value` is the sentinel, or holds it at any leaf. */
function carries(value: unknown, sentinel: string): boolean {
  if (value === sentinel) return true
  if (Array.isArray(value)) return value.some(item => carries(item, sentinel))
  if (typeof value === 'object' && value !== null) {
    return Object.values(value as Record<string, unknown>).some(item => carries(item, sentinel))
  }
  return false
}

/** The mocked runtime `handlers.ts` was handed — what a probe's calls arrive at. */
function runtime(): ShowRuntime {
  const stub = ends.stub.current
  if (stub === null) throw new Error('the mocked show runtime was never created')
  return stub
}

/** One registered handler, as Electron would call it. */
function handler(channel: string): ChannelHandler {
  const registered = ends.registered.get(channel)
  if (registered === undefined) throw new Error(`no handler registered for ${channel}`)
  return registered
}

/**
 * A window for the pair `registerWindowIpcHandlers` registers, with the calls recorded:
 * those two handlers close over the window and the crash, so spies are what make the
 * registration's shape readable — the same fixture the parity gate builds.
 */
function pairedWindow(): { win: BrowserWindow; allowClose: Mock; deps: WindowHandlerDeps } {
  const close = vi.fn()
  const allowClose = vi.fn()
  return {
    win: { close } as unknown as BrowserWindow,
    allowClose,
    deps: { allowClose, takeRendererCrash: vi.fn(() => null) }
  }
}

/** The calls one channel's probe made in the shared run. */
function callsOf(channel: string): RuntimeCall[] {
  return surface.windows.get(channel) ?? []
}

/**
 * Probes every channel in `surface` with its own sentinel and answers which of them
 * reached the service-facing runtime with their own caller's data — with the calls each
 * channel's probe made, so a permit (an id the code names) can be read as well as the
 * refusal.
 *
 * The window matters as much as the sentinel: a call is read against the channel being
 * probed when it was made, so a reach that belongs to no channel — the licence subscriber
 * re-sending the settings the window last sent, a quit's teardown — is never credited to
 * whichever channel happened to be under the probe at the time.
 */
async function probeSurface(surface: ReadonlyMap<string, ChannelHandler>): Promise<Probe> {
  const windows = new Map<string, RuntimeCall[]>()
  const addressing: Addressing[] = []
  for (const [channel, handler] of surface) {
    const sentinel = sentinelFor(channel)
    const from = ends.calls.length
    for (const value of probeValues(sentinel)) {
      try {
        await handler(PROBE_EVENT, value)
      } catch {
        // A channel is free to refuse a payload built out of a sentinel: the probe asks
        // what it forwards, not whether it accepts nonsense, and a refusal forwards
        // nothing. A channel that answers without throwing is no different here.
      }
    }
    const made = ends.calls.slice(from)
    windows.set(channel, made)
    const verbs = made
      .filter(call => call.args.some(arg => carries(arg, sentinel)))
      .map(call => call.verb)
    if (verbs.length > 0) addressing.push({ channel, verbs: [...new Set(verbs)] })
  }
  return { windows, addressing }
}

/** The registered surface, probed once: every case below reads that one run. */
let surface: Probe = { windows: new Map(), addressing: [] }
/** What registration itself did, before any channel was probed. */
let launch: RuntimeCall[] = []
/** The engine path this process started with, put back when the file is done. */
const audioBin = process.env['CUERUNNER_AUDIO_BIN']
/** The window whose pair joins the probed surface, and the spies that prove it was probed. */
const pair = pairedWindow()

beforeAll(async () => {
  // The audio client would otherwise start a real engine process to answer the audio
  // channels, on whatever device backend the machine offers. The gate is about the IPC
  // surface, and no channel's reach into the services goes through the engine: pointing
  // the client at an engine that is not there makes every audio verb refuse the way the
  // refusal test's clock does, and spawns nothing.
  process.env['CUERUNNER_AUDIO_BIN'] = join(ends.userData.path, 'no-engine')
  registerIpcHandlers()
  // The window's own pair is part of the surface the app registers — it is added where a
  // window is created rather than at launch — so it is probed with everything else: a
  // payload-carrying channel there would be a fifth route like any other.
  registerWindowIpcHandlers(pair.win, pair.deps)
  launch = [...ends.calls]
  surface = await probeSurface(new Map(ends.registered))
})

afterAll(async () => {
  // Registration opens the services the way a launch does and a quit closes them; the
  // listeners are the app's own (a socket close, a flush timer), so they are run before
  // the directory goes.
  for (const { listener } of ends.appOn) await listener()
  rmSync(ends.userData.path, { recursive: true, force: true })
  if (audioBin === undefined) delete process.env['CUERUNNER_AUDIO_BIN']
  else process.env['CUERUNNER_AUDIO_BIN'] = audioBin
})

describe('a channel outside the show channels may not address a service', () => {
  it('flags the declaration’s addressing routes and no other channel', () => {
    // Every channel the gate flags is one `SHOW_CHANNELS` names: a route added tomorrow
    // that forwards its caller's id, action or settings lands in this map with nothing to
    // permit it, and the assertion fails naming it. The routes that do address a service
    // are here with the verb each reached, so the gate is not passing over the surface it
    // was pointed at.
    expect(Object.fromEntries(surface.addressing.map(finding => [finding.channel, finding.verbs]))).toEqual({
      [SHOW_CHANNELS.configure]: ['configure'],
      [SHOW_CHANNELS.command]: ['command'],
      [SHOW_CHANNELS.restart]: ['restart']
    })
  })

  it('does not flag the snapshot route, which addresses no service', () => {
    // The record is read out of the host rather than sent to it: nothing a caller puts in
    // this request can reach a service, and no service is named by it.
    expect(surface.addressing.map(finding => finding.channel)).not.toContain(SHOW_CHANNELS.snapshot)
  })

  it('forwards the settings, the command and the id the declaration says those routes forward', () => {
    // What makes these three routes: their arguments are the caller's own, reaching the
    // runtime as they arrived. A route that dropped one of them would still be flagged —
    // the others carry the sentinel — so each position is pinned rather than left to the
    // finding above.
    expect(callsOf(SHOW_CHANNELS.configure)).toContainEqual({
      verb: 'configure',
      args: [sentinelFor(SHOW_CHANNELS.configure)]
    })
    expect(callsOf(SHOW_CHANNELS.command)).toContainEqual({
      verb: 'command',
      args: [
        sentinelFor(SHOW_CHANNELS.command),
        sentinelFor(SHOW_CHANNELS.command),
        sentinelFor(SHOW_CHANNELS.command)
      ]
    })
    expect(callsOf(SHOW_CHANNELS.restart)).toContainEqual({
      verb: 'restart',
      args: [sentinelFor(SHOW_CHANNELS.restart)]
    })
  })

  it('flags nothing for the window pair, whose channels take no payload', () => {
    // The pair `registerWindowIpcHandlers` registers is in the probed surface, and neither
    // handler is given a payload by Electron, so there is no caller data for either to
    // carry into a service.
    const flagged = surface.addressing.map(finding => finding.channel)
    for (const channel of [APP_CHANNELS.confirmClose, APP_CHANNELS.rendererCrash]) {
      expect(ends.registered.has(channel)).toBe(true)
      expect(flagged).not.toContain(channel)
    }
    // Probed rather than skipped: the close handler answered the probe the way a window
    // does, and let its window go.
    expect(pair.allowClose).toHaveBeenCalled()
  })

  it('sees the fixed-id restart a machine configure makes, and does not flag it', async () => {
    // `redundancy:configure` restarts one service by an id the code names, and the
    // caller's patch is this machine's own settings — it reaches no service at all. The
    // gate has to see that call and permit it (which is why it sits on the runtime rather
    // than on a list of four names), so the permit is pinned here rather than left to the
    // absence of a finding.
    licenseGate.pro = true
    try {
      const probe = await probeSurface(
        new Map([
          [SHOW_CHANNELS.configure, handler(SHOW_CHANNELS.configure)],
          [REDUNDANCY_CHANNELS.configure, handler(REDUNDANCY_CHANNELS.configure)]
        ])
      )

      expect(probe.addressing.map(finding => finding.channel)).toEqual([SHOW_CHANNELS.configure])
      // Every call its probe made restarted the service the code names — once per probe
      // shape, with nothing of the caller's patch in any argument.
      const restarted = probeValues(sentinelFor(REDUNDANCY_CHANNELS.configure)).map(() => ({
        verb: 'restart',
        args: ['redundancy']
      }))
      expect(probe.windows.get(REDUNDANCY_CHANNELS.configure)).toEqual(restarted)
    } finally {
      licenseGate.pro = false
    }
  })

  it('flags nothing for the reaches that are not channels', async () => {
    // Registration subscribes to the host's events and configures the services with the
    // launch defaults, before any window has sent settings: reaches into a service that
    // belong to no channel, already in the record when the surface was probed.
    expect(launch.map(call => call.verb)).toEqual(expect.arrayContaining(['configure', 'subscribe']))

    // A licence change re-sends the settings the window last sent — another reach that is
    // not a channel, made by the subscriber in `handlers.ts` rather than by a request. It
    // is recorded, carrying the data the show:configure route had put there, and the gate,
    // which judges each channel against its own probe alone, credits it to no channel.
    const probe = await probeSurface(
      new Map([
        [SHOW_CHANNELS.configure, handler(SHOW_CHANNELS.configure)],
        [LICENSE_CHANNELS.deactivate, handler(LICENSE_CHANNELS.deactivate)]
      ])
    )

    expect(probe.addressing.map(finding => finding.channel)).toEqual([SHOW_CHANNELS.configure])
    // What the licence channel's probe caused: the subscriber re-sending the settings the
    // route had put in `lastShowSettings`, once per probe. No channel's own data is in
    // them, so nothing here is a route — and the reach is in the record rather than merely
    // unfound.
    const reSends = probe.windows.get(LICENSE_CHANNELS.deactivate) ?? []
    expect(reSends.length).toBeGreaterThan(0)
    expect(
      reSends.every(call => call.verb === 'configure' && carries(call.args, sentinelFor(SHOW_CHANNELS.configure)))
    ).toBe(true)
  })

  it('catches a channel the app does not have that forwards its caller’s payload', async () => {
    // A publish into the pair, shaped like an operator's request and doing the one thing
    // the rule forbids: handing its own caller's data to a service. The channel does not
    // exist in this app, which is the point — the check takes a channel→handler map, so
    // it can be falsified against a surface the registration never produced.
    const publish = 'redundancy:publish'
    expect(ends.registered.has(publish)).toBe(false)
    const probe = await probeSurface(
      new Map<string, ChannelHandler>([
        [
          publish,
          (_event, payload) => {
            const forwarded = payload as { service: string; action: string; payload: unknown }
            return runtime().command(forwarded.service, forwarded.action, forwarded.payload)
          }
        ]
      ])
    )

    expect(probe.addressing).toEqual([{ channel: publish, verbs: ['command'] }])
  })

  it('catches a channel that names its fields differently and validates before forwarding', async () => {
    // The guard is only as good as the payload it probes with. A channel that reads a name
    // this file's list does not carry — `serviceId` and `cmd` rather than `service` and
    // `action` — and that refuses anything failing its own type check before it forwards,
    // must be caught like any other: the probe answers the sentinel for a name it does not
    // hold, and carries a request-shaped shape a validation accepts. Falsified here against
    // a channel the app does not have, as the case above is.
    const publish = 'redundancy:publish'
    const probe = await probeSurface(
      new Map<string, ChannelHandler>([
        [
          publish,
          (_event, payload) => {
            const forwarded = payload as { serviceId?: unknown; cmd?: unknown; settings?: unknown }
            const named = typeof forwarded.serviceId === 'string' && typeof forwarded.cmd === 'string'
            const shaped = typeof forwarded.settings === 'object' && forwarded.settings !== null
            if (!named || !shaped) return { ok: false, error: 'that is not a publish request' }
            return runtime().command(forwarded.serviceId as string, forwarded.cmd as string, forwarded.settings)
          }
        ]
      ])
    )

    expect(probe.addressing).toEqual([{ channel: publish, verbs: ['command'] }])
  })
})
