import { useEffect, useState } from 'react'
import type { WhatsNew } from '../../../../shared/ipc/update'
import { ReleaseNotesDialog } from './ReleaseNotes'

/**
 * "What's new", once, after an update: the notes of every version installed since this machine
 * last ran, newest first — an operator who skipped a release reads both. Main hands them over
 * one time only, so a relaunch does not show them again.
 */
export function WhatsNewDialog() {
  const [news, setNews] = useState<WhatsNew | null>(null)

  useEffect(() => {
    // No cleanup that drops the answer: main hands the notes over once, so a second mount —
    // React's development double-run — gets nothing, and the first answer is the only one.
    window.cuerunner.update.whatsNew()
      .then(taken => { if (taken !== null) setNews(taken) })
      .catch(() => {
        // Nothing to show is the answer a failed read gives, too.
      })
  }, [])

  if (news === null) return null
  return (
    <ReleaseNotesDialog
      title={`What’s new in Cuerunner ${news.version}`}
      lede={`Updated from ${news.previous}. Everything since then:`}
      sections={news.sections}
      onClose={() => setNews(null)}
    />
  )
}
