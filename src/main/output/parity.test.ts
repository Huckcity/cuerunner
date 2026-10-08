// The output windows' door, held the way src/main/ipc/parity.test.ts holds the control
// window's: the output preload's bridge is executed against a recording `ipcRenderer`, the
// registrar against a recording `ipcMain`, and the two are compared with the declared table.
//
// And the one rule the two preloads have between them: they import no value in common. Each
// is bundled into a single file, because a sandboxed preload can require `electron` and
// nothing else, and a module both of them imported would be split by the bundler into a
// chunk neither could load — a window with no bridge at all.

import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { OUTPUT_WINDOW_CHANNELS } from '../../shared/ipc/outputWindow'
import { registerOutputWindowHandlers } from './ipc'

const ends = vi.hoisted(() => ({
  handlers: new Map<string, unknown>(),
  calls: [] as Array<{ kind: 'invoke' | 'on' | 'off'; channel: string }>,
  exposed: [] as Array<{ key: string; value: unknown }>
}))

vi.mock('electron', () => ({
  app: { getPath: () => 'cuerunner-output-parity', isPackaged: false, on: () => {}, isReady: () => false },
  ipcMain: {
    handle: (channel: string, handler: unknown) => {
      if (ends.handlers.has(channel)) throw new Error(`Attempted to register a second handler for '${channel}'`)
      ends.handlers.set(channel, handler)
    },
    removeHandler: (channel: string) => ends.handlers.delete(channel)
  },
  ipcRenderer: {
    invoke: (channel: string) => {
      ends.calls.push({ kind: 'invoke', channel })
      return Promise.resolve(null)
    },
    on: (channel: string) => { ends.calls.push({ kind: 'on', channel }) },
    off: (channel: string) => { ends.calls.push({ kind: 'off', channel }) }
  },
  contextBridge: { exposeInMainWorld: (key: string, value: unknown) => ends.exposed.push({ key, value }) },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  dialog: {},
  screen: {},
  protocol: {}
}))

await import('../../preload/output')

describe('the output windows\' door', () => {
  it('exposes one bridge, as window.cuerunnerOutput', () => {
    expect(ends.exposed.map(entry => entry.key)).toEqual(['cuerunnerOutput'])
  })

  it('invokes, subscribes to and registers exactly the declared channels', async () => {
    registerOutputWindowHandlers()
    const bridge = ends.exposed[0].value as Record<string, (arg?: unknown) => unknown>
    for (const member of Object.values(bridge)) {
      const returned = member(() => {})
      if (typeof returned === 'function') (returned as () => void)()
      else await returned
    }
    const invoked = ends.calls.filter(call => call.kind === 'invoke').map(call => call.channel).sort()
    const subscribed = ends.calls.filter(call => call.kind === 'on').map(call => call.channel)
    const unsubscribed = ends.calls.filter(call => call.kind === 'off').map(call => call.channel)
    const declared = Object.values(OUTPUT_WINDOW_CHANNELS)
    expect(invoked).toEqual([OUTPUT_WINDOW_CHANNELS.clock, OUTPUT_WINDOW_CHANNELS.ready, OUTPUT_WINDOW_CHANNELS.report].sort())
    expect(subscribed).toEqual([OUTPUT_WINDOW_CHANNELS.commands])
    expect(unsubscribed).toEqual([OUTPUT_WINDOW_CHANNELS.commands])
    expect([...ends.handlers.keys()].sort()).toEqual(invoked)
    expect([...invoked, ...subscribed].sort()).toEqual([...declared].sort())
  })
})

/** The modules a source file imports values from (not types), resolved to files. */
function valueImports(file: string): string[] {
  const source = readFileSync(file, 'utf8')
  const found: string[] = []
  for (const match of source.matchAll(/^import\s+(type\s+)?([^'"]*?)\s*from\s+'([^']+)'/gms)) {
    const [, typeOnly, names, specifier] = match
    if (typeOnly !== undefined) continue
    // `import { type A, type B } from` brings no value either.
    const braced = /\{([^}]*)\}/.exec(names)?.[1]
    if (braced !== undefined && braced.split(',').every(name => name.trim() === '' || name.trim().startsWith('type '))) continue
    found.push(specifier.startsWith('.') ? resolve(dirname(file), specifier) : specifier)
  }
  return found
}

describe('the two preloads', () => {
  it('import no value in common but electron, so each bundles to the one file a sandbox can load', () => {
    const root = resolve(__dirname, '..', '..', 'preload')
    const control = new Set(valueImports(join(root, 'index.ts')))
    const output = valueImports(join(root, 'output.ts'))
    const shared = output.filter(module => control.has(module) && module !== 'electron')
    expect(shared).toEqual([])
  })
})
