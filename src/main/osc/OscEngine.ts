type OscArg = { type: string; value: number | string | boolean }

export interface OscSendResult {
  ok: boolean
  error?: string
}

// node-osc ships no types, so the surface this engine uses is declared here. The
// cast at the require is the library boundary and nothing else.
interface OscClient {
  send(address: string, ...args: unknown[]): void
  close(callback?: () => void): void
  on(event: 'error', listener: (error: Error) => void): void
}

// UDP gives no delivery confirmation, but the send itself can fail: a bad port, a
// hostname that does not resolve, a socket that errors. Without a bound on the wait, a
// lost callback would leave the cue running for the rest of the show.
const SEND_TIMEOUT_MS = 2000

export class OscEngine {
  private listener: unknown = null

  async send(host: string, port: number, address: string, args: OscArg[]): Promise<OscSendResult> {
    if (!host) return { ok: false, error: 'No OSC host is set for this cue' }

    let client: OscClient
    try {
      const { Client } = require('node-osc') as {
        Client: new (host: string, port: number) => OscClient
      }
      client = new Client(host, port)
    } catch (error) {
      return { ok: false, error: describe(error) }
    }

    const mappedArgs = args.map(a => {
      if (a.type === 'T') return true
      if (a.type === 'F') return false
      return a.value
    })

    const { promise, resolve } = Promise.withResolvers<OscSendResult>()
    let settled = false
    const finish = (result: OscSendResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      client.close(() => {})
      resolve(result)
    }

    const timer = setTimeout(
      () => finish({ ok: false, error: `No response sending to ${host}:${port}` }),
      SEND_TIMEOUT_MS
    )

    // node-osc re-emits socket errors on the client. Without a listener that is an
    // unhandled 'error' event, which takes the main process down with it.
    client.on('error', (error: Error) => finish({ ok: false, error: describe(error) }))

    try {
      client.send(address, ...mappedArgs, (error?: Error) => {
        finish(error ? { ok: false, error: describe(error) } : { ok: true })
      })
    } catch (error) {
      finish({ ok: false, error: describe(error) })
    }

    return promise
  }

  startListener(port: number): void {
    try {
      const { Server } = require('node-osc') as {
        Server: new (port: number, host: string, callback: () => void) => unknown
      }
      if (this.listener) return
      this.listener = new Server(port, '0.0.0.0', () => {
        console.log(`OSC listener on port ${port}`)
      })
    } catch (e) {
      console.error('OSC listener error:', e)
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
