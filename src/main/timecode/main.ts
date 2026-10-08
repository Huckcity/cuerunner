/**
 * The timecode hub as the app builds it: the real MIDI ports, the real engine, real sockets.
 * Everything the hub touches arrives through its deps, so this file is the only one that
 * knows which machine it is running on.
 */
import { createSocket, type Socket } from 'node:dgram'
import { TimecodeHub } from './hub'
import { LtcClient, type LtcVerb } from './ltc'
import { midiTimecodeTap } from './midiTap'
import type { Closable } from './receiver'
import { ARTNET_PORT, type TimecodeStatus } from '../../shared/timecode'

export interface TimecodeHubOptions {
  filePath: string
  sendMidi(port: string, messages: number[][]): { ok: boolean; error?: string }
  listMidiInputs(): string[]
  /** The engine's LTC verbs. */
  ltc: LtcVerb
  broadcast(status: TimecodeStatus): void
  restartReceiver(): Promise<void>
}

interface MidiInputPort {
  getPortCount(): number
  getPortName(index: number): string
  openPort(index: number): void
  closePort(): void
  ignoreTypes(sysex: boolean, timing: boolean, activeSense: boolean): void
  on(event: 'message', listener: (deltaTime: number, message: number[]) => void): void
}

/** A MIDI input of the receiver's own, with MTC let through (rtmidi drops it with the clock by default). */
function openMidiInput(port: string, onMessage: (bytes: number[], at: number) => void): Closable {
  const midi = require('midi') as { Input: new () => MidiInputPort }
  const input = new midi.Input()
  let index = -1
  for (let i = 0; i < input.getPortCount(); i++) if (input.getPortName(i) === port) index = i
  if (index < 0) {
    input.closePort()
    throw new Error(`no MIDI input port named "${port}"`)
  }
  input.ignoreTypes(false, false, true)
  input.on('message', (_delta, message) => onMessage(message, Date.now()))
  input.openPort(index)
  return { close: () => input.closePort() }
}

/** Binds a UDP port for ArtTimeCode. Shared with any other Art-Net listener on the machine. */
function bindUdp(port: number, onPacket: (packet: Buffer, at: number) => void): Promise<Closable> {
  return new Promise((resolve, reject) => {
    const socket = createSocket({ type: 'udp4', reuseAddr: true })
    const failed = (error: Error): void => {
      socket.close()
      reject(error)
    }
    socket.once('error', failed)
    socket.on('message', packet => onPacket(packet, Date.now()))
    socket.bind(port, () => {
      socket.off('error', failed)
      // A socket that fails later is a listener that has stopped; it says nothing more.
      socket.on('error', () => {})
      socket.unref()
      resolve({ close: () => socket.close() })
    })
  })
}

/** "host" or "host:port": Art-Net's own port unless the cue names another. */
export function artnetAddress(target: string): { host: string; port: number } {
  const match = /^(.*):(\d{1,5})$/.exec(target.trim())
  if (match && !match[1].includes(':')) return { host: match[1], port: Number(match[2]) }
  return { host: target.trim(), port: ARTNET_PORT }
}

export function createTimecodeHub(options: TimecodeHubOptions): TimecodeHub {
  const ltc = new LtcClient(options.ltc)
  let sender: Socket | null = null
  const sendArtnet = (target: string, packet: Buffer): void => {
    if (sender === null) {
      sender = createSocket({ type: 'udp4' })
      sender.on('error', () => {})
      sender.bind(0, () => {
        sender?.setBroadcast(true)
        sender?.unref()
      })
    }
    const { host, port } = artnetAddress(target)
    sender.send(packet, port, host)
  }
  return new TimecodeHub({
    filePath: options.filePath,
    receiver: {
      now: () => Date.now(),
      tap: midiTimecodeTap,
      listMidiInputs: options.listMidiInputs,
      openMidiInput,
      ltc,
      bindUdp
    },
    generators: {
      now: () => Date.now(),
      sendMidi: options.sendMidi,
      ltc,
      sendArtnet
    },
    broadcast: options.broadcast,
    restartReceiver: options.restartReceiver
  })
}
