// The hook's own half of the desk's buttons: which device event is the desk's own, and what
// the reader is told when one arrives.
//
// What the reader makes of a message is its own file's subject (`utils/deskInput.test.ts`).
// This one is about the wiring the reader cannot see: the device row a desk's traffic is
// published under, and the reset that row asks for. Both edges of a port's life are worth a
// reset for one reason — a port that is gone can no longer send what it was holding, so the
// note latch stays down and the groups' edge detection stays at a state that is no longer
// true. Kept as it was, a key held when its desk was unplugged made the operator's next press
// read as the repeat of a key nobody was holding, and the show never moved.
//
// The device ids the cases deliver as are the services' own spellings, written out here
// rather than derived from the code under test: `midi-in:<port name>` is what
// `MidiInputService` publishes for a cable and `midi-tcp:<host:port>` what `MidiTcpService`
// publishes for the desk's socket, and a case that computed them would agree with a wrong
// spelling instead of failing on it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useDeskButtons } from './useDeskButtons'
import { useStore } from '../store'
import { defaultShowSettings, type DeskSettings } from '../../../shared/show'
import type { MidiMessageKind } from '../../../shared/cue'
import type { ShowEvent } from '../../../shared/show'

/** The port a desk on a cable arrives on, and the name its own messages carry. */
const PORT = 'IAC Bus 1'
/** Another port of the same machine: set up in the show, and not where the desk is. */
const OTHER_PORT = 'IAC Bus 2'
/** The address of a desk on the network: the show's `host`/`tcpPort`, as one string. */
const HOST = '127.0.0.1'
const TCP_PORT = 51325
const SOCKET = `${HOST}:${TCP_PORT}`
/** Another address a socket row could name: a second desk, or the desk's other service. */
const OTHER_SOCKET = `${HOST}:${TCP_PORT + 1}`
/** The MIDI note the show's GO key transmits, on a desk whose soft key sends one. */
const GO_NOTE = 60
/** The mute group the show's GO key toggles, on the route that reports groups. */
const GO_GROUP = 1

/** Two scenes, so a press is visible as the step it made and a swallowed one is not. */
const SCENES = [
  { id: 's-1', name: 'Wedding', dcas: [], notes: '' },
  { id: 's-2', name: 'Interval', dcas: [], notes: '' }
]

/** The desk a case is about: an SQ, whose profile is the one that offers both routes. */
function desk(patch: Partial<DeskSettings>): DeskSettings {
  return { ...defaultShowSettings().desk, profile: 'sq', midiChannel: 1, ...patch }
}

/** A desk whose only assignment is its GO key's note: what the note cases drive. */
const GO_ON_NOTE = { buttons: { go: null, back: null, goNote: GO_NOTE, backNote: null } }
/** A desk whose only assignment is its GO mute group: what the group case primes. */
const GO_ON_GROUP = { buttons: { go: GO_GROUP, back: null, goNote: null, backNote: null } }

/** A key press, or its release, as the desk transmits one. */
function note(device: string, down = true): ShowEvent {
  return {
    kind: 'midi',
    at: 1,
    device,
    message: { kind: down ? 'noteOn' : 'noteOff', channel: 1, note: GO_NOTE, velocity: down ? 0x7f : 0 }
  }
}

/** One group's state, as an SQ reports it: page 04's NRPN, absolute form. */
function group(device: string, on: boolean): ShowEvent[] {
  const messages: MidiMessageKind[] = [
    { kind: 'cc', channel: 1, controller: 0x63, value: 0x04 },
    { kind: 'cc', channel: 1, controller: 0x62, value: GO_GROUP - 1 },
    { kind: 'cc', channel: 1, controller: 0x06, value: 0x00 },
    { kind: 'cc', channel: 1, controller: 0x26, value: on ? 0x01 : 0x00 }
  ]
  return messages.map(message => ({ kind: 'midi', at: 1, device, message }))
}

/**
 * A device row going online or offline, as a service publishes one: `midi-in:<port name>` or
 * `midi-tcp:<host:port>`, with the service id the row's own prefix names — the shape both
 * services actually publish, rather than the cable's label on a socket's row.
 */
function deviceRow(id: string, online: boolean): ShowEvent {
  return {
    kind: 'device',
    at: 1,
    device: {
      id,
      service: id.slice(0, id.indexOf(':')),
      name: id,
      model: 'MIDI input',
      online,
      lastSeen: 1
    }
  }
}

function Harness() {
  useDeskButtons()
  return null
}

