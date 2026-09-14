import { useEffect } from 'react'
import { useStore } from '../store'

/**
 * Registers a modal panel for as long as it is mounted, which is what tells the transport
 * bindings to stand down: a modal owns the keyboard, so a Space typed into a field in it
 * does not also fire the show's next cue behind it, and its own Escape does not stop the
 * show on the way past.
 *
 * A count rather than a flag, because a modal can open another one and the keyboard
 * belongs to the innermost of them; it belongs to none of them once the last closes.
 */
export function useModal(): void {
  const pushModal = useStore(s => s.pushModal)
  const popModal = useStore(s => s.popModal)

  useEffect(() => {
    pushModal()
    return popModal
  }, [pushModal, popModal])
}
