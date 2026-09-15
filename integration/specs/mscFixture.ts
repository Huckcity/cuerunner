// The show the show control spec drives: one cue that tells a desk's cue list to GO, and
// one that answers the desk when it GOes on its own.
//
// Written as a workspace file rather than typed into the view, for the same reason the
// desk show is: the desk's address is the peer's ephemeral port, which no form can be told
// to use, and what these specs are about is the conversation rather than the setting.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
  const root = mkdtempSync(join(tmpdir(), 'winslab-msc-'))
  const path = join(root, `${MSC_SHOW_NAME}.wlab`)

  writeFileSync(path, `${JSON.stringify({
    version: 1,
    id: 'w-msc',
    name: MSC_SHOW_NAME,
    createdAt: '2026-01-01T00:00:00.000Z',
    audioSettings: { outputDeviceId: 'default' },
    midiSettings: { outputPortName: '' },
    showSettings: {
      desk: {
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
        name: 'Desk called a cue',
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
            // The desk's own socket, reported the way MidiTcpService names it.
            id: 't-msc',
            kind: 'msc',
            device: `127.0.0.1:${port}`,
            deviceId: 127,
            format: 'all',
            command: 'go',
            cueNumber: cue,
            cueList: ''
          }
        ]
      }
    ]
  }, null, 2)}\n`)

  return path
}
