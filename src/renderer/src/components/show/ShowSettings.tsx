import { useEffect } from 'react'
import { useStore, usePro, type ShowSettingsTab } from '../../store'
import { useModal } from '../../hooks/useModal'
import { ProLock } from '../license/ProLock'
import { ChannelsTab } from './ChannelsTab'
import { CastTab } from './CastTab'
import { MicPlotTab } from '../rf/MicPlotTab'
import './ShowSettings.css'

/** The tabs, by what is being set up rather than by which part of the show does it. */
const SHOW_TABS: { id: ShowSettingsTab; label: string }[] = [
  { id: 'channels', label: 'Channels' },
  { id: 'cast', label: 'Cast' },
  { id: 'mic-plot', label: 'Mic plot' }
]

/**
 * Show Settings: the show's setup, in three tabs.
 *
 * It is not a section of the app's Settings because it is not this machine's business —
 * every list in here travels with the workspace, the way the cue stack does. It is
 * opened from the menu, so a show can be set up without a trip through the Scenes view,
 * and it stays open until it is dismissed: half-typed is a state this panel is in.
 */
export function ShowSettings() {
  const tab = useStore(s => s.showSettingsTab)
  const pro = usePro()
  const openShowSettings = useStore(s => s.openShowSettings)
  const closeShowSettings = useStore(s => s.closeShowSettings)
  const openSettings = useStore(s => s.openSettings)
  // While this is up the transport keys stand down: the operator is setting a show up,
  // not running one, and a Space typed into a name must not fire the next cue behind it.
  useModal()

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeShowSettings()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [closeShowSettings])

  if (tab === null) return null

  return (
    <div className="show-settings-overlay">
      <div
        className="show-settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Show Settings"
      >
        <div className="show-settings-header">
          <span className="show-settings-title">Show Settings</span>
          <button
            className="show-settings-close"
            onClick={closeShowSettings}
            aria-label="Close Show Settings"
            title="Close (Esc)"
          >✕</button>
        </div>

        <div className="show-settings-tabs">
          {SHOW_TABS.map(({ id, label }) => (
            <button
              key={id}
              className="show-settings-tab"
              data-active={tab === id}
              onClick={() => openShowSettings(id)}
            >{label}</button>
          ))}
        </div>

        <div className="show-settings-body">
          {/* Without a key the console and the cast can still be set up — a show built on
              a licensed machine opens here as it is, and nothing is thrown away — but what
              runs on them is Scenes, and a dialog full of faders with no word about that
              read as settings the free cue stack somehow needed. */}
          {!pro && tab !== 'mic-plot' && (
            <p className="show-settings-pro-note" role="note">
              <span className="pro-chip">Cuerunner Pro</span>
              <span>
                The console and the cast are what Scenes run on. You can set them up without
                a key; Scenes need one.
              </span>
              <button
                className="license-link"
                onClick={() => { closeShowSettings(); openSettings('license') }}
              >
                Enter license key
              </button>
            </p>
          )}
          {tab === 'channels' && <ChannelsTab />}
          {tab === 'cast' && <CastTab />}
          {/* The plot is the one Pro surface in here: the cast and the channels describe
              the show, and this reads the rack the show is running on. */}
          {tab === 'mic-plot' && (pro ? (
            <MicPlotTab />
          ) : (
            <ProLock
              variant="section"
              feature="Wireless"
              blurb="The mic plot, the packs on stage, and the alarm before a battery dies mid-line."
            />
          ))}
        </div>

        <div className="show-settings-footer">
          <button className="show-settings-done" onClick={closeShowSettings}>Close</button>
        </div>
      </div>
    </div>
  )
}
