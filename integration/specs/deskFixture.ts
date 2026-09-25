// The show the desk specs drive, written as a workspace file rather than typed into the
// view. Two reasons: the desk's address is the counterpart's — the peer's ephemeral port
// here, a real desk's own address on the hardware lane (`host`) — which no form can be told
// to use, and the connection is what these specs are about: the form that sets it has its
// own spec (e2e/desk-tcp.spec.ts).
//
// One channel, one fader and one cue that answers to the desk by default — plus, where a lane
// asks for them, a controlled set of channels, the faders its scenes place them on, a second
// scene for the desk's own keys to walk to and a cue that answers a console's show control
// command. That is the whole show: the scene owns the assignment, so it places its channels on
// its faders and says nothing else, and a recall of it is a handful of messages — which is what
// lets what went on the wire be read at a glance instead of fished out of a sweep of twelve.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultShowSettings } from '../../src/shared/show'
import type { DeskButtons, DeskProfile } from '../../src/shared/show'
import type { MscCommand, MscFormat } from '../../src/shared/cue'

/** Where a peer on this machine is. A real desk is named by its own address. */
const LOOPBACK = '127.0.0.1'

/**
 * A fader a scene places channels on. The id is what a scene names it by, and the desk number
 * is what the desk is addressed with — null is the number its place derives, which is what the
 * specs assert.
 */
export interface DeskShowFader {
  id: string
  label: string
  deskNumber?: number | null
}

/**
 * One scene of the show the fixture writes: what each fader carries in it.
 *
 * A channel's number on the desk is its place in the show's own list, so a scene names a
 * channel by its id — `ch-1` is input 1 — and a fader left out of `places` carries nobody,
 * which is what makes a scene a close as well as an open.
 */
export interface DeskShowScene {
  id: string
  name: string
  /** The channels each fader carries, keyed by the fader's id. */
  places: Record<string, string[]>
}

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
   * what the specs assert: the derivation is under test, not a fixture's arithmetic. It is
   * the default fader's number; a show with faders of its own gives each one its own.
   */
  dcaNote?: number
  /**
   * The show's controlled set: one entry per channel, in the desk's own order, whose name is
   * what the strip is called. A channel's number on the desk is its place here, so a show of
   * nine channels is inputs 1 to 9 and a scene names them by their place (`ch-1` upward).
   * Left out, the one channel the desk show has always had.
   */
  channels?: string[]
  /**
   * The faders the show's scenes place channels on. Left out, the one DCA 1 the desk specs
   * have always driven, numbered by `dcaNote` where a show overrides it.
   */
  faders?: DeskShowFader[]
  /**
   * The scenes, when a lane needs placements of its own: a show can carry more than the one
   * the specs recall by hand, and the scenes it does carry are what makes a recall a change.
   * Left out, the one scene that places the first channel on the first fader — or, where
   * `buttons` is given, that scene and the one the desk's own keys walk to.
   */
  scenes?: DeskShowScene[]
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
  const channels = options.channels ?? ['Ruth']
  const faders = options.faders ?? [{ id: DCA_ID, label: 'DCA 1', deskNumber: dcaNote ?? null }]
  // A channel's number on the desk is its place in this list, so the ids are the places.
  const strips = channels.map((name, index) => ({ id: `ch-${index + 1}`, name }))
  // A scene names its faders and its channels by id, so an id the show does not declare would
  // drop a placement silently — and the lane that asked for it would assert against a show
  // that places nobody. What the show declares is the boundary, and nothing outside it is
  // written into a file that is then read as though it meant something.
  if (strips.length === 0) throw new Error('a desk show has at least one channel: `channels` is empty')
  if (faders.length === 0) throw new Error('a desk show has at least one fader: `faders` is empty')
  for (const scene of options.scenes ?? []) {
    for (const [faderId, placed] of Object.entries(scene.places)) {
      if (!faders.some(fader => fader.id === faderId)) {
        throw new Error(
          `scene "${scene.id}" places channels on "${faderId}", which this show declares no fader for (${faders.map(fader => fader.id).join(', ')})`
        )
      }
      for (const channelId of placed) {
        if (!strips.some(strip => strip.id === channelId)) {
          throw new Error(
            `scene "${scene.id}" places "${channelId}", which this show declares no channel for (${strips.map(strip => strip.id).join(', ')})`
          )
        }
      }
    }
  }
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
  // places the first channel on the first fader — which is the membership a recall writes and
  // the reason the mic is open — and the second places nothing, so a recall of it is a close.
  // A lane that needs placements of its own names its scenes instead.
  const defaults = defaultShowSettings()
  // A row holds one thing (the show's shape), so a fader a lane puts two mics on carries a
  // group the fixture declares in the cast — the same membership the desk is told, written as
  // the grouping it is. A fader with one channel carries the channel itself.
  const groups: { id: string; name: string; channelIds: string[] }[] = []
  const member = (sceneName: string, fader: DeskShowFader, channelIds: string[]) => {
    if (channelIds.length === 1) return { kind: 'channel' as const, memberId: channelIds[0] }
    const id = `g-${groups.length + 1}`
    groups.push({ id, name: `${sceneName} · ${fader.label}`, channelIds })
    return { kind: 'ensemble' as const, memberId: id }
  }
  const placed = { dcaId: faders[0].id, ...member('Wedding', faders[0], [CHANNEL_ID]) }
  const defaultScenes = buttons === undefined
    ? [{ id: 's-1', name: 'Wedding', dcas: [placed], notes: '' }]
    : [
        { id: 's-1', name: 'Wedding', dcas: [placed], notes: '' },
        { id: 's-2', name: 'Interval', dcas: [], notes: '' }
      ]
  const scenes = options.scenes?.map(scene => ({
    id: scene.id,
    name: scene.name,
    // A fader with nobody on it is left out of the scene rather than written as an empty row,
    // which is the shape the editor writes and the shape a recall reads.
    dcas: faders
      .filter(fader => (scene.places[fader.id] ?? []).length > 0)
      .map(fader => ({ dcaId: fader.id, ...member(scene.name, fader, scene.places[fader.id]) })),
    notes: ''
  })) ?? defaultScenes

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
        // never the strip's (AD-26), so there is no assignment on the channel at all. The
        // number is the channel's place in this list, which is the input's own number.
        channels: strips,
        performers: [
          { id: 'p-1', name: 'Ruth', role: 'lead', notes: '', channelId: CHANNEL_ID }
        ],
        // A group holds strips, so this is where the ones a row rides are declared.
        ensembles: groups,
        // One number for a fader, and null is the number its place derives: an override is
        // the desk's own numbering rather than a second way of writing the place down.
        dcas: faders.map(fader => ({
          id: fader.id,
          deskNumber: fader.deskNumber ?? null
        }))
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
