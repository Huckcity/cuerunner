import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import type { ViewMenuAction } from '../../../shared/fileMenu'

/** The key show mode answers to, in and out — the one QLab-style apps have taught operators. */
export const SHOW_MODE_KEY = 'F5'

/** The key the cart answers to, beside it. */
export const CART_KEY = 'F6'

function readStored(key: string): boolean {
  try { return localStorage.getItem(key) === 'true' } catch { return false }
}

function writeStored(key: string, on: boolean): void {
  try { localStorage.setItem(key, String(on)) } catch { /* the default is fine */ }
}

/**
 * One of the window's views, on and off: its function key from anywhere a modal is not open,
 * and its item in the View menu. `remember` keeps it across launches on this machine — the
 * cart, which a sound-effects board is built in — where show mode is session state: a show
 * opens in the editing view, and an operator who left it in show mode last night is not
 * surprised by a list they cannot edit this morning.
 */
function useViewToggle(
  key: string,
  action: ViewMenuAction,
  remember?: string,
  intercept?: () => boolean
): [boolean, () => void] {
  const [on, setOn] = useState(() => remember === undefined ? false : readStored(remember))
  // A press somebody else answered — a cart list flipping its own face — leaves the view alone.
  const interceptRef = useRef(intercept)
  interceptRef.current = intercept
  const toggle = useCallback(() => {
    if (interceptRef.current?.() === true) return
    setOn(current => !current)
  }, [])

  useEffect(() => {
    if (remember !== undefined) writeStored(remember, on)
  }, [on, remember])

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key !== key || e.repeat) return
      // A modal owns the keyboard while it is up, as it does for the transport's keys.
      if (useStore.getState().modals > 0) return
      e.preventDefault()
      toggle()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [key, toggle])

  useEffect(() => window.cuerunner.app.onMenuAction(menuAction => {
    if (menuAction === action) toggle()
  }), [action, toggle])

  return [on, toggle]
}

/** Show mode (F5): the large-type, read-only operator view. */
export function useShowMode(): [boolean, () => void] {
  return useViewToggle(SHOW_MODE_KEY, 'show-mode')
}

/**
 * The cart (F6): the list as a wall of buttons, each firing its cue. Remembered on this machine.
 * `intercept` answers the press first where the list on screen is a cart already, whose F6 shows
 * it as rows for editing and back, rather than turning every other list into a cart.
 */
export function useCartMode(intercept?: () => boolean): [boolean, () => void] {
  return useViewToggle(CART_KEY, 'cart', 'cuerunner.cart', intercept)
}
