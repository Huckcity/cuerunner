// The gate that fails when the two ends of the IPC contract disagree.
//
// A channel declared in `src/shared` and exposed by the preload with no handler compiles
// and typechecks: the bridge's `satisfies CuerunnerBridge` checks the shape of what the
// window sees, not what main registered, so the invoke only rejects when an operator
// clicks the button mid-show. Nothing short of enumerating both ends closes that, and
// nothing can enumerate them by reading — the preload exposes functions, not channels,
// and main's registrations are calls. So both ends are executed here against recorders:
// the real `registerIpcHandlers()` and `registerWindowIpcHandlers()` against a mocked
// `ipcMain`, and the preload's exposed bridge against a mocked `ipcRenderer`.
//
// Nothing here names a channel. The handled set comes from the calls main made, the bridge
// set from the calls the members made, and the declared set from the composition point in
// `src/shared/ipc`, so a channel added to a table, a registrar and the preload tomorrow is
// covered without editing this file — and one added to only two of them fails.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import type { BrowserWindow } from 'electron'
import { APP_CHANNELS, type RendererCrash } from '../../shared/ipc/app'
import { CHANNEL_TABLES, EVENT_CHANNELS } from '../../shared/ipc'
import { registerIpcHandlers } from './handlers'
import { registerWindowIpcHandlers, type WindowHandlerDeps } from './windowHandlers'
// Importing the preload is what exposes its bridge: it reads its channel constants and
// hands the literal to `contextBridge`, and the mock below is what catches the hand-off.
import '../../preload/index'

/**
 * What the mocked ends recorded, shared between the module mocks and the test body.
 * `vi.hoisted` because the electron factory is hoisted above these imports and has to
 * close over the same recorders the test reads.
 */
const ends = vi.hoisted(() => {
  /** The channels main has a handler for, as the real `ipcMain` holds them. */
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  /** Every channel call the bridge made, tagged with the member that was being probed. */
  const calls: Array<{ member: string; kind: 'invoke' | 'on' | 'off'; channel: string }> = []
  /**
   * The member being probed, read by the recorders as each call arrives — a box rather
   * than a plain variable, because the recorders outlive any single member: one that
   * addresses its channel after an await is still attributed to itself.
   */
  const probing: { member: string | null } = { member: null }
  /** Live subscriptions, as the real `ipcRenderer` holds them: channel → listeners. */
  const subscriptions = new Map<string, Set<unknown>>()
  /** Every app event main registered, so a quit's teardown can be replayed in full. */
  const appOn: Array<{ event: string; listener: () => void }> = []
  /** Every hand-off the preload made to `contextBridge`, in order. */
  const exposed: Array<{ key: string; value: unknown }> = []

  return { handlers, calls, probing, subscriptions, appOn, exposed }
})

