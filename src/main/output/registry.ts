// What main knows about the show's outputs, without a window in sight: which outputs the
// show declares, which picture is on which of them, and the commands each picture has been
// given since it went up. The Electron half (OutputManager.ts) owns the windows and asks
// this what to do; this is the part the tests can hold.
//
// The record of pictures is what makes an output window disposable. The window draws, but
// main remembers: a window whose renderer dies, or one that is rebuilt because its display
// came back, reloads, says it is ready, and is handed every picture it had with the
// commands since — all on the engine clock, so it lands where it would have been rather
// than where it was when it died (spine AD-17, the window is not the system).

import type { LayerCommand, LayerSpec } from '../../shared/ipc/output'
import type { VideoOutput } from '../../shared/visual'
import { sameValue } from '../../shared/showfile'

/** The commands kept per picture past its play. A long show of live geometry edits keeps the newest. */
export const MAX_COMMANDS_PER_LAYER = 64

/** Pictures kept at once across every output: past it the oldest is forgotten (it is still drawn). */
export const MAX_LAYERS = 256

export interface OutputChange {
  added: VideoOutput[]
  /** Outputs whose declaration changed: name, size, timer or warp. */
  changed: VideoOutput[]
  removed: string[]
}

interface LayerRecord {
  spec: LayerSpec
  commands: LayerCommand[]
}

export type Routed =
  /** `takeDownFrom` is the output a re-fired cue was on before, when that is another one. */
  | { kind: 'output'; outputId: string; command: LayerCommand; takeDownFrom?: string }
  | { kind: 'all'; command: LayerCommand }
  | { kind: 'refused'; error: string }
  /** A command for a picture no output is showing: nothing to do, and not an error. */
  | { kind: 'nowhere' }

export class OutputRegistry {
  private outputs: VideoOutput[] = []
  private layers = new Map<string, LayerRecord>()

  list(): readonly VideoOutput[] {
    return this.outputs
  }

  get(outputId: string): VideoOutput | null {
    return this.outputs.find(output => output.id === outputId) ?? null
  }

  /** The show's outputs are now these. Says what that changed. */
  configure(next: readonly VideoOutput[]): OutputChange {
    const seen = new Set<string>()
    const unique = next.filter(output => {
      if (typeof output?.id !== 'string' || output.id === '' || seen.has(output.id)) return false
      seen.add(output.id)
      return true
    })
    const before = new Map(this.outputs.map(output => [output.id, output]))
    const added = unique.filter(output => !before.has(output.id))
    const changed = unique.filter(output => {
      const old = before.get(output.id)
      return old !== undefined && !sameValue(old, output)
    })
    const removed = this.outputs.filter(output => !seen.has(output.id)).map(output => output.id)
    this.outputs = unique.map(output => structuredClone(output))
    return { added, changed, removed }
  }

  /**
   * The output a cue's picture goes to: the one it names, else — named nothing — the first
   * that has pictures of its own (a mirror shows another's).
   */
  resolve(outputId: string): VideoOutput | null {
    if (outputId === '') return this.outputs.find(output => output.mirrorOf === undefined) ?? this.outputs[0] ?? null
    return this.get(outputId)
  }

  /**
   * Where a command goes, and what is remembered about it. A play is held to an output that
   * exists; anything else addressed to a cue goes where that cue's picture is.
   */
  route(command: LayerCommand): Routed {
    if (command.op === 'clear') {
      this.layers.clear()
      return { kind: 'all', command }
    }
    if (command.op === 'play' || command.op === 'prepare') {
      const output = this.resolve(command.layer.outputId)
      if (output === null) {
        return {
          kind: 'refused',
          error: this.outputs.length === 0
            ? 'the show has no video output — add one in the Outputs panel'
            : 'the output this cue names is not in the show'
        }
      }
      const layer = { ...command.layer, outputId: output.id }
      if (command.op === 'play') {
        // A cue fired again replaces its picture: on the output it was on, if that is not
        // where it is going now, the old one is taken down.
        const previous = this.layers.get(layer.cueId)
        this.layers.delete(layer.cueId)
        this.layers.set(layer.cueId, { spec: layer, commands: [] })
        this.trim()
        if (previous !== undefined && previous.spec.outputId !== output.id) {
          return { kind: 'output', outputId: output.id, command: { op: 'play', layer }, takeDownFrom: previous.spec.outputId }
        }
      }
      return { kind: 'output', outputId: output.id, command: { ...command, layer } }
    }
    const record = this.layers.get(command.cueId)
    if (record === undefined) return { kind: 'nowhere' }
    if (command.op === 'update') {
      // A patch is folded into the picture itself: a reload needs the picture as it is now,
      // not the history of how it got there.
      record.spec = applyPatch(record.spec, command.patch)
    } else {
      record.commands.push(command)
      if (record.commands.length > MAX_COMMANDS_PER_LAYER) {
        record.commands.splice(0, record.commands.length - MAX_COMMANDS_PER_LAYER)
      }
    }
    return { kind: 'output', outputId: record.spec.outputId, command }
  }

  /** Where a cue's picture is, if anywhere. */
  outputOf(cueId: string): string | null {
    return this.layers.get(cueId)?.spec.outputId ?? null
  }

  /** The picture is off its output: forgotten. */
  gone(cueId: string, outputId: string): void {
    const record = this.layers.get(cueId)
    if (record !== undefined && record.spec.outputId === outputId) this.layers.delete(cueId)
  }

  /** Every picture an output holds, and the commands since, for a window that has just loaded. */
  replay(outputId: string): { layers: LayerSpec[]; commands: LayerCommand[] } {
    const layers: LayerSpec[] = []
    const commands: LayerCommand[] = []
    for (const record of this.layers.values()) {
      if (record.spec.outputId !== outputId) continue
      layers.push(record.spec)
      commands.push(...record.commands)
    }
    return { layers, commands }
  }

  /** The cues an output is showing, in the order they were played. */
  cuesOn(outputId: string): string[] {
    return [...this.layers.values()].filter(record => record.spec.outputId === outputId).map(record => record.spec.cueId)
  }

  /** An output is gone: its pictures go with it, and these are the cues that were up there. */
  withdraw(outputId: string): string[] {
    const cues = this.cuesOn(outputId)
    for (const cueId of cues) this.layers.delete(cueId)
    return cues
  }

  private trim(): void {
    while (this.layers.size > MAX_LAYERS) {
      const oldest = this.layers.keys().next().value
      if (oldest === undefined) break
      this.layers.delete(oldest)
    }
  }
}

export function applyPatch(spec: LayerSpec, patch: import('../../shared/ipc/output').LayerPatch): LayerSpec {
  return {
    ...spec,
    ...(patch.layer !== undefined ? { layer: patch.layer } : {}),
    ...(patch.opacity !== undefined ? { opacity: patch.opacity } : {}),
    ...(patch.geometry !== undefined ? { geometry: patch.geometry } : {}),
    ...(patch.fadeOutMs !== undefined ? { fadeOutMs: patch.fadeOutMs } : {}),
    ...(patch.text !== undefined ? { text: patch.text } : {}),
    ...(patch.displayMs !== undefined ? { displayMs: patch.displayMs } : {}),
    ...(patch.blend !== undefined ? { blend: patch.blend } : {}),
    ...(patch.keyframes !== undefined ? { keyframes: patch.keyframes } : {})
  }
}
