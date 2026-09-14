import { DCA_LIMIT } from '../types/show'
import type {
  CastSettings,
  Dca,
  DeskMessage,
  Ensemble,
  Performer,
  ShowChannel
} from '../types/show'

/**
 * The show's setup: the channels on the console, the cast and where their mics are
 * patched, the ensembles that group them, and the DCAs those channels open.
 *
 * Every operation here is pure and works on the whole cast, so the store can write one
 * edit at a time and an undo can put back exactly what an edit destroyed.
 */

// ── Performers ─────────────────────────────────────────────────────────────

export function addPerformer(cast: CastSettings, name: string, role: string, notes = ''): CastSettings {
  const performer: Performer = {
    id: crypto.randomUUID(),
    name,
    role,
    notes,
    channelId: null
  }
  return { ...cast, performers: [...cast.performers, performer] }
}

export function updatePerformer(
  cast: CastSettings,
  performerId: string,
  patch: Partial<Omit<Performer, 'id'>>
): CastSettings {
  return {
    ...cast,
    performers: cast.performers.map(performer =>
      performer.id === performerId ? { ...performer, ...patch } : performer)
  }
}

/**
 * Drops a performer from the cast list, and out of every ensemble that held them. What
 * they were wearing is the plot's business — the caller releases that pack — and any
 * scene that had them open is the scene list's, since neither lives here.
 */
export function removePerformerFromCast(cast: CastSettings, performerId: string): CastSettings {
  return {
    ...cast,
    performers: cast.performers.filter(performer => performer.id !== performerId),
    ensembles: cast.ensembles.map(ensemble => ensemble.members.includes(performerId)
      ? { ...ensemble, members: ensemble.members.filter(id => id !== performerId) }
      : ensemble)
  }
}

// ── Channels ───────────────────────────────────────────────────────────────

export function addChannel(cast: CastSettings, name = ''): CastSettings {
  const channel: ShowChannel = { id: crypto.randomUUID(), name, enabled: true, dcaId: null }
  return { ...cast, channels: [...cast.channels, channel] }
}

export function updateChannel(
  cast: CastSettings,
  channelId: string,
  patch: Partial<Omit<ShowChannel, 'id'>>
): CastSettings {
  return {
    ...cast,
    channels: cast.channels.map(channel =>
      channel.id === channelId ? { ...channel, ...patch } : channel)
  }
}

/**
 * Removes a channel and unpatches whoever was on it, as one edit: a performer pointed at
 * a channel that is gone is a mic that opens nothing, and the numbers after it close up
 * because a strip's number is its place in the list.
 */
export function removeChannel(cast: CastSettings, channelId: string): CastSettings {
  return {
    ...cast,
    channels: cast.channels.filter(channel => channel.id !== channelId),
    performers: cast.performers.map(performer =>
      performer.channelId === channelId ? { ...performer, channelId: null } : performer)
  }
}

/** The channel a performer's mic is patched to, or null while they are patched to none. */
export function performerChannel(performer: Performer, channels: ShowChannel[]): ShowChannel | null {
  if (performer.channelId === null) return null
  return channels.find(channel => channel.id === performer.channelId) ?? null
}

/**
 * A channel as a row reads it: its number, which is its place in the list, and the name
 * beside it when it has one. An unnamed strip is still a strip — a number is what the
 * operator calls it until it is named.
 */
export function channelLabel(channels: ShowChannel[], channelId: string | null): string {
  const index = channelId === null ? -1 : channels.findIndex(channel => channel.id === channelId)
  if (index === -1) return ''
  const name = channels[index].name.trim()
  return name === '' ? `Ch ${index + 1}` : `Ch ${index + 1} · ${name}`
}

/**
 * The DCA a performer's mic opens: the one their channel is assigned to. A channel that
 * is switched out of tonight's patch drives nothing, which is the whole point of the
 * switch — the desk is not told about a strip that is not there.
 */
export function performerDcaId(performer: Performer, channels: ShowChannel[]): string | null {
  const channel = performerChannel(performer, channels)
  if (channel === null || !channel.enabled) return null
  return channel.dcaId
}

// ── Ensembles ──────────────────────────────────────────────────────────────

/**
 * An ensemble is a grouping, so it is created empty and whoever is in it is named by the
 * list it carries. It is not desk routing: what opens for its members is their channels.
 */
export function addEnsemble(cast: CastSettings, name = '', members: string[] = []): CastSettings {
  const ensemble: Ensemble = {
    id: crypto.randomUUID(),
    name: name.trim() === '' ? `Ensemble ${cast.ensembles.length + 1}` : name.trim(),
    members
  }
  return { ...cast, ensembles: [...cast.ensembles, ensemble] }
}

export function updateEnsemble(
  cast: CastSettings,
  ensembleId: string,
  patch: Partial<Omit<Ensemble, 'id'>>
): CastSettings {
  return {
    ...cast,
    ensembles: cast.ensembles.map(ensemble =>
      ensemble.id === ensembleId ? { ...ensemble, ...patch } : ensemble)
  }
}

/** Removes an ensemble; its members keep existing, just no longer grouped under it. */
export function removeEnsemble(cast: CastSettings, ensembleId: string): CastSettings {
  return { ...cast, ensembles: cast.ensembles.filter(ensemble => ensemble.id !== ensembleId) }
}

/** Who is in an ensemble, in cast order. Members that are no longer cast are dropped. */
export function ensembleMembers(cast: CastSettings, ensembleId: string): Performer[] {
  const ensemble = cast.ensembles.find(candidate => candidate.id === ensembleId)
  if (!ensemble) return []
  return cast.performers.filter(performer => ensemble.members.includes(performer.id))
}

// ── DCAs ───────────────────────────────────────────────────────────────────

export function addDca(cast: CastSettings, label = ''): CastSettings {
  const dca: Dca = {
    id: crypto.randomUUID(),
    label: label.trim() === '' ? `DCA ${cast.dcas.length + 1}` : label.trim(),
    mute: null,
    unmute: null
  }
  return { ...cast, dcas: [...cast.dcas, dca] }
}

export function updateDca(
  cast: CastSettings,
  dcaId: string,
  patch: Partial<Omit<Dca, 'id'>>
): CastSettings {
  return {
    ...cast,
    dcas: cast.dcas.map(dca => dca.id === dcaId ? { ...dca, ...patch } : dca)
  }
}

/**
 * How many DCAs the desk has, which is what the show controls. The list is resized to
 * match: growing appends unpatched DCAs, and shrinking takes the last ones off along
 * with every channel assigned to them — as one edit, because half of that is a strip
 * pointing at a DCA nothing can open.
 */
export function setDcaCount(cast: CastSettings, count: number): CastSettings {
  const wanted = Math.max(0, Math.min(DCA_LIMIT, Math.round(count)))
  if (wanted === cast.dcas.length) return cast

  const dcas = cast.dcas.slice(0, wanted)
  while (dcas.length < wanted) {
    dcas.push({
      id: crypto.randomUUID(),
      label: `DCA ${dcas.length + 1}`,
      mute: null,
      unmute: null
    })
  }

  const kept = new Set(dcas.map(dca => dca.id))
  return {
    ...cast,
    dcas,
    channels: cast.channels.map(channel =>
      channel.dcaId !== null && !kept.has(channel.dcaId) ? { ...channel, dcaId: null } : channel)
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
