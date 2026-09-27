// An instrument for capturing an Allen & Heath SQ's *native* control service (TCP 51326), the
// protocol Allen & Heath publish nothing about. It is not a lane and no lane runs it: it exists
// because the one measured desk capture in the repository (integration/fixtures/vendor/
// sq6-native-apply-2026-09-22.json) was taken with it, and the next capture will need it again.
//
// It answers as the desk in one place only — the discovery broadcast on UDP 51320 — because a
// client asked for an address finds consoles by broadcast and would otherwise dial the desk
// itself, out of reach of anything watching. Everything on the TCP side is forwarded verbatim:
// the relay answers nothing, invents nothing and drops nothing (the discipline
// `harness-desk-relay.spec.ts` holds the lane's relay to).
//
// Two things measured on an SQ-6, firmware 1.6.1 (2026-09-22), that a capture must respect:
//
//   * the desk reports a controlling client, and a client that dies without leaving
//     (`BYE.`, sent on the range's own port 51321) leaves the desk's native port mute —
//     accepting TCP and answering the hello with nothing — until it is reset or power-cycled.
//     Stop the client before the instrument, and power-cycle the desk if a capture went wrong.
//   * the desk's native service takes several clients, so the instrument can sit in front of it
//     while a show-control client and this tool's own probes both connect.
//
// Usage:
//
//   node integration/sqCapture.mjs --desk 192.168.0.226 --capture /tmp/sq-capture.jsonl
//
// then point the client at *this machine's* address on the desk's network, drive it, and stop it
// with its own goodbye before stopping this.
import { createServer, createConnection } from 'node:net'
import { createSocket } from 'node:dgram'
import { appendFileSync, writeFileSync } from 'node:fs'

const args = new Map()
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1])

const DESK_HOST = args.get('--desk')
if (DESK_HOST === undefined) {
  console.error('sqCapture: --desk <host> is required (the SQ\'s own address, e.g. 192.168.0.226)')
  process.exit(2)
}
/**
 * A port argument, as a whole number in range. `Number('abc')` is `NaN`, and a sweep over
 * `NaN` relays nothing while still printing a banner — the operator sees a capture that
 * "ran" and holds no traffic. A bare `0` is the other end of the same mistake: it walks
 * 0..last and calls `listen(0)` on ephemeral ports, which bind and answer nothing.
 */
function portArg(name, fallback) {
  const raw = args.get(name)
  if (raw === undefined) return fallback
  const port = /^[0-9]+$/.test(raw) ? Number(raw) : NaN
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`sqCapture: ${name} takes a whole port number from 1 to 65535, not ${JSON.stringify(raw)}`)
    process.exit(2)
  }
  return port
}

const FIRST_PORT = portArg('--first-port', 51320)
const LAST_PORT = portArg('--last-port', 51340)
const DISCOVERY_PORT = portArg('--discovery-port', 51320)
if (LAST_PORT < FIRST_PORT) {
  console.error(`sqCapture: --last-port ${LAST_PORT} is below --first-port ${FIRST_PORT} — there is no range to sweep`)
  process.exit(2)
}
const MODEL_REPLY = args.get('--model-reply') ?? 'SQ-6'
const CAPTURE = args.get('--capture') ?? '/tmp/sq-capture.jsonl'

writeFileSync(CAPTURE, '')
const t0 = Date.now()
const lat = (b) => [...b].map((x) => (x >= 32 && x < 127 ? String.fromCharCode(x) : '.')).join('')

/** One captured chunk: when, which connection, which way, and the bytes as they crossed. */
function record(who, dir, buf) {
  const entry = { t: Date.now() - t0, who, dir, len: buf.length, hex: buf.toString('hex'), latin1: buf.toString('latin1') }
  appendFileSync(CAPTURE, JSON.stringify(entry) + '\n')
  const tag = buf.length >= 4 ? lat(buf.subarray(0, 4)) : ''
  console.log(`+${String(entry.t).padStart(6)}ms ${who} ${dir} ${String(buf.length).padStart(5)}B ${tag.padEnd(4)} ${lat(buf).slice(0, 200)}`)
}

/* Discovery: the one place the instrument answers as the desk. */
const discovery = createSocket('udp4')
// The TCP side logs a port that will not bind and carries on with the rest; this socket is the
// instrument's whole reason for existing — a client that finds no desk by discovery dials the
// desk itself, out of reach of anything watching — so a port somebody else holds is the end of
// the run rather than a line to read past.
discovery.on('error', (error) => {
  console.error(`sqCapture: udp ${DISCOVERY_PORT} — ${error.message}`)
  process.exit(2)
})
discovery.on('message', (msg, rinfo) => {
  const said = lat(msg).replace(/\0+$/, '')
  console.log(`+${String(Date.now() - t0).padStart(6)}ms udp <- ${rinfo.address}:${rinfo.port} ${JSON.stringify(said)}`)
  if (said === 'SQ Find') {
    discovery.send(Buffer.from(`${MODEL_REPLY}\0`, 'latin1'), rinfo.port, rinfo.address, () => {})
    console.log(`          answered "${MODEL_REPLY}\\0" as the desk`)
  }
})
discovery.bind(DISCOVERY_PORT, '0.0.0.0', () => discovery.setBroadcast(true))

/* The ports a client may use, relayed to the desk and captured in both directions. */
let seq = 0
for (let port = FIRST_PORT; port <= LAST_PORT; port++) {
  const server = createServer((client) => {
    const who = `t${port}c${++seq}`
    console.log(`+${String(Date.now() - t0).padStart(6)}ms ${who} client ${client.remoteAddress}:${client.remotePort}`)
    const desk = createConnection({ host: DESK_HOST, port })
    client.on('data', (b) => { record(who, '->', b); desk.write(b) })
    desk.on('data', (b) => { record(who, '<-', b); client.write(b) })
    const close = (why) => { console.log(`+${String(Date.now() - t0).padStart(6)}ms ${who} closing: ${why}`); client.destroy(); desk.destroy() }
    client.on('close', () => close('client closed'))
    client.on('error', (e) => close(`client error ${e.message}`))
    desk.on('close', () => close('desk closed'))
    desk.on('error', (e) => close(`desk error ${e.message}`))
  })
  server.on('error', (e) => console.log(`port ${port}: ${e.message}`))
  server.listen(port, '0.0.0.0', () => {})
}

console.log(`sqCapture: relaying tcp ${FIRST_PORT}-${LAST_PORT} to ${DESK_HOST}, answering discovery on udp ${DISCOVERY_PORT}, capturing to ${CAPTURE}`)
process.on('SIGINT', () => { discovery.close(); process.exit(0) })
