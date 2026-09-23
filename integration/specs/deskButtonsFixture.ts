// The show the desk-button spec drives: two scenes over one mic, and a desk whose mute groups
// 5 and 6 have been assigned to the operator's GO and BACK keys — and whose soft keys 1 and 2
// are set to transmit notes 48 and 49. Both routes run the show's scenes from the surface; the
// notes are the keys that do not latch.
//
// Written as a workspace file rather than typed into the view, because the desk's address is
// the peer's ephemeral port — and because the buttons are what a show file carries, which is
// the point: the operator sets four fields, assigns the groups to keys and sets two soft keys
// to MIDI Note at the desk, and the show's scenes are run from the surface.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultShowSettings } from '../../src/shared/show'

/** The mute groups the show runs from, as the desk's own panel numbers them. */
export const GO_GROUP = 5
export const BACK_GROUP = 6

/** The notes the desk's soft keys transmit: soft key 1 is C3, 0x30, and they run upward. */
export const GO_NOTE = 0x30
export const BACK_NOTE = 0x31

/** The channel the desk is set to, and the one the show is told it is. */
export const CHANNEL = 1

export interface DeskButtonsShowOptions {
  /** The peer's port: where the show's desk is. */
  port: number
}

export const DESK_BUTTONS_SHOW_NAME = 'Desk Buttons Show'

export function writeDeskButtonsShow(options: DeskButtonsShowOptions): string {
  const { port } = options
  const root = mkdtempSync(join(tmpdir(), 'cuerunner-desk-buttons-'))
  const path = join(root, `${DESK_BUTTONS_SHOW_NAME}.cuerunner`)
  // Every section this build declares, then what this show says about them: the load funnel
  // refuses a settings object that leaves one out, so a fixture carrying a hand-picked few
  // would be a file this build cannot read at all.
  const defaults = defaultShowSettings()

  writeFileSync(path, `${JSON.stringify({
    version: 1,
    id: 'w-desk-buttons',
    name: DESK_BUTTONS_SHOW_NAME,
    createdAt: '2026-01-01T00:00:00.000Z',
    audioSettings: { outputDeviceId: 'default' },
    midiSettings: { outputPortName: '' },
    showSettings: {
      ...defaults,
      desk: {
        ...defaults.desk,
        kind: 'midi-tcp',
        profile: 'sq',
        midiPort: '',
        midiChannel: CHANNEL,
        host: '127.0.0.1',
        port: 8000,
        tcpPort: port,
        address: '/dca/{n}/on',
        buttons: { go: GO_GROUP, back: BACK_GROUP, goNote: GO_NOTE, backNote: BACK_NOTE }
      },
      cast: {
        // A channel is a name and a number: the fader it rides is the scene's, so a strip
        // carries no assignment (AD-26) and the desk's own numbers live on the faders.
        channels: [{ id: 'ch-1', name: 'Ruth' }],
        performers: [{ id: 'p-1', name: 'Ruth', role: 'lead', notes: '', channelId: 'ch-1' }],
        ensembles: [],
        dcas: [{ id: 'dca-1', label: 'DCA 1', deskNumber: null }]
      },
      // Two scenes over one mic: the walk the desk's keys drive is this list, in this order.
      // The first places the mic on the fader — the membership a recall writes, and the
      // reason the desk has it open — and the second places nothing.
      scenes: {
        list: [
          {
            id: 's-1',
            name: 'Wedding',
            dcas: [{ dcaId: 'dca-1', channels: ['ch-1'], ensembles: [], excluded: [] }],
            notes: ''
          },
          { id: 's-2', name: 'Interval', dcas: [], notes: '' }
        ],
        allowDuplicateAssignment: true
      }
    },
    cues: []
  }, null, 2)}\n`)

  return path
}
