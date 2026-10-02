import type { DeviceState, RfPack, RfThresholds } from '../../../shared/show'

// The question asked before the doors open: is every pack ready to be worn? It is answered from
// what the panel already knows — the plot and what each channel last reported — and it is a
// question, not a gate. Cuerunner never stops a GO, so this says what is not ready and leaves
// the deciding to the person who can see the stage.

/** `not-ready` is what would fail the pack on stage; `attention` is worth a look and not worth stopping for. */
export type Readiness = 'not-ready' | 'attention'

export interface PreshowEntry {
  pack: RfPack
  device: DeviceState | undefined
}

export interface PreshowItem {
  packId: string
  label: string
  readiness: Readiness
  /** Why, worded for the person reading it, worst first. */
  reasons: string[]
}

export interface PreshowCheck {
  /** `nothing` when there is no pack to ask about: an empty rack is not a ready one. */
  verdict: 'nothing' | 'ready' | 'attention' | 'not-ready'
  total: number
  ready: number
  /** Packs that are not ready, the ones that would fail first. */
  items: PreshowItem[]
}

/** A show that ran long, a colder night: what it used last time is not a promise, so a quarter more. */
const SAFETY = 1.25

interface Reason {
  readiness: Readiness
  text: string
}

/** What is wrong with one pack, from the readings it last gave. */
function reasonsFor({ pack, device }: PreshowEntry, thresholds: RfThresholds): Reason[] {
  // A pack with no channel is a patch waiting to be made. It cannot be asked about, and it is
  // not a failure: a spare pack in the case is not a pack on stage.
  if (!pack.channelId) return [{ readiness: 'attention', text: 'no channel patched' }]
  if (device === undefined) return [{ readiness: 'not-ready', text: 'not reporting — is it switched on?' }]
  if (!device.online) return [{ readiness: 'not-ready', text: 'stopped reporting' }]

  const reasons: Reason[] = []
  for (const warning of device.warnings ?? []) {
    reasons.push({ readiness: warning.critical ? 'not-ready' : 'attention', text: warning.text })
  }
  const percent = device.battery?.percent
  if (percent !== undefined && percent <= thresholds.batteryCritical) {
    reasons.push({ readiness: 'not-ready', text: `battery ${percent}%` })
  } else if (percent !== undefined && percent <= thresholds.batteryWarning) {
    reasons.push({ readiness: 'attention', text: `battery ${percent}%` })
  }
  // A charge that is fine now may not be enough for a show: the pack's own past says what one
  // cost it, and a show that took 24% from a pack at 30% leaves it at the urgent line before the
  // curtain. Only said when the reading alone has not already said it.
  const used = device.history?.lastUsedPercent
  if (
    percent !== undefined && used !== undefined && percent > thresholds.batteryWarning &&
    // At or below the urgent line is urgent, as everywhere else: ending the show on it is ending it there.
    percent - Math.ceil(used * SAFETY) <= thresholds.batteryCritical
  ) {
    reasons.push({ readiness: 'attention', text: `battery ${percent}% — a show used ${used}% last time` })
  }
  const rf = device.rf
  if (rf !== undefined && (rf.weak ?? rf.level <= thresholds.rfWarningDbm)) {
    reasons.push({ readiness: 'attention', text: `signal weak — ${rf.level} ${rf.unit === 'dBm' ? 'dBm' : '%'}` })
  }
  // Muted at the receiver is a decision somebody may have made, and the last thing anyone
  // wants to discover from the stalls.
  if (device.audio?.muted) reasons.push({ readiness: 'attention', text: 'muted at the receiver' })

  return reasons.sort((a, b) => Number(b.readiness === 'not-ready') - Number(a.readiness === 'not-ready'))
}

export function preshowCheck(entries: PreshowEntry[], thresholds: RfThresholds): PreshowCheck {
  const items: PreshowItem[] = []
  for (const entry of entries) {
    const reasons = reasonsFor(entry, thresholds)
    if (reasons.length === 0) continue
    items.push({
      packId: entry.pack.id,
      label: entry.pack.label,
      readiness: reasons.some(reason => reason.readiness === 'not-ready') ? 'not-ready' : 'attention',
      reasons: reasons.map(reason => reason.text)
    })
  }
  // A stable sort: within a band, packs stay in plot order.
  items.sort((a, b) => Number(b.readiness === 'not-ready') - Number(a.readiness === 'not-ready'))

  const verdict =
    entries.length === 0 ? 'nothing'
      : items.some(item => item.readiness === 'not-ready') ? 'not-ready'
        : items.length > 0 ? 'attention'
          : 'ready'
  return { verdict, total: entries.length, ready: entries.length - items.length, items }
}

/** The check as plain text, for pasting into the message to whoever is on the deck. */
export function preshowText(check: PreshowCheck): string {
  if (check.verdict === 'nothing') return 'No packs to check.'
  const noun = check.total === 1 ? 'pack' : 'packs'
  const head =
    check.verdict === 'ready'
      ? `All ${check.total} ${noun} ready.`
      : `${check.ready} of ${check.total} ${noun} ready.`
  return [head, ...check.items.map(item => `${item.readiness === 'not-ready' ? 'NOT READY' : 'check'} ${item.label}: ${item.reasons.join('; ')}`)].join('\n')
}
