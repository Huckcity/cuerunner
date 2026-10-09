// A running QLab, read over its own OSC interface.
//
// This path does not depend on the file format at all: it asks QLab what it has, in the
// vocabulary QLab documents for scripting it — `/workspaces`, `/workspace/{id}/connect`,
// `/workspace/{id}/cueLists`, and `/workspace/{id}/cue_id/{id}/valuesForKeys` for each cue
// — over TCP on port 53000, where every packet is SLIP-framed and every answer arrives as
// a `/reply/…` message carrying one JSON string. So a show can come across from a Mac
// that is on the network, from a QLab version whose files nobody has decoded, or from a
// workspace that has not been saved since the last change.
//
// Main owns the socket. One request is in flight at a time and every one has a deadline;
// the frames are bounded and so is the whole conversation, so a peer that talks forever
// or never answers ends in a sentence, not a hang. QLab's unsolicited `/update` messages,
// which it sends a connected client, are read past.

import { Socket } from 'node:net'
import { Refusal } from '../ipc/refusal'
import type { QLabWorkspaceEntry } from '../../shared/ipc/qlab'
import { SlipDecoder, decodeOscMessage, encodeOscMessage, slipEncode } from './oscStream'
import { MAX_IMPORTED_CUES, qlabKind, type QLabCue, type QLabKind, type QLabList, type QLabShow } from './qlabShow'

export interface LiveOptions {
  /** How long QLab has to answer one request. */
  replyTimeoutMs?: number
  /** How long the connection has to open. */
  connectTimeoutMs?: number
  /** The largest single reply. A cue list's reply holds the whole tree, so this is generous. */
  maxFrameBytes?: number
  /** Everything the conversation may read, all replies together. */
  maxTotalBytes?: number
}

const DEFAULTS: Required<LiveOptions> = {
  replyTimeoutMs: 5000,
  connectTimeoutMs: 3000,
  maxFrameBytes: 16 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024
}

/** What every cue is asked for, whatever its type. */
const COMMON_KEYS = ['notes', 'preWait', 'postWait', 'duration', 'continueMode', 'colorName', 'armed']

/** What each type is asked for on top. A key a cue does not have is left out of its answer. */
const TYPE_KEYS: Partial<Record<QLabKind, string[]>> = {
  audio: ['fileTarget', 'startTime', 'endTime', 'playCount', 'infiniteLoop', 'rate', 'sliderLevels'],
  video: ['fileTarget'],
  midifile: ['fileTarget'],
  fade: ['cueTargetID', 'cueTargetNumber', 'sliderLevels', 'stopTargetWhenDone'],
  stop: ['cueTargetID', 'cueTargetNumber'],
  devamp: ['cueTargetID', 'cueTargetNumber', 'stopTargetWhenDone'],
  start: ['cueTargetID', 'cueTargetNumber'],
  pause: ['cueTargetID', 'cueTargetNumber'],
  load: ['cueTargetID', 'cueTargetNumber', 'loadAt'],
  reset: ['cueTargetID', 'cueTargetNumber'],
  goto: ['cueTargetID', 'cueTargetNumber'],
  target: ['cueTargetID', 'cueTargetNumber'],
  arm: ['cueTargetID', 'cueTargetNumber'],
  disarm: ['cueTargetID', 'cueTargetNumber'],
  group: ['mode'],
  midi: ['messageType', 'status', 'channel', 'byte1', 'byte2', 'command', 'commandFormat', 'deviceID', 'qNumber', 'qList', 'sysexString'],
  network: ['messageType', 'customString', 'oscString', 'rawString'],
  script: ['scriptSource'],
  light: ['lightCommandText'],
  text: ['text']
}

/** One answer QLab gave: its status, and what it carried. */
interface Reply {
  status: string
  data: unknown
}

/** A conversation with one QLab: requests out, replies matched back, one at a time. */
export class QLabSession {
  private readonly decoder: SlipDecoder
  private received = 0
  private waiting: { address: string; settle: (reply: Reply | Error) => void } | null = null
  private failure: Error | null = null

  private constructor(
    private readonly socket: Socket,
    private readonly where: string,
    private readonly options: Required<LiveOptions>
  ) {
    this.decoder = new SlipDecoder(options.maxFrameBytes)
    socket.on('data', chunk => this.read(chunk))
    socket.on('error', error => this.fail(new Refusal(`the connection to QLab at ${where} failed: ${error.message}`)))
    socket.on('close', () => this.fail(new Refusal(`QLab at ${where} closed the connection`)))
  }

