// The report's inputs from this process, and the three verbs the window asks for.
//
// Split from `report.ts` so the composer stays a pure function of its facts: everything that
// touches Electron, the OS or the disk is here, and handlers.ts only registers it.

import { app, clipboard, dialog, shell } from 'electron'
import { writeFile } from 'node:fs/promises'
import { homedir, release } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import type { ReportEmailResult, ReportInput, ReportSaveResult } from '../../shared/ipc/app'
import { SUPPORT_ADDRESS } from '../../shared/support'
import type { NativeAudioEngine } from '../audio/AudioEngine'
import { Refusal } from '../ipc/refusal'
import { composeReport, readCrashDumps, REPORT_TEXT_LIMIT, type ReportFacts } from './report'

/** What the report needs from the rest of main. */
export interface ReportSources {
  engine: Pick<NativeAudioEngine, 'snapshot' | 'status'>
}

export function gatherFacts(sources: ReportSources, now: number = Date.now()): ReportFacts {
  const crashDumpDir = app.getPath('crashDumps')
  return {
    appVersion: app.getVersion(),
    packaged: app.isPackaged,
    electron: process.versions.electron ?? 'unknown',
    chrome: process.versions.chrome ?? 'unknown',
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    osRelease: release(),
    engine: sources.engine.snapshot(),
    engineStatus: sources.engine.status(),
    crashDumps: readCrashDumps(crashDumpDir),
    crashDumpDir,
    home: homedir(),
    now
  }
}

export function compose(sources: ReportSources, input: ReportInput): string {
  if (typeof input?.description !== 'string' || !Array.isArray(input.log)
    || input.log.some(line => typeof line !== 'string')) {
    throw new Refusal('The report could not be built from what the window sent.')
  }
  return composeReport(gatherFacts(sources), input)
}

/** The text a save or a mail acts on: a string, and one no composed report could exceed. */
function checked(text: unknown): string {
  if (typeof text !== 'string' || text === '') throw new Refusal('There is no report to send.')
  if (text.length > REPORT_TEXT_LIMIT) throw new Refusal('The report is too large to save or mail.')
  return text
}

function stamp(now: Date): string {
  const two = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}`
}

export async function saveReport(win: BrowserWindow, text: unknown): Promise<ReportSaveResult> {
  const body = checked(text)
  const picked = await dialog.showSaveDialog(win, {
    title: 'Save Problem Report',
    defaultPath: join(app.getPath('documents'), `cuerunner-report-${stamp(new Date())}.txt`),
    filters: [{ name: 'Text', extensions: ['txt'] }]
  })
  if (picked.canceled || !picked.filePath) return { ok: true, path: null }
  await writeFile(picked.filePath, body, 'utf8')
  return { ok: true, path: picked.filePath }
}

/**
 * A mailto: URL cannot carry a report — Windows drops anything past about two thousand
 * characters — so the report goes on the clipboard and the message says to paste it.
 */
export async function emailReport(text: unknown): Promise<ReportEmailResult> {
  const body = checked(text)
  clipboard.writeText(body)
  const subject = `Cuerunner ${app.getVersion()} problem report`
  const message = 'The problem report is on your clipboard. Paste it here, and add anything the report does not say.'
  await shell.openExternal(
    `mailto:${SUPPORT_ADDRESS}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`
  )
  return { ok: true }
}
