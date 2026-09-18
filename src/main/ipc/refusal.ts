// The main-process half of the refusal discipline: the marker raised where an ordinary
// state is detected, and the one conversion that turns it into the value each channel
// declares.
//
// The audio verbs are the worked example this follows (`audioVerb` in handlers.ts): a
// refusal is an answer, and Electron logs every rejected `ipcMain.handle` to stderr with a
// stack. The difference is that audio converts *every* rejection, because the engine's
// verbs refuse by design; here only a marked error converts, so an unexpected fault — a
// bug in the workspace code, a save whose disk is full — still rejects and stays findable.
//
// Marking belongs where the state is detected (a file that is not JSON, an archive that is
// damaged) and conversion belongs at the channel boundary, so a channel's regime is
// decided once rather than at each of its call sites.

import type { Refusal as RefusalValue } from '../../shared/ipc/refusal'

/**
 * An ordinary state of the system, raised where it was detected.
 *
 * It extends `Error` on purpose: the same sentences were thrown before this existed, and
 * every caller and test that reads an error's message keeps working unchanged.
 */
export class Refusal extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'Refusal'
  }
}

/** Whether a throw is the app saying no to an ordinary state rather than failing. */
export function isRefusal(error: unknown): error is Refusal {
  return error instanceof Refusal
}

/** The refusal an ordinary failure means: a marker already in hand passes through. */
export function asRefusal(error: unknown): Refusal {
  return isRefusal(error) ? error : new Refusal(error instanceof Error ? error.message : String(error))
}

/**
 * A channel's answer, with the one conversion the discipline needs: a marked refusal
 * becomes the value `{ ok: false, error }`, and anything else keeps rejecting, because a
 * fault is not an answer a caller can be handed.
 */
export async function refusalValue<T>(run: () => Promise<T>): Promise<T | RefusalValue> {
  try {
    return await run()
  } catch (error) {
    if (isRefusal(error)) return { ok: false, error: error.message }
    throw error
  }
}