vi.mock('electron', () => ({
  // Main reads these while its modules load — `app.getPath` for the license, the machine's
  // redundancy settings and the recent files, `app.isPackaged` for the key ring — so they
  // have to answer before `handlers.ts` is imported. A directory that holds no files is
  // the state a machine that has never run Cuerunner is in, and every reader copes with it.
  app: {
    getPath: () => 'cuerunner-parity-test-user-data',
    isPackaged: false,
    on: (event: string, listener: () => void) => {
      // Every event, not just the one main happens to use today: the teardown is replayed
      // from this list, so a registration moved to another event is still run at the end.
      ends.appOn.push({ event, listener })
    }
  },
  ipcMain: {
    handle: (channel: string, handler: unknown) => {
      // Electron refuses a second handler on a live channel, and the pair registered per
      // window removes before it registers for exactly that reason. Modelling the refusal
      // means a channel registered twice fails this gate rather than only failing at launch.
      if (ends.handlers.has(channel)) {
        throw new Error(`Attempted to register a second handler for '${channel}'`)
      }
      ends.handlers.set(channel, handler as (...args: unknown[]) => unknown)
    },
    removeHandler: (channel: string) => ends.handlers.delete(channel)
  },
  ipcRenderer: {
    // Playback's heartbeat chains `.catch` onto this and the audio verbs unwrap it, so it
    // has to be a promise resolving to what both of them accept: the unwrapper's envelope.
    invoke: (channel: string) => {
      ends.calls.push({ member: ends.probing.member ?? 'unattributed', kind: 'invoke', channel })
      return Promise.resolve({ ok: true, value: undefined })
    },
    on: (channel: string, listener: unknown) => {
      const listeners = ends.subscriptions.get(channel) ?? new Set<unknown>()
      listeners.add(listener)
      ends.subscriptions.set(channel, listeners)
      ends.calls.push({ member: ends.probing.member ?? 'unattributed', kind: 'on', channel })
    },
    off: (channel: string, listener: unknown) => {
      ends.subscriptions.get(channel)?.delete(listener)
      ends.calls.push({ member: ends.probing.member ?? 'unattributed', kind: 'off', channel })
    }
  },
  contextBridge: {
    exposeInMainWorld: (key: string, value: unknown) => ends.exposed.push({ key, value })
  },
  webUtils: { getPathForFile: () => '' },
  // Nothing here calls these; they exist because the modules under test import them.
  dialog: {},
  net: { fetch: () => Promise.resolve(undefined) },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null }
}))

/** One channel call a bridge member made, and what it did with it. */
interface BridgeCall {
  /** `namespace.member`, as the window reads it: `audio.prepare`. */
  member: string
  kind: 'invoke' | 'on' | 'off'
  channel: string
}

/** A member the probe could not hold to a channel, and why. */
interface ProbeFinding {
  member: string
  reason: string
}

/**
 * Calls every function the preload exposes, records the channel and the kind of call each
 * one made, and calls each subscription's unsubscribe the way the window does. The kind is
 * read from what the member did, not from its name: that is what tells a subscription from
 * a request, and the two are checked against different sets.
 *
 * A member that addresses no channel, or one whose returned unsubscribe leaves the channel
 * bound, is reported rather than skipped — a member the probe cannot hold to anything is a
 * member this gate cannot hold to anything.
 */
async function probeBridge(): Promise<{
  calls: BridgeCall[]
  unclassified: ProbeFinding[]
  unsubscribed: ProbeFinding[]
  skipped: string[]
}> {
  if (ends.exposed.length !== 1) {
    throw new Error(`the preload handed over ${ends.exposed.length} bridges; expected exactly one`)
  }
  const bridge = ends.exposed[0].value as Record<string, unknown>
  const unclassified: ProbeFinding[] = []
  const unsubscribed: ProbeFinding[] = []
  const skipped: string[] = []

  for (const [namespace, members] of Object.entries(bridge)) {
    // The bridge also carries values that are not namespaces: `platform`, and the one
    // member that resolves a File's path without asking main. Neither addresses a channel;
    // the coverage test asserts those two are the only entries skipped.
    if (typeof members !== 'object' || members === null) {
      skipped.push(namespace)
      continue
    }
    for (const [name, member] of Object.entries(members as Record<string, unknown>)) {
      if (typeof member !== 'function') {
        skipped.push(`${namespace}.${name}`)
        continue
      }
      const probing = `${namespace}.${name}`
      const from = ends.calls.length
      ends.probing.member = probing
      let thrown: string | null = null
      try {
        // The subscription members take a listener; nothing fires it, and the request
        // members ignore the argument.
        const returned: unknown = (member as (arg: unknown) => unknown)(() => {})
        if (returned !== null && typeof returned === 'object' && typeof (returned as { then?: unknown }).then === 'function') {
          // A rejection is not a finding here: the probe is after the channels a member
          // addresses, and a member's own callers decide what a failed request means.
          await (returned as Promise<unknown>).catch(() => {})
        }

        const made = ends.calls.slice(from)
        const subscribed = made.find(call => call.kind === 'on')
        if (subscribed !== undefined && typeof returned === 'function') {
          // The unsubscribe the member handed back, called the way the window calls it.
          const beforeUnsubscribe = ends.calls.length
          try {
            returned()
          } catch (error) {
            // Reported through the check below: no unbind was recorded.
            thrown = error instanceof Error ? error.message : String(error)
          }
          const unbound = ends.calls.slice(beforeUnsubscribe).some(call => call.kind === 'off' && call.channel === subscribed.channel)
          if (!unbound || (ends.subscriptions.get(subscribed.channel)?.size ?? 0) > 0) {
            unsubscribed.push({
              member: probing,
              reason: thrown ?? `left ${subscribed.channel} bound`
            })
          }
        }
      } catch (error) {
        thrown = error instanceof Error ? error.message : String(error)
      } finally {
        ends.probing.member = null
      }
      if (!ends.calls.slice(from).some(call => call.kind !== 'off')) {
        unclassified.push({ member: probing, reason: thrown ?? 'addressed no channel' })
      }
    }
  }
  return { calls: [...ends.calls], unclassified, unsubscribed, skipped }
}

