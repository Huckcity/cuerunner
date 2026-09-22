// The show the show control spec drives: one cue that tells a desk's cue list to GO, and
// one that answers a button on the desk itself.
//
// Written as a workspace file rather than typed into the view, for the same reason the
// desk show is: the desk's address is the peer's ephemeral port, which no form can be told
// to use, and what these specs are about is the conversation rather than the setting.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultShowSettings } from '../../src/shared/show'

/** The soft key the show listens to — a button somebody assigned at the desk. */
export const SOFT_KEY = 3
/**
 * The note that key sends, from the SQ's document: soft keys are notes from C3 (0x30)
 * upward, one per key, "controlled using standard MIDI Note On/Off messages".
 */
export const SOFT_KEY_NOTE = 0x30 + SOFT_KEY - 1

export interface MscShowOptions {
  /** The peer's port: where the show's desk is. */
  port: number
  /** The cue the show control cue names on the receiving console. */
  cue: string
}

/** What the show is called, so a spec's failure names something an operator would say. */
export const MSC_SHOW_NAME = 'Show Control Show'

export function writeMscShow(options: MscShowOptions): string {
  const { port, cue } = options
  const root = mkdtempSync(join(tmpdir(), 'cuerunner-msc-'))
  const path = join(root, `${MSC_SHOW_NAME}.cuerunner`)
  // Every section this build declares, then what this show says about them: the load funnel
  // refuses a settings object that leaves one out, so a fixture carrying a hand-picked few
  // would be a file this build cannot read at all.
  const settings = defaultShowSettings()

  writeFileSync(path, `${JSON.stringify({
    version: 1,
    id: 'w-msc',
    name: MSC_SHOW_NAME,
    createdAt: '2026-01-01T00:00:00.000Z',
    audioSettings: { outputDeviceId: 'default' },
    midiSettings: { outputPortName: '' },
    showSettings: {
      ...settings,
      desk: {
        ...settings.desk,
        kind: 'midi-tcp',
        profile: 'sq',
        midiPort: '',
        midiChannel: 1,
        host: '127.0.0.1',
        port: 8000,
        tcpPort: port,
        address: '/dca/{n}/on'
      },
      cast: { channels: [], performers: [], ensembles: [], dcas: [] }
    },
    cues: [
      {
        id: 'm-1',
        number: '1',
        name: 'LX Go',
        type: 'msc',
        colorLabel: 'none',
        parentId: null,
        preWait: 0,
        postWait: 0,
        timelineOffset: 0,
        duration: 0,
        advance: 'none',
        isArmed: true,
        notes: '',
        // All-call and all-types, which is what a cue nobody has addressed sends: every
        // device has to answer the all-call, so the command arrives wherever it is.
        command: 'go',
        format: 'all',
        deviceId: 127,
        cueNumber: cue,
        cueList: '',
        destination: 'desk',
        portName: ''
      },
      {
        id: 'w-1',
        number: '2',
        name: 'Desk pressed a key',
        type: 'wait',
        colorLabel: 'none',
        parentId: null,
        preWait: 0,
        postWait: 0,
        timelineOffset: 0,
        duration: 200,
        advance: 'none',
        isArmed: true,
        notes: '',
        triggers: [
          {
            // The desk's own button, heard on the desk's own socket — reported the way
            // MidiTcpService names it. There is nothing show-control about this: a desk
            // has no GO key, so what a show listens to is a key somebody assigned to send
            // a MIDI note, and this is the note soft key 3 sends.
            id: 't-key',
            kind: 'midi',
            device: `127.0.0.1:${port}`,
            message: { kind: 'noteOn', channel: 1, note: SOFT_KEY_NOTE, velocity: 127 }
          }
        ]
      }
    ]
  }, null, 2)}\n`)

  return path
}
