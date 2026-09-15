// The show the desk-button spec drives: two scenes over one mic, and a desk whose mute groups
// 5 and 6 have been assigned to the operator's GO and BACK keys.
//
// Written as a workspace file rather than typed into the view, because the desk's address is
// the peer's ephemeral port — and because the buttons are what a show file carries, which is
// the point: the operator sets two fields, assigns the groups to keys at the desk, and the
// show's scenes are run from the surface.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** The mute groups the show runs from, as the desk's own panel numbers them. */
export const GO_GROUP = 5
export const BACK_GROUP = 6

/** The channel the desk is set to, and the one the show is told it is. */
export const CHANNEL = 1

export interface DeskButtonsShowOptions {
  /** The peer's port: where the show's desk is. */
  port: number
}

export const DESK_BUTTONS_SHOW_NAME = 'Desk Buttons Show'

export function writeDeskButtonsShow(options: DeskButtonsShowOptions): string {
  const { port } = options
  const root = mkdtempSync(join(tmpdir(), 'winslab-desk-buttons-'))
  const path = join(root, `${DESK_BUTTONS_SHOW_NAME}.wlab`)

  writeFileSync(path, `${JSON.stringify({
    version: 1,
    id: 'w-desk-buttons',
    name: DESK_BUTTONS_SHOW_NAME,
    createdAt: '2026-01-01T00:00:00.000Z',
    audioSettings: { outputDeviceId: 'default' },
    midiSettings: { outputPortName: '' },
    showSettings: {
      desk: {
        kind: 'midi-tcp',
        profile: 'sq',
        midiPort: '',
        midiChannel: CHANNEL,
        host: '127.0.0.1',
        port: 8000,
        tcpPort: port,
        address: '/dca/{n}/on',
        buttons: { go: GO_GROUP, back: BACK_GROUP }
      },
      cast: {
        channels: [{ id: 'ch-1', name: 'Ruth', dcaId: 'dca-1' }],
        performers: [{ id: 'p-1', name: 'Ruth', role: 'lead', notes: '', channelId: 'ch-1' }],
        ensembles: [],
        dcas: [{ id: 'dca-1', label: 'DCA 1', note: null, address: null }]
      },
      // Two scenes over one mic: the walk the desk's keys drive is this list, in this order.
      scenes: {
        list: [
          { id: 's-1', name: 'Wedding', live: ['p-1'], ensembles: [], excluded: [], notes: '' },
          { id: 's-2', name: 'Interval', live: [], ensembles: [], excluded: [], notes: '' }
        ]
      }
    },
    cues: []
  }, null, 2)}\n`)

  return path
}
