// This machine's half of OSC: which network interface the show listens for OSC on, and which
// one its OSC cues send out of. Facts about the machine, not the show (AD-14) — a show carried
// to another desk listens on that desk's network — so they live beside the licence in
// `osc.json`, like the lighting's interface in `dmx.json`.
//
// An interface is remembered by name and by the address it had when it was chosen, and found
// again by either (`resolveBinding`), so a renamed adapter and a renewed lease are both still
// found. One that is on neither is reported, and the socket goes unpinned rather than not at all.

import { readFileSync, statSync } from 'node:fs'
import { writeFileAtomically } from '../workspace/recovery'
import type { OscDirection, OscMachineSettings } from '../../shared/ipc/osc'

/** The file is a handful of fields: anything larger is not a file this machine wrote. */
const MAX_MACHINE_FILE_BYTES = 64 * 1024

export interface MachineOsc {
  current(): OscMachineSettings
  /** Pins one direction to an interface — by name, with the address it has now — or unpins it. */
  update(direction: OscDirection, name: string | null, address: string | null): Promise<OscMachineSettings>
}

const UNPINNED: OscMachineSettings = {
  inputInterface: null,
  inputAddress: null,
  outputInterface: null,
  outputAddress: null
}

function text(value: unknown, pattern?: RegExp): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) return null
  return pattern === undefined || pattern.test(value) ? value : null
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/

function normalize(stored: Partial<OscMachineSettings> | null): OscMachineSettings {
  if (stored === null) return { ...UNPINNED }
  const inputInterface = text(stored.inputInterface)
  const outputInterface = text(stored.outputInterface)
  return {
    inputInterface,
    inputAddress: inputInterface === null ? null : text(stored.inputAddress, IPV4),
    outputInterface,
    outputAddress: outputInterface === null ? null : text(stored.outputAddress, IPV4)
  }
}

export function createMachineOsc(options: { filePath?: string } = {}): MachineOsc {
  const stored = ((): Partial<OscMachineSettings> | null => {
    if (options.filePath === undefined) return null
    try {
      // Bounded before it is read: a file this size is not this machine's.
      if (statSync(options.filePath).size > MAX_MACHINE_FILE_BYTES) return null
      const parsed: unknown = JSON.parse(readFileSync(options.filePath, 'utf8'))
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Partial<OscMachineSettings>)
        : null
    } catch {
      // Missing or unreadable: the machine starts unpinned, which is what it always did.
      return null
    }
  })()
  let settings = normalize(stored)

  return {
    current: () => settings,
    async update(direction, name, address) {
      settings = normalize(direction === 'in'
        ? { ...settings, inputInterface: name, inputAddress: address }
        : { ...settings, outputInterface: name, outputAddress: address })
      if (options.filePath !== undefined) {
        await writeFileAtomically(options.filePath, `${JSON.stringify(settings, null, 2)}\n`)
      }
      return settings
    }
  }
}
