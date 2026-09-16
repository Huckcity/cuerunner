// The show the console specs drive, written as a workspace file. It is deliberately the
// same show for both counterparts — the peer in `eos.spec.ts` and a real console in
// `eos-vendor.spec.ts` — because the app must not be able to tell them apart, and a
// counterpart that needs the show set up differently would be one the app can.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface EosShowOptions {
  /** Where the console is: the peer's port, or the port a real console listens on. */
  consoleHost: string
  consolePort: number
  /**
   * The show's own OSC input. A console sends to the destination configured in *its*
   * setup — it cannot be told where to answer — so this is the field an operator fills in
   * at the desk, and the reason the fixture has to know the port before it starts.
   */
  oscInPort: number
  /** The cue the show fires in the console, by number, in cue list 1. */
  cue: number
}

export const EOS_SHOW_NAME = 'Eos Show'

/** What a console says when a cue runs: the address the show's answering cue listens for. */
export function firedAddress(cue: number): string {
  return `/eos/out/event/cue/1/${cue}/fire`
}

/** What a console answers with when asked who it is. */
export const VERSION_ANSWER = '/eos/out/get/version'

export function writeEosShow(options: EosShowOptions): string {
  const { consoleHost, consolePort, oscInPort, cue } = options
  const root = mkdtempSync(join(tmpdir(), 'cuerunner-eos-'))
  const path = join(root, `${EOS_SHOW_NAME}.wlab`)
  const base = {
    colorLabel: 'none',
    preWait: 0,
    postWait: 0,
    timelineOffset: 0,
    advance: 'none',
    isArmed: true,
    refire: 'ignore',
    parentId: null,
    notes: ''
  }

  writeFileSync(path, `${JSON.stringify({
    version: 1,
    id: 'w-eos',
    name: EOS_SHOW_NAME,
    createdAt: '2026-01-01T00:00:00.000Z',
    audioSettings: { outputDeviceId: 'default' },
    midiSettings: { outputPortName: '' },
    showSettings: {
      oscIn: { enabled: true, port: oscInPort }
    },
    // GO is de-duplicated by the trigger guard, deliberately: two presses inside the window
    // are one firing, which is what a bouncing footswitch or a held Space bar looks like. A
    // spec presses GO far more often than an operator ever would, so the guard is turned off
    // here — it has its own spec (e2e/trigger-guard.spec.ts), and a test about the console
    // should not be silently swallowed by a rule it is not testing.
    triggerGuard: { windowMs: 0 },
    cues: [
      {
        ...base,
        id: 'osc-1',
        number: '1',
        name: 'Blackout',
        type: 'osc',
        duration: 0,
        host: consoleHost,
        port: consolePort,
        address: `/eos/cue/1/${cue}/fire`,
        args: []
      },
      {
        ...base,
        id: 'w-1',
        number: '2',
        name: 'After the console says so',
        type: 'wait',
        duration: 50,
        // What the console says when a cue runs. Two of them: one for the cue this show
        // fires, and one for the cue the console's own GO fires — which the peer lane can
        // make happen and a real console's front panel makes happen.
        triggers: [
          { id: 't-1', kind: 'osc', address: firedAddress(cue) },
          { id: 't-2', kind: 'osc', address: firedAddress(cue + 1) }
        ]
      },
      {
        ...base,
        id: 'osc-2',
        number: '3',
        name: 'Who are you',
        type: 'osc',
        duration: 0,
        host: consoleHost,
        port: consolePort,
        address: '/eos/get/version',
        args: []
      }
    ]
  }, null, 2)}\n`)

  return path
}