/**
 * Every channel the shared layer declares, read from the tables at the composition point
 * rather than listed here: a namespace that joins `CuerunnerBridge` joins `CHANNEL_TABLES`
 * with it, and a channel added to a table lands in this set without an edit. The
 * invoke/push split is `EVENT_CHANNELS` — the one place the split is declared.
 */
const DECLARED_CHANNELS: readonly string[] = CHANNEL_TABLES.flatMap(table => Object.values(table))

const DECLARED_EVENTS: readonly string[] = EVENT_CHANNELS
const DECLARED_INVOKES = DECLARED_CHANNELS.filter(channel => !DECLARED_EVENTS.includes(channel))

/**
 * A window and its two callbacks, with the calls recorded: the pair closes over the window
 * and the crash, so the spies are what make the registration's shape readable.
 */
function pairedWindow(): {
  win: BrowserWindow
  close: Mock
  allowClose: Mock
  takeRendererCrash: Mock
  deps: WindowHandlerDeps
  crash: RendererCrash
} {
  const crash: RendererCrash = { reason: 'crashed', at: 1 }
  const close = vi.fn()
  const allowClose = vi.fn()
  const takeRendererCrash = vi.fn(() => crash)
  return {
    win: { close } as unknown as BrowserWindow,
    close,
    allowClose,
    takeRendererCrash,
    deps: { allowClose, takeRendererCrash },
    crash
  }
}

