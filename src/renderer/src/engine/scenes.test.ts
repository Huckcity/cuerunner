// Recalling a scene is the one thing here that touches the room, so what is tested is what
// goes out on the wire, in what order, what is remembered about it, and what happens when
// the desk does not answer.
//
// Two facts go and they go in this order: the membership, then the mic's mute. The
// membership first because it is what the mute is a state *of* — and because a channel
// whose fader changed must not be muted on its way there, which is why that case asserts
// the sequence a recall left out as much as the one it sent.
//
// The controlled set is the boundary. The walk is the show's own channel list, so a channel
// the scene never mentions is not merely left alone by accident: there is no path from the
// scene to it, and the case that holds that reads the numbers the frames themselves carry.
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { recallScene } from './scenes'
import { useStore } from '../store'
import type { MidiMessageKind } from '../../../shared/cue'
import {
  ALL_CLOSED_SCENE_ID,
  defaultDeskSettings,
  defaultShowSettings,
  type CastSettings,
  type DeskMessage,
  type DeskSettings,
  type MicScene,
  type SqMembershipIntent,
  type SqRidesIntent
} from '../../../shared/show'
import type { DeskState } from '../utils/scenes'

/** The show's four strips, and the faders they are placed on. Nothing here decides either. */
function cast(): CastSettings {
  return {
    channels: [
      { id: 'ch-1', name: 'Ruth' },
      { id: 'ch-2', name: 'Sancho' },
      { id: 'ch-3', name: 'Nell' },
      { id: 'ch-4', name: '' }
    ],
    performers: [
      { id: 'p-1', name: 'Ruth', role: 'Lead', notes: '', channelId: 'ch-1' },
      { id: 'p-2', name: 'Sancho', role: 'Comic', notes: '', channelId: 'ch-2' },
      { id: 'p-3', name: 'Nell', role: '', notes: '', channelId: 'ch-3' }
    ],
    ensembles: [{ id: 'ens-1', name: 'Chorus', channelIds: ['ch-1', 'ch-2'] }],
    dcas: [1, 2, 3, 4].map(index => ({
      id: `dca-${index}`,
      deskNumber: null
    }))
  }
}

/** Ruth on the first fader, and nobody else: one placement and three closed mics. */
const WEDDING: MicScene = {
  id: 's-1',
  name: 'Wedding',
  dcas: [{ dcaId: 'dca-1', kind: 'channel', memberId: 'ch-1' }],
  notes: ''
}

/** Two placements on two faders, so a case can tell DCA order from channel order. */
const FINALE: MicScene = {
  id: 's-2',
  name: 'Finale',
  dcas: [
    { dcaId: 'dca-2', kind: 'channel', memberId: 'ch-2' },
    { dcaId: 'dca-3', kind: 'channel', memberId: 'ch-3' }
  ],
  notes: ''
}

/** Ruth moves to the third fader while she stays open: the fader-change case's scene. */
const MOVED: MicScene = {
  id: 's-3',
  name: 'Moved',
  dcas: [{ dcaId: 'dca-3', kind: 'channel', memberId: 'ch-1' }],
  notes: ''
}

/**
 * One strip placed on two faders of one scene: a recall of it writes twice about one
 * channel, in the faders' order, which is what makes the record the writes read matter.
 */
const DOUBLE: MicScene = {
  id: 's-6',
  name: 'Double',
  dcas: [
    { dcaId: 'dca-2', kind: 'channel', memberId: 'ch-2' },
    { dcaId: 'dca-4', kind: 'channel', memberId: 'ch-2' }
  ],
  notes: ''
}

/** The desk nothing has been sent to: both facts unknown, so the next recall writes them. */
const EMPTY: DeskState = { mutes: {}, assignments: {} }

/** The desk's own service, which is the one route that is not a message. */
const SQ: DeskSettings = {
  ...defaultDeskSettings(),
  kind: 'midi-tcp',
  host: '10.0.0.5',
  tcpPort: 51325,
  midiChannel: 3,
  profile: 'sq'
}

/** NRPN 40 over the desk link's MIDI, whose inputs answer on the desk's own channel. */
const AVANTIS: DeskSettings = {
  ...defaultDeskSettings(),
  kind: 'midi-tcp',
  host: '10.0.0.5',
  midiChannel: 12,
  profile: 'avantis'
}

