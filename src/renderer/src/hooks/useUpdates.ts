import { useEffect } from 'react'
import { useStore } from '../store'
import { setUpdateStatus } from '../engine/updateStatus'

/**
 * The window's half of updating: it follows the status main pushes, and tells main what the
 * show is doing whenever that changes — whether anything is running, whether the window is in
 * Show Mode, and whether the show is a file — because those are what main decides a download,
 * a restart and a check by, and the show lives here.
 */
export function useUpdates(showMode: boolean): void {
  const busy = useStore(s => s.running.size > 0)
  const showOpen = useStore(s => s.workspacePath !== null)

  useEffect(() => {
    const off = window.cuerunner.update.onEvents(setUpdateStatus)
    window.cuerunner.update.status().then(setUpdateStatus).catch(() => {
      // No status yet: the bar and the settings tab wait for the first push.
    })
    return off
  }, [])

  useEffect(() => {
    window.cuerunner.update.report({ busy, showMode, showOpen })
  }, [busy, showMode, showOpen])
}
