import { useStore } from '../../store'
import { formatClock } from '../../utils/cueDefaults'
import { addPack, assignPack, describeSwap, recordSwaps, removePack, updatePack } from '../../utils/rfPlot'
import type { RfPlot, RfSwap } from '../../types/show'
import { CommitInput } from '../show/CommitField'
import './MicPlotTab.css'

// The rf service names every device after the channel it reports, so a channel id is the
// device id with that prefix taken off. Matching on it here is what keeps the patch list
// tied to what is on the air rather than to a list someone typed.
const RF_DEVICE_PREFIX = 'rf:'

// The report holds the whole night; the tab shows only the recent past, which is what
// tells an operator the change they just made landed.
const RECENT_SWAP_COUNT = 5

/**
 * The mic plot: who is wearing which transmitter. The panel in the dock beside it is
 * read-only — it answers "which pack is in trouble" — so every change an operator makes
 * during a show is made here, and each one has to leave the same swap behind as any
 * other editor.
 *
 * Pack assignment rides on the plot and not on the cast: a performer is who they are for
 * the whole show, while what they are wearing changes hands mid-number.
 */
export function MicPlotTab() {
  const plot = useStore(s => s.showSettings.rf.plot)
  const swaps = useStore(s => s.showSettings.rf.swaps)
  // Performers themselves, and where their mics are patched, are the cast's — set up in
  // the Cast tab. The plot only says who is currently wearing which transmitter.
  const performers = useStore(s => s.showSettings.cast.performers)
  const devices = useStore(s => s.showDevices)
  const updateRfSettings = useStore(s => s.updateRfSettings)
  const appendLog = useStore(s => s.appendLog)

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
    <div className="show-tab-body">
      <div className="show-section plot-packs">
        <div className="show-section-head">
          <span className="show-section-title">Packs</span>
        </div>

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
          + Pack
        </button>
        <datalist id="plot-channels">
          {channels.map(channel => (
            <option key={channel.id} value={channel.id} label={channel.name} />
          ))}
        </datalist>
      </div>

      <div className="show-section">
        <div className="show-section-head">
          <span className="show-section-title">Swaps</span>
        </div>
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
  )
}