describe('useDeskButtons', () => {
  let container: HTMLDivElement
  let root: Root
  let emit: ((events: ShowEvent[]) => void) | null

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    vi.mocked(window.cuerunner.show.onEvents).mockImplementation(callback => {
      emit = callback
      return () => {
        if (emit === callback) emit = null
      }
    })

    useStore.setState({
      cues: [],
      log: [],
      // Where the desk was left: nothing has been sent to it yet, so both facts are
      // unknown and the first press writes what it needs.
      deskState: { mutes: {}, assignments: {} },
      deskSceneId: null
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllMocks()
  })

  /** The show the case is about, as the store holds it, with the hook reading it. */
  function mount(deskSettings: DeskSettings): void {
    useStore.setState(s => ({
      showSettings: { ...s.showSettings, desk: deskSettings, scenes: { list: SCENES, allowDuplicateAssignment: true } }
    }))
    act(() => { root.render(<Harness />) })
  }

  /**
   * What the main process does: hand a batch to whatever is listening on the bridge.
   *
   * A press sets a recall going, and the recall writes its line once the desk has answered
   * — one awaited send at a time — so the delivery is awaited too: a case reads the log
   * after it, and a case that did not wait would be reading a show that had not moved yet.
   */
  async function deliver(events: ShowEvent[]): Promise<void> {
    if (emit === null) throw new Error('nothing is subscribed to the show bus')
    await act(async () => { emit!(events) })
  }

  /**
   * The scenes the show has stepped onto, by the name the recall's own line carries: a press
   * moves the walk on, and a swallowed press is a name that never appears.
   */
  function stepped(): string[] {
    return useStore.getState().log
      .map(entry => /^Scene "(.+)" —/.exec(entry.message)?.[1] ?? null)
      .filter((name): name is string => name !== null)
  }

  /** How many times the app has asked the desk where its groups stand. */
  function asks(): number {
    return vi.mocked(window.cuerunner.midi.send).mock.calls.length
  }

  it('lets the next press through when a key was held while a port desk was unplugged', async () => {
    // A desk on a cable, its GO key on a note: the desk transmits only while the key is
    // down, so the note-off is the release — and the port going away is the one event that
    // can take that release with it. The reader has to start over there, or the operator's
    // next press is the repeat of a key nobody is holding and the show never moves.
    mount(desk({ kind: 'midi', midiPort: PORT, ...GO_ON_NOTE }))

    await deliver([note(PORT)])
    await deliver([deviceRow(`midi-in:${PORT}`, false)])
    await deliver([note(PORT)])

    expect(stepped()).toEqual(['Wedding', 'Interval'])
  })

  it('reads a repeat as a repeat while the key really is still down', async () => {
    // The other half of the same latch, and the reason the reset is the desk's own row: a
    // key that is genuinely held transmits again, and that repeat is not a second press.
    mount(desk({ kind: 'midi', midiPort: PORT, ...GO_ON_NOTE }))

    await deliver([note(PORT)])
    await deliver([note(PORT)])

    expect(stepped()).toEqual(['Wedding'])
  })

  it('resets on the desk’s socket too, the other row a desk arrives under', async () => {
    // A desk on the network publishes `midi-tcp:<host:port>`; the spelling is the only thing
    // that differs — a socket that has gone down cannot release a key either.
    mount(desk({ kind: 'midi-tcp', host: HOST, tcpPort: TCP_PORT, ...GO_ON_NOTE }))

    await deliver([note(SOCKET)])
    await deliver([deviceRow(`midi-tcp:${SOCKET}`, false)])
    await deliver([note(SOCKET)])

    expect(stepped()).toEqual(['Wedding', 'Interval'])
  })

  it('leaves the latch alone when a port that is not the desk’s own goes away', async () => {
    // A second port of the same machine — a console's own cable, say — is not where the desk
    // is, and clearing the desk's latch for it would read a repeat as a press.
    mount(desk({ kind: 'midi', midiPort: PORT, ...GO_ON_NOTE }))

    await deliver([note(PORT)])
    await deliver([deviceRow(`midi-in:${OTHER_PORT}`, false)])
    await deliver([note(PORT)])

    expect(stepped()).toEqual(['Wedding'])
  })

  it('leaves the latch alone when another socket goes away', async () => {
    // The socket spelling is the desk's own only at the desk's own address, so the row is
    // keyed on the link the show named rather than on the `midi-tcp:` prefix: another
    // address leaving would otherwise clear this desk's latch and read a repeat as a press.
    mount(desk({ kind: 'midi-tcp', host: HOST, tcpPort: TCP_PORT, ...GO_ON_NOTE }))

    await deliver([note(SOCKET)])
    await deliver([deviceRow(`midi-tcp:${OTHER_SOCKET}`, false)])
    await deliver([note(SOCKET)])

    expect(stepped()).toEqual(['Wedding'])
  })

  it('primes the groups again when the desk’s port goes away and comes back', async () => {
    // A group is a movement, so what the reader remembers has to be the desk's state — and a
    // message lost while the port was down leaves that memory wrong: the report that follows
    // would read as the operator's hand rather than as where the room stands. The port's own
    // rows clear it, so the report primes; only the return asks, because a port that has just
    // left has no desk behind it to answer.
    mount(desk({ kind: 'midi', midiPort: PORT, ...GO_ON_GROUP }))

    // The desk's own report, the way it answers a get or a connect: group 1 is off, which is
    // where the room was left.
    await deliver(group(PORT, false))
    expect(stepped()).toEqual([])
    const askedAtStart = asks()

    await deliver([deviceRow(`midi-in:${PORT}`, false)])
    expect(asks(), 'nothing is asked of a port that has just left').toBe(askedAtStart)

    await deliver([deviceRow(`midi-in:${PORT}`, true)])
    expect(asks(), 'the port came back, so the show asks where its groups stand').toBe(askedAtStart + 1)

    await deliver(group(PORT, true))
    expect(stepped(), 'the report after a reset primes rather than presses').toEqual([])

    // And the reader is alive: the movement after that report is a press, which is what makes
    // the emptiness above the priming rather than a reader that stopped reading.
    await deliver(group(PORT, false))
    expect(stepped()).toEqual(['Wedding'])
  })
})
