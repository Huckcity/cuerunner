import {
  DEFAULT_POLL_MS,
  DEFAULT_TIMEOUT_MS,
  DEMO_PACK_COUNT,
  DEMO_SOURCE_ID,
  demoChannelId
} from '../../../shared/show'
import type { Performer, RfPack, ShowChannel, TelemetrySource } from '../../../shared/show'

// The demo rack is the whole feature in one click: a source the main process simulates
// and a plot that names every channel it reports. Both are generated from the same ids
// (`demoChannelId`), so a pack and its telemetry can never drift apart, and the demo
// needs no configuration to be worth looking at.

interface CastMember {
  name: string
  role: string
  notes: string
}

// The cast in pack order: pack 1 wears channel 1, and so on. The principals come first
// because those are the packs an operator checks first, and the roles the panel shows
// are what the stage manager calls them. Twelve of them, one per demo channel.
const CAST: CastMember[] = [
  { name: 'Aldonza', role: 'lead', notes: 'Opens the show, cannot lose audio' },
  { name: 'Sancho', role: 'comic lead', notes: '' },
  { name: 'Cervantes', role: 'lead', notes: 'Doubles as Quixote in the frame' },
  { name: 'Pedro', role: 'ensemble', notes: '' },
  { name: 'Anselmo', role: 'ensemble', notes: '' },
  { name: 'Fermina', role: 'ensemble', notes: '' },
  { name: 'Antonia', role: 'supporting', notes: 'Quick change into the wedding scene' },
  { name: 'Padre', role: 'supporting', notes: '' },
  { name: 'Innkeeper', role: 'featured', notes: '' },
  { name: 'Carrasco', role: 'featured', notes: '' },
  { name: 'Barber', role: 'ensemble', notes: '' },
  { name: 'Housekeeper', role: 'ensemble', notes: '' }
]

/** Stable id for a demo performer, so a pack's assignment survives a re-render. */
function demoPerformerId(index: number): string {
  return `demo-performer-${index}`
}

/** The simulated rack: no URL, no polling configuration, generated in-process. */
export function demoSource(): TelemetrySource {
  return {
    id: DEMO_SOURCE_ID,
    label: 'Demo rack',
    kind: 'demo',
    target: '',
    pollMs: DEFAULT_POLL_MS,
    timeoutMs: DEFAULT_TIMEOUT_MS
  }
}

/**
 * Twelve performers, cast-side rather than plot-side, each on the strip of their own
 * number: the demo is a show somebody can open a scene on, and a performer with no strip
 * is a row no scene can move.
 */
export function demoPerformers(channels: ShowChannel[] = []): Performer[] {
  return CAST.map((member, i) => ({
    id: demoPerformerId(i + 1),
    name: member.name,
    role: member.role,
    notes: member.notes,
    channelId: channels[i]?.id ?? null
  }))
}

/** Twelve packs, each patched to the demo channel its performer wears. */
export function demoPacks(): RfPack[] {
  // The cast list and the channel count are the same number; keep them tied together
  // so a channel can never end up without a name in the plot.
  return Array.from({ length: DEMO_PACK_COUNT }, (_, i) => ({
    id: `demo-slot-${i + 1}`,
    label: `Pack ${i + 1}`,
    channelId: demoChannelId(i + 1),
    performerId: demoPerformerId(i + 1),
    notes: ''
  }))
}
