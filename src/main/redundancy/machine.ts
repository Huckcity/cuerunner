import { readFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { randomUUID } from 'node:crypto'
import { writeFileAtomically } from '../workspace/recovery'
import {
  normalizeRedundancySettings,
  type RedundancySettings
} from '../../shared/redundancy'

/**
 * This machine's half of a redundant pair, and the only place it is read or written.
 *
 * It lives in a file of its own in the user-data folder rather than in the workspace, and
 * for a sharp reason: both machines of a pair run the *same*
 * workspace file, so a role or a partner's address kept in the show would be read as the
 * same answer by both of them. Which machine is the main and where the other one is are
 * facts about the machines, and the showfile travels between them.
 */
export interface MachineRedundancy {
  current(): RedundancySettings
  /**
   * Applies a patch and writes it down. The name and the id are the machine's own and
   * are never changed by a patch: the id is how the pair resolves its two sockets, and
   * a new one would make this machine a stranger to the partner that was talking to it.
   */
  update(patch: Partial<RedundancySettings>): Promise<RedundancySettings>
}

export interface MachineRedundancyOptions {
  /** Where the settings are kept between runs. */
  filePath: string
  /** What this machine calls itself when nobody has said: its host name. */
  name?: string
  /** Test seam for the id minted on first run. */
  id?: string
  /** Test seam for a file that is not there or not readable. */
  readFile?: (path: string) => string
}

export function createMachineRedundancy(options: MachineRedundancyOptions): MachineRedundancy {
  const read = options.readFile ?? ((path: string) => readFileSync(path, 'utf8'))
  const machineName = options.name ?? hostname() ?? 'cuerunner'
  const mintedId = options.id ?? randomUUID()

  const stored = ((): Partial<RedundancySettings> | null => {
    try {
      const text = read(options.filePath)
      if (text.trim() === '') return null
      const parsed: unknown = JSON.parse(text)
      // A file that is not an object is a file this machine did not write; the
      // normalizer below turns anything else into the settings a new machine starts on.
      return typeof parsed === 'object' && parsed !== null ? (parsed as Partial<RedundancySettings>) : null
    } catch {
      // Missing, unreadable or corrupt: a show must still open, and the redundancy
      // settings it opens with are the defaults rather than a failure to start.
      return null
    }
  })()

  let settings = normalizeRedundancySettings(stored ?? undefined, { name: machineName, id: mintedId })

  return {
    current: () => settings,

    async update(patch: Partial<RedundancySettings>): Promise<RedundancySettings> {
      settings = normalizeRedundancySettings({ ...settings, ...patch }, {
        name: machineName,
        id: settings.id
      })
      await writeFileAtomically(options.filePath, `${JSON.stringify(settings, null, 2)}\n`)
      return settings
    }
  }
}
