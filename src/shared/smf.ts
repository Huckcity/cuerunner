// A Standard MIDI File, read from its bytes into one timeline of messages with their times.
//
// Written from the file format's own specification (the MIDI Manufacturers Association's
// "Standard MIDI Files 1.0"), not from any player's code. It is pure: bytes in, a song or a
// refusal out, so the same function serves the main process that plays a file and the tests
// that build files byte by byte.
//
// What a file can be is wide, and what this reads is all of it that a show plays:
//
//   - formats 0 (one track), 1 (tracks played together) and 2 (tracks played one after another);
//   - metrical time (ticks per quarter note, where a Set Tempo anywhere in the file moves
//     everything after it) and SMPTE time (frames and ticks per frame, where tempo means nothing);
//   - running status, Note On at velocity 0 as a release, SysEx whole or in packets, the escape
//     form, and every meta event — read for what it says (names, tempo) and never sent;
//   - a RIFF "RMID" wrapper around the file, which is how Windows names a `.rmi`.
//
// A file that is not one of those is refused with a sentence and the code beside it — never a
// throw. Every read is bounded: the file's size, the tracks it may hold, the events it may
// carry and the length of each variable-length number, so a damaged or hostile file costs at
// most what a large honest one would.

/** The most bytes a file may have before it is refused unread. Show files are kilobytes. */
export const SMF_MAX_BYTES = 16 * 1024 * 1024

/** The most tracks a file may declare. The format allows 65535; no sequencer writes that. */
export const SMF_MAX_TRACKS = 1024

/** The most events — every kind, meta included — across all of a file's tracks. */
export const SMF_MAX_EVENTS = 1_000_000

/** A track's name as the inspector shows it is cut here: a name, not a lyric sheet. */
const MAX_NAME_CHARS = 64

/** The tempo a metrical file plays at until it says otherwise: 120 BPM, by the specification. */
const DEFAULT_US_PER_QUARTER = 500_000

/** Why a file was refused. The sentence beside it is the one the operator reads. */
export type SmfRefusalCode =
  | 'too-large'
  | 'not-midi'
  | 'header-short'
  | 'format-unknown'
  | 'format0-tracks'
  | 'no-tracks'
  | 'too-many-tracks'
  | 'division-invalid'
  | 'tracks-missing'
  | 'track-truncated'
  | 'event-truncated'
  | 'length-too-long'
  | 'running-status-missing'
  | 'status-invalid'
  | 'data-invalid'
  | 'tempo-invalid'
  | 'too-many-events'

export interface SmfRefusal {
  ok: false
  code: SmfRefusalCode
  /** The sentence for the operator: what is wrong with this file, in their words. */
  error: string
}

/** How a file counts time. */
export type SmfTiming =
  | { kind: 'metrical'; ticksPerQuarter: number }
  /** `framesPerSecond` is 24, 25, 29.97 (the file's "29", drop-frame) or 30. */
  | { kind: 'smpte'; framesPerSecond: number; ticksPerFrame: number }

/**
 * One message to send, at its time in the file. `data` is the message's bytes as they go on
 * the wire: a channel message with its status written out (running status expanded), a SysEx
 * framed F0 … F7, or the escape form's bytes as the file wrote them.
 */
export interface SmfEvent {
  /** Milliseconds from the start of the file, with the tempo map applied. */
  ms: number
  /** The track it came from, zero-based. */
  track: number
  data: number[]
}

/** What one track holds, for the inspector's track list. */
export interface SmfTrackInfo {
  /** Its first Sequence/Track Name meta event, or empty when it has none. */
  name: string
  /** Channel messages: notes, controllers, programs, bends, pressure. */
  channelEvents: number
  /** Note Ons that sound (velocity above 0). */
  notes: number
  sysex: number
  meta: number
  /** The channels its messages are on, 1–16, ascending. */
  channels: number[]
  /** Where its End of Track falls, in ms from the start of the file. */
  endMs: number
}

