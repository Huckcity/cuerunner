import type { Cue } from '../../../shared/cue'
import type { RemoteCommand, RemoteCueRef } from '../../../shared/oscRemote'
import type { LogEntryInput } from '../store'

/**
 * What the remote needs from the window to act: the list as it stands, where the operator
 * is standing, and the runner's own verbs. Passed in rather than imported, so the decision of
 * what an address does can be tested without a runner or a store behind it.
 */
export interface RemoteDeps {
  getCues: () => Cue[]
  getSelected: () => string | null
  /** The groups folded shut in the list: next and previous walk what the operator can see. */
  getCollapsed: () => ReadonlySet<string>
  select: (id: string | null) => void
  go: () => void
  stop: (cueId?: string) => void
  goById: (cueId: string) => void
  seekCue: (cueId: string, positionMs: number) => void
  log: (entry: LogEntryInput) => void
}

/** The cues in the order the list draws them, without the ones a folded group hides. */
export function visibleOrder(cues: readonly Cue[], collapsed: ReadonlySet<string>): Cue[] {
  const hidden = new Set<string>()
  const visible: Cue[] = []
  for (const cue of cues) {
    if (cue.parentId !== null && (hidden.has(cue.parentId) || collapsed.has(cue.parentId))) {
      // A folded group hides its whole subtree, a group inside it included.
      hidden.add(cue.id)
      continue
    }
    visible.push(cue)
  }
  return visible
}

function findCue(ref: RemoteCueRef, deps: RemoteDeps): Cue | null {
  const cues = deps.getCues()
  if (ref.by === 'selected') {
    const id = deps.getSelected()
    return cues.find(cue => cue.id === id) ?? null
  }
  // A cue number is text, compared as written: `1.5` and `01.5` are two cues to the list.
  const wanted = ref.number.trim()
  return cues.find(cue => cue.number.trim() === wanted) ?? null
}

function describeRef(ref: RemoteCueRef): string {
  return ref.by === 'selected' ? 'the selected cue' : `cue ${ref.number}`
}

function cueLabel(cue: Cue): string {
  return `${cue.number} · ${cue.name}`
}

/**
 * Carries out one remote command, and writes what it did to the session log under the
 * address that asked — the log is how an operator finds out the tablet in the booth pressed
 * GO, and a remote that moved the show in silence would be indistinguishable from a fault.
 *
 * The panic is not here: main answers it itself (`remotePanicFromEvent`), and a window that
 * panicked again on top would only say so twice.
 */
export function runRemote(command: RemoteCommand, deps: RemoteDeps, source: string): void {
  const log = (message: string, level: LogEntryInput['level'] = 'info', label?: string): void => {
    deps.log(label === undefined ? { level, message } : { level, message, label })
  }

  switch (command.kind) {
    case 'panic':
      return
    case 'go':
      log(`GO from ${source}`)
      deps.go()
      return
    case 'stop':
      log(`STOP from ${source}`)
      deps.stop()
      return
    case 'select-next':
    case 'select-previous': {
      const order = visibleOrder(deps.getCues(), deps.getCollapsed())
      if (order.length === 0) return
      const at = order.findIndex(cue => cue.id === deps.getSelected())
      const step = command.kind === 'select-next' ? 1 : -1
      // Nothing selected is the end of the show; previous from there is its last cue, and
      // next is its first, so a remote can always find its way back in.
      const index = at < 0
        ? (step > 0 ? 0 : order.length - 1)
        : Math.min(Math.max(at + step, 0), order.length - 1)
      deps.select(order[index].id)
      return
    }
  }

  const cue = findCue(command.cue, deps)
  if (cue === null) {
    log(`${source}: no ${describeRef(command.cue)} in this show`, 'error')
    return
  }
  const label = cueLabel(cue)

  switch (command.kind) {
    case 'cue-select':
      deps.select(cue.id)
      return
    case 'cue-go':
      // Standing on the cue and pressing GO, so the selection moves past it the way GO's
      // does — which is what makes the next GO, from whichever surface, the cue after it.
      log(`GO from ${source}`, 'info', label)
      deps.select(cue.id)
      deps.go()
      return
    case 'cue-start':
      if (!cue.isArmed) {
        log(`not fired by ${source}: the cue is disarmed`, 'error', label)
        return
      }
      log(`Started by ${source}`, 'info', label)
      deps.goById(cue.id)
      return
    case 'cue-stop':
      log(`Stopped by ${source}`, 'info', label)
      deps.stop(cue.id)
      return
    case 'cue-seek':
      if (cue.type !== 'audio') {
        log(`${source}: only an audio cue can be moved to a time`, 'error', label)
        return
      }
      // Seconds into the cue's own region, as the waveform reads it: the file's own time is
      // the cue's business, and a remote fader knows the cue rather than the file.
      deps.seekCue(cue.id, cue.startTime + command.seconds * 1000)
      return
  }
}