describe('the two ends of the IPC contract', () => {
  const first = pairedWindow()
  const second = pairedWindow()
  let calls: BridgeCall[] = []
  let unclassified: ProbeFinding[] = []
  let unsubscribed: ProbeFinding[] = []
  let skipped: string[] = []

  beforeAll(async () => {
    registerIpcHandlers()
    registerWindowIpcHandlers(first.win, first.deps)
    const probed = await probeBridge()
    calls = probed.calls
    unclassified = probed.unclassified
    unsubscribed = probed.unsubscribed
    skipped = probed.skipped
  })

  afterAll(() => {
    expect(
      ends.appOn.length,
      'main registered no app listener for a quit to run'
    ).toBeGreaterThan(0)
    // Registration opens the free show services the way a launch does, and a quit closes
    // them: every listener main registered is replayed here — on whatever event it was
    // registered under — so this run leaves no socket behind for the next one.
    for (const { listener } of ends.appOn) listener()
  })

  it('registers the window pair so each handler answers through the window it was given', () => {
    const confirmClose = ends.handlers.get(APP_CHANNELS.confirmClose)
    const rendererCrash = ends.handlers.get(APP_CHANNELS.rendererCrash)

    confirmClose?.()
    expect(first.allowClose).toHaveBeenCalledOnce()
    expect(first.close).toHaveBeenCalledOnce()
    // The close request is allowed before the window is closed: the close listener refuses
    // anything the dirty check has not cleared.
    expect(first.allowClose.mock.invocationCallOrder[0]).toBeLessThan(first.close.mock.invocationCallOrder[0])
    expect(rendererCrash?.()).toEqual(first.crash)

    // A second window registers the same two channels. Electron holds one handler per
    // channel, so this replaces the first window's rather than throwing — which is what
    // the single-window invariant in `index.ts` keeps safe.
    expect(() => registerWindowIpcHandlers(second.win, second.deps)).not.toThrow()
    ends.handlers.get(APP_CHANNELS.confirmClose)?.()
    expect(second.allowClose).toHaveBeenCalledOnce()
    expect(second.close).toHaveBeenCalledOnce()
    expect(first.close).toHaveBeenCalledOnce()
    expect(ends.handlers.get(APP_CHANNELS.rendererCrash)?.()).toEqual(second.crash)
  })

  it('registers its teardown for the quit event a cancelled quit cannot skip', () => {
    expect(
      [...new Set(ends.appOn.map(({ event }) => event))],
      'the app events main registered teardown on'
    ).toEqual(['will-quit'])
  })

  it('exposes the bridge once, as window.cuerunner', () => {
    expect(
      ends.exposed.map(handoff => handoff.key),
      'the preload must hand the bridge to the window once, under the name the renderer reads'
    ).toEqual(['cuerunner'])
  })

  it('probes a channel out of every member the preload exposes', () => {
    expect(unclassified, 'bridge members that addressed no channel').toEqual([])
  })

  it('skips only the bridge entries that are values rather than namespaces', () => {
    expect(
      [...skipped].sort(),
      'bridge entries the probe did not call and held to nothing'
    ).toEqual(['getPathForFile', 'platform'])
  })

  it('unbinds the channel every subscription member subscribed', () => {
    expect(unsubscribed, 'subscription members whose unsubscribe left the channel bound').toEqual([])
  })

  it('registers a handler for every declared invoke channel, and for nothing else', () => {
    const handled = [...ends.handlers.keys()]
    expect(
      {
        unhandled: DECLARED_INVOKES.filter(channel => !handled.includes(channel)),
        notAnInvoke: handled.filter(channel => !DECLARED_INVOKES.includes(channel))
      },
      'main\'s registrations and the declared invoke channels disagree'
    ).toEqual({ unhandled: [], notAnInvoke: [] })
  })

  it('invokes, from the bridge, exactly the channels main handles', () => {
    const handled = [...ends.handlers.keys()]
    const invoked = calls.filter(call => call.kind === 'invoke')
    expect(
      {
        withoutHandler: invoked
          .filter(call => !handled.includes(call.channel))
          .map(call => `window.cuerunner.${call.member} -> ${call.channel}`),
        withoutCaller: handled
          .filter(channel => !invoked.some(call => call.channel === channel))
          .map(channel => `${channel} <- no bridge member invokes it`)
      },
      'the bridge\'s requests and main\'s handlers disagree'
    ).toEqual({ withoutHandler: [], withoutCaller: [] })
  })

  it('subscribes, from the bridge, exactly the declared events', () => {
    const subscribed = calls.filter(call => call.kind === 'on')
    expect(
      {
        wrongKind: subscribed
          .filter(call => !DECLARED_EVENTS.includes(call.channel))
          .map(call => `window.cuerunner.${call.member} -> ${call.channel}`),
        withoutListener: DECLARED_EVENTS
          .filter(channel => !subscribed.some(call => call.channel === channel))
          .map(channel => `${channel} <- no bridge member subscribes it`)
      },
      'the bridge\'s subscriptions and EVENT_CHANNELS disagree'
    ).toEqual({ wrongKind: [], withoutListener: [] })
  })
})
