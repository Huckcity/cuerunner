import { formatClock } from './cueDefaults'
import type { DeviceState, RfPack, RfPerformer, RfPlot, RfSwap } from '../types/show'

/**
 * The plot is the one part of a show that changes hands during it: a pack moves to
 * another performer for a quick change, or comes off someone entirely. Everything that
 * changes the plot lives here as a pure function, so the editor can be small and the
 * swap it produces is recorded the same way wherever the change came from.
 *
 * Performers themselves are the cast's (`utils/cast.ts`) — the plot only tracks who is
 * currently wearing which transmitter, which is why every function below that needs a
 * name takes the cast's performer list as a parameter rather than owning one.
 */

/** A session rarely makes more than a handful of swaps; this is a runaway guard. */
export const MAX_SWAPS = 200

export interface PlotChange {
  plot: RfPlot
  /** Swaps this change made, in order. Empty for a change that moved nothing. */
  swaps: RfSwap[]
}

/** Adding a pack leaves it unassigned and unpatched: both are decisions, not defaults. */
export function addPack(plot: RfPlot, label: string, channelId: string | null = null): RfPlot {
  const pack: RfPack = { id: crypto.randomUUID(), label, channelId, performerId: null, notes: '' }
  return { ...plot, packs: [...plot.packs, pack] }
}

export function updatePack(
  plot: RfPlot,
  packId: string,
  patch: Partial<Omit<RfPack, 'id'>>
): RfPlot {
  return {
    ...plot,
    packs: plot.packs.map(pack => pack.id === packId ? { ...pack, ...patch } : pack)
  }
}

export function removePack(plot: RfPlot, packId: string): RfPlot {
  return { ...plot, packs: plot.packs.filter(pack => pack.id !== packId) }
}

/**
 * Hands a pack to someone, or to nobody. A change from one performer to another is what
 * the report calls a swap, so it comes back with the record of it; assigning the same
 * performer again is not a change and produces nothing.
 */
export function assignPack(
  plot: RfPlot,
  performers: RfPerformer[],
  packId: string,
  performerId: string | null,
  at: number
): PlotChange {
  const pack = plot.packs.find(candidate => candidate.id === packId)
  if (!pack || pack.performerId === performerId) return { plot, swaps: [] }

  const next = updatePack(plot, packId, { performerId })
  return {
    plot: next,
    swaps: [{
      at,
      packId,
      packLabel: pack.label,
      from: nameOf(performers, pack.performerId),
      to: nameOf(performers, performerId)
    }]
  }
}

/**
 * Releases every pack a performer was wearing — called when they leave the cast. Each
 * release is a swap in its own right: the report should say the pack came off someone,
 * not quietly show it unassigned.
 */
export function releasePerformerPacks(
  plot: RfPlot,
  performers: RfPerformer[],
  performerId: string,
  at: number
): PlotChange {
  const swaps: RfSwap[] = []
  let next = plot
  for (const pack of plot.packs) {
    if (pack.performerId !== performerId) continue
    const change = assignPack(next, performers, pack.id, null, at)
    next = change.plot
    swaps.push(...change.swaps)
  }
  return { plot: next, swaps }
}

/** Appends swaps to the log, keeping the newest, so a runaway cannot grow the workspace. */
export function recordSwaps(swaps: RfSwap[], added: RfSwap[]): RfSwap[] {
  if (added.length === 0) return swaps
  return [...swaps, ...added].slice(-MAX_SWAPS)
}

/** How a swap reads in the log and the report: `Pack 12 Aldonza → Moor`. */
export function describeSwap(swap: RfSwap): string {
  const from = swap.from ?? 'unassigned'
  const to = swap.to ?? 'unassigned'
  return `${swap.packLabel} ${from} → ${to}`
}

/** One line of the show report: what this pack did over the night. */
export interface RfReportRow {
  packId: string
  label: string
  performer: string | null
  role: string | null
  channelId: string | null
  /** The pack as it stands now, when a source is reporting for it. */
  device: DeviceState | undefined
  /** The lowest battery the show saw for this pack, from the wireless service. */
  lowestPercent: number | null
  lowestAt: number | null
  dropouts: number
  swaps: RfSwap[]
}

/**
 * What happened to each pack over the session: the battery it got down to, how many
 * times it went quiet, and every time it changed hands. Read the morning after, which
 * is why it does not depend on anything being on right now.
 */
export function buildReport(
  plot: RfPlot,
  performers: RfPerformer[],
  devices: DeviceState[],
  swaps: RfSwap[]
): RfReportRow[] {
  const byChannel = new Map(devices.map(device => [device.id, device]))
  return plot.packs.map(pack => {
    const device = pack.channelId ? byChannel.get(`rf:${pack.channelId}`) : undefined
    const performer = performers.find(candidate => candidate.id === pack.performerId)
    return {
      packId: pack.id,
      label: pack.label,
      performer: performer?.name ?? null,
      role: performer?.role ?? null,
      channelId: pack.channelId,
      device,
      lowestPercent: device?.history?.lowestPercent ?? null,
      lowestAt: device?.history?.lowestAt ?? null,
      dropouts: device?.history?.dropouts ?? 0,
      swaps: swaps.filter(swap => swap.packId === pack.id)
    }
  })
}

/** The report as text, for the clipboard and for pasting into a show file. */
export function reportText(rows: RfReportRow[], generatedAt: number): string {
  const lines: string[] = [`Mic plot report — ${rows.length} packs (${formatClock(generatedAt)})`]

  for (const row of rows) {
    const who = row.performer ? `${row.performer} (${row.role ?? '—'})` : 'unassigned'
    const battery = row.lowestPercent === null
      ? 'no reading'
      : `lowest ${row.lowestPercent}%${row.lowestAt === null ? '' : ` at ${formatClock(row.lowestAt)}`}`
    const dropouts = row.dropouts === 0 ? 'no dropouts' : `${row.dropouts} dropout${row.dropouts === 1 ? '' : 's'}`
    lines.push(`${row.label} — ${who}, ${battery}, ${dropouts}`)
  }

  const swaps = rows.flatMap(row => row.swaps).sort((a, b) => a.at - b.at)
  lines.push('')
  if (swaps.length === 0) {
    lines.push('No swaps.')
  } else {
    lines.push(`Swaps (${swaps.length}):`)
    for (const swap of swaps) lines.push(`  ${formatClock(swap.at)}  ${describeSwap(swap)}`)
  }

  return lines.join('\n')
}

function nameOf(performers: RfPerformer[], performerId: string | null): string | null {
  if (performerId === null) return null
  return performers.find(performer => performer.id === performerId)?.name ?? null
}
