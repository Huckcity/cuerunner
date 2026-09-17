import { DCA_LIMIT } from '../../../shared/show'
import type {
  CastSettings,
  Dca,
  Ensemble,
  Performer,
  ShowChannel
} from '../../../shared/show'

/**
 * The show's setup: the channels on the console, the cast and where their mics are
 * patched, the ensembles that group them, and the DCAs those channels open.
 *
 * Every operation here is pure and works on the whole cast, so the store can write one
 * edit at a time and an undo can put back exactly what an edit destroyed.
 */

/**
 * The DCA a strip in this place drives by default: the one with the same number. A show
 * is set up from the desk's own numbering — strip 4 on fader 4 — and a group sharing a
 * fader (the chorus, the band) is the exception somebody chose.
 */
function dcaForPlace(dcas: Dca[], place: number): string | null {
  return dcas[place]?.id ?? null
}

// ── Performers ─────────────────────────────────────────────────────────────

/**
 * Adds a performer on the first strip nobody is on, or on a new strip when every one is
 * taken: a performer with no strip is a row that can never be open in a scene, and the
 * strip they land on is where their mic is patched. It is left unnamed — naming the
 * performer names the strip, and until then "Ch 7" is what the desk calls it.
 */
export function addPerformer(
  cast: CastSettings,
  name: string,
  role: string,
  notes = ''
): CastSettings {
  const taken = new Set(cast.performers.map(performer => performer.channelId))
  const free = cast.channels.find(channel => !taken.has(channel.id))
  const channelId = free?.id ?? crypto.randomUUID()
  const channels = free === undefined
    ? [...cast.channels, {
        id: channelId,
        name: '',
        dcaId: dcaForPlace(cast.dcas, cast.channels.length)
      }]
    : cast.channels

  const performer: Performer = { id: crypto.randomUUID(), name, role, notes, channelId }
  return { ...cast, channels, performers: [...cast.performers, performer] }
}

/** Updates by id, leaving the rest alone. */
export function updatePerformer(
  cast: CastSettings,
  performerId: string,
  patch: Partial<Omit<Performer, 'id'>>
): CastSettings {
  const performer = cast.performers.find(candidate => candidate.id === performerId)
  if (performer === undefined) return cast

  const next = { ...performer, ...patch }
  const performers = cast.performers.map(c => c.id === performerId ? next : c)
  // Renaming a performer names the strip they are on, as long as nobody has named it
  // themselves: the strip's label is what the desk shows, and it is their name nine
  // times out of ten.
  if (patch.name === undefined || patch.name.trim() === '' || next.channelId === null) {
    return { ...cast, performers }
  }

  return {
    ...cast,
    performers,
    channels: cast.channels.map(channel =>
      channel.id === next.channelId && channel.name.trim() === ''
        ? { ...channel, name: next.name }
        : channel)
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

/** Adds a strip after the last one, driving the DCA of its own number. */
export function addChannel(cast: CastSettings, name = ''): CastSettings {
  const channel: ShowChannel = {
    id: crypto.randomUUID(),
    name,
    dcaId: dcaForPlace(cast.dcas, cast.channels.length)
  }
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
 * The DCA a performer's mic opens: the one their channel drives, or nothing when the
 * strip is patched to no fader at all.
 */
export function performerDcaId(performer: Performer, channels: ShowChannel[]): string | null {
  return performerChannel(performer, channels)?.dcaId ?? null
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
 * match: growing appends DCAs that label and drive themselves, and shrinking takes the
 * last ones off — putting every strip that was on one back on the DCA of its own number,
 * which is the one that is certainly still there.
 */
export function setDcaCount(cast: CastSettings, count: number): CastSettings {
  const wanted = Math.max(0, Math.min(DCA_LIMIT, Math.round(count)))
  if (wanted === cast.dcas.length) return cast

  const dcas = cast.dcas.slice(0, wanted)
  while (dcas.length < wanted) {
    dcas.push({
      id: crypto.randomUUID(),
      label: `DCA ${dcas.length + 1}`,
      note: null,
      address: null
    })
  }

  const kept = new Set(dcas.map(dca => dca.id))
  return {
    ...cast,
    dcas,
    channels: cast.channels.map((channel, place) => {
      if (channel.dcaId === null || kept.has(channel.dcaId)) return channel
      return { ...channel, dcaId: dcaForPlace(dcas, place) }
    })
  }
}
