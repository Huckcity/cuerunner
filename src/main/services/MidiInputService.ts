import { decodeMidiMessage } from '../midi/decode'
import type { ShowSettings } from '../../shared/show'
import type { ServiceContext, ShowService } from '../bus/ServiceHost'

// The `midi` package is an optional dependency: it needs build tools, and a machine
// that cannot build it still has to run the show. Everything it exposes is used
// through this interface, so the service can be tested without it.
interface MidiInputPort {
  getPortCount(): number
  getPortName(index: number): string
  openPort(index: number): void
  closePort(): void
  ignoreTypes(sysex: boolean, timing: boolean, activeSense: boolean): void
  on(event: 'message', listener: (deltaTime: number, message: number[]) => void): void
}

type InputFactory = () => MidiInputPort

function createInput(): MidiInputPort {
  const midi = require('midi') as { Input: new () => MidiInputPort }
  return new midi.Input()
}

/** How often the port list is checked for interfaces appearing and disappearing. */
const PORT_POLL_MS = 2000

/**
 * Listens to the show's MIDI inputs and reports which ones are connected.
 *
 * A USB interface that drops out mid-show is worth knowing about before the cue that
 * needed it, so a missing port is an alarm as well as a device going offline.
 */
export class MidiInputService implements ShowService {
  readonly id = 'midi-in'
  readonly label = 'MIDI input'
  readonly settingsSections = ['midiIn'] as const

  private inputs = new Map<string, MidiInputPort>()
  private poll: ReturnType<typeof setInterval> | null = null
  private context: ServiceContext | null = null
  private portNames: string[] = []

  constructor(private readonly create: InputFactory = createInput) {}

  start(context: ServiceContext, settings: ShowSettings): void {
    this.context = context
    this.portNames = settings.midiIn.portNames

    if (!settings.midiIn.enabled) {
      context.setState('stopped', 'disabled')
      return
    }

    let available: string[]
    try {
      available = this.listPorts()
    } catch (error) {
      // The optional dependency is missing: the show runs, this panel says why.
      context.setState('degraded', describe(error))
      return
    }

    // No ports chosen means every port: an operator who enabled MIDI input without
    // picking one wants the device they just plugged in to work.
    const wanted = this.portNames.length > 0 ? this.portNames : available
    const missing = wanted.filter(name => !available.includes(name))

    for (const name of wanted) {
      if (available.includes(name)) this.open(name, context)
    }

    const opened = this.inputs.size
    if (opened === 0) {
      const detail = missing.length > 0
        ? `no input port named ${missing.map(quote).join(', ')}`
        : 'no MIDI input ports available'
      context.setState('degraded', detail)
      return
    }

    context.setState(
      'running',
      missing.length > 0
        ? `listening on ${opened} port${opened === 1 ? '' : 's'}, waiting for ${missing.map(quote).join(', ')}`
        : `listening on ${[...this.inputs.keys()].map(quote).join(', ')}`
    )
    this.watch(context)
  }

  stop(): void {
    clearInterval(this.poll ?? undefined)
    this.poll = null
    // Publish the offline rows before dropping the context they publish through —
    // otherwise they are silently dropped and the panel reads "online" forever.
    for (const [name, input] of this.inputs) {
      try {
        input.closePort()
      } catch {
        // A port the OS already took away throws on close; it is gone either way.
      }
      this.publishPort(name, false)
    }
    this.inputs.clear()
    this.context = null
  }

  /** Rescan on demand: the operator patched something in and does not want to wait. */
  command(action: string): unknown {
    if (action !== 'rescan') throw new Error(`Unknown action "${action}"`)
    this.reconcile()
    return { ports: [...this.inputs.keys()] }
  }

  private watch(context: ServiceContext): void {
    this.poll = setInterval(() => {
      try {
        this.reconcile()
      } catch (error) {
        context.setState('degraded', describe(error))
      }
    }, PORT_POLL_MS)
    // A poll of the OS port list must not be what keeps the app alive on quit.
    this.poll.unref?.()
  }

  /**
   * Brings the open ports in line with what the OS reports: a configured port that
   * appeared is opened, one that left is closed and reported offline.
   */
  private reconcile(): void {
    const context = this.context
    if (!context) return

    const available = this.listPorts()
    const wanted = this.portNames.length > 0 ? this.portNames : available

    for (const name of wanted) {
      if (available.includes(name) && !this.inputs.has(name)) this.open(name, context)
    }
    for (const name of [...this.inputs.keys()]) {
      if (!available.includes(name)) this.close(name, context)
    }
  }

  private open(name: string, context: ServiceContext): void {
    const input = this.create()
    const index = this.indexOf(input, name)
    if (index < 0) return
    // Sysex is kept — it is how desks send their state. Clock and active sensing are
    // dropped: both arrive continuously and neither says anything the show needs.
    input.ignoreTypes(false, true, true)
    input.on('message', (_deltaTime, message) => {
      const decoded = decodeMidiMessage(message)
      if (!decoded) return
      context.bus.publish({ kind: 'midi', at: Date.now(), device: name, message: decoded })
    })
    input.openPort(index)
    this.inputs.set(name, input)
    this.publishPort(name, true)
    context.setState('running', `listening on ${[...this.inputs.keys()].map(quote).join(', ')}`)
  }

  private close(name: string, context: ServiceContext): void {
    const input = this.inputs.get(name)
    if (!input) return
    this.inputs.delete(name)
    try {
      input.closePort()
    } catch {
      // Already gone at the OS level.
    }
    this.publishPort(name, false)
    // A cue that played a note down this port will silently play nowhere, and the
    // operator only finds out on the night. Say it now.
    context.bus.alert('warning', this.id, `MIDI input ${quote(name)} disconnected`)
  }

  private publishPort(name: string, online: boolean): void {
    this.context?.bus.device({
      id: `midi-in:${name}`,
      service: this.id,
      name,
      model: 'MIDI input',
      online,
      lastSeen: Date.now()
    })
  }

  private listPorts(): string[] {
    const input = this.create()
    try {
      const count = input.getPortCount()
      const names: string[] = []
      for (let i = 0; i < count; i++) names.push(input.getPortName(i))
      return names
    } finally {
      try {
        input.closePort()
      } catch {
        // A probe that opened nothing has nothing to close.
      }
    }
  }

  private indexOf(input: MidiInputPort, name: string): number {
    const count = input.getPortCount()
    for (let i = 0; i < count; i++) {
      if (input.getPortName(i) === name) return i
    }
    return -1
  }
}

function quote(name: string): string {
  return `"${name}"`
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
