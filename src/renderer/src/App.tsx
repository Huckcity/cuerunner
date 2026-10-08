import { useEffect, useState } from 'react'
import { Toolbar } from './components/layout/Toolbar'
import { TransportBar } from './components/layout/TransportBar'
import { ContextBar } from './components/layout/ContextBar'
import { CueList } from './components/cue-list/CueList'
import { Inspector } from './components/inspector/Inspector'
import { SettingsDialog } from './components/layout/SettingsDialog'
import { ShowSettings } from './components/show/ShowSettings'
import { ChangesDialog } from './components/changes/ChangesDialog'
import { MergeReportDialog } from './components/changes/MergeReportDialog'
import { ReportDialog } from './components/layout/ReportDialog'
import { QLabImportHost } from './components/qlab/QLabImportHost'
import { CrashNotice } from './components/layout/CrashNotice'
import { RecoveryNotice } from './components/layout/RecoveryNotice'
import { NoticeBar } from './components/layout/NoticeBar'
import { MissingMediaBar } from './components/media/MissingMediaBar'
import { GroupingNoteBar } from './components/layout/GroupingNoteBar'
import { useAutosave } from './hooks/useAutosave'
import { usePlaybackBridge } from './hooks/usePlaybackBridge'
import { useMediaLengths } from './hooks/useMediaLengths'
import { useSilenceTrim } from './hooks/useSilenceTrim'
import { useShowBridge } from './hooks/useShowBridge'
import { useCueTriggers } from './hooks/useCueTriggers'
import { useDeskButtons } from './hooks/useDeskButtons'
import { useHighestWins } from './hooks/useHighestWins'
import { useCompanionPublisher } from './hooks/useCompanionPublisher'
import { useRedundancy } from './hooks/useRedundancy'
import { useTimecodeFollow } from './hooks/useTimecodeFollow'
import { useOutputs } from './hooks/useOutputs'
import { Dock, type DockTab } from './components/layout/Dock'
import type { AppView } from './components/layout/Toolbar'
import { ScenesView } from './components/scenes/ScenesView'
import { ShowModeView } from './components/show-mode/ShowModeView'
import { useCartMode, useShowMode } from './hooks/useShowMode'
import { CartView } from './components/cart/CartView'
import { useLogFile } from './hooks/useLogFile'
import { useSelectedCue, useStore, usePro } from './store'
import type { GroupCue } from '../../shared/cue'
import { ProLock } from './components/license/ProLock'
import { LightingView } from './components/lighting/LightingView'
import { useLightingBridge } from './hooks/useLightingBridge'
import { useUpdates } from './hooks/useUpdates'
import { UpdateNotice } from './components/update/UpdateNotice'
import { WhatsNewDialog } from './components/update/WhatsNewDialog'
import './App.css'

// Store-backed notice bar: save and open failures land here, where a packaged build
// can actually show them.
function NoticeHost() {
  const notice = useStore(s => s.notice)
  const setNotice = useStore(s => s.setNotice)
  if (!notice) return null
  return (
    <NoticeBar kind="error" onDismiss={() => setNotice(null)}>
      {notice}
    </NoticeBar>
  )
}

