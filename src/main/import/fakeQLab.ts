// Test support: a QLab that answers the OSC the live import asks, on a TCP port of its
// own (port 0, so tests never collide). It speaks what QLab documents — SLIP framing,
// `/reply/…` answers carrying one JSON string, `badpass` for a wrong passcode, `denied`
// for a workspace nobody has connected to — and it can be told to misbehave the ways a
// real network does: go quiet, or send more than any reply is.

import { createServer, type Server, type Socket } from 'node:net'
import { SlipDecoder, decodeOscMessage, encodeOscMessage, slipEncode } from './oscStream'

export interface FakeCue {
  uniqueID: string
  number: string
  name: string
  /** QLab's type name as `cueLists` reports it: "Audio", "Group", "MIDI". */
  type: string
  colorName?: string
  armed?: boolean
  /** What `valuesForKeys` answers for this cue. */
  values?: Record<string, unknown>
  cues?: FakeCue[]
}

export interface FakeList {
  uniqueID: string
  name: string
  type?: 'Cue List' | 'Cart'
  cues: FakeCue[]
}

export interface FakeWorkspace {
  id: string
  name: string
  version?: string
  passcode?: string
  lists: FakeList[]
}

export interface FakeQLabOptions {
  workspaces: FakeWorkspace[]
  /** Never answers anything. */
  silent?: boolean
  /** Answers `/workspaces` with a frame larger than any reply. */
  flood?: number
  /** Replies with the workspace prefix kept, as some QLab versions do. */
  keepPrefix?: boolean
}

export interface FakeQLab {
  port: number
  /** Every address it was sent, in order. */
  requests: string[]
  close(): Promise<void>
}

export async function startFakeQLab(options: FakeQLabOptions): Promise<FakeQLab> {
  const requests: string[] = []
  const sockets = new Set<Socket>()
  const server: Server = createServer(socket => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => socket.destroy())
    const decoder = new SlipDecoder(1024 * 1024)
    const connected = new Set<string>()
    socket.on('data', chunk => {
      for (const packet of decoder.push(chunk)) {
        const message = decodeOscMessage(packet)
        requests.push(message.address)
        if (options.silent) continue
        answer(socket, message.address, message.args, connected)
      }
    })
  })

  const reply = (socket: Socket, address: string, body: unknown): void => {
    const shown = options.keepPrefix ? address : address.replace(/^\/workspace\/[^/]+/, '')
    // An update first, as a connected QLab sends them: the import has to read past it.
    socket.write(slipEncode(encodeOscMessage('/update/workspace/fake', [])))
    socket.write(slipEncode(encodeOscMessage(`/reply${shown}`, [JSON.stringify({ address, ...body as object })])))
  }

  const answer = (socket: Socket, address: string, args: unknown[], connected: Set<string>): void => {
    if (address === '/workspaces') {
      if (options.flood) {
        socket.write(Buffer.concat([Buffer.from([0xc0]), Buffer.alloc(options.flood, 0x41), Buffer.from([0xc0])]))
        return
      }
      reply(socket, address, {
        status: 'ok',
        data: options.workspaces.map(workspace => ({
          uniqueID: workspace.id,
          displayName: workspace.name,
          hasPasscode: workspace.passcode !== undefined,
          version: workspace.version ?? '5.4.1'
        }))
      })
      return
    }
    const match = /^\/workspace\/([^/]+)(\/.*)$/.exec(address)
    const workspace = match ? options.workspaces.find(entry => entry.id === match[1]) : undefined
    if (!match || !workspace) {
      reply(socket, address, { status: 'error' })
      return
    }
    const rest = match[2]
    if (rest === '/connect') {
      if (workspace.passcode !== undefined && args[0] !== workspace.passcode) {
        reply(socket, address, { status: 'ok', data: 'badpass' })
        return
      }
      connected.add(workspace.id)
      reply(socket, address, { status: 'ok', data: 'ok:view|edit|control' })
      return
    }
    if (!connected.has(workspace.id)) {
      reply(socket, address, { status: 'denied' })
      return
    }
    if (rest === '/cueLists') {
      const tree = (cue: FakeCue): unknown => ({
        uniqueID: cue.uniqueID,
        number: cue.number,
        name: cue.name,
        listName: cue.name,
        type: cue.type,
        colorName: cue.colorName ?? 'none',
        flagged: false,
        armed: cue.armed ?? true,
        ...(cue.cues ? { cues: cue.cues.map(tree) } : {})
      })
      reply(socket, address, {
        status: 'ok',
        data: workspace.lists.map(list => ({
          uniqueID: list.uniqueID,
          number: '',
          name: list.name,
          listName: list.name,
          type: list.type ?? 'Cue List',
          colorName: 'none',
          flagged: false,
          armed: true,
          cues: list.cues.map(tree)
        }))
      })
      return
    }
    const valuesMatch = /^\/cue_id\/([^/]+)\/valuesForKeys$/.exec(rest)
    if (valuesMatch) {
      const find = (cues: FakeCue[]): FakeCue | undefined => {
        for (const cue of cues) {
          if (cue.uniqueID === valuesMatch[1]) return cue
          const inner = cue.cues ? find(cue.cues) : undefined
          if (inner) return inner
        }
        return undefined
      }
      const cue = workspace.lists.map(list => find(list.cues)).find(Boolean)
      if (!cue) {
        reply(socket, address, { status: 'error' })
        return
      }
      const keys = typeof args[0] === 'string' ? JSON.parse(args[0]) as string[] : []
      const data: Record<string, unknown> = {}
      for (const key of keys) if (cue.values && key in cue.values) data[key] = cue.values[key]
      reply(socket, address, { status: 'ok', data })
      return
    }
    reply(socket, address, { status: 'error' })
  }

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  return {
    port,
    requests,
    close: () => new Promise<void>(resolve => {
      for (const socket of sockets) socket.destroy()
      server.close(() => resolve())
    })
  }
}