export interface SmfSong {
  format: 0 | 1 | 2
  timing: SmfTiming
  /** The whole file's length, including the silence before the last End of Track. */
  durationMs: number
  tracks: SmfTrackInfo[]
  /** Every message to send, in the order it plays. */
  events: SmfEvent[]
  /** Channels used anywhere in the file, 1–16. */
  channels: number[]
  /** The tempo the file starts at, BPM; null for an SMPTE file, where tempo means nothing. */
  initialBpm: number | null
  /** How many Set Tempo events the file carries. */
  tempoChanges: number
}

export type SmfResult = { ok: true; song: SmfSong } | SmfRefusal

/**
 * What the inspector is shown about a file: everything but the events, which stay in the
 * process that plays them.
 */
export type SmfSummary = Omit<SmfSong, 'events'> & { eventCount: number }

export function summarizeSmf(song: SmfSong): SmfSummary {
  const { events, ...rest } = song
  return { ...rest, eventCount: events.length }
}

/** The sentence each refusal is said in. `detail` names the place where it was found. */
function refuse(code: SmfRefusalCode, detail = ''): SmfRefusal {
  const sentences: Record<SmfRefusalCode, string> = {
    'too-large': `the file is larger than ${SMF_MAX_BYTES / (1024 * 1024)} MB, which no MIDI file a show plays is`,
    'not-midi': 'this is not a MIDI file: it does not begin with a MIDI header',
    'header-short': 'the MIDI header is cut short',
    'format-unknown': 'the file says it is a MIDI format this app does not know (only 0, 1 and 2 exist)',
    'format0-tracks': 'the file says it is format 0, which holds one track, and declares more or fewer',
    'no-tracks': 'the file declares no tracks, so there is nothing in it to play',
    'too-many-tracks': `the file declares more than ${SMF_MAX_TRACKS} tracks`,
    'division-invalid': 'the file’s timing is not one a MIDI file can have',
    'tracks-missing': 'the file ends before all the tracks its header declares',
    'track-truncated': 'a track says it is longer than the file that holds it',
    'event-truncated': 'an event runs past the end of its track',
    'length-too-long': 'a length in the file is longer than four bytes, which the format does not allow',
    'running-status-missing': 'a track begins with data and no status byte to say what it is',
    'status-invalid': 'a track holds a status byte that has no meaning in a MIDI file',
    'data-invalid': 'a message carries a data byte above 127',
    'tempo-invalid': 'a Set Tempo event is not three bytes, or sets a tempo of zero',
    'too-many-events': `the file holds more than ${SMF_MAX_EVENTS.toLocaleString('en-GB')} events`
  }
  return { ok: false, code, error: detail === '' ? sentences[code] : `${sentences[code]} (${detail})` }
}

/** A refusal found deep in a read, carried out of it without a throw reaching the caller. */
class Stop {
  constructor(readonly refusal: SmfRefusal) {}
}

function fourCC(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3])
}

function u32(bytes: Uint8Array, at: number): number {
  return ((bytes[at] << 24) >>> 0) + (bytes[at + 1] << 16) + (bytes[at + 2] << 8) + bytes[at + 3]
}

function u16(bytes: Uint8Array, at: number): number {
  return (bytes[at] << 8) | bytes[at + 1]
}

/** A RIFF chunk's length is little-endian, unlike every length inside the MIDI file. */
function u32le(bytes: Uint8Array, at: number): number {
  return bytes[at] + (bytes[at + 1] << 8) + (bytes[at + 2] << 16) + ((bytes[at + 3] << 24) >>> 0)
}

/**
 * The MIDI file inside a RIFF "RMID" wrapper, or the bytes themselves when there is none. A
 * wrapper with no `data` chunk is not a MIDI file, and says so the way any other one does.
 */
function unwrapRiff(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 12 || fourCC(bytes, 0) !== 'RIFF' || fourCC(bytes, 8) !== 'RMID') return bytes
  let at = 12
  while (at + 8 <= bytes.length) {
    const id = fourCC(bytes, at)
    const length = u32le(bytes, at + 4)
    const start = at + 8
    if (id === 'data') return bytes.subarray(start, Math.min(bytes.length, start + length))
    // RIFF pads every chunk to an even length.
    at = start + length + (length % 2)
  }
  return new Uint8Array(0)
}

