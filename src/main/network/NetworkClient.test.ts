import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { NetworkClient } from './NetworkClient'

const servers: Server[] = []

function serve(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<string> {
  const { promise, resolve } = Promise.withResolvers<string>()
  const server = createServer(handler)
  servers.push(server)
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('no port')
    resolve(`http://127.0.0.1:${address.port}`)
  })
  return promise
}

afterEach(() => {
  for (const server of servers.splice(0)) server.close()
})

describe('NetworkClient', () => {
  it('returns the status, headers and body of an HTTP response', async () => {
    const base = await serve((_req, res) => {
      res.writeHead(418, 'I Am A Teapot', { 'X-Show': 'demo' })
      res.end('{"ok":true}')
    })
    const client = new NetworkClient()

    const result = await client.request({ method: 'POST', url: `${base}/hook`, body: '{"a":1}' })

    expect(result).toEqual({
      ok: true,
      status: 418,
      statusText: 'I Am A Teapot',
      body: '{"ok":true}',
      error: null
    })
  })

  it('sends the method, headers and body the cue configured', async () => {
    let seen: { method?: string; header?: string; body?: string } = {}
    const base = await serve((req, res) => {
      let body = ''
      req.on('data', chunk => { body += chunk })
      req.on('end', () => {
        seen = { method: req.method, header: req.headers['x-show'] as string, body }
        res.writeHead(200)
        res.end('ok')
      })
    })

    await new NetworkClient().request({
      method: 'PUT',
      url: `${base}/hit`,
      headers: { 'X-Show': 'demo' },
      body: '{"scene":3}'
    })

    expect(seen).toEqual({ method: 'PUT', header: 'demo', body: '{"scene":3}' })
  })

  it('drops the body of a GET, which the server would hold the connection open for', async () => {
    let received = ''
    const base = await serve((req, res) => {
      req.on('data', chunk => { received += chunk })
      req.on('end', () => {
        res.writeHead(200)
        res.end('ok')
      })
    })

    await new NetworkClient().request({ method: 'GET', url: `${base}/x`, body: 'ignored' })

    expect(received).toBe('')
  })

  it('times out a server that never answers, and says so', async () => {
    const base = await serve(() => { /* hold the request open */ })
    const client = new NetworkClient({ defaultTimeoutMs: 60 })

    const result = await client.request({ method: 'GET', url: `${base}/slow` })

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/timed out after 60ms/)
  })

  it('reports a refused connection rather than hanging', async () => {
    // Port 1 on the loopback is not a listening port in any sane test environment.
    const result = await new NetworkClient().request({ method: 'GET', url: 'http://127.0.0.1:1/x' })

    expect(result.ok).toBe(false)
    expect(result.error).not.toBeNull()
  })

  it('keeps a bounded prefix of a body that runs long', async () => {
    const base = await serve((_req, res) => {
      res.writeHead(200)
      res.end('x'.repeat(10_000))
    })

    const result = await new NetworkClient({ bodyLimit: 100 }).request({ method: 'GET', url: base })

    expect(result.body).toHaveLength(100 + '\n… (truncated)'.length)
    expect(result.body.endsWith('\n… (truncated)')).toBe(true)
  })

  it('cancels an in-flight request by its cue id', async () => {
    const base = await serve(() => { /* never answers */ })
    const client = new NetworkClient()

    const inFlight = client.request({ method: 'GET', url: `${base}/slow`, requestId: 'cue-1' })
    expect(client.cancel('cue-1')).toBe(true)

    const result = await inFlight
    expect(result.ok).toBe(false)
    expect(result.error).toBe('Request cancelled')
  })

  it('does not cancel a request that already finished', async () => {
    const base = await serve((_req, res) => { res.writeHead(200); res.end('ok') })
    const client = new NetworkClient()

    await client.request({ method: 'GET', url: base, requestId: 'cue-1' })

    expect(client.cancel('cue-1')).toBe(false)
  })
})
