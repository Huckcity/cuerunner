import { useStore } from '../../store'
import type { MicCue } from '../../../../shared/cue'
import { LastRun } from './LastRun'

/** Only a Sennheiser EW-DX channel can be muted from here, and its id says so. */
const EW_DX = 'ew-dx:'

interface Choice {
  channelId: string
  /** What it reads as in the list and in the log: the pack and who wears it, or what the receiver calls it. */
  label: string
}

/**
 * A mic cue names one radio mic and says which way: mute or unmute, never a toggle. A toggle run
 * twice leaves the mic as the first run found it, and a cue list that can be jumped around in
 * cannot know which that was.
 *
 * What it can be pointed at is every EW-DX channel the show knows — those the plot patches, which
 * are choosable while their pack is switched off, and those that are reporting — named the way the
 * show names them: the pack and the person on it where there is a plot, and what the receiver calls
 * the channel where there is not. It is never the person: a pack that changes hands keeps its channel.
 */
export function MicInspector({ cue }: { cue: MicCue }) {
  const update = useStore(s => s.updateCue)
  const devices = useStore(s => s.showDevices)
  const plot = useStore(s => s.showSettings.rf.plot)
  const performers = useStore(s => s.showSettings.cast.performers)

  const choices = new Map<string, Choice>()
  for (const device of devices) {
    const channelId = device.id.startsWith('rf:') ? device.id.slice(3) : ''
    if (device.service === 'rf' && channelId.startsWith(EW_DX)) choices.set(channelId, { channelId, label: device.name })
  }
  // The plot names a pack and who is wearing it, which is what the operator knows it by.
  for (const pack of plot.packs) {
    if (!pack.channelId?.startsWith(EW_DX)) continue
    const who = performers.find(performer => performer.id === pack.performerId)?.name
    const named = who ? `${pack.label} (${who})` : pack.label
    const reported = choices.get(pack.channelId)
    choices.set(pack.channelId, { channelId: pack.channelId, label: reported ? `${named} · ${reported.label}` : named })
  }

  const list = [...choices.values()]
  const missing = cue.channelId !== '' && !choices.has(cue.channelId)

  return (
    <div className="inspector-section">
      <div className="field-section-title">Mic</div>
      <div className="field-row">
        <label htmlFor="mic-cue-channel">Mic</label>
        <select
          id="mic-cue-channel"
          value={cue.channelId}
          onChange={e => {
            const chosen = choices.get(e.target.value)
            update(cue.id, { channelId: e.target.value, label: chosen?.label ?? '' })
          }}
        >
          <option value="">— none —</option>
          {missing && <option value={cue.channelId}>{cue.label || cue.channelId} — not found</option>}
          {list.map(choice => (
            <option key={choice.channelId} value={choice.channelId}>{choice.label}</option>
          ))}
        </select>
      </div>
      <div className="field-row">
        <label htmlFor="mic-cue-action">Do</label>
        <select
          id="mic-cue-action"
          value={cue.action}
          onChange={e => update(cue.id, { action: e.target.value as MicCue['action'] })}
        >
          <option value="mute">Mute</option>
          <option value="unmute">Unmute</option>
        </select>
      </div>
      {list.length === 0 && cue.channelId === '' ? (
        <p className="inspector-hint">No EW-DX receivers yet. Add one in Settings, Wireless.</p>
      ) : (
        <p className="inspector-hint">Closes the mic at its receiver, then asks it. A failure is an error on the cue.</p>
      )}
      <LastRun cueId={cue.id} />
    </div>
  )
}
