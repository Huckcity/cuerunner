import { readFileSync } from 'node:fs'
import { writeFileAtomically } from '../workspace/recovery'
import { DEFAULT_PLACEMENT, type OutputPlacement } from '../../shared/visual'
import type { TimerWindowState } from '../../shared/ipc/output'

/**
 * Where this machine puts each of a show's outputs, and the only place that is read or
 * written.
 *
 * Kept beside `license.key` and `redundancy.json` rather than in the workspace: a show is
 * rehearsed on a laptop with one screen and run on a rig with three projectors, and which
 * display an output goes to is a fact about the machine it is running on (spine AD-14). The
 * show keeps its outputs — names, sizes, the warp each projector needs — and this keeps their
 * places, by output id, so the same file opens correctly on both.
 *
 * The floating timer lives here too: it is the operator's, on the operator's screen.
 */
export interface MachinePlacements {
  placement(outputId: string): OutputPlacement
  place(outputId: string, placement: OutputPlacement): Promise<OutputPlacement>
  timerWindow(): TimerWindowState
  setTimerWindow(state: TimerWindowState): Promise<TimerWindowState>
}

interface StoredPlacements {
  outputs: Record<string, OutputPlacement>
  timerWindow: TimerWindowState
}

/** How many outputs' places are kept: a machine that has run many shows forgets the oldest. */
export const MAX_KEPT_PLACEMENTS = 64

const DEFAULT_TIMER_WINDOW: TimerWindowState = { open: false, mode: 'remaining' }

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** A stored placement this build can use, or the default for one it cannot. */
export function normalizePlacement(value: unknown): OutputPlacement {
  if (typeof value !== 'object' || value === null) return { ...DEFAULT_PLACEMENT }
  const raw = value as Partial<OutputPlacement>
  const bounds = raw.bounds
  const goodBounds = typeof bounds === 'object' && bounds !== null &&
    finite(bounds.x) && finite(bounds.y) && finite(bounds.width) && finite(bounds.height) &&
    bounds.width >= 16 && bounds.height >= 16
  return {
    displayId: finite(raw.displayId) ? raw.displayId : null,
    displayLabel: typeof raw.displayLabel === 'string' ? raw.displayLabel.slice(0, 200) : '',
    fullscreen: raw.fullscreen === true,
    bounds: goodBounds ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : null
  }
}

function normalizeTimerWindow(value: unknown): TimerWindowState {
  if (typeof value !== 'object' || value === null) return { ...DEFAULT_TIMER_WINDOW }
  const raw = value as Partial<TimerWindowState>
  const mode = raw.mode === 'clock' || raw.mode === 'elapsed' || raw.mode === 'remaining' ? raw.mode : DEFAULT_TIMER_WINDOW.mode
  return { open: raw.open === true, mode }
}

export interface MachinePlacementsOptions {
  filePath: string
  /** Test seam for a file that is not there or not readable. */
  readFile?: (path: string) => string
  /** Test seam for the write. */
  writeFile?: (path: string, text: string) => Promise<void>
}

export function createMachinePlacements(options: MachinePlacementsOptions): MachinePlacements {
  const read = options.readFile ?? ((path: string) => readFileSync(path, 'utf8'))
  const write = options.writeFile ?? writeFileAtomically

  const stored = ((): StoredPlacements => {
    try {
      const text = read(options.filePath)
      // Bounded: the file is this machine's own, and a few dozen entries is all it ever
      // holds — anything larger is not a file this build wrote.
      if (text.length > 1024 * 1024) return { outputs: {}, timerWindow: { ...DEFAULT_TIMER_WINDOW } }
      const parsed = JSON.parse(text) as Partial<StoredPlacements> | null
      const outputs: Record<string, OutputPlacement> = {}
      if (parsed && typeof parsed.outputs === 'object' && parsed.outputs !== null) {
        for (const [id, placement] of Object.entries(parsed.outputs).slice(-MAX_KEPT_PLACEMENTS)) {
          outputs[id] = normalizePlacement(placement)
        }
      }
      return { outputs, timerWindow: normalizeTimerWindow(parsed?.timerWindow) }
    } catch {
      // Missing or unreadable: every output opens as a window until it is placed.
      return { outputs: {}, timerWindow: { ...DEFAULT_TIMER_WINDOW } }
    }
  })()

  const state: StoredPlacements = stored

  const persist = async (): Promise<void> => {
    const ids = Object.keys(state.outputs)
    if (ids.length > MAX_KEPT_PLACEMENTS) {
      for (const id of ids.slice(0, ids.length - MAX_KEPT_PLACEMENTS)) delete state.outputs[id]
    }
    await write(options.filePath, `${JSON.stringify(state, null, 2)}\n`)
  }

  return {
    placement: outputId => state.outputs[outputId] ?? { ...DEFAULT_PLACEMENT },
    async place(outputId, placement) {
      const normalized = normalizePlacement(placement)
      // Re-inserted, so the newest placement is the last to be forgotten.
      delete state.outputs[outputId]
      state.outputs[outputId] = normalized
      await persist()
      return normalized
    },
    timerWindow: () => state.timerWindow,
    async setTimerWindow(next) {
      state.timerWindow = normalizeTimerWindow(next)
      await persist()
      return state.timerWindow
    }
  }
}