/** One track's events as read, before the tempo map turns ticks into milliseconds. */
interface RawEvent {
  tick: number
  /** Its order in its own track, so events at one tick keep the order the file wrote. */
  seq: number
  data: number[] | null
  /** Microseconds per quarter note, on a Set Tempo meta event. */
  tempo?: number
}

interface RawTrack {
  events: RawEvent[]
  endTick: number
  info: Omit<SmfTrackInfo, 'endMs' | 'channels'> & { channelMask: number }
}

/** Reads one track chunk's bytes into its events. */
function readTrack(bytes: Uint8Array, start: number, end: number, budget: { events: number }): RawTrack {
  const events: RawEvent[] = []
  const info = { name: '', channelEvents: 0, notes: 0, sysex: 0, meta: 0, channelMask: 0 }
  let at = start
  let tick = 0
  let seq = 0
  let running = 0
  let nameSeen = false
  // A SysEx sent in packets: the F0 that opened it and every F7 continuation since, joined,
  // and the tick it began on — it goes out whole, when its first packet was due.
  let packet: { tick: number; seq: number; data: number[] } | null = null

  const need = (count: number): void => {
    if (at + count > end) throw new Stop(refuse('event-truncated'))
  }
  const vlq = (): number => {
    let value = 0
    for (let i = 0; i < 4; i++) {
      need(1)
      const byte = bytes[at++]
      value = value * 128 + (byte & 0x7f)
      if ((byte & 0x80) === 0) return value
    }
    throw new Stop(refuse('length-too-long'))
  }
  const take = (length: number): number[] => {
    need(length)
    const out = Array.from(bytes.subarray(at, at + length))
    at += length
    return out
  }
  const count = (): void => {
    if (--budget.events < 0) throw new Stop(refuse('too-many-events'))
  }

  while (at < end) {
    tick += vlq()
    need(1)
    let status = bytes[at]
    if (status < 0x80) {
      // Running status: this byte is data for the status the track last set.
      if (running === 0) throw new Stop(refuse('running-status-missing'))
      status = running
    } else {
      at++
    }
    count()

    if (status < 0xf0) {
      running = status
      const length = (status & 0xf0) === 0xc0 || (status & 0xf0) === 0xd0 ? 1 : 2
      const data = take(length)
      if (data.some(byte => byte > 0x7f)) throw new Stop(refuse('data-invalid'))
      const kind = status & 0xf0
      info.channelEvents++
      info.channelMask |= 1 << (status & 0x0f)
      if (kind === 0x90 && data[1] > 0) info.notes++
      events.push({ tick, seq: seq++, data: [status, ...data] })
      continue
    }

    // SysEx and meta events cancel running status (Standard MIDI Files 1.0, "Running Status").
    running = 0
    if (status === 0xf0) {
      const body = take(vlq())
      info.sysex++
      if (body[body.length - 1] === 0xf7) {
        events.push({ tick, seq: seq++, data: [0xf0, ...body] })
        packet = null
      } else {
        packet = { tick, seq: seq++, data: [0xf0, ...body] }
      }
      continue
    }
    if (status === 0xf7) {
      const body = take(vlq())
      if (packet !== null) {
        // A continuation packet of the SysEx an F0 opened.
        packet.data.push(...body)
        if (body[body.length - 1] === 0xf7) {
          events.push({ tick: packet.tick, seq: packet.seq, data: packet.data })
          packet = null
        }
      } else {
        // The escape form: these bytes go on the wire exactly as written.
        info.sysex++
        if (body.length > 0) events.push({ tick, seq: seq++, data: body })
      }
      continue
    }
    if (status === 0xff) {
      need(1)
      const type = bytes[at++]
      const body = take(vlq())
      info.meta++
      if (type === 0x2f) {
        // End of Track: anything after it in the chunk is not part of the track.
        return { events, endTick: tick, info }
      }
      if (type === 0x03 && !nameSeen) {
        nameSeen = true
        info.name = latin1(body).slice(0, MAX_NAME_CHARS).trim()
      }
      if (type === 0x51) {
        const tempo = body.length === 3 ? (body[0] << 16) | (body[1] << 8) | body[2] : 0
        if (tempo === 0) throw new Stop(refuse('tempo-invalid'))
        events.push({ tick, seq: seq++, data: null, tempo })
      }
      continue
    }
    // F1–F6 and F8–FE are system messages a file has no way to carry.
    throw new Stop(refuse('status-invalid', `0x${status.toString(16).toUpperCase()}`))
  }
  // No End of Track: the format requires one, and plenty of files in the world leave it off.
  // The track ends where its last event is, which is what every player reads it as.
  return { events, endTick: tick, info }
}

