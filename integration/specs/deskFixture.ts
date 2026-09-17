// The show the desk specs drive, written as a workspace file rather than typed into the
// view. Two reasons: the desk's address is the peer's ephemeral port, which no form can be
// told to use, and the connection is what these specs are about — the form that sets it has
// its own spec (e2e/desk-tcp.spec.ts).
//
// One channel, one DCA, one scene, and one cue that answers to the desk. That is the whole
// show: a scene recall on a one-mic show is a handful of messages, so what went on the wire
// can be read at a glance instead of fished out of a sweep of twelve.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DeskProfile } from '../../src/renderer/src/types/show'

export interface DeskShowOptions {
  /** The peer's port: where the show's desk is. */
  port: number
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
}

/** What the show is called, so a spec's failure names something an operator would say. */
export const DESK_SHOW_NAME = 'Desk Show'

export function writeDeskShow(options: DeskShowOptions): string {
  const { port, channel, profile, dcaNote, deskScene = 7 } = options
  const root = mkdtempSync(join(tmpdir(), 'cuerunner-desk-'))
  const path = join(root, `${DESK_SHOW_NAME}.cuerunner`)
  const device = `127.0.0.1:${port}`

  writeFileSync(path, `${JSON.stringify({
    version: 1,
    id: 'w-desk',
    name: DESK_SHOW_NAME,
    createdAt: '2026-01-01T00:00:00.000Z',
    audioSettings: { outputDeviceId: 'default' },
    midiSettings: { outputPortName: '' },
    showSettings: {
      desk: {
        kind: 'midi-tcp',
        profile,
        midiPort: '',
        midiChannel: channel,
        host: '127.0.0.1',
        port: 8000,
        tcpPort: port,
        address: '/dca/{n}/on'
      },
      cast: {
        channels: [{ id: 'ch-1', name: 'Ruth', dcaId: 'dca-1' }],
        performers: [
          { id: 'p-1', name: 'Ruth', role: 'lead', notes: '', channelId: 'ch-1' }
        ],
        ensembles: [],
        dcas: [{ id: 'dca-1', label: 'DCA 1', note: dcaNote ?? null, address: null }]
      },
      scenes: {
        list: [
          { id: 's-1', name: 'Wedding', live: ['p-1'], ensembles: [], excluded: [], notes: '' }
        ]
      }
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
      }
    ]
  }, null, 2)}\n`)

  return path
}
