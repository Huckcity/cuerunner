import type { OscArg } from '../../renderer/src/types/cue'
import type { ShowSettings } from '../../renderer/src/types/show'
import type { ServiceContext, ShowService } from '../bus/ServiceHost'

interface Rinfo {
  address: string
  port: number
}

// node-osc ships no types, so the surface this service uses is declared here. The cast
// at the require is the library boundary and nothing else.
interface OscServer {
  readonly port: number
  on(event: 'listening', listener: () => void): void
  on(event: 'message', listener: (message: unknown[], rinfo: Rinfo) => void): void
  on(event: 'bundle', listener: (bundle: { elements: unknown[][] }, rinfo: Rinfo) => void): void
  on(event: 'error', listener: (error: Error) => void): void
  close(cb?: (error?: Error) => void): void
}

type ServerFactory = (port: number, host: string) => OscServer

function connectOscServer(port: number, host: string): OscServer {
  const { Server } = require('node-osc') as {
    Server: new (port: number, host: string) => OscServer
  }
  return new Server(port, host)
}

/**
 * Reads the OSC that arrives at the show.
 *
 * A show talks back: a lighting desk sends its cue state, a console sends a macro, a
 * tablet sends a GO. Nothing here decides what those messages mean — the service's job
 * is to get them onto the bus with enough context to be understood, so the panels and,
 * later, the cue stack can act on them.
 */
export class OscInputService implements ShowService {
  readonly id = 'osc-in'
  readonly label = 'OSC input'

  private server: OscServer | null = null

  constructor(private readonly connect: ServerFactory = connectOscServer) {}

  start(context: ServiceContext, settings: ShowSettings): void {
    const { enabled, port } = settings.oscIn
    if (!enabled) {
      context.setState('stopped', 'disabled')
      return
    }

    const server = this.connect(port, '0.0.0.0')
    this.server = server
    context.setState('starting', `binding 0.0.0.0:${port}`)

    // Without a listener, an 'error' event on the server is an unhandled throw that
    // takes the main process down — and a port already in use is the likeliest error
    // there is, since the operator's QLab or TouchOSC may hold it.
    server.on('error', (error: Error) => {
      context.setState('degraded', describe(error))
      context.bus.alert('warning', this.id, `OSC input: ${describe(error)}`)
    })

    server.on('listening', () => {
      // The port, not the bind address: an operator reads this to check the desk is
      // pointed at the right number, and 0.0.0.0 is the answer to a question nobody
      // asked. What it binds to has not changed.
      context.setState('running', `listening on port ${server.port}`)
    })

    server.on('message', (message, rinfo) => {
      this.publishMessage(context, message, rinfo)
    })

    // A desk that sends its state as one bundle should arrive as its parts, in order.
    server.on('bundle', (bundle, rinfo) => {
      for (const element of bundle.elements) this.publishMessage(context, element, rinfo)
    })
  }

  stop(): void {
    const server = this.server
    if (!server) return
    this.server = null
    try {
      // The promise form rejects when the socket is already gone, which is not worth
      // reporting: the outcome the caller wanted is the socket being closed.
      void Promise.resolve(server.close(() => {})).catch(() => {})
    } catch {
      // A socket that is already closed throws from close(); nothing left to do.
    }
  }

  private publishMessage(context: ServiceContext, message: unknown[], rinfo: Rinfo): void {
    const [address, ...values] = message
    if (typeof address !== 'string') return
    context.bus.publish({
      kind: 'osc',
      at: Date.now(),
      from: `${rinfo.address}:${rinfo.port}`,
      address,
      args: toOscArgs(values)
    })
  }
}

/**
 * node-osc hands over decoded JavaScript values with the OSC type tags already
 * stripped. The type is inferred back from the value, which cannot tell an int32 from
 * a float32 — the panel shows the number either way, and a message that carries a
 * boolean comes back as one.
 */
export function toOscArgs(values: unknown[]): OscArg[] {
  return values.map(value => {
    if (typeof value === 'number') {
      return { type: Number.isInteger(value) ? 'i' : 'f', value }
    }
    if (typeof value === 'boolean') {
      return { type: value ? 'T' : 'F', value }
    }
    if (typeof value === 'string') {
      return { type: 's', value }
    }
    if (Buffer.isBuffer(value)) {
      // Blobs have no tag in the cue model; their bytes are more useful than a summary.
      return { type: 's', value: value.toString('hex') }
    }
    return { type: 's', value: String(value) }
  })
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
