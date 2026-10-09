import { existingOutputManager } from './ipc'

/**
 * Takes every picture down over `fadeMs`: what a panic does to the outputs. A machine whose
 * show has never declared an output has none to clear, and nothing is made to clear them.
 */
export function panicOutputs(fadeMs: number): void {
  existingOutputManager()?.panic(fadeMs)
}
