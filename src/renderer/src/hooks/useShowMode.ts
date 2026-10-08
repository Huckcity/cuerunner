import { useCallback, useEffect, useState } from 'react'
import { useStore } from '../store'

/** The key show mode answers to, in and out — the one QLab-style apps have taught operators. */
export const SHOW_MODE_KEY = 'F5'

/**
 * Show mode, on and off: F5 from anywhere a modal is not open, and View → Show Mode from the
 * application menu. Session state — a show opens in the editing view, and an operator who left
 * it in show mode last night is not surprised by a list they cannot edit this morning.
 */
export function useShowMode(): [boolean, () => void] {
  const [on, setOn] = useState(false)
  const toggle = useCallback(() => setOn(current => !current), [])

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key !== SHOW_MODE_KEY || e.repeat) return
      // A modal owns the keyboard while it is up, as it does for the transport's keys.
      if (useStore.getState().modals > 0) return
      e.preventDefault()
      toggle()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [toggle])

  useEffect(() => window.cuerunner.app.onMenuAction(action => {
    if (action === 'show-mode') toggle()
  }), [toggle])

  return [on, toggle]
}
