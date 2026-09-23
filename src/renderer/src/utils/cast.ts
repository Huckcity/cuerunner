import { CHANNEL_LIMIT, DCA_LIMIT } from '../../../shared/show'
import type {
  CastSettings,
  Dca,
  Ensemble,
  Performer,
  ShowChannel
} from '../../../shared/show'

/**
 * The show's setup: the channels on the console, the cast and where their mics are
 * patched, the ensembles that group them, and the faders the desk has.
 *
 * Every operation here is pure and works on the whole cast, so the store can write one
 * edit at a time and an undo can put back exactly what an edit destroyed.
 *
 * Nothing here says which fader a channel rides: a strip is a name and a number, and the
 * placement belongs to the scene that makes it (AD-26).
 */

// ── Performers ─────────────────────────────────────────────────────────────

/**
 * Adds a performer on the first strip nobody is on, or on a new strip when every one is
 * taken: a performer with no strip is a row that can never be named on the desk, and the
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
    ? [...cast.channels, { id: channelId, name: '' }]
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

/** Adds a strip after the last one. Where it rides is the scene's to say, not the strip's. */
export function addChannel(cast: CastSettings, name = ''): CastSettings {
  const channel: ShowChannel = { id: crypto.randomUUID(), name }
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
 * Unpatches every mic that was standing on a strip that has gone: a performer pointed at a
 * channel the show no longer has is a mic that opens nothing, and the numbers after it
 * close up, so the patch goes rather than pointing at whatever took its place. Both ways a
 * strip leaves — one at a time, and a count's tail — are made of this one rule.
 */
function unpatchPerformers(performers: Performer[], gone: Set<string>): Performer[] {
  if (gone.size === 0) return performers
  return performers.map(performer =>
    performer.channelId !== null && gone.has(performer.channelId)
      ? { ...performer, channelId: null }
      : performer)
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
    performers: unpatchPerformers(cast.performers, new Set([channelId]))
  }
}

/**
 * How many strips the console has. The list is resized to match: growing appends strips
 * minted the way a strip added by hand is, and shrinking takes the last ones off, which
 * unpatches their mics the way removing one strip does. Each list keeps its names, its
 * order and the ids of what remains, so a strip that survives a count is the same strip.
 *
 * The cap bounds what the show is asked to grow to, never what it already has: a show can
 * pass it by hand — `+ Channel`, and a performer on a full console minting a strip — and a
 * count it already carries must leave it alone rather than trim it and its placements.
 *
 * What the scenes say about the strips that went is the store action's business, which
 * makes that change in the same edit as this one.
 */
export function setChannelCount(cast: CastSettings, count: number): CastSettings {
  const ceiling = Math.max(CHANNEL_LIMIT, cast.channels.length)
  const wanted = Math.max(0, Math.min(ceiling, Math.round(count)))
  if (wanted === cast.channels.length) return cast

  const channels = cast.channels.slice(0, wanted)
  while (channels.length < wanted) {
    channels.push({ id: crypto.randomUUID(), name: '' })
  }
  const gone = new Set(cast.channels.slice(wanted).map(channel => channel.id))
  return { ...cast, channels, performers: unpatchPerformers(cast.performers, gone) }
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
 * How many faders the show drives. The list is resized to match: growing appends DCAs that
 * label and address themselves, and shrinking takes the last ones off. Each list keeps its
 * labels, its order and the ids of what remains, so a fader that survives a count is the
 * same fader.
 *
 * The cap bounds growth alone, the same way the strips' does: a show a file carries more
 * faders than are offerable keeps its own count selectable, and asking for it back must
 * leave the list alone. What happens to the scenes that named the faders that went is the
 * store action's business, which drops those rows in the same edit — so a fader grown back
 * is a new fader, with a new id, and it comes back empty.
 */
export function setDcaCount(cast: CastSettings, count: number): CastSettings {
  const ceiling = Math.max(DCA_LIMIT, cast.dcas.length)
  const wanted = Math.max(0, Math.min(ceiling, Math.round(count)))
  if (wanted === cast.dcas.length) return cast

  const dcas = cast.dcas.slice(0, wanted)
  while (dcas.length < wanted) {
    dcas.push({
      id: crypto.randomUUID(),
      label: `DCA ${dcas.length + 1}`,
      deskNumber: null
    })
  }
  return { ...cast, dcas }
}