function latin1(body: number[]): string {
  let text = ''
  for (const byte of body) text += byte >= 0x20 ? String.fromCharCode(byte) : ' '
  return text
}

/**
 * Ticks to milliseconds for one timeline: the tempo changes it carries, in tick order, from
 * the default 120 BPM. An SMPTE file's ticks have one length, whatever tempo it names.
 */
function tickClock(timing: SmfTiming, tempos: { tick: number; tempo: number }[]): (tick: number) => number {
  if (timing.kind === 'smpte') {
    const msPerTick = 1000 / (timing.framesPerSecond * timing.ticksPerFrame)
    return tick => tick * msPerTick
  }
  const ppq = timing.ticksPerQuarter
  // Each segment: from this tick, at this tempo, starting at this many ms.
  const segments: { tick: number; ms: number; usPerQuarter: number }[] = [{ tick: 0, ms: 0, usPerQuarter: DEFAULT_US_PER_QUARTER }]
  for (const change of tempos) {
    const last = segments[segments.length - 1]
    const ms = last.ms + ((change.tick - last.tick) * last.usPerQuarter) / ppq / 1000
    if (change.tick === last.tick) {
      last.usPerQuarter = change.tempo
    } else {
      segments.push({ tick: change.tick, ms, usPerQuarter: change.tempo })
    }
  }
  return tick => {
    // The last segment that starts at or before this tick. Ticks only go up within a walk,
    // but the callers are few enough that a binary search is plenty.
    let lo = 0
    let hi = segments.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (segments[mid].tick <= tick) lo = mid
      else hi = mid - 1
    }
    const segment = segments[lo]
    return segment.ms + ((tick - segment.tick) * segment.usPerQuarter) / ppq / 1000
  }
}

function maskChannels(mask: number): number[] {
  const channels: number[] = []
  for (let channel = 0; channel < 16; channel++) if ((mask & (1 << channel)) !== 0) channels.push(channel + 1)
  return channels
}

/** Reads a file. Never throws: a file that cannot be played is a refusal with its reason. */
export function parseSmf(input: Uint8Array): SmfResult {
  try {
    return parse(input)
  } catch (error) {
    if (error instanceof Stop) return error.refusal
    throw error
  }
}

