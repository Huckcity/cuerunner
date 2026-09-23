// The show the desk specs drive, written as a workspace file rather than typed into the
// view. Two reasons: the desk's address is the counterpart's — the peer's ephemeral port
// here, a real desk's own address on the hardware lane (`host`) — which no form can be told
// to use, and the connection is what these specs are about: the form that sets it has its
// own spec (e2e/desk-tcp.spec.ts).
//
// One channel, one fader and one cue that answers to the desk — plus, where a lane asks for
// them, a second scene for the desk's own keys to walk to and a cue that answers a console's
// show control command. That is the whole show: the scene owns the assignment, so it places
// its one channel on the one fader and says nothing else, and a recall of it is a handful of
// messages — which is what lets what went on the wire be read at a glance instead of fished
// out of a sweep of twelve.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultShowSettings } from '../../src/shared/show'
import type { DeskButtons, DeskProfile } from '../../src/shared/show'
import type { MscCommand, MscFormat } from '../../src/shared/cue'

/** Where a peer on this machine is. A real desk is named by its own address. */
const LOOPBACK = '127.0.0.1'

/** What every desk show has in common, whichever way the show reaches its desk. */
interface DeskShowCommon {
  /**
   * Where the desk is: loopback when the counterpart is a peer running here, and the
   * desk's own address when a real one is named. That address is the only thing the
   * hardware lane changes about the show (INTEGRATION-HARNESS.md §10, M3).
   */
  host?: string
  /**
   * The MIDI channel both ends are set to: the desk's own, 1–16 as its Utility screen
   * shows it. Where its DCAs answer is derived from that by the profile.
   */
  channel: number
  /** What the desk takes as an open and a close — the range the peer is standing in for. */
  profile: DeskProfile
  /**
   * A DCA number override, for a show that has been told its desk numbers its faders
   * differently. Left out, DCA 1 is addressed the way the profile derives it, which is
   * what the specs assert: the derivation is under test, not a fixture's arithmetic.
   */
  dcaNote?: number
  /**
   * The scene the desk recalls of its own accord in the desk-originated case, and the cue
   * that answers to it. It is transmitted as bank select + program change on the base
   * channel, so the trigger matches the program the doc's numbering makes: scene 7 is
   * program 6.
   */
  deskScene?: number
  /**
   * The buttons an operator has assigned at the desk. The lanes that pass this assign the
   * mute groups only — the note route has its own fixture (`deskButtonsFixture.ts`) — but
   * the shape is the show's own, so a field added to it cannot go missing here: what the
   * caller names is written over every field the show declares, the unassigned ones as null.
   */
  buttons?: Partial<DeskButtons>
  /**
   * A console on a MIDI cable: the MIDI input port its cable appears as on this machine,
   * and the show control command it transmits. The show listens on that port and carries
   * one more cue that answers the command — the only place an `msc` trigger can be driven
   * end to end, because no peer here is a console on a cable (INTEGRATION-HARNESS.md §3,
   * G2, and §10's M3).
   */
  msc?: MscInput
}

/**
 * The show the desk specs drive. A desk is reached one of two ways, and the fields that name
 * it are the ones that way needs: the desk's own MIDI socket, or a MIDI port of this machine —
 * which is the route an operator with A&H MIDI Control's virtual port takes (`AH_MIDI_PORT` on
 * the vendor lane).
 */
export type DeskShowOptions =
  | (DeskShowCommon & {
      kind?: 'midi-tcp'
      /** The counterpart's port: where the show's desk is on the network. */
      port: number
    })
  | (DeskShowCommon & {
      kind: 'midi'
      /**
       * The MIDI port the show drives its desk through — and, because a bridge carries both
       * directions, the port the show listens on for the desk's own messages.
       */
      midiPort: string
    })

/** A console's own show control command, as the run then tells the show to expect it. */
export interface MscInput {
  /** The port name the console's cable appears as, as the machine's MIDI list reports it. */
  port: string
  /**
   * What the console transmits with. A show control trigger compares the device ID, the
   * format, the command and the cue exactly, so this is the console's own setting rather than
   * a device this end can address: a console set to another ID fires nothing.
   */
  deviceId: number
  /** What the console addresses its command to. */
  format: MscFormat
  command: MscCommand
  /** The cue it names, and its cue list; empty means whatever the console has open. */
  cueNumber: string
  cueList: string
}

/** What the show is called, so a spec's failure names something an operator would say. */
export const DESK_SHOW_NAME = 'Desk Show'

/** The one channel's id, and the one fader's: what a scene's placement names. */
export const CHANNEL_ID = 'ch-1'
export const DCA_ID = 'dca-1'

