// The problem report: one plain-text document the operator reads before it goes anywhere.
//
// Nothing here sends anything. The app has no phone-home (SPEC: offline-first), so the report is composed on request, shown in
// full, and leaves only when the operator copies it, saves it or mails it themselves. What it
// holds is what a person answering the mail would otherwise ask for one question at a time:
// the versions, the audio engine's own state and last words, the crash dumps Chromium left
// on this machine, and the tail of the session log.
//
// It never holds the show: no cue names, no file contents. The log can name a media path, and
// a path names the operator's account, so the home folder is replaced by `~` throughout.
//
// Every input is bounded. The log is the operator's session, a script can write a line as
// long as it likes, and a report that grows without a ceiling is a save that fills a disk.

import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { AudioEngineInfo } from '../../shared/audio'
import type { AudioEngineStatus } from '../audio/AudioEngine'
import type { ReportInput } from '../../shared/ipc/app'

/** What the operator typed. Longer is cut, and the cut is said. */
export const DESCRIPTION_LIMIT = 10_000
/** Log lines kept: the newest. A show's log is capped at 500 already; this is the tail of it. */
export const LOG_LINES = 300
/** One log line's ceiling — a script can print a megabyte on a single line. */
export const LOG_LINE_LIMIT = 600
/** The engine's stderr lines kept. */
export const STDERR_LINES = 20
/** Crash dumps listed, newest first. */
export const DUMP_LIMIT = 10
/** The largest text `save` and `email` accept back from the window: a composed report is far smaller. */
export const REPORT_TEXT_LIMIT = 400_000

/** One crash dump Chromium wrote on this machine: named, never read. */
export interface CrashDump {
  name: string
  bytes: number
  modified: number
}

/** Everything the report says that the window does not know, gathered by the caller. */
export interface ReportFacts {
  appVersion: string
  packaged: boolean
  electron: string
  chrome: string
  node: string
  platform: string
  arch: string
  osRelease: string
  engine: AudioEngineInfo | null
  engineStatus: AudioEngineStatus
  crashDumps: CrashDump[]
  crashDumpDir: string
  home: string
  now: number
}

/** `text` with the home folder replaced by `~`, in every spelling a path takes in a log. */
export function redactHome(text: string, home: string): string {
  if (home.length < 2) return text
  const spellings = new Set([home, home.replace(/\\/g, '/'), home.replace(/\//g, '\\')])
  let redacted = text
  for (const spelling of spellings) {
    redacted = redacted.replace(new RegExp(escapeRegExp(spelling), 'gi'), '~')
  }
  return redacted
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function cut(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}… [cut at ${limit} characters]` : text
}

/**
 * The dumps in Chromium's crash folder, newest first. Only `.dmp` files, only their names and
 * sizes: a dump holds memory, and it is the operator's to attach or not.
 */
export function readCrashDumps(dir: string): CrashDump[] {
  const found: CrashDump[] = []
  const walk = (folder: string, depth: number): void => {
    let entries: string[]
    try {
      entries = readdirSync(folder)
    } catch {
      // No folder is the state of a machine that has never crashed.
      return
    }
    for (const name of entries) {
      const path = join(folder, name)
      try {
        const stats = statSync(path)
        if (stats.isDirectory() && depth < 2) walk(path, depth + 1)
        else if (stats.isFile() && name.toLowerCase().endsWith('.dmp')) {
          found.push({ name, bytes: stats.size, modified: stats.mtimeMs })
        }
      } catch {
        // A file that vanished between the listing and the stat is not a finding.
      }
    }
  }
  walk(dir, 0)
  return found.sort((a, b) => b.modified - a.modified).slice(0, DUMP_LIMIT)
}

function engineLines(facts: ReportFacts): string[] {
  const { engine, engineStatus } = facts
  const lines = [
    `connected: ${engineStatus.connected}`,
    `restarts since launch: ${engineStatus.restarts}`
  ]
  if (engineStatus.lastError) lines.push(`last error: ${engineStatus.lastError}`)
  if (engine === null) {
    lines.push('no state received from the engine yet')
  } else {
    lines.push(
      `engine: ${engine.name} ${engine.version} (protocol ${engine.protocol})`,
      `backend: ${engine.backend}`,
      `device: ${engine.deviceName || 'none'}`,
      `sample rate: ${engine.sampleRate} Hz, ${engine.channels} channels, ${engine.format}`,
      `exclusive: ${engine.exclusive}`,
      `buffer: ${engine.bufferFrames === null ? 'not exposed' : `${engine.bufferFrames} frames`}, latency ${engine.latencyMs === null ? 'unknown' : `${engine.latencyMs} ms`}`,
      `voices playing: ${engine.activeVoices}`
    )
  }
  return lines
}

function stderrLines(facts: ReportFacts): string[] {
  const tail = facts.engineStatus.stderrTail.slice(-STDERR_LINES)
  return tail.length === 0 ? ['(nothing)'] : tail.map(line => cut(line, LOG_LINE_LIMIT))
}

/** The report, redacted, ready to show and to hand back to save or mail. */
export function composeReport(facts: ReportFacts, input: ReportInput): string {
  const description = cut(input.description.trim(), DESCRIPTION_LIMIT)
  const log = input.log.slice(-LOG_LINES).map(line => cut(line, LOG_LINE_LIMIT))
  const dumps = facts.crashDumps.map(dump =>
    `${dump.name} (${dump.bytes} bytes, ${new Date(dump.modified).toISOString()})`)

  const sections: string[] = [
    'CUERUNNER PROBLEM REPORT',
    `Made ${new Date(facts.now).toISOString()} on request. Nothing has been sent anywhere.`,
    '',
    'WHAT HAPPENED',
    description === '' ? '(nothing written)' : description,
    '',
    'THIS MACHINE',
    `Cuerunner ${facts.appVersion}${facts.packaged ? '' : ' (development build)'}`,
    `${facts.platform} ${facts.arch}, OS ${facts.osRelease}`,
    `Electron ${facts.electron}, Chromium ${facts.chrome}, Node ${facts.node}`,
    '',
    'AUDIO ENGINE',
    ...engineLines(facts),
    '',
    'ENGINE STDERR (last lines)',
    ...stderrLines(facts),
    '',
    `CRASH DUMPS in ${facts.crashDumpDir}`,
    ...(dumps.length === 0 ? ['(none)'] : dumps),
    'Dumps are not included. Attach one if asked.',
    '',
    `SESSION LOG (last ${log.length} lines)`,
    ...(log.length === 0 ? ['(empty)'] : log),
    ''
  ]
  return redactHome(sections.join('\n'), facts.home)
}
