import type { Cue } from '../../../shared/cue'
import type { RemoteCommand, RemoteCueRef, RemoteListVerb } from '../../../shared/oscRemote'
import { cuesOfList, findCueList, listMembership, type CueListInfo } from '../../../shared/cueLists'
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
  pauseAll: () => void
  resumeAll: () => void
  togglePause: () => void
  pauseCue: (cueId: string) => boolean
  resumeCue: (cueId: string) => boolean
  togglePauseCue: (cueId: string) => boolean
  log: (entry: LogEntryInput) => void
  // The show's cue lists. Optional: a window without them runs one list, the way every show
  // did before there were several, and an address that names a list is answered as unknown.
  getCueLists?: () => CueListInfo[]
  getActiveListId?: () => string
  setActiveList?: (listId: string) => void
  /** GO on one list's own playhead, without bringing it to the front. */
  goList?: (listId: string) => void
  /** STOP for one list: what runs in it, and nothing else. */
  stopList?: (listId: string) => void
  setListArmed?: (listId: string, armed: boolean) => void
  /** Moves one list's playhead without bringing it to the front. */
  setListPlayhead?: (listId: string, cueId: string | null) => void
  getListPlayhead?: (listId: string) => string | null
}

/** The cues of the list on screen, children with their groups: what next and previous walk. */
function activeListCues(deps: RemoteDeps): Cue[] {
  const active = deps.getActiveListId?.()
  const cues = deps.getCues()
  return active === undefined ? cues : cuesOfList(cues, active)
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
  if (ref.by === 'id') return cues.find(cue => cue.id === ref.id) ?? null
  // A cue number is text, compared as written: `1.5` and `01.5` are two cues to the list.
  // Numbers are not held unique across lists, so the list on screen answers first.
  const wanted = ref.number.trim()
  const here = activeListCues(deps).find(cue => cue.number.trim() === wanted)
  return here ?? cues.find(cue => cue.number.trim() === wanted) ?? null
}

function describeRef(ref: RemoteCueRef): string {
  if (ref.by === 'id') return `cue or list with the id ${ref.id}`
  return ref.by === 'selected' ? 'the selected cue' : `cue ${ref.number}`
}

/**
 * One list's command. A list nobody has is said in the log, like a cue nobody has; a verb the
 * window has no hand for — an older window without lists — is said too, rather than ignored.
 */
function runListCommand(list: CueListInfo, verb: RemoteListVerb, deps: RemoteDeps, source: string): void {
  const log = (message: string, level: LogEntryInput['level'] = 'info'): void => deps.log({ level, message })
  const missing = (): void => log(`${source}: this window cannot ${verb} a list`, 'error')
  switch (verb) {
    case 'go':
      if (!deps.goList) return missing()
      log(`GO on “${list.name}” from ${source}`)
      deps.goList(list.id)
      return
    case 'stop':
      if (!deps.stopList) return missing()
      log(`STOP on “${list.name}” from ${source}`)
      deps.stopList(list.id)
      return
    case 'select':
      if (!deps.setActiveList) return missing()
      deps.setActiveList(list.id)
      return
    case 'arm':
    case 'disarm':
      if (!deps.setListArmed) return missing()
      log(`${verb === 'arm' ? 'Armed' : 'Disarmed'} “${list.name}” from ${source}`)
      deps.setListArmed(list.id, verb === 'arm')
      return
    case 'next':
    case 'previous': {
      if (!deps.getListPlayhead || !deps.setListPlayhead) return missing()
      const membership = listMembership(deps.getCues())
      const order = visibleOrder(deps.getCues().filter(cue => membership.get(cue.id) === list.id), deps.getCollapsed())
      if (order.length === 0) return
      const at = order.findIndex(cue => cue.id === deps.getListPlayhead!(list.id))
      const step = verb === 'next' ? 1 : -1
      const index = at < 0 ? (step > 0 ? 0 : order.length - 1) : Math.min(Math.max(at + step, 0), order.length - 1)
      deps.setListPlayhead(list.id, order[index].id)
      return
    }
  }
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
    case 'pause':
      log(`PAUSE from ${source}`)
      deps.pauseAll()
      return
    case 'resume':
      log(`RESUME from ${source}`)
      deps.resumeAll()
      return
    case 'toggle-pause':
      log(`PAUSE/RESUME from ${source}`)
      deps.togglePause()
      return
    case 'list': {
      const list = findCueList(deps.getCueLists?.() ?? [], command.list)
      if (list === null) {
        log(`${source}: no cue list “${command.list}” in this show`, 'error')
        return
      }
      runListCommand(list, command.verb, deps, source)
      return
    }
    case 'select-next':
    case 'select-previous': {
      // Next and previous walk the list on screen, as the arrow keys do.
      const order = visibleOrder(activeListCues(deps), deps.getCollapsed())
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

  // QLab counts a cue list as a cue: `/cue_id/{list id}/go` is GO on that list.
  if (command.cue.by === 'id') {
    const list = deps.getCueLists?.().find(entry => entry.id === (command.cue as { id: string }).id)
    const listVerb: RemoteListVerb | null = list === undefined ? null
      : command.kind === 'cue-go' || command.kind === 'cue-start' ? 'go'
        : command.kind === 'cue-stop' ? 'stop'
          : command.kind === 'cue-select' ? 'select'
            : null
    if (list !== undefined && listVerb !== null) {
      runListCommand(list, listVerb, deps, source)
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
    case 'cue-pause':
      if (deps.pauseCue(cue.id)) log(`Paused by ${source}`, 'info', label)
      return
    case 'cue-resume':
      if (deps.resumeCue(cue.id)) log(`Resumed by ${source}`, 'info', label)
      return
    case 'cue-toggle-pause':
      if (deps.togglePauseCue(cue.id)) log(`Pause toggled by ${source}`, 'info', label)
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