export function writeDeskShow(options: DeskShowOptions): string {
  const { host = LOOPBACK, channel, profile, dcaNote, buttons, msc, deskScene = 7 } = options
  const root = mkdtempSync(join(tmpdir(), 'cuerunner-desk-'))
  const path = join(root, `${DESK_SHOW_NAME}.cuerunner`)
  // What the desk's own messages arrive as: a socket's `host:port`, or the name of the port
  // the show drives it through.
  const device = options.kind === 'midi' ? options.midiPort : `${host}:${options.port}`
  // A show driven through a MIDI port listens on the same port — a virtual port is the one
  // thing an operator has, and the desk's answers come back the way its instructions went out.
  // A console's cable is a port of its own, and a show can be listening to both.
  const inputs = [
    ...(options.kind === 'midi' ? [options.midiPort] : []),
    ...(msc === undefined ? [] : [msc.port])
  ]
  // A show the desk's own keys walk needs a second scene to walk to; a show the specs
  // recall by hand has the one, and the peer lane asserts on that one. The first scene
  // places the channel on the fader — which is the membership a recall writes and the
  // reason the mic is open — and the second places nothing, so a recall of it is a close.
  const defaults = defaultShowSettings()
  const placed = { dcaId: DCA_ID, channels: [CHANNEL_ID], ensembles: [], excluded: [] }
  const scenes = buttons === undefined
    ? [{ id: 's-1', name: 'Wedding', dcas: [placed], notes: '' }]
    : [
        { id: 's-1', name: 'Wedding', dcas: [placed], notes: '' },
        { id: 's-2', name: 'Interval', dcas: [], notes: '' }
      ]

  writeFileSync(path, `${JSON.stringify({
    version: 1,
    id: 'w-desk',
    name: DESK_SHOW_NAME,
    createdAt: '2026-01-01T00:00:00.000Z',
    audioSettings: { outputDeviceId: 'default' },
    midiSettings: { outputPortName: '' },
    // Every section this build declares, then what this show says about them: the load
    // funnel refuses a settings object that leaves one out, so a fixture carrying a
    // hand-picked few would be a file this build cannot read at all.
    showSettings: {
      ...defaults,
      // What the show listens to is its own decision: the desk's own socket needs no setting,
      // a port the desk is driven through is listened on for its answers, and a console's
      // cable is a port of its own.
      ...(inputs.length === 0 ? {} : { midiIn: { enabled: true, portNames: inputs } }),
      desk: {
        ...defaults.desk,
        kind: options.kind ?? 'midi-tcp',
        profile,
        midiChannel: channel,
        address: '/dca/{n}/on',
        // Where the desk is, in the fields that way of reaching it uses.
        ...(options.kind === 'midi'
          ? { midiPort: options.midiPort }
          : { midiPort: '', host, port: 8000, tcpPort: options.port }),
        ...(buttons === undefined ? {} : { buttons: { ...defaults.desk.buttons, ...buttons } })
      },
      cast: {
        // A channel is a name and a number: which fader it rides is the scene's decision and
        // never the strip's (AD-26), so there is no assignment on the channel at all.
        channels: [{ id: CHANNEL_ID, name: 'Ruth' }],
        performers: [
          { id: 'p-1', name: 'Ruth', role: 'lead', notes: '', channelId: CHANNEL_ID }
        ],
        ensembles: [],
        // One number for the fader, and null is the number its place derives: an override is
        // the desk's own numbering rather than a second way of writing the place down.
        dcas: [{ id: DCA_ID, label: 'DCA 1', deskNumber: dcaNote ?? null }]
      },
      // The scenes own the assignment, and the field beside them is not optional on disk:
      // the load funnel reads every declared field, so a file that left it out would be one
      // this build refuses rather than one it completes.
      scenes: { list: scenes, allowDuplicateAssignment: true }
    },
    cues: [
      {
        id: 'w-1',
        number: '1',
        name: 'Desk called a scene',
        type: 'wait',
        colorLabel: 'none',
        preWait: 0,
        postWait: 0,
        timelineOffset: 0,
        duration: 50,
        advance: 'none',
        isArmed: true,
        refire: 'ignore',
        parentId: null,
        notes: '',
        triggers: [
          {
            id: 't-desk',
            kind: 'midi',
            device,
            message: { kind: 'programChange', channel, program: deskScene - 1 }
          }
        ]
      },
      ...(msc === undefined ? [] : [{
        id: 'w-2',
        number: '2',
        name: 'Console said go',
        type: 'wait',
        colorLabel: 'none',
        preWait: 0,
        postWait: 0,
        timelineOffset: 0,
        duration: 50,
        advance: 'none',
        isArmed: true,
        refire: 'ignore',
        parentId: null,
        notes: '',
        // Every field of a show control command is identity, including the cue number: a
        // console going to cue 12 is not a console going to the next one. What the console
        // transmits is a setting on the console, so the run is what tells the show.
        triggers: [
          {
            id: 't-msc',
            kind: 'msc',
            device: msc.port,
            deviceId: msc.deviceId,
            format: msc.format,
            command: msc.command,
            cueNumber: msc.cueNumber,
            cueList: msc.cueList
          }
        ]
      }])
    ]
  }, null, 2)}\n`)

  return path
}
