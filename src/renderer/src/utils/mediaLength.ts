// What the app knows about the length of the files a show points at.
//
// A cue's `duration` is workspace content and is 0 until something has measured the
// file, so a workspace that has just been loaded carries no lengths at all: a row reads
// `–` and a timeline block is a stub. Those two are the same fault — a length nobody
// has asked for — and this is the model that makes them legible, for the measurement
// pass (`useMediaLengths`) and for the surfaces that draw a cue.
//
// One cue's file has three possible answers, and only two of them can be stored:
// `measuring` is the state of a file nobody has answered for yet, so it is derived from
// the absence of an answer rather than written down. What is written down is the two
// answers that are final for the session: the file is not there (or not readable), and
// the file states no length. Both are facts about the file, not about the operator's
// show, so neither belongs in the workspace file.

import type { AudioCue, Cue } from '../types/cue'
import type { MissingMedia } from '../../../shared/media'

/** A final answer about one cue's file. Absent means nobody has asked yet. */
export interface MediaLengthAnswer {
  /**
   * The file the answer is about. A cue pointed at a different file has not been
   * measured, whatever was learned about the last one — which is what makes a relink
   * measure again without anybody having to clear anything.
   */
  path: string
  state: 'missing' | 'no-length'
}

/** How one cue's length reads, or null when there is nothing to say about it. */
export type MediaLengthState = 'measuring' | 'missing' | 'no-length'

/** The session's answers, beside the files the workspace could not find when it loaded. */
export interface MediaLengths {
  answers: Record<string, MediaLengthAnswer>
  /** Cue ids whose file the workspace could not find on this machine. */
  missing: Set<string>
}

export function mediaLengthsFrom(
  answers: Record<string, MediaLengthAnswer>,
  missingMedia: MissingMedia[]
): MediaLengths {
  return { answers, missing: new Set(missingMedia.map(media => media.cueId)) }
}

/**
 * How a cue's length reads. Null for a cue whose length is not a file's — a wait or a
 * group, an audio cue nobody has given a file to — and for one that has been measured.
 */
export function mediaLengthState(cue: Cue, lengths: MediaLengths): MediaLengthState | null {
  if (cue.type !== 'audio' || cue.filePath === '') return null
  // A file that is not there is missing however well its length was once known: the cue
  // cannot play, and a length left over from another machine would only make it look
  // like it could.
  if (lengths.missing.has(cue.id)) return 'missing'
  const answer = lengths.answers[cue.id]
  if (answer && answer.path === cue.filePath) return answer.state
  return cue.duration > 0 ? null : 'measuring'
}

/**
 * The files the measurement pass still has to ask the engine about, in cue order: every
 * audio cue with a file and no length, minus the ones that are already settled — the
 * file the workspace could not find, and the file that has answered.
 */
export function cuesAwaitingLength(cues: Cue[], lengths: MediaLengths): AudioCue[] {
  return cues.filter((cue): cue is AudioCue =>
    cue.type === 'audio' &&
    cue.filePath !== '' &&
    cue.duration <= 0 &&
    !lengths.missing.has(cue.id) &&
    lengths.answers[cue.id]?.path !== cue.filePath)
}

/**
 * What a group's length does not know yet, from the files under it: `missing` when one
 * of them cannot be read, `measuring` while one has not answered. Null when every
 * length under the group is known — or when the group has no knowable length at all,
 * a playlist or a random group firing one child per GO.
 */
export function groupLengthState(
  cues: Cue[],
  groupId: string,
  lengths: MediaLengths
): Extract<MediaLengthState, 'measuring' | 'missing'> | null {
  const group = cues.find(c => c.id === groupId)
  if (!group || group.type !== 'group') return null
  if (group.mode === 'playlist' || group.mode === 'random') return null

  const states = subtreeLengthStates(cues, groupId, lengths, new Set([groupId]))
  if (states.has('missing')) return 'missing'
  if (states.has('measuring')) return 'measuring'
  return null
}

function subtreeLengthStates(
  cues: Cue[],
  groupId: string,
  lengths: MediaLengths,
  seen: Set<string>
): Set<'measuring' | 'missing'> {
  const states = new Set<'measuring' | 'missing'>()
  for (const child of cues) {
    if (child.parentId !== groupId) continue
    if (child.type === 'group') {
      // A malformed parent chain (a group that is its own ancestor) stops at the
      // repeated group rather than looping forever.
      if (seen.has(child.id)) continue
      seen.add(child.id)
      for (const state of subtreeLengthStates(cues, child.id, lengths, seen)) states.add(state)
      continue
    }
    const state = mediaLengthState(child, lengths)
    // `no-length` is a length that is known: the file said it does not state one.
    if (state === 'measuring' || state === 'missing') states.add(state)
  }
  return states
}