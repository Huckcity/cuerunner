import type { GdtfImportRequest, GdtfImportResult } from '../../../shared/dmxWire'
import { lightingCommand } from '../engine/lighting'

/**
 * A GDTF file the operator picked, read by main — a `.gdtf` is a zip, and the window has neither
 * a zip reader nor a file system — and handed back as a fixture type for the show, or as the
 * sentence it was refused with. The lighting service is Pro, so a machine without a licence is
 * refused there as well as by the locked view this is drawn in.
 */
export async function importGdtfFixture(file: File): Promise<GdtfImportResult> {
  let path = ''
  try {
    path = window.cuerunner.getPathForFile(file)
  } catch {
    // A File with no place on disk — one made in the page — has no path to give.
  }
  if (path === '') return { ok: false, error: 'that file has no place on disk this app can read it from' }
  const answer = await lightingCommand('importGdtf', { path } satisfies GdtfImportRequest)
  if (!answer.ok) return { ok: false, error: answer.error ?? 'the lighting did not take it' }
  const result = answer.result as GdtfImportResult | undefined
  return result ?? { ok: false, error: 'the lighting gave no answer' }
}