export function App() {
  useAutosave()
  usePlaybackBridge()
  // A loaded show measures its files before anything asks for a length.
  useMediaLengths()
  // And a show playing with the silence trim on measures where its sound starts and
  // stops, so firing a cue never waits on a scan.
  useSilenceTrim()
  useShowBridge()
  useCueTriggers()
  useDeskButtons()
  useHighestWins()
  useCompanionPublisher()
  // The other machine on the desk: what it is doing with the show, and what to do with
  // the show it hands over.
  useRedundancy()
  // The session log, written to disk as it is written on screen.
  useLogFile()
  // The lighting engine is told where the show's universes go whenever that changes.
  useLightingBridge()
  // The incoming SMPTE clock: its status for the window, and the cues it fires.
  useTimecodeFollow()
  // The video outputs: which the show declares, what they report, and the timers on them.
  useOutputs()
  const settingsTab = useStore(s => s.settingsTab)
  const openSettings = useStore(s => s.openSettings)
  const closeSettings = useStore(s => s.closeSettings)
  const changesTab = useStore(s => s.changesTab)
  const closeChanges = useStore(s => s.closeChanges)
  const reportOpen = useStore(s => s.reportOpen)
  const closeReport = useStore(s => s.closeReport)
  const mergeReport = useStore(s => s.mergeReport)
  const setMergeReport = useStore(s => s.setMergeReport)
  const showSettingsTab = useStore(s => s.showSettingsTab)
  const setLicense = useStore(s => s.setLicense)
  const pro = usePro()
  const [timelineExpanded, setTimelineExpanded] = useState(false)
  // The bottom of the window is one dock: the selected cue, or one of the show's panels.
  const [dockTab, setDockTab] = useState<DockTab>('cue')
  // Which view fills the window. The scenes view is what the show is run from and where
  // it is edited; the cue stack is the other half, one click away at curtain up.
  const [view, setView] = useState<AppView>('cues')
  const selected = useSelectedCue()
  // The large-type operator view (F5): it takes the place of the list and the inspector.
  const [showMode, toggleShowMode] = useShowMode()
  // The cart (F6): the list as a wall of buttons. Show mode, when it is on, is in front of it.
  const [cartMode, toggleCartMode] = useCartMode()
  const cartShown = cartMode && !showMode && view === 'cues'
  // Updates follow the show: main is told whether it is running, in Show Mode, a file.
  useUpdates(showMode)

  const timelineGroupCue = selected?.type === 'group' && (selected as GroupCue).mode === 'timeline'
    ? selected as GroupCue
    : null

  const timelineFullscreen = timelineExpanded && timelineGroupCue !== null && dockTab === 'cue' && view === 'cues'
  const shellClass = `app-shell${timelineFullscreen ? ' timeline-fullscreen' : ''}${showMode ? ' in-show-mode' : ''}${cartShown ? ' in-cart' : ''}`

  // The license can change while the window is open — a key entered in Settings, or one
  // that ran out overnight — so the panels follow the main process rather than the read
  // taken at startup. The startup read itself happens before the first frame (main.tsx).
  useEffect(() => window.cuerunner.license.onChanged(setLicense), [setLicense])

  useEffect(() => {
    return window.cuerunner.app.onMenuAction((action) => {
      // The File menu's actions are the toolbar's (useWorkspace lives there).
      if (action !== 'undo' && action !== 'redo') return
      // The menu accelerator swallows the keystroke, so a focused text field never
      // receives it. Route the action to the field's own editing undo instead of the
      // cue history (which only covers cues).
      const active = document.activeElement
      const isTextField =
        active instanceof HTMLTextAreaElement ||
        (active instanceof HTMLElement && active.isContentEditable) ||
        (active instanceof HTMLInputElement && active.type !== 'range')
      if (isTextField) {
        document.execCommand(action)
        return
      }

      const store = useStore.getState()
      if (action === 'undo') store.undo()
      else if (action === 'redo') store.redo()
    })
  }, [])

  // Main-process failures (IPC handlers, the native modules, a crashed child process)
  // have no console a packaged build can show, so they land in the session log.
  useEffect(() => {
    // A failure in the main process can land before this runs — during startup, which is
    // when a native module or a port is most likely to fail — so the backlog is taken as
    // well as the subscription. Subscribing first means a failure in between is caught
    // by one of the two; the set keeps it from being logged twice.
    const delivered = new Set<string>()
    const off = window.cuerunner.app.onMainError((message) => {
      delivered.add(message)
      useStore.getState().appendLog([{ level: 'error', message, origin: 'main' }])
    })
    void window.cuerunner.app.drainMainErrors()
      .then(messages => {
        for (const message of messages) {
          if (delivered.has(message)) continue
          useStore.getState().appendLog([{ level: 'error', message, origin: 'main' }])
        }
      })
      // A renderer that cannot read the backlog still runs the show; it just starts
      // with whatever the subscription catches.
      .catch(() => {})
    return off
  }, [])

  return (
    <div className={shellClass}>
      <CrashNotice />
      <RecoveryNotice />
      <NoticeHost />
      <UpdateNotice showMode={showMode} />
      <WhatsNewDialog />
      <MissingMediaBar />
      <GroupingNoteBar />
      <Toolbar
        onOpenSettings={() => openSettings('general')}
        view={view}
        onSwitchView={setView}
      />
      <ContextBar />
      <div className="app-main" data-view={showMode ? 'show' : cartShown ? 'cart' : view}>
        {showMode ? (
          <ShowModeView onExit={toggleShowMode} />
        ) : cartShown ? (
          <CartView onExit={toggleCartMode} />
        ) : view === 'scenes' ? (
          pro ? (
            <ScenesView />
          ) : (
            <ProLock
              variant="view"
              feature="Scenes"
              blurb="Who is open on stage, scene by scene. Recall one and the desk moves with the show."
            />
          )
        ) : view === 'lighting' ? (
          pro ? (
            <LightingView />
          ) : (
            <ProLock
              variant="view"
              feature="Lighting"
              blurb="The rig patched, faders to build a look, and sACN or Art-Net out of this machine, run from the cue list."
            />
          )
        ) : (
          <>
            <CueList />
            <Inspector />
          </>
        )}
      </div>
      <Dock
        view={view}
        tab={dockTab}
        onTab={setDockTab}
        timelineExpanded={timelineExpanded}
        onToggleTimeline={() => setTimelineExpanded(e => !e)}
      />
      <TransportBar onShowStrip={setDockTab} />
      {settingsTab !== null && <SettingsDialog initialTab={settingsTab} onClose={closeSettings} />}
      {showSettingsTab !== null && <ShowSettings />}
      {changesTab !== null && <ChangesDialog initialTab={changesTab} onClose={closeChanges} />}
      {reportOpen && <ReportDialog onClose={closeReport} />}
      {mergeReport !== null && (
        <MergeReportDialog report={mergeReport} onClose={() => setMergeReport(null)} />
      )}
      <QLabImportHost />
    </div>
  )
}
