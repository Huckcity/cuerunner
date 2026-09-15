// The show the desk-button spec drives: three cues, and a desk whose mute groups 5 and 6
// have been assigned to the operator's GO and BACK keys.
//
// Written as a workspace file rather than typed into the view, because the desk's address is
// the peer's ephemeral port — and because the buttons are what a show file carries, which is
// the point: the operator sets two fields, assigns the groups to keys at the desk, and the
// show runs from the surface.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** The mute groups the show runs from, as the desk's own panel numbers them. */
export const GO_GROUP = 5
export const BACK_GROUP = 6

export interface DeskButtonsShowOptions {
  /** The peer's port: where the show's desk is. */
  port: number
  /** The channel the desk is set to, and the one the show is told it is. */
  channel: number
}

export const DESK_BUTTONS_SHOW_NAME = 'Desk Buttons Show'

export function writeDeskButtonsShow(options: DeskButtonsShowOptions): string {
  const { port, channel } = options
  const root = mkdtempSync(join(tmpdir(), 'winslab-desk-buttons-'))
  const path = join(root, `${DESK_BUTTONS_SHOW_NAME}.wlab`)

  const cue = (number: number, name: string) => ({
    id: `w-${number}`,
    number: String(number),
    name,
    type: 'wait',
    colorLabel: 'none',
    parentId: null,
    preWait: 0,
    postWait: 0,
    timelineOffset: 0,
    duration: 200,
    advance: 'none',
    isArmed: true,
    notes: ''
  })

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
        midiChannel: channel,
        host: '127.0.0.1',
        port: 8000,
        tcpPort: port,
        address: '/dca/{n}/on',
        buttons: { go: GO_GROUP, back: BACK_GROUP }
      },
      cast: { channels: [], performers: [], ensembles: [], dcas: [] }
    },
    cues: [cue(1, 'One'), cue(2, 'Two'), cue(3, 'Three')]
  }, null, 2)}\n`)

  return path
}
