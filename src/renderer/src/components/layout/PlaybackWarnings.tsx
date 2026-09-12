// What the engine and this workspace's media have to say for themselves — media-memory
// pressure, a workspace whose files would not all fit in memory, a stalled stream — kept
// on screen while the condition lasts. The engine's own words, and the estimate's, never
// a lossy summary, and never a reason to load media into the renderer.

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

  // The workspace comes first: what is loaded is what the operator just did.
  const warnings = [
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
