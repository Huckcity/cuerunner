// A MIDI output port that is not there, for the end-to-end suite: the module the engine
// loads, standing in for the native one, with one output port of a given name whose every
// message is written down with the moment it arrived.
//
// A test machine has no MIDI interface, and the native module itself is optional — a build
// on a machine without ALSA's headers has none — so a spec that has to read what a cue put on
// the wire reads it here, through a name in main's global scope like the playback harness's.
// It is installed only by a build running from the source tree, and only when the launch asks
// for it by name.

import { performance } from 'node:perf_hooks'
import type { MidiModuleLoader } from './MidiEngine'

/** One message as the port received it: when, on main's high-resolution clock, and what. */
export interface LoopbackMessage {
  at: number
  bytes: number[]
}

export interface MidiLoopbackHarness {
  portName: string
  /** Every message received, oldest first. */
  messages: () => LoopbackMessage[]
  clear: () => void
}

declare global {
  // eslint-disable-next-line no-var
  var __cuerunnerMidiLoopback: MidiLoopbackHarness | undefined
}

/** What the port keeps: a spec reads a show's worth, and a stuck sender cannot grow it. */
const MESSAGE_LIMIT = 20_000

/** A stand-in module with one output port called `portName`, and the record of it. */
export function createMidiLoopback(portName: string): { load: MidiModuleLoader; harness: MidiLoopbackHarness } {
  const received: LoopbackMessage[] = []
  class Output {
    private open = false
    getPortCount(): number { return 1 }
    getPortName(index: number): string { return index === 0 ? portName : '' }
    openPort(index: number): void {
      if (index !== 0) throw new Error(`no port ${index}`)
      this.open = true
    }
    closePort(): void { this.open = false }
    sendMessage(message: number[]): void {
      if (!this.open) throw new Error('the port is not open')
      received.push({ at: performance.now(), bytes: [...message] })
      if (received.length > MESSAGE_LIMIT) received.splice(0, received.length - MESSAGE_LIMIT)
    }
  }
  class Input {
    getPortCount(): number { return 0 }
    getPortName(): string { return '' }
    closePort(): void {}
  }
  const harness: MidiLoopbackHarness = {
    portName,
    messages: () => received.map(message => ({ at: message.at, bytes: [...message.bytes] })),
    clear: () => { received.length = 0 }
  }
  return { load: () => ({ Output, Input }), harness }
}

/** Installs the stand-in's record where a spec can read it, and hands back its loader. */
export function installMidiLoopback(portName: string): MidiModuleLoader {
  const { load, harness } = createMidiLoopback(portName)
  globalThis.__cuerunnerMidiLoopback = harness
  return load
}