function parse(input: Uint8Array): SmfResult {
  if (input.length > SMF_MAX_BYTES) return refuse('too-large')
  const bytes = unwrapRiff(input)
  if (bytes.length < 8 || fourCC(bytes, 0) !== 'MThd') return refuse('not-midi')
  const headerLength = u32(bytes, 4)
  if (headerLength < 6 || bytes.length < 8 + 6) return refuse('header-short')
  if (8 + headerLength > bytes.length) return refuse('header-short')

  const format = u16(bytes, 8)
  const declaredTracks = u16(bytes, 10)
  const division = u16(bytes, 12)
  if (format > 2) return refuse('format-unknown', `format ${format}`)
  if (declaredTracks === 0) return refuse('no-tracks')
  if (format === 0 && declaredTracks !== 1) return refuse('format0-tracks', `${declaredTracks} tracks`)
  if (declaredTracks > SMF_MAX_TRACKS) return refuse('too-many-tracks', `${declaredTracks}`)

  let timing: SmfTiming
  if ((division & 0x8000) === 0) {
    if (division === 0) return refuse('division-invalid', 'zero ticks per quarter note')
    timing = { kind: 'metrical', ticksPerQuarter: division }
  } else {
    // The high byte is the frame rate as a negative number: -24, -25, -29 (drop-frame) or -30.
    const frames = 256 - (division >> 8)
    const ticksPerFrame = division & 0xff
    const rates: Record<number, number> = { 24: 24, 25: 25, 29: 30000 / 1001, 30: 30 }
    if (rates[frames] === undefined) return refuse('division-invalid', `${frames} frames per second`)
    if (ticksPerFrame === 0) return refuse('division-invalid', 'zero ticks per frame')
    timing = { kind: 'smpte', framesPerSecond: rates[frames], ticksPerFrame }
  }

  // The chunks after the header: tracks, and anything else, which the format says a reader
  // skips — a chunk type it does not know is a later version's, not damage.
  const budget = { events: SMF_MAX_EVENTS }
  const tracks: RawTrack[] = []
  let at = 8 + headerLength
  while (tracks.length < declaredTracks) {
    if (at + 8 > bytes.length) return refuse('tracks-missing', `${tracks.length} of ${declaredTracks}`)
    const id = fourCC(bytes, at)
    const length = u32(bytes, at + 4)
    const start = at + 8
    if (start + length > bytes.length) return refuse('track-truncated', `track ${tracks.length + 1}`)
    if (id === 'MTrk') tracks.push(readTrack(bytes, start, start + length, budget))
    at = start + length
  }

  const events: SmfEvent[] = []
  const infos: SmfTrackInfo[] = []
  let tempoChanges = 0
  let initialTempo: number | null = null
  let durationMs = 0
  let channelMask = 0

  const place = (track: RawTrack, index: number, clock: (tick: number) => number, offsetMs: number): void => {
    for (const event of track.events) {
      if (event.data !== null) events.push({ ms: offsetMs + clock(event.tick), track: index, data: event.data })
    }
    const endMs = offsetMs + clock(track.endTick)
    channelMask |= track.info.channelMask
    const { channelMask: mask, ...info } = track.info
    infos.push({ ...info, channels: maskChannels(mask), endMs })
    durationMs = Math.max(durationMs, endMs)
  }

  if (format === 2) {
    // Each track is a sequence of its own, with its own tempo map, played after the last.
    let offsetMs = 0
    for (let index = 0; index < tracks.length; index++) {
      const track = tracks[index]
      const tempos = track.events.filter(event => event.tempo !== undefined).map(event => ({ tick: event.tick, tempo: event.tempo! }))
      tempoChanges += tempos.length
      if (index === 0) initialTempo = tempos.filter(change => change.tick === 0).pop()?.tempo ?? DEFAULT_US_PER_QUARTER
      place(track, index, tickClock(timing, tempos), offsetMs)
      offsetMs = durationMs
    }
  } else {
    // One timeline for every track: a Set Tempo in any of them — the conductor track, by
    // convention — moves the events of all of them that follow it. Tempo changes at one tick
    // apply in track order, so the last one written wins.
    const tempos = tracks
      .flatMap((track, index) => track.events
        .filter(event => event.tempo !== undefined)
        .map(event => ({ tick: event.tick, tempo: event.tempo!, track: index, seq: event.seq })))
      .sort((a, b) => a.tick - b.tick || a.track - b.track || a.seq - b.seq)
    tempoChanges = tempos.length
    initialTempo = tempos.filter(change => change.tick === 0).pop()?.tempo ?? DEFAULT_US_PER_QUARTER
    const clock = tickClock(timing, tempos)
    for (let index = 0; index < tracks.length; index++) place(tracks[index], index, clock, 0)
    // Merged: by time, then by track, then in the order each track wrote them — the sort is
    // stable and every track's own events are already in its order.
    events.sort((a, b) => a.ms - b.ms || a.track - b.track)
  }

  return {
    ok: true,
    song: {
      format: format as 0 | 1 | 2,
      timing,
      durationMs,
      tracks: infos,
      events,
      channels: maskChannels(channelMask),
      initialBpm: timing.kind === 'smpte' || initialTempo === null ? null : 60_000_000 / initialTempo,
      tempoChanges
    }
  }
}
