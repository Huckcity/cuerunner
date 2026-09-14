// What the engine and this workspace's media have to say for themselves — media-memory
// pressure, a workspace whose files would not all fit in memory, a stalled stream — kept
// on screen while the condition lasts. The engine's own words, and the estimate's, never
// a lossy summary, and never a reason to load media into the renderer.

import { useEffect, useState } from 'react'
import { audioEngine } from '../../engine/audioEngineClient'
import { useAudioEngineInfo } from '../../hooks/useAudioEngineInfo'
import { useWorkspaceFootprint } from '../../hooks/useWorkspaceFootprint'

interface Props {
  /** Class for the wrapper; the two surfaces style their own size. */
  className?: string
  /** Show only the first warning (the waveform header has one line to give). */
  compact?: boolean
}

export function PlaybackWarnings({ className = 'engine-warning', compact = false }: Props) {
  const { info } = useAudioEngineInfo()
  const footprint = useWorkspaceFootprint(info)
  const restarts = useEngineRestarts()

  // Engine restarts lead: an engine replaced under a running show is the most urgent
  // thing this bar can say. Then the workspace, which is what the operator just did,
  // then whatever the engine has noticed on its own.
  const warnings = [
    ...restarts,
    ...(footprint?.warning ? [footprint.warning] : []),
    ...(info?.warnings ?? [])
  ]
  if (warnings.length === 0) return null

  const shown = compact ? warnings.slice(0, 1) : warnings
  const rest = warnings.length - shown.length

  return (
    <div className={className} role="status" title={warnings.join('\n')}>
      {shown.map(warning => <div key={warning}>{warning}</div>)}
      {rest > 0 && <div>and {rest} more playback {rest === 1 ? 'warning' : 'warnings'}</div>}
    </div>
  )
}

/**
 * One line per engine restart this window has seen, with the rest of the session's
 * notices. The client owns the list, not this component: an operator who closes and
 * reopens the panel the bar lives in must not be able to lose the fact that the engine
 * was replaced under the show.
 */
function useEngineRestarts(): string[] {
  const [restarts, setRestarts] = useState<string[]>(() => audioEngine.sessionWarnings())
  useEffect(
    () => audioEngine.onSessionChange(() => setRestarts([...audioEngine.sessionWarnings()])),
    []
  )
  return restarts
}