/** The app's own arrangement: a note per strip, on the desk's own channel. */
const NOTES: DeskSettings = {
  ...defaultDeskSettings(),
  kind: 'midi',
  midiPort: 'Yamaha',
  midiChannel: 3,
  profile: 'note'
}

/** The same arrangement over OSC, where the address carries the channel's number. */
const OSC: DeskSettings = {
  ...defaultDeskSettings(),
  kind: 'osc',
  host: '10.0.0.5',
  port: 9000,
  profile: 'note'
}

function seed(
  deskState: DeskState = EMPTY,
  deskSceneId: string | null = null,
  castSettings: CastSettings = cast(),
  deskSettings: DeskSettings = SQ,
  list: MicScene[] = [WEDDING, FINALE, MOVED]
): void {
  useStore.setState({
    showSettings: {
      ...defaultShowSettings(),
      desk: deskSettings,
      cast: castSettings,
      scenes: { list, allowDuplicateAssignment: true }
    },
    deskState,
    deskSceneId,
    log: []
  })
}

/**
 * One write as a case's sequence reads it. The bytes are pinned where they are built
 * (`utils/desk.test.ts`); what a case here is about is the order they went in and which of
 * them a recall left out, so this renders a frame for the channel and the fader it names
 * rather than re-checking the table a second time.
 */
function said(message: DeskMessage): string {
  if (message.kind === 'sq-native') {
    return `SQ ch${message.channel} ${message.placed ? 'onto' : 'off'} fader ${message.dca}`
  }
  if (message.kind === 'sq-native-rides') {
    return `SQ ch${message.channel} rides ${message.highest ? 'highest of ' : ''}[${message.dcas.join(',')}] was [${message.wrote.join(',')}]`
  }
  if (message.kind === 'osc') return `OSC ${message.address} ${message.args.join(' ')}`
  return message.messages.map(frame => {
    if (frame.kind === 'cc') return `cc ${frame.controller.toString(16)} ${frame.value.toString(16)}`
    if (frame.kind === 'noteOn') return `on ${frame.note} ${frame.velocity.toString(16)}`
    if (frame.kind === 'noteOff') return `off ${frame.note} ${frame.velocity.toString(16)}`
    return frame.kind
  }).join(' | ')
}

