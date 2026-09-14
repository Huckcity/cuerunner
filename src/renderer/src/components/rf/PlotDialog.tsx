import { useEffect, useState } from 'react'
import { useStore } from '../../store'
import { formatClock } from '../../utils/cueDefaults'
import { addPack, assignPack, describeSwap, recordSwaps, removePack, updatePack } from '../../utils/rfPlot'
import type { RfPlot, RfSwap } from '../../types/show'
import './PlotDialog.css'

// The rf service names every device after the channel it reports, so a channel id is the
// device id with that prefix taken off. Matching on it here is what keeps the patch list
// tied to what is on the air rather than to a list someone typed.
const RF_DEVICE_PREFIX = 'rf:'

// The report holds the whole night; the dialog shows only the recent past, which is what
// tells an operator the change they just made landed.
const RECENT_SWAP_COUNT = 5

interface Props {
  onClose: () => void
}

/**
 * A field that keeps what is being typed to itself until it is left. Binding the plot to
 * every keystroke would rewrite the workspace on each character — and a name that was
 * swapped while half-typed would put a swap in the log that never happened.
 */
function CommitInput({
  value,
  onCommit,
  ...rest
}: {
  value: string
  onCommit: (value: string) => void
  className?: string
  placeholder?: string
  list?: string
  'aria-label'?: string
}) {
  const [draft, setDraft] = useState<string | null>(null)

  const commit = (): void => {
    if (draft !== null && draft !== value) onCommit(draft)
    setDraft(null)
  }

  return (
    <input
      {...rest}
      value={draft ?? value}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') commit()
      }}
    />
  )
}

/**
 * The editor for the mic plot. Every change goes through the pure operations in
 * `utils/rfPlot`, so a pack changing hands produces the swap record wherever the change
 * was made from; this dialog only decides where to put the result and where to log it.
 */
export function PlotDialog({ onClose }: Props) {
  const plot = useStore(s => s.showSettings.rf.plot)
  const swaps = useStore(s => s.showSettings.rf.swaps)
  // Performers themselves — and which desk group they feed — are the cast's, set up in
  // the Show panel. The plot only says who is currently wearing which transmitter.
  const performers = useStore(s => s.showSettings.cast.performers)
  const devices = useStore(s => s.showDevices)
  const updateRfSettings = useStore(s => s.updateRfSettings)
  const appendLog = useStore(s => s.appendLog)

  // Dismiss on Escape, wherever focus is inside the dialog.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // One write for both the plot and the swap log, so an edit that moved a pack can never
  // leave the workspace with the new assignment and the old record of it. A change that
  // moved nothing comes back empty and writes nothing to the session log.
  const apply = (next: RfPlot, added: RfSwap[] = []): void => {
    updateRfSettings({ plot: next, swaps: recordSwaps(swaps, added) })
    for (const swap of added) {
      appendLog([{ level: 'info', label: 'RF', message: `Swap: ${describeSwap(swap)}` }])
    }
  }

  // What the wireless service is reporting right now. A pack that is switched off today
  // is still part of tonight's plot, so the input stays free text around these.
  const channels = devices
    .filter(device => device.id.startsWith(RF_DEVICE_PREFIX))
    .map(device => ({ id: device.id.slice(RF_DEVICE_PREFIX.length), name: device.name }))

  const recentSwaps = swaps.slice(-RECENT_SWAP_COUNT).reverse()

  return (
    <div className="plot-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="plot-dialog" role="dialog" aria-modal="true" aria-label="Mic plot">
        <div className="plot-header">
          <span className="plot-title">Mic plot</span>
        </div>

        <div className="plot-body">
          <div className="plot-section plot-packs">
            <div className="plot-section-title">Packs</div>
            {plot.packs.map(pack => (
              <div className="plot-pack-row" key={pack.id}>
                <CommitInput
                  className="plot-pack-label"
                  value={pack.label}
                  placeholder="Label"
                  aria-label="Pack label"
                  onCommit={label => apply(updatePack(plot, pack.id, { label }))}
                />
                <CommitInput
                  className="plot-channel"
                  list="plot-channels"
                  value={pack.channelId ?? ''}
                  placeholder="Channel"
                  aria-label="Pack channel"
                  onCommit={channel => apply(updatePack(plot, pack.id, { channelId: channel.trim() || null }))}
                />
                <select
                  className="plot-pack-performer"
                  value={pack.performerId ?? ''}
                  aria-label="Pack performer"
                  onChange={e => {
                    const change = assignPack(plot, performers, pack.id, e.target.value || null, Date.now())
                    apply(change.plot, change.swaps)
                  }}
                >
                  <option value="">— unassigned —</option>
                  {performers.map(performer => (
                    <option key={performer.id} value={performer.id}>{performer.name}</option>
                  ))}
                </select>
                <CommitInput
                  className="plot-pack-notes"
                  value={pack.notes}
                  placeholder="Notes"
                  aria-label="Pack notes"
                  onCommit={notes => apply(updatePack(plot, pack.id, { notes }))}
                />
                <button
                  className="plot-remove"
                  aria-label={`Remove ${pack.label}`}
                  onClick={() => apply(removePack(plot, pack.id))}
                >✕</button>
              </div>
            ))}
            <button className="plot-add-pack add-row" onClick={() => apply(addPack(plot, `Pack ${plot.packs.length + 1}`))}>
              + Add pack
            </button>
            <datalist id="plot-channels">
              {channels.map(channel => (
                <option key={channel.id} value={channel.id} label={channel.name} />
              ))}
            </datalist>
          </div>

          <div className="plot-section">
            <div className="plot-section-title">Swaps</div>
            <div className="plot-swaps">
              {recentSwaps.length === 0 ? (
                <span className="plot-swaps-empty">No swaps yet.</span>
              ) : (
                recentSwaps.map((swap, index) => (
                  <div className="plot-swap" key={`${swap.at}-${swap.packId}-${index}`}>
                    <span className="plot-swap-time">{formatClock(swap.at)}</span>
                    <span className="plot-swap-text">{describeSwap(swap)}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="plot-footer">
          <button className="plot-close" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
