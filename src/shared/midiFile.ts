// How a MIDI File cue plays its file: the options it hands the player, the bounds each one is
// held to, and the arithmetic of how long that takes. Shared, because the window works out a
// cue's length to show it and the main process works out the same length to play it — two
// copies of one sum are two answers to how long a cue is.

import type { MidiFileCue } from './cue'

/** The slowest and fastest a file plays: the same range an audio cue's rate has. */
export const MIDI_FILE_RATE_MIN = 0.25
export const MIDI_FILE_RATE_MAX = 4

/** How far a file may be transposed, in semitones, either way. */
export const MIDI_FILE_TRANSPOSE_MAX = 48

/** The file's channels as written: channel n goes out as channel n. */
export const MIDI_FILE_IDENTITY_MAP: readonly number[] = Array.from({ length: 16 }, (_, index) => index + 1)

/** The channel General MIDI keeps its drums on, 1-based. */
export const MIDI_FILE_DRUM_CHANNEL = 10

/** What the player is told about how to play a file. */
export interface MidiFileOptions {
  rate: number
  /** The region, ms of the file at its own tempo; `endMs` null is the end of the file. */
  startMs: number
  endMs: number | null
  /** 0 plays once, n plays n more times, a negative number loops until stopped. */
  loopCount: number
  /** Sixteen entries: the output channel for each of the file's channels, or 0 for none. */
  channelMap: number[]
  transpose: number
  transposeDrums: boolean
}

/** A cue's options, as its fields say them. */
export function midiFileOptionsOf(cue: MidiFileCue): MidiFileOptions {
  return {
    rate: cue.playbackRate,
    startMs: cue.startTime,
    endMs: cue.endTime,
    loopCount: cue.loopCount,
    channelMap: [...cue.channelMap],
    transpose: cue.transpose,
    transposeDrums: cue.transposeDrums
  }
}

/**
 * Why these options cannot be played, in the operator's words, or null when they can. Every
 * bound refuses rather than clamps: each is a number the inspector already holds inside it,
 * so one outside it is a hand-edited file, and playing something other than what it says
 * would be a guess.
 */
export function midiFileOptionsProblem(options: MidiFileOptions): string | null {
  const { rate, startMs, endMs, loopCount, channelMap, transpose } = options
  if (!Number.isFinite(rate) || rate < MIDI_FILE_RATE_MIN || rate > MIDI_FILE_RATE_MAX) {
    return `the rate must be between ${MIDI_FILE_RATE_MIN}x and ${MIDI_FILE_RATE_MAX}x`
  }
  if (!Number.isFinite(startMs) || startMs < 0) return 'the start time must be zero or later'
  if (endMs !== null && (!Number.isFinite(endMs) || endMs <= startMs)) return 'the end time must come after the start time'
  if (!Number.isInteger(loopCount)) return 'the loop count must be a whole number'
  if (!Array.isArray(channelMap) || channelMap.length !== 16 ||
      channelMap.some(channel => !Number.isInteger(channel) || channel < 0 || channel > 16)) {
    return 'the channel map must name an output channel, 1–16 or none, for each of the 16 channels'
  }
  if (!Number.isInteger(transpose) || Math.abs(transpose) > MIDI_FILE_TRANSPOSE_MAX) {
    return `the transposition must be a whole number of semitones within ±${MIDI_FILE_TRANSPOSE_MAX}`
  }
  return null
}

/**
 * The part of a file of this length the options play, or null when it is empty — a start at
 * or past the end of the file, which is a region with nothing in it.
 */
export function midiFileRegion(durationMs: number, options: MidiFileOptions): { startMs: number; endMs: number } | null {
  const endMs = Math.min(options.endMs ?? durationMs, durationMs)
  if (options.startMs >= endMs) return null
  return { startMs: options.startMs, endMs }
}

/** How long one pass of the region takes to play at the options' rate, ms. */
export function midiFilePassMs(durationMs: number, options: MidiFileOptions): number {
  const region = midiFileRegion(durationMs, options)
  if (region === null) return 0
  return (region.endMs - region.startMs) / options.rate
}

/**
 * How long the whole run takes, every pass, ms — or null for a run that loops until it is
 * stopped, whose end nobody can say in advance.
 */
export function midiFileTotalMs(durationMs: number, options: MidiFileOptions): number | null {
  if (options.loopCount < 0) return null
  return midiFilePassMs(durationMs, options) * (options.loopCount + 1)
}

/**
 * The extensions a MIDI file is offered by: a dialog's filter and which dropped files become
 * MIDI File cues. Not what decides whether one plays — the parser reads the bytes, and a file
 * that is not MIDI by any name says so.
 */
export const MIDI_FILE_EXTENSIONS = ['mid', 'midi', 'smf', 'kar', 'rmi'] as const

/** Whether a file's name says it is a MIDI file. */
export function isMidiFileName(fileName: string): boolean {
  const dot = fileName.lastIndexOf('.')
  if (dot < 0) return false
  return (MIDI_FILE_EXTENSIONS as readonly string[]).includes(fileName.slice(dot + 1).toLowerCase())
}