  /** Opens a connection, or refuses with a sentence that says why there is none. */
  static open(host: string, port: number, options: LiveOptions = {}): Promise<QLabSession> {
    const settings = { ...DEFAULTS, ...options }
    const where = `${host}:${port}`
    return new Promise((resolve, reject) => {
      const socket = new Socket()
      const timer = setTimeout(() => {
        socket.destroy()
        reject(new Refusal(`no QLab answered at ${where} within ${settings.connectTimeoutMs / 1000} seconds`))
      }, settings.connectTimeoutMs)
      socket.once('error', error => {
        clearTimeout(timer)
        socket.destroy()
        const code = (error as NodeJS.ErrnoException).code
        reject(new Refusal(code === 'ECONNREFUSED'
          ? `no QLab answered at ${where}: nothing is listening there. Is QLab open, with OSC access allowed?`
          : `no QLab answered at ${where}: ${error.message}`))
      })
      socket.connect(port, host, () => {
        clearTimeout(timer)
        socket.removeAllListeners('error')
        socket.setNoDelay(true)
        resolve(new QLabSession(socket, where, settings))
      })
    })
  }

  /** Sends one message and waits for the reply to it. */
  request(address: string, args: Array<string | number> = []): Promise<Reply> {
    if (this.failure) return Promise.reject(this.failure)
    if (this.waiting) return Promise.reject(new Error('a QLab session takes one request at a time'))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting = null
        reject(new Refusal(`QLab at ${this.where} stopped answering (${address} had no reply in ${this.options.replyTimeoutMs / 1000} seconds)`))
      }, this.options.replyTimeoutMs)
      this.waiting = {
        address,
        settle: reply => {
          clearTimeout(timer)
          this.waiting = null
          if (reply instanceof Error) reject(reply)
          else resolve(reply)
        }
      }
      this.socket.write(slipEncode(encodeOscMessage(address, args)))
    })
  }

  close(): void {
    this.socket.removeAllListeners('close')
    this.socket.destroy()
  }

  private fail(error: Error): void {
    if (this.failure) return
    this.failure = error
    this.waiting?.settle(error)
  }

  private read(chunk: Buffer): void {
    if (this.failure) return
    this.received += chunk.length
    if (this.received > this.options.maxTotalBytes) {
      this.fail(new Refusal(`QLab at ${this.where} sent more than an import reads`))
      this.close()
      return
    }
    let packets: Uint8Array[]
    try {
      packets = this.decoder.push(chunk)
    } catch (error) {
      this.fail(new Refusal(`QLab at ${this.where} sent something that is not OSC: ${(error as Error).message}`))
      this.close()
      return
    }
    for (const packet of packets) {
      let message
      try {
        message = decodeOscMessage(packet)
      } catch {
        // A packet that is not a message is not a reply to anything; the request it might
        // have answered still has its deadline.
        continue
      }
      if (!message.address.startsWith('/reply')) continue
      const waiting = this.waiting
      if (waiting === null || !answers(message.address, waiting.address)) continue
      const body = message.args[0]
      if (typeof body !== 'string') {
        waiting.settle({ status: 'ok', data: null })
        continue
      }
      try {
        const parsed = JSON.parse(body) as { status?: unknown; data?: unknown }
        waiting.settle({ status: typeof parsed.status === 'string' ? parsed.status : 'ok', data: parsed.data })
      } catch {
        waiting.settle(new Refusal(`QLab at ${this.where} answered ${waiting.address} with something that is not JSON`))
      }
    }
  }
}

/** Whether a reply address answers a request: QLab replies with or without the workspace prefix. */
function answers(replyAddress: string, sent: string): boolean {
  const asked = replyAddress.slice('/reply'.length)
  return asked === sent || asked === sent.replace(/^\/workspace\/[^/]+/, '')
}

function text(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function number(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return undefined
}

function flag(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (value === 'true') return true
  if (value === 'false') return false
  return fallback
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
}

/** A slider level QLab reports in decibels, as a linear gain. */
function fromDecibels(value: unknown): number | null {
  const db = number(value)
  if (db === undefined) return null
  return db <= -60 ? 0 : Math.pow(10, db / 20)
}

/** The workspaces a QLab has open. */
export async function listQLabWorkspaces(host: string, port: number, options: LiveOptions = {}): Promise<QLabWorkspaceEntry[]> {
  const session = await QLabSession.open(host, port, options)
  try {
    const reply = await session.request('/workspaces')
    const data = Array.isArray(reply.data) ? reply.data : []
    return data.map(record).filter((entry): entry is Record<string, unknown> => entry !== null).map(entry => ({
      id: text(entry['uniqueID']),
      name: text(entry['displayName']) || text(entry['name']) || 'Untitled Workspace',
      hasPasscode: flag(entry['hasPasscode'], false),
      version: text(entry['version'])
    })).filter(entry => entry.id !== '')
  } finally {
    session.close()
  }
}

/** One workspace of a running QLab, read cue by cue into a show. */
export async function readLiveWorkspace(
  host: string,
  port: number,
  workspaceId: string,
  passcode: string | undefined,
  options: LiveOptions = {}
): Promise<QLabShow> {
  const where = `${host}:${port}`
  const session = await QLabSession.open(host, port, options)
  try {
    const prefix = `/workspace/${workspaceId}`
    const listed = await session.request('/workspaces')
    const entry = (Array.isArray(listed.data) ? listed.data : []).map(record).find(item => text(item?.['uniqueID']) === workspaceId)
    if (!entry) throw new Refusal(`QLab at ${where} no longer has that workspace open`)

    const connected = await session.request(`${prefix}/connect`, passcode ? [passcode] : [])
    const answer = text(connected.data)
    if (answer === 'badpass' || connected.status === 'denied') {
      throw new Refusal(passcode
        ? `QLab at ${where} did not accept that passcode`
        : `that workspace has a passcode: type it in and import again`)
    }
    if (connected.status === 'error') throw new Refusal(`QLab at ${where} would not connect to that workspace`)

    const tree = await session.request(`${prefix}/cueLists`)
    if (tree.status !== 'ok' || !Array.isArray(tree.data)) {
      throw new Refusal(tree.status === 'denied'
        ? `QLab at ${where} would not show that workspace’s cues: its OSC access does not allow it`
        : `QLab at ${where} did not send that workspace’s cue lists`)
    }

    const counter = { cues: 0 }
    const lists: QLabList[] = []
    for (const item of tree.data) {
      const list = record(item)
      if (!list) continue
      const cues = Array.isArray(list['cues']) ? list['cues'] : []
      lists.push({
        name: text(list['name']) || text(list['listName']),
        uniqueID: text(list['uniqueID']),
        cart: /cart/i.test(text(list['type'])),
        cues: await liveCues(cues, session, prefix, counter)
      })
    }
    return { name: text(entry['displayName']).replace(/\.qlab\d$/i, ''), lists, baseDir: null }
  } finally {
    session.close()
  }
}

async function liveCues(
  items: unknown[],
  session: QLabSession,
  prefix: string,
  counter: { cues: number },
): Promise<QLabCue[]> {
  const out: QLabCue[] = []
  for (const item of items) {
    const listed = record(item)
    if (!listed) continue
    counter.cues++
    if (counter.cues > MAX_IMPORTED_CUES) {
      throw new Refusal(`that workspace holds more than ${MAX_IMPORTED_CUES.toLocaleString('en-GB')} cues, which is more than this import converts`)
    }
    const id = text(listed['uniqueID'])
    const typeName = text(listed['type'])
    const kind = qlabKind(typeName)
    let values: Record<string, unknown> = {}
    if (id !== '') {
      const address = `${prefix}/cue_id/${id}/valuesForKeys`
      const keys = [...COMMON_KEYS, ...(TYPE_KEYS[kind] ?? [])]
      let reply = await session.request(address, [JSON.stringify(keys)])
      // A QLab that does not know one of a type's keys may refuse the whole question; the
      // keys every cue has are asked again on their own, so the cue keeps its timing.
      if (reply.status !== 'ok' && keys.length > COMMON_KEYS.length) {
        reply = await session.request(address, [JSON.stringify(COMMON_KEYS)])
      }
      values = reply.status === 'ok' ? record(reply.data) ?? {} : {}
    }
    const children = Array.isArray(listed['cues']) ? await liveCues(listed['cues'], session, prefix, counter) : undefined
    out.push(liveCue(kind, typeName, listed, values, children))
  }
  return out
}

/** One cue, from what the tree listed and what `valuesForKeys` added. */
export function liveCue(
  kind: QLabKind,
  typeName: string,
  listed: Record<string, unknown>,
  values: Record<string, unknown>,
  children: QLabCue[] | undefined
): QLabCue {
  const value = (key: string): unknown => values[key] ?? listed[key]
  const cue: QLabCue = {
    kind,
    typeName,
    uniqueID: text(listed['uniqueID']),
    number: text(value('number')),
    name: text(value('name')) || text(listed['listName']),
    notes: text(value('notes')),
    colorName: text(value('colorName')),
    armed: flag(value('armed'), true),
    preWait: number(value('preWait')) ?? 0,
    postWait: number(value('postWait')) ?? 0,
    duration: number(value('duration')) ?? 0,
    continueMode: number(value('continueMode')) ?? 0
  }
  const targetId = text(value('cueTargetID'))
  const targetNumber = text(value('cueTargetNumber'))
  if (targetId !== '' || targetNumber !== '') cue.target = { uniqueID: targetId, number: targetNumber }
  const loadAt = kind === 'load' ? number(value('loadAt')) : undefined
  if (loadAt !== undefined) cue.loadAt = loadAt
  const file = text(value('fileTarget'))
  // A live QLab reports the file where it is on that machine.
  if (file !== '') cue.media = { relative: '', absolute: file }
  const sliders = Array.isArray(value('sliderLevels')) ? value('sliderLevels') as unknown[] : null

  switch (kind) {
    case 'audio':
      cue.startTime = number(value('startTime'))
      cue.endTime = number(value('endTime'))
      cue.playCount = number(value('playCount'))
      cue.infiniteLoop = flag(value('infiniteLoop'), false)
      cue.rate = number(value('rate'))
      if (sliders) cue.levels = { master: fromDecibels(sliders[0]), left: fromDecibels(sliders[1]), right: fromDecibels(sliders[2]) }
      break
    case 'fade': {
      const master = sliders ? fromDecibels(sliders[0]) : null
      const left = sliders ? fromDecibels(sliders[1]) : null
      const right = sliders ? fromDecibels(sliders[2]) : null
      const pan = left !== null && right !== null && left + right > 0 ? (right - left) / (left + right) : null
      cue.fadeTo = { master, pan }
      cue.stopTargetWhenDone = flag(value('stopTargetWhenDone'), false)
      break
    }
    case 'devamp':
      cue.stopTargetWhenDone = flag(value('stopTargetWhenDone'), false)
      break
    case 'group':
      cue.groupMode = number(value('mode'))
      cue.children = children ?? []
      break
    case 'midi': {
      const messageType = number(value('messageType')) ?? 1
      cue.midi = {
        messageType,
        status: number(value('status')) ?? 1,
        channel: number(value('channel')) ?? 1,
        byte1: number(value('byte1')) ?? 0,
        byte2: number(value('byte2')) ?? 0,
        port: ''
      }
      if (messageType === 2) {
        cue.midi.msc = {
          format: number(value('commandFormat')) ?? 0x7f,
          command: number(value('command')) ?? 0x01,
          deviceId: number(value('deviceID')) ?? 127,
          cueNumber: text(value('qNumber')),
          cueList: text(value('qList'))
        }
      }
      if (messageType === 3) {
        const raw = text(value('sysexString'))
        const bytes = raw.replace(/[^0-9a-f]/gi, ' ').trim().split(/\s+/).filter(Boolean).map(pair => parseInt(pair, 16))
        if (bytes.length > 0 && bytes.every(byte => Number.isFinite(byte) && byte >= 0 && byte <= 255)) cue.midi.sysex = bytes
      }
      break
    }
    case 'network': {
      const message = text(value('oscString')) || text(value('customString'))
      const raw = text(value('rawString'))
      cue.network = message.trim() !== ''
        ? { kind: 'osc', message: message.trim(), host: null, port: null, patch: '' }
        : raw !== ''
          ? { kind: 'text', message: raw, host: null, port: null, patch: '' }
          : { kind: 'unknown', message: '', host: null, port: null, patch: '' }
      break
    }
    case 'script':
      cue.script = text(value('scriptSource'))
      break
    case 'light':
      cue.detail = text(value('lightCommandText'))
      break
    case 'text':
      cue.detail = text(value('text'))
      break
  }
  if (kind !== 'group' && children && children.length > 0) cue.children = undefined
  return cue
}
