import { useEffect, useCallback } from 'react'
import { cueEngine } from '../engine/CueEngine'
import { useStore } from '../store'
import { isPro } from '../../../shared/license'

export function useCueEngine() {
  const setRunning = useStore(s => s.setRunning)
  const clearAllRunning = useStore(s => s.clearAllRunning)
  const select = useStore(s => s.select)
  const syncCueDuration = useStore(s => s.syncCueDuration)
  const setLastRun = useStore(s => s.setLastRun)
  const appendLog = useStore(s => s.appendLog)

  useEffect(() => {
    cueEngine.init({
      getCues: () => useStore.getState().cues,
      getSelected: () => useStore.getState().selectedId,
      setSelected: select,
      setRunning,
      clearAllRunning,
      syncCueDuration,
      setLastRun,
      appendLog,
      getWorkspacePath: () => useStore.getState().workspacePath,
      getMidiDefaultPort: () => useStore.getState().midiSettings.outputPortName,
      getTriggerGuard: () => useStore.getState().triggerGuard,
      getRunning: () => useStore.getState().running,
      isPro: () => isPro(useStore.getState().license),
      getOscPatches: () => useStore.getState().oscPatches,
      setArmed: (cueIds, armed) => useStore.getState().updateCues(cueIds, { isArmed: armed }),
      getCueLists: () => useStore.getState().cueLists,
      getActiveListId: () => useStore.getState().activeListId,
      getListPlayhead: listId => useStore.getState().listPlayhead(listId),
      setListPlayhead: (listId, cueId) => useStore.getState().setListPlayhead(listId, cueId)
    })
  }, [select, setRunning, clearAllRunning, syncCueDuration, setLastRun, appendLog])

  const go = useCallback(() => cueEngine.go(), [])
  // The operator's STOP: a cut, or the show's STOP fade with a second press to cut it.
  const stop = useCallback(() => cueEngine.operatorStop(), [])
  const panic = useCallback(() => cueEngine.panic(), [])
  const togglePause = useCallback(() => cueEngine.togglePause(), [])

  return { go, stop, panic, togglePause }
}

export function useKeyboard(go: () => void, stop: () => void, panic: () => void, togglePause?: () => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // A modal panel owns the keyboard while it is up: its own Escape closes it, and the
      // keys that run the show do nothing behind it. Read off the store rather than from a
      // dependency, so the binding does not have to be rebuilt every time a panel opens.
      if (useStore.getState().modals > 0) return
      const el = e.target as HTMLElement
      const tag = el?.tagName
      const isTextInput = (tag === 'INPUT' && (el as HTMLInputElement).type !== 'range') ||
        tag === 'TEXTAREA' || tag === 'SELECT'
      if (isTextInput) return
      if (e.code === 'Space' && !e.shiftKey) { e.preventDefault(); go() }
      if (e.code === 'Escape' && e.shiftKey) { e.preventDefault(); panic() }
      if (e.code === 'Escape' && !e.shiftKey) { e.preventDefault(); stop() }
      // P holds the whole show and lets it go again. A bare press only: with a modifier it
      // is somebody's shortcut, and a held key is one press, not a flicker of pauses.
      if (togglePause && e.code === 'KeyP' && !e.repeat && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        togglePause()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [go, stop, panic, togglePause])
}