describe('recallScene', () => {
  let midiSend: Mock
  let oscSend: Mock
  let tcpSend: Mock
  let command: Mock
  /** Every write this case sent, in the order it went, as `said` renders it. */
  let sent: string[]
  /**
   * The writes the desk refuses, by their place in the sequence from one. A seam rather
   * than a queue of once-answers, because a case is usually about one send out of a
   * handful and the rest have to go on landing.
   */
  let refused: number[]
  /** What the desk answers a refused write with, in its own words. */
  let refusal: string

  beforeEach(() => {
    sent = []
    refused = []
    refusal = 'the port is gone'
    // Every write records itself as it goes, so order is asserted on what left rather than
    // on a counter in the code under test.
    midiSend = vi.mocked(window.cuerunner.midi.send).mockImplementation(request => {
      sent.push(said({ kind: 'midi', portName: request.portName, messages: request.messages }))
      return Promise.resolve(refused.includes(sent.length) ? { ok: false, error: refusal } : { ok: true })
    })
    oscSend = vi.mocked(window.cuerunner.osc.send).mockImplementation(request => {
      sent.push(said({
        kind: 'osc',
        host: request.host,
        port: request.port,
        address: request.address,
        args: request.args.map(arg => Number(arg.value))
      }))
      return Promise.resolve(refused.includes(sent.length) ? { ok: false, error: refusal } : { ok: true })
    })
    tcpSend = vi.mocked(window.cuerunner.midi.sendTcp).mockImplementation(request => {
      sent.push(said({ kind: 'midi-tcp', host: request.host, port: request.port, messages: request.messages }))
      return Promise.resolve(refused.includes(sent.length) ? { ok: false, error: refusal } : { ok: true })
    })
    // The SQ's membership is a service command: two answers, because two things can be
    // wrong — the service never took it, or it took it and had no session to write on.
    command = vi.mocked(window.cuerunner.show.command).mockImplementation((_service, action, payload) => {
      if (action === 'rides') sent.push(said({ kind: 'sq-native-rides', ...(payload as SqRidesIntent) }))
      else sent.push(said({ kind: 'sq-native', ...(payload as SqMembershipIntent) }))
      return Promise.resolve(refused.includes(sent.length)
        ? { ok: true, result: { ok: false, error: refusal } }
        : { ok: true, result: { ok: true, frames: 4 } })
    })
    seed()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  /** What each frame a case sent names, read out of the frames rather than the record. */
  function named(): { channels: number[]; faders: number[] } {
    const channels: number[] = []
    const faders: number[] = []
    for (const call of command.mock.calls.filter(call => call[1] === 'membership')) {
      const intent = call[2] as SqMembershipIntent
      channels.push(intent.channel)
      faders.push(intent.dca)
    }
    for (const call of tcpSend.mock.calls) {
      const messages = call[0].messages as MidiMessageKind[]
      const ccs = messages.filter(
        (frame): frame is Extract<MidiMessageKind, { kind: 'cc' }> => frame.kind === 'cc')
      const notes = messages.filter(
        (frame): frame is Extract<MidiMessageKind, { kind: 'noteOn' }> => frame.kind === 'noteOn')
      // An SQ's channel mute: page 00's parameter is the strip's own number from zero.
      if (ccs.length === 4) channels.push(ccs[1].value + 1)
      // An Avantis: NRPN 40's first byte is the input, its value the fader's own place.
      else if (ccs.length === 3) {
        channels.push(ccs[0].value + 1)
        faders.push(ccs[2].value >= 0x40 ? ccs[2].value - 0x40 + 1 : ccs[2].value + 1)
      } else if (notes.length > 0) channels.push(notes[0].note + 1)
    }
    for (const call of midiSend.mock.calls) {
      const [frame] = call[0].messages as MidiMessageKind[]
      if (frame.kind === 'noteOn' || frame.kind === 'noteOff') channels.push(frame.note)
    }
    for (const call of oscSend.mock.calls) {
      // The address carries the channel's number wherever the show's own pattern put it.
      const digits = /\d+/.exec(String(call[0].address))
      if (digits !== null) channels.push(Number(digits[0]))
    }
    return { channels, faders }
  }

  function logMessages(): string[] {
    return useStore.getState().log.map(entry => entry.message)
  }

  it('sends the membership first, in the faders’ own order, one awaited send at a time', async () => {
    // The membership goes first because it is what the mute is a state *of*, and in the
    // faders' own order because that is the order the desk's DCAs are numbered in. The
    // sequence below is the whole of it: two placements, then a mute per channel that
    // moves — the two placed ones open, the two the scene places nowhere closed.
    let landed = 0
    const first = Promise.withResolvers<{ ok: boolean; result?: unknown }>()
    command.mockImplementationOnce((_service, _action, payload) => {
      const intent = payload as SqMembershipIntent
      sent.push(said({ kind: 'sq-native', ...intent }))
      landed += 1
      return first.promise
    })

    const recall = recallScene('s-2')
    for (let i = 0; i < 10; i++) await Promise.resolve()
    // One awaited send at a time: the second write has not left while the first is owed an
    // answer, which is also what keeps the record meaningful.
    expect(sent).toEqual(['SQ ch2 onto fader 2'])
    expect(landed).toBe(1)

    first.resolve({ ok: true, result: { ok: true, frames: 4 } })
    const result = await recall

    expect(result.failures).toEqual([])
    expect(sent).toEqual([
      'SQ ch2 onto fader 2',
      'SQ ch3 onto fader 3',
      // One mute per channel, in the order of the first fader each rides: the two the
      // scene places, then the two it does not, in the show's own channel order.
      'cc 63 0 | cc 62 1 | cc 6 0 | cc 26 0',
      'cc 63 0 | cc 62 2 | cc 6 0 | cc 26 0',
      'cc 63 0 | cc 62 0 | cc 6 0 | cc 26 1',
      'cc 63 0 | cc 62 3 | cc 6 0 | cc 26 1'
    ])
    expect(useStore.getState().deskSceneId).toBe('s-2')
    expect(logMessages()).toEqual(['Scene "Finale" — 2 opened, 2 closed'])
  })

  it('merges each success into the record as it lands, never from the copy the recall read', async () => {
    // A recall can be overtaken: two scene cues at one timeline offset, a batch of
    // triggers, an operator pressing the next button while the desk is still answering.
    // The record therefore follows the desk as the sends land — a record written from the
    // copy read before them belongs to whichever recall finishes last, which is not the
    // order the desk heard, and a fact it gets wrong is never told anything again.
    const first = Promise.withResolvers<{ ok: boolean; result?: unknown }>()
    const second = Promise.withResolvers<{ ok: boolean; result?: unknown }>()
    command
      .mockImplementationOnce((_service, _action, payload) => {
        sent.push(said({ kind: 'sq-native', ...(payload as SqMembershipIntent) }))
        return first.promise
      })
      .mockImplementationOnce((_service, _action, payload) => {
        sent.push(said({ kind: 'sq-native', ...(payload as SqMembershipIntent) }))
        return second.promise
      })

    const recall = recallScene('s-2')
    first.resolve({ ok: true, result: { ok: true, frames: 4 } })
    for (let i = 0; i < 10; i++) await Promise.resolve()

    // The first placement is on the desk and said so, while the seconds' mutes are still
    // owed: what landed is what the record holds, mid-recall.
    expect(useStore.getState().deskState).toEqual({
      mutes: {},
      assignments: { 'ch-2': ['dca-2'] }
    })

    second.resolve({ ok: true, result: { ok: true, frames: 4 } })
    await recall
    expect(useStore.getState().deskState).toEqual({
      mutes: { 'ch-2': false, 'ch-3': false, 'ch-1': true, 'ch-4': true },
      assignments: { 'ch-2': ['dca-2'], 'ch-3': ['dca-3'] }
    })

    // And the same test with the copy taken away for good: a scene that places one strip on
    // two faders makes two writes about one channel, so the second is computed from the
    // record the first just wrote. Read from the copy this recall was handed, the second
    // would leave the record holding the second fader alone while the strip rides both —
    // and the desk's own fader 2 would be told nothing about it ever again.
    seed(EMPTY, null, cast(), SQ, [DOUBLE])
    sent.length = 0
    await recallScene('s-6')

    expect(sent.filter(line => line.startsWith('SQ '))).toEqual([
      'SQ ch2 onto fader 2',
      'SQ ch2 onto fader 4'
    ])
    expect(useStore.getState().deskState.assignments['ch-2']).toEqual(['dca-2', 'dca-4'])
  })

  it('leaves the first write recorded when a later one fails, and the next recall retries only the rest', async () => {
    // The state that was remembered is only the state that got there, so the next recall
    // tries again for the rest — and not for what already landed.
    refused = [2]
    refusal = 'no session'

    const result = await recallScene('s-2')

    expect(result.failures).toEqual([
      'Ch 3 · Nell → DCA 3: SQ assign ch3 onto DCA 3 — no session'
    ])
    expect(useStore.getState().deskState).toEqual({
      mutes: { 'ch-2': false, 'ch-3': false, 'ch-1': true, 'ch-4': true },
      assignments: { 'ch-2': ['dca-2'] }
    })
    expect(logMessages()).toEqual([
      'Scene "Finale" — 2 opened, 2 closed',
      'Could not reach the desk: Ch 3 · Nell → DCA 3: SQ assign ch3 onto DCA 3; why: no session'
    ])

    // The desk is willing now: what is left is the one placement that never landed, and
    // neither the placement that did nor any of the four mutes is sent again.
    refused = []
    sent.length = 0
    const second = await recallScene('s-2')

    expect(second.failures).toEqual([])
    expect(sent).toEqual(['SQ ch3 onto fader 3'])
    expect(useStore.getState().deskState.assignments).toEqual({
      'ch-2': ['dca-2'],
      'ch-3': ['dca-3']
    })
  })

  it('addresses nothing outside the show’s channel list, on any desk and any shape', async () => {
    // The bound. A scene can name a strip the show does not have and a fader it does not
    // have — a file written against a longer console, a channel deleted since — and no
    // message anywhere may name either: the walk is the show's own channel list, so what
    // is not in it is not reachable from a recall at all. Each desk is asked, because each
    // addresses a channel differently, and the numbers are read out of the frames.
    const shapes: MicScene[] = [
      WEDDING,
      FINALE,
      { id: 's-4', name: 'Empty', dcas: [], notes: '' },
      {
        id: 's-5',
        name: 'Phantom',
        dcas: [
          { dcaId: 'dca-2', kind: 'channel', memberId: 'ch-9' },
          { dcaId: 'dca-9', kind: 'channel', memberId: 'ch-2' }
        ],
        notes: ''
      }
    ]

    for (const desk of [SQ, AVANTIS, NOTES, OSC]) {
      for (const scene of shapes) {
        seed(EMPTY, null, cast(), desk, [...shapes])
        midiSend.mockClear()
        oscSend.mockClear()
        tcpSend.mockClear()
        command.mockClear()
        sent.length = 0

        await recallScene(scene.id)
        const { channels, faders } = named()
        const where = `${desk.profile} over ${desk.kind}, scene ${scene.id}`

        expect(channels.length, `${where}: nothing was sent at all`).toBeGreaterThan(0)
        expect(channels.every(number => number >= 1 && number <= 4),
          `${where} named channels outside 1–4: ${channels.join(', ')}`).toBe(true)
        expect(faders.every(number => number >= 1 && number <= 4),
          `${where} named faders outside 1–4: ${faders.join(', ')}`).toBe(true)
      }
    }
  })

  it('sends no mute for a channel that changes fader while it stays open', async () => {
    // "Keeps playing" is the app's half only: the desk moves a channel between faders
    // without a mute, so the recall must not compose one. The sequence is the assertion —
    // the record says Ruth is open, the scene opens her on another fader, and the two
    // writes that go are the clear and the place.
    seed({
      mutes: { 'ch-1': false, 'ch-2': true, 'ch-3': true, 'ch-4': true },
      assignments: { 'ch-1': ['dca-1'], 'ch-2': [], 'ch-3': [], 'ch-4': [] }
    })

    const result = await recallScene('s-3')

    expect(sent).toEqual(['SQ ch1 off fader 1', 'SQ ch1 onto fader 3'])
    expect(tcpSend).not.toHaveBeenCalled()
    expect(result.changes).toEqual([
      { channelId: 'ch-1', label: 'Ch 1 · Ruth', open: true, dcas: ['dca-3'] }
    ])
    expect(logMessages()).toEqual(['Scene "Moved" — 1 moved'])
  })

  it('refuses a cue pointed at no scene, rather than reading it as the whole stage off', async () => {
    // A cue pointed at nothing is a missing button, and closing every mic would be the
    // loudest possible reading of it.
    seed({ mutes: { 'ch-1': false }, assignments: { 'ch-1': ['dca-1'] } }, 's-3')

    const result = await recallScene(null)

    expect(result.failures).toEqual(['no scene chosen — nothing was sent to the desk'])
    expect(result.changes).toEqual([])
    expect(sent).toEqual([])
    expect(useStore.getState().deskState.assignments).toEqual({ 'ch-1': ['dca-1'] })
    expect(useStore.getState().deskSceneId).toBe('s-3')
    expect(useStore.getState().log).toEqual([
      expect.objectContaining({ level: 'error', message: 'no scene chosen — nothing was sent to the desk' })
    ])
  })

  it('reads the all-closed column as a real recall that closes the controlled set', async () => {
    // Every mic closed is somewhere the desk can be left, so it is remembered as a place
    // rather than as nothing: a view that said "nothing recalled" after the mics went off
    // would be wrong about the one thing it is there to say.
    seed({
      mutes: { 'ch-1': false, 'ch-2': true, 'ch-3': false, 'ch-4': true },
      assignments: { 'ch-1': ['dca-1'], 'ch-2': [], 'ch-3': ['dca-3'], 'ch-4': [] }
    })

    const result = await recallScene(ALL_CLOSED_SCENE_ID)

    expect(result.sceneName).toBeNull()
    // The two channels the record had on faders are taken off them, and the two the record
    // believes are open are muted: the ones it already knows are closed are not told again.
    expect(sent).toEqual([
      'SQ ch1 off fader 1',
      'SQ ch3 off fader 3',
      'cc 63 0 | cc 62 0 | cc 6 0 | cc 26 1',
      'cc 63 0 | cc 62 2 | cc 6 0 | cc 26 1'
    ])
    expect(useStore.getState().deskState).toEqual({
      mutes: { 'ch-1': true, 'ch-2': true, 'ch-3': true, 'ch-4': true },
      assignments: { 'ch-1': [], 'ch-2': [], 'ch-3': [], 'ch-4': [] }
    })
    expect(useStore.getState().deskSceneId).toBe(ALL_CLOSED_SCENE_ID)
    expect(logMessages()).toEqual(['Mics closed — 2 channels'])
  })

  it('tells a channel left off one of its faders that it still rides another', async () => {
    // A clear carries the channel's own fact as the write leaves it: a channel on two faders
    // that the scene keeps on one is not a channel that rides nothing, and telling the desk
    // it does would take it off the fader the show still wants it on. The record is seeded
    // with both faders, and the scene places the channel on one.
    const scene: MicScene = {
      id: 's-1',
      name: 'Wedding',
      dcas: [
        { dcaId: 'dca-1', kind: 'channel', memberId: 'ch-1' }
      ],
      notes: ''
    }
    seed({ mutes: { 'ch-1': false }, assignments: { 'ch-1': ['dca-1', 'dca-2'] } }, 's-1', cast(), SQ, [scene])

    await recallScene('s-1')

    // The clear comes first, and it carries the channel's fact as that write leaves it: it
    // rides fader 1, so the flag says it still rides a fader. The mutes that follow are the
    // channels the record has never heard of, which the scene places nowhere.
    expect(sent[0]).toBe('SQ ch1 off fader 2')
    expect(command.mock.calls[0][2]).toEqual({ channel: 1, dca: 2, placed: false, rides: true })
  })

  it('records nothing when the service never took the membership', async () => {
    // An outer refusal is the command never reaching the service at all — not running, not
    // licensed — and the write must not be remembered as landed: a record that says the
    // desk holds an assignment it never heard is a diff that will never offer it again.
    command.mockImplementation(() => Promise.resolve({ ok: false, error: 'the service is not running' }))
    seed({ mutes: { 'ch-1': true }, assignments: { 'ch-1': [] } }, 's-1', cast(), SQ)

    await recallScene('s-1')

    const failures = logMessages().filter(line => line.startsWith('Could not reach the desk'))
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('SQ assign ch1 onto DCA 1')
    expect(failures[0]).toContain('the service is not running')
    expect(useStore.getState().deskState.assignments['ch-1']).toEqual([])
  })

  it('reports the gap by name on a desk with no membership route, while the mute still goes', async () => {
    // The app's own arrangement and OSC take no assignment at all, so a silent gap would
    // be a recall that half worked and said nothing about the half that did not. The mute
    // reaches the desk with the channel's own number in it, on each profile's own terms.
    const quiet = [
      {
        desk: NOTES,
        error: 'a note desk takes no assignment',
        frame: { portName: 'Yamaha', messages: [{ kind: 'noteOn', channel: 3, note: 1, velocity: 127 }] }
      },
      {
        desk: OSC,
        error: 'OSC takes no assignment',
        frame: { host: '10.0.0.5', port: 9000, address: '/dca/1/on', args: [{ type: 'i', value: 1 }] }
      }
    ] as const

    for (const { desk, error, frame } of quiet) {
      seed(EMPTY, null, cast(), desk)

      const result = await recallScene('s-1')

      expect(result.failures, `a refusal is not a failure`).toEqual([])
      expect(logMessages()).toEqual([
        'Scene "Wedding" — 1 opened, 3 closed',
        `Cannot be told to this desk — Ch 1 · Ruth → DCA 1: ${error}`
      ])
      // The mute went, and it is the channel's — the first strip, not the first fader.
      expect(desk.kind === 'midi' ? midiSend : oscSend).toHaveBeenCalledWith(frame)
      expect(useStore.getState().deskState).toEqual({
        mutes: { 'ch-1': false, 'ch-2': true, 'ch-3': true, 'ch-4': true },
        // Nothing is recorded as written: the one placement was never sent.
        assignments: {}
      })
    }
  })

  it('refuses a placement past the desk’s DCA list by name, and the rest still runs', async () => {
    // Nine strips on an SQ, which has eight DCAs: the ninth fader cannot be told to this
    // desk at all — a different thing from a desk that did not answer — so it is named and
    // the mics still move.
    const nine: CastSettings = {
      channels: Array.from({ length: 9 }, (_, index) => ({ id: `ch-${index + 1}`, name: '' })),
      performers: [],
      ensembles: [],
      dcas: Array.from({ length: 9 }, (_, index) => ({
        id: `dca-${index + 1}`,
        deskNumber: null
      }))
    }
    const ninth: MicScene = {
      id: 's-9',
      name: 'Ninth',
      dcas: [{ dcaId: 'dca-9', kind: 'channel', memberId: 'ch-9' }],
      notes: ''
    }
    seed(EMPTY, null, nine, SQ, [ninth])

    const result = await recallScene('s-9')

    expect(result.failures).toEqual([])
    // The ninth channel is open, so its mute goes too — by its own number, on page 00.
    expect(sent[0]).toBe('cc 63 0 | cc 62 8 | cc 6 0 | cc 26 0')
    expect(sent).toHaveLength(9)
    expect(command).not.toHaveBeenCalled()
    expect(logMessages()).toEqual([
      'Scene "Ninth" — 1 opened, 8 closed',
      'Cannot be told to this desk — Ch 9 → DCA 9: an SQ has eight DCAs'
    ])
    // Nothing is remembered as written for the fader that cannot be told one: the next
    // recall tries it again.
    expect(useStore.getState().deskState.assignments).toEqual({})
  })

  it('names a send the desk refused in the log, and the rest of the recall continues', async () => {
    // A desk that did not answer is a different thing from one that cannot be told, and
    // the engine's own sentence travels with the write it was for: what failed and why are
    // two halves of one fact.
    const socket: DeskSettings = { ...NOTES, kind: 'midi-tcp', host: '10.0.0.5', tcpPort: 51325 }
    refusal = 'The desk at 10.0.0.5:51325 accepted the connection and then reset it'
      + ' — something else may be holding its MIDI port'
    refused = [2]
    seed(EMPTY, null, cast(), socket)

    const result = await recallScene('s-1')

    expect(result.failures).toEqual([
      `Ch 2 · Sancho: noteOff ch3 → 10.0.0.5:51325 — ${refusal}`
    ])
    // Whatever landed is remembered and whatever did not is not, so the next recall tries
    // the rest again: the recording is what a recall's base is.
    expect(useStore.getState().deskState.mutes).toEqual({
      'ch-1': false,
      'ch-3': true,
      'ch-4': true
    })
    expect(logMessages()).toEqual([
      'Scene "Wedding" — 1 opened, 3 closed',
      'Cannot be told to this desk — Ch 1 · Ruth → DCA 1: a note desk takes no assignment',
      `Could not reach the desk: Ch 2 · Sancho: noteOff ch3 → 10.0.0.5:51325; why: ${refusal}`
    ])

    refused = []
    sent.length = 0
    await recallScene('s-1')
    expect(sent).toEqual(['off 2 0'])
  })

  it('says nothing to a desk that is already where the scene wants it', async () => {
    // The diff is against two facts per channel, so a show whose desk already carries the
    // scene is a recall of no messages at all.
    seed({
      mutes: { 'ch-1': false, 'ch-2': true, 'ch-3': true, 'ch-4': true },
      assignments: { 'ch-1': ['dca-1'], 'ch-2': [], 'ch-3': [], 'ch-4': [] }
    })

    const result = await recallScene('s-1')

    expect(result.changes).toEqual([])
    expect(sent).toEqual([])
    expect(useStore.getState().deskSceneId).toBe('s-1')
    expect(logMessages()).toEqual(['Scene "Wedding" — desk already set'])
  })

  it('refuses a scene that is gone rather than closing the stage', async () => {
    // Deleting a scene leaves the cues that pointed at it pointing at nothing, and reading
    // that as "close everything" would mute the whole stage on the next GO.
    seed({ mutes: { 'ch-1': false }, assignments: { 'ch-1': ['dca-1'] } }, 's-3')

    const result = await recallScene('s-deleted')

    expect(result.failures).toEqual(['no scene by that id — it may have been deleted (s-deleted)'])
    expect(sent).toEqual([])
    expect(useStore.getState().deskState.assignments).toEqual({ 'ch-1': ['dca-1'] })
    expect(useStore.getState().deskSceneId).toBe('s-3')
  })

  describe('when the highest fader wins', () => {
    /** The show with highest wins asked for, on whatever desk and list the case seeded. */
    function highest(): void {
      const { showSettings } = useStore.getState()
      useStore.setState({
        showSettings: { ...showSettings, scenes: { ...showSettings.scenes, highestWins: true } }
      })
    }

    /** Sancho alone, on the third fader: a channel main was following, taken back to one. */
    const SINGLE: MicScene = {
      id: 's-7',
      name: 'Single',
      dcas: [{ dcaId: 'dca-3', kind: 'channel', memberId: 'ch-2' }],
      notes: ''
    }

    it('hands main a channel on two faders as one write naming both, then the mutes', async () => {
      // An SQ adds the offsets of every DCA a channel is on; main keeps it on the highest
      // one instead, so the recall's word for it is the faders rather than the pairs.
      seed(EMPTY, null, cast(), SQ, [DOUBLE])
      highest()

      await recallScene('s-6')

      expect(sent).toEqual([
        'SQ ch2 rides highest of [2,4] was []',
        'cc 63 0 | cc 62 1 | cc 6 0 | cc 26 0',
        'cc 63 0 | cc 62 0 | cc 6 0 | cc 26 1',
        'cc 63 0 | cc 62 2 | cc 6 0 | cc 26 1',
        'cc 63 0 | cc 62 3 | cc 6 0 | cc 26 1'
      ])
      // The record keeps what the scene asked — both faders — because that is what the next
      // recall is a difference from; which one the desk holds this moment is main's.
      expect(useStore.getState().deskState.assignments['ch-2']).toEqual(['dca-2', 'dca-4'])
      expect(logMessages()).toEqual(['Scene "Double" — 1 opened, 3 closed'])
    })

    it('puts a followed channel back through main when the scene takes it to one fader', async () => {
      // The record says both faders, but main may have taken the channel off either: the
      // pairs a diff would write here are against a fader the desk may not hold, so the
      // channel goes back through main, which knows which one it is on.
      seed(
        { mutes: { 'ch-2': false }, assignments: { 'ch-2': ['dca-2', 'dca-4'] } },
        's-6', cast(), SQ, [DOUBLE, SINGLE]
      )
      highest()

      await recallScene('s-7')

      expect(sent.filter(line => line.startsWith('SQ '))).toEqual(['SQ ch2 rides highest of [3] was [2,4]'])
      expect(useStore.getState().deskState.assignments['ch-2']).toEqual(['dca-3'])
    })

    it('writes pairs as before for a channel on one fader', async () => {
      seed()
      highest()

      await recallScene('s-1')

      expect(sent.filter(line => line.startsWith('SQ '))).toEqual(['SQ ch1 onto fader 1'])
    })

    it('writes pairs on a desk main cannot follow', async () => {
      // An Avantis's DCA levels have not been measured, so the show's ask is not acted on:
      // the channel rides both faders, as the desk adds them.
      seed(EMPTY, null, cast(), AVANTIS, [DOUBLE])
      highest()

      await recallScene('s-6')

      expect(command).not.toHaveBeenCalled()
      expect(useStore.getState().deskState.assignments['ch-2']).toEqual(['dca-2', 'dca-4'])
    })

    it('leaves the record alone when main does not take the channel', async () => {
      seed(EMPTY, null, cast(), SQ, [DOUBLE])
      highest()
      refused = [1]
      refusal = 'the SQ session is not up'

      const result = await recallScene('s-6')

      expect(result.failures).toEqual([
        'Ch 2 · Sancho: SQ ch2 rides the highest of DCA 2, 4 — the SQ session is not up'
      ])
      expect(useStore.getState().deskState.assignments['ch-2']).toBeUndefined()
    })
  })
})
