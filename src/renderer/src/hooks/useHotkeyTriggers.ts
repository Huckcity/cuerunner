import { useEffect } from 'react'
import { cueEngine } from '../engine/CueEngine'
import { useStore } from '../store'
import { cuesForHotkey, hotkeyFromPress } from '../utils/hotkeys'
import { formatShortcut } from '../utils/shortcuts'

/**
 * Fires the cues a key on this machine's keyboard answers.
 *
 * The keys the transport answers are guarded the same way: nothing while a modal panel owns
 * the keyboard, nothing while a field is being typed in, and a key held down is one press. A
 * key the app answers itself never reaches a cue (`cuesForHotkey`), so a trigger can never take
 * GO, STOP or PANIC off the operator. What reaches the runner first is the guard, as for every
 * other way of firing: a key that bounced is one firing.
 */
export function useHotkeyTriggers(): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.repeat) return
      const store = useStore.getState()
      if (store.modals > 0) return
      const el = e.target as HTMLElement | null
      const tag = el?.tagName
      if ((tag === 'INPUT' && (el as HTMLInputElement).type !== 'range') || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (el?.isContentEditable) return
      const key = hotkeyFromPress(e)
      if (key === null) return
      const cues = cuesForHotkey(store.cues, key)
      if (cues.length === 0) return
      e.preventDefault()
      if (!cueEngine.acceptsFire('key', `hotkey:${key}`)) return
      for (const cue of cues) {
        store.appendLog([{
          level: 'info',
          label: `${cue.number} · ${cue.name}`,
          message: `Triggered by the key ${formatShortcut(key)}`
        }])
        cueEngine.goById(cue.id)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])
}
