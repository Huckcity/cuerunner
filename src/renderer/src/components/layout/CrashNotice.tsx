import { useEffect, useState } from 'react'
import { formatClock } from '../../utils/cueDefaults'
import { NoticeBar } from './NoticeBar'

interface RendererCrash {
  reason: string
  at: number
}

// After a renderer crash the main process reloads the window, which resets the show —
// the in-memory cues are gone. This is the only place that says so.
export function CrashNotice() {
  const [crash, setCrash] = useState<RendererCrash | null>(null)

  useEffect(() => {
    window.winslab.app
      .rendererCrash()
      .then(report => { if (report) setCrash(report) })
      .catch(() => { /* nothing to report if the bridge is unavailable */ })
  }, [])

  if (!crash) return null

  return (
    <NoticeBar kind="crash" onDismiss={() => setCrash(null)}>
      The interface stopped unexpectedly at {formatClock(crash.at)} ({crash.reason}) and was
      reloaded. Anything unsaved is gone; the workspace file on disk is untouched.
    </NoticeBar>
  )
}
