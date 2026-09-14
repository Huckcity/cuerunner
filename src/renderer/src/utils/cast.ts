import type { CastSettings, DeskChannel, DeskMessage, RfEnsemble, RfPerformer } from '../types/show'

/**
 * The cast: performers, the ensembles that group them, and the desk groups they drive.
 * This is the one place DCA routing is configured — Scenes only runs it, and the mic
 * plot only says who is currently wearing which pack.
 */

// ── Performers ─────────────────────────────────────────────────────────────

export function addPerformer(cast: CastSettings, name: string, role: string, notes = ''): CastSettings {
  const performer: RfPerformer = {
    id: crypto.randomUUID(),
    name,
    role,
    notes,
    ensembleId: null,
    deskChannelId: null
  }
  return { ...cast, performers: [...cast.performers, performer] }
}

export function updatePerformer(
  cast: CastSettings,
  performerId: string,
  patch: Partial<Omit<RfPerformer, 'id'>>
): CastSettings {
  return {
    ...cast,
    performers: cast.performers.map(performer =>
      performer.id === performerId ? { ...performer, ...patch } : performer)
  }
}

/**
 * Drops a performer from the cast list. What they were wearing is the plot's business —
 * the caller releases that pack — and any scene that had them live is the scene list's,
 * since neither lives here.
 */
export function removePerformerFromCast(cast: CastSettings, performerId: string): CastSettings {
  return { ...cast, performers: cast.performers.filter(performer => performer.id !== performerId) }
}

// ── Ensembles ──────────────────────────────────────────────────────────────

export function addEnsemble(cast: CastSettings, name = ''): CastSettings {
  const ensemble: RfEnsemble = {
    id: crypto.randomUUID(),
    name: name.trim() === '' ? `Ensemble ${cast.ensembles.length + 1}` : name.trim(),
    deskChannelId: null
  }
  return { ...cast, ensembles: [...cast.ensembles, ensemble] }
}

export function updateEnsemble(
  cast: CastSettings,
  ensembleId: string,
  patch: Partial<Omit<RfEnsemble, 'id'>>
): CastSettings {
  return {
    ...cast,
    ensembles: cast.ensembles.map(ensemble =>
      ensemble.id === ensembleId ? { ...ensemble, ...patch } : ensemble)
  }
}

/** Removes an ensemble; its members keep existing, just no longer grouped under it. */
export function removeEnsemble(cast: CastSettings, ensembleId: string): CastSettings {
  return {
    ...cast,
    ensembles: cast.ensembles.filter(ensemble => ensemble.id !== ensembleId),
    performers: cast.performers.map(performer =>
      performer.ensembleId === ensembleId ? { ...performer, ensembleId: null } : performer)
  }
}

export function ensembleMembers(cast: CastSettings, ensembleId: string): RfPerformer[] {
  return cast.performers.filter(performer => performer.ensembleId === ensembleId)
}

// ── Desk groups ────────────────────────────────────────────────────────────

export function addDeskGroup(cast: CastSettings, label = ''): CastSettings {
  const group: DeskChannel = {
    id: crypto.randomUUID(),
    label: label.trim() === '' ? `DCA ${cast.groups.length + 1}` : label.trim(),
    mute: null,
    unmute: null
  }
  return { ...cast, groups: [...cast.groups, group] }
}

export function updateDeskGroup(
  cast: CastSettings,
  groupId: string,
  patch: Partial<Omit<DeskChannel, 'id'>>
): CastSettings {
  return {
    ...cast,
    groups: cast.groups.map(group => group.id === groupId ? { ...group, ...patch } : group)
  }
}

/**
 * Removes a group. Performers and ensembles pointed at it keep the pointer until
 * something clears it — the caller does that in the same edit, because half a removal
 * is a group that is gone but still driving the desk in everyone's head.
 */
export function removeDeskGroup(cast: CastSettings, groupId: string): CastSettings {
  return { ...cast, groups: cast.groups.filter(group => group.id !== groupId) }
}

/** Clears every pointer at a group that is being removed, in the same edit. */
export function clearDeskGroupPointers(cast: CastSettings, groupId: string): CastSettings {
  return {
    ...cast,
    performers: cast.performers.map(performer =>
      performer.deskChannelId === groupId ? { ...performer, deskChannelId: null } : performer),
    ensembles: cast.ensembles.map(ensemble =>
      ensemble.deskChannelId === groupId ? { ...ensemble, deskChannelId: null } : ensemble)
  }
}

/**
 * The ordinary desk arrangement for a wireless group: one note, open on note-on and
 * closed on note-off, which is what most desks map a mute to.
 */
export function midiNoteMessages(
  portName: string,
  channel: number,
  note: number
): { mute: DeskMessage; unmute: DeskMessage } {
  return {
    unmute: { kind: 'midi', portName, message: { kind: 'noteOn', channel, note, velocity: 127 } },
    mute: { kind: 'midi', portName, message: { kind: 'noteOff', channel, note, velocity: 0 } }
  }
}

/** The same arrangement over OSC: one address, open value and close value. */
export function oscMessages(
  host: string,
  port: number,
  address: string,
  open: number[] = [1],
  close: number[] = [0]
): { mute: DeskMessage; unmute: DeskMessage } {
  return {
    unmute: { kind: 'osc', host, port, address, args: open },
    mute: { kind: 'osc', host, port, address, args: close }
  }
}

export function describeDeskMessage(message: DeskMessage | null): string {
  if (message === null) return 'nothing'
  if (message.kind === 'osc') {
    return `OSC ${message.address} ${message.args.join(' ')} → ${message.host}:${message.port}`
  }
  if (message.message.kind === 'sysex') {
    return `sysex ${message.message.data.length} bytes → "${message.portName}"`
  }
  return `${message.message.kind} ch${message.message.channel} → "${message.portName}"`
}

// ── Resolution ─────────────────────────────────────────────────────────────

/**
 * The group a performer's mic actually opens: their own, or failing that their
 * ensemble's, or nobody's. A performer keeps this across a pack swap — the desk never
 * knew a pack was involved.
 */
export function resolvedGroupId(performer: RfPerformer, ensembles: RfEnsemble[]): string | null {
  if (performer.deskChannelId !== null) return performer.deskChannelId
  if (performer.ensembleId === null) return null
  return ensembles.find(ensemble => ensemble.id === performer.ensembleId)?.deskChannelId ?? null
}
