// This machine's own half of the lighting: which network interface its DMX goes out of, and
// who it is on the wire — the sACN component identifier receivers tell sources apart by, and
// the name they show. Facts about the machine, not the show (AD-14): a show carried to another
// desk goes out of that desk's own interface, and two machines running one show must not claim
// to be the same source.

import { readFileSync, statSync } from 'node:fs'
import { hostname } from 'node:os'
import { randomUUID } from 'node:crypto'
import { writeFileAtomically } from '../workspace/recovery'

export interface DmxMachineSettings {
  /** The interface chosen, by name, or null to let the OS route. */
  interfaceName: string | null
  /** Its address when it was chosen, so a renamed adapter is still found. */
  interfaceAddress: string | null
  /** The sACN CID, a UUID minted on first run and kept. */
  cid: string
  /** What receivers show this source as. */
  sourceName: string
}

/** The file is a handful of fields: anything larger is not a file this machine wrote. */
const MAX_MACHINE_FILE_BYTES = 64 * 1024

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface MachineDmx {
  current(): DmxMachineSettings
  /**
   * Writes the settings down if this machine has never done so: the CID minted on a first run
   * has to be the same one the next run sends with, or every restart is a new source to every
   * receiver on the network.
   */
  remember(): Promise<void>
  update(patch: Partial<Pick<DmxMachineSettings, 'interfaceName' | 'interfaceAddress' | 'sourceName'>>): Promise<DmxMachineSettings>
}

export interface MachineDmxOptions {
  /** Where the settings are kept between runs; none keeps them for this run only. */
  filePath?: string
  /** Test seam for the CID minted on first run. */
  cid?: string
}

function normalize(stored: Partial<DmxMachineSettings> | null, mintedCid: string): DmxMachineSettings {
  const name = typeof stored?.interfaceName === 'string' && stored.interfaceName.length <= 128 ? stored.interfaceName : null
  const address =
    typeof stored?.interfaceAddress === 'string' && /^\d{1,3}(\.\d{1,3}){3}$/.test(stored.interfaceAddress)
      ? stored.interfaceAddress
      : null
  const sourceName =
    typeof stored?.sourceName === 'string' && stored.sourceName.trim() !== '' && stored.sourceName.length <= 63
      ? stored.sourceName
      : `Cuerunner (${hostname() || 'this machine'})`.slice(0, 63)
  return {
    interfaceName: name,
    interfaceAddress: name === null ? null : address,
    cid: typeof stored?.cid === 'string' && UUID.test(stored.cid) ? stored.cid : mintedCid,
    sourceName
  }
}

export function createMachineDmx(options: MachineDmxOptions = {}): MachineDmx {
  const minted = options.cid ?? randomUUID()
  const stored = ((): Partial<DmxMachineSettings> | null => {
    if (options.filePath === undefined) return null
    try {
      // Bounded before it is read: a file this size is not this machine's.
      if (statSync(options.filePath).size > MAX_MACHINE_FILE_BYTES) return null
      const parsed: unknown = JSON.parse(readFileSync(options.filePath, 'utf8'))
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Partial<DmxMachineSettings>)
        : null
    } catch {
      // Missing or unreadable: the machine starts unpinned, with a CID of its own.
      return null
    }
  })()
  let settings = normalize(stored, minted)
  let written = stored !== null && stored.cid === settings.cid

  const write = async (): Promise<void> => {
    if (options.filePath === undefined) return
    await writeFileAtomically(options.filePath, `${JSON.stringify(settings, null, 2)}\n`)
    written = true
  }

  return {
    current: () => settings,
    async remember() {
      if (!written) await write()
    },
    async update(patch) {
      settings = normalize({ ...settings, ...patch }, settings.cid)
      await write()
      return settings
    }
  }
}
