import type { MidiAvailability } from '../../shared/midi'
import { encodeMidiMessage, type MidiMessage } from './encode'

export interface MidiSendResult {
  ok: boolean
  /** Why nothing was sent, when nothing was. */
  error?: string
}

interface MidiOutputPort {
  getPortCount(): number
  getPortName(index: number): string
  openPort(index: number): void
  closePort(): void
  sendMessage(message: number[]): void
}

interface MidiInputPort {
  getPortCount(): number
  getPortName(index: number): string
  closePort(): void
}

interface MidiModule {
  Output: new () => MidiOutputPort
  Input: new () => MidiInputPort
}

/**
 * The module is loaded through this, so a test can stand in for a machine that has it
 * and a build without it is a case that can be exercised rather than guessed at.
 */
export type MidiModuleLoader = () => MidiModule

function defaultMidiLoader(): MidiModule {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('midi') as MidiModule
}

export class MidiEngine {
  private outputs = new Map<string, MidiOutputPort>()
  // Whether the module has once answered. A module that loaded and listed its ports does
  // not stop being installed, so a send asks only until the answer is yes: asking every
  // time built a fresh native client — a new CoreMIDI or ALSA client on some systems — on
  // the path of every MIDI cue in the show, to learn what the last cue already knew.
  private moduleAnswered = false

  constructor(private readonly load: MidiModuleLoader = defaultMidiLoader) {}

  status(): MidiAvailability {
    try {
      const midi = this.load()
      const out = new midi.Output()
      try {
        // Requiring the module is not enough: the addon's bindings are what fail to
        // load on a machine that cannot build them, and asking for the port list is
        // what touches them.
        out.getPortCount()
      } finally {
        try {
          out.closePort()
        } catch {
          // A probe that opened nothing has nothing to close.
        }
      }
      return { available: true, error: null }
    } catch (error) {
      return { available: false, error: describeMidiFailure(error) }
    }
  }

  listOutputPorts(): string[] {
    try {
      const midi = this.load()
      const out = new midi.Output()
      const count = out.getPortCount()
      const ports: string[] = []
      for (let i = 0; i < count; i++) ports.push(out.getPortName(i))
      out.closePort()
      return ports
    } catch {
      return []
    }
  }

  listInputPorts(): string[] {
    try {
      const midi = this.load()
      const input = new midi.Input()
      const count = input.getPortCount()
      const ports: string[] = []
      for (let i = 0; i < count; i++) ports.push(input.getPortName(i))
      input.closePort()
      return ports
    } catch {
      return []
    }
  }

  private getOutput(portName: string): MidiOutputPort | null {
    const cached = this.outputs.get(portName)
    if (cached) return cached
    try {
      const midi = this.load()
      const out = new midi.Output()
      const count = out.getPortCount()
      for (let i = 0; i < count; i++) {
        if (out.getPortName(i) === portName) {
          out.openPort(i)
          this.outputs.set(portName, out)
          return out
        }
      }
      // No such port: the handle that was made to look for it is not kept, so it is let go
      // rather than left for the collector — a cue with a wrong port name fires all night.
      try {
        out.closePort()
      } catch {
        // A handle that opened nothing has nothing to close.
      }
    } catch {
      // The module itself is unavailable; send() reports that before it gets here.
    }
    return null
  }

  send(portName: string, messages: MidiMessage[]): MidiSendResult {
    // Without the module there is no port to look for, and saying "no port named X"
    // would send the operator looking at their rack instead of their installation.
    if (!this.moduleAnswered) {
      const availability = this.status()
      if (!availability.available) {
        return { ok: false, error: `MIDI is unavailable${availability.error ? `: ${availability.error}` : ''}` }
      }
      this.moduleAnswered = true
    }

    const out = this.getOutput(portName)
    // Returning silently here is what made a MIDI cue look successful while nothing
    // was sent: the port was wrong, or the device was not there at all.
    if (!out) {
      return {
        ok: false,
        error: portName
          ? `No MIDI output port named "${portName}"`
          : 'No MIDI output port is set for this cue'
      }
    }
    try {
      for (const msg of messages) out.sendMessage(encodeMidiMessage(msg))
      return { ok: true }
    } catch (error) {
      // A device unplugged mid-show leaves a handle that throws on every later send.
      // Dropping it means the next send looks for the port again.
      this.outputs.delete(portName)
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
}

/**
 * `require('midi')` failing is the common case on a machine without build tools, and
 * "Cannot find module 'midi'" means nothing to an operator. The message says what is
 * wrong with the installation, and keeps the raw text of anything else.
 */
function describeMidiFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/cannot find module|module_not_found|no native build|invalid elf|wrong elf|dlopen/i.test(message)) {
    return 'the MIDI module is not installed in this build'
  }
  return message
}
