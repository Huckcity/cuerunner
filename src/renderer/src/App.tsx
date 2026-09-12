import { useEffect, useState } from 'react'
import { Toolbar } from './components/layout/Toolbar'
import { TransportBar } from './components/layout/TransportBar'
import { CueList } from './components/cue-list/CueList'
import { Inspector } from './components/inspector/Inspector'
import { WaveformPanel } from './components/waveform/WaveformPanel'
import { TimelineEditor } from './components/timeline/TimelineEditor'
import { SettingsDialog } from './components/layout/SettingsDialog'
import { CrashNotice } from './components/layout/CrashNotice'
import { RecoveryNotice } from './components/layout/RecoveryNotice'
import { NoticeBar } from './components/layout/NoticeBar'
import { useAutosave } from './hooks/useAutosave'
import { LogPanel } from './components/log/LogPanel'
import { MonitorPanel } from './components/monitor/MonitorPanel'
import { RfPanel } from './components/rf/RfPanel'
import { ScriptPanel } from './components/script/ScriptPanel'
import { useShowBridge } from './hooks/useShowBridge'
import { useCueTriggers } from './hooks/useCueTriggers'
import { useCompanionPublisher } from './hooks/useCompanionPublisher'
import type { ShowStrip } from './components/layout/TransportBar'
import type { AppView } from './components/layout/Toolbar'
import { ScenesView } from './components/scenes/ScenesView'
import { useSelectedCue, useStore, usePro } from './store'
import type { GroupCue } from './types/cue'
import { ProLock } from './components/license/ProLock'
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
  useShowBridge()
  useCueTriggers()
  useCompanionPublisher()
  const settingsTab = useStore(s => s.settingsTab)
  const openSettings = useStore(s => s.openSettings)
  const closeSettings = useStore(s => s.closeSettings)
  const setLicense = useStore(s => s.setLicense)
  const pro = usePro()
  const [timelineExpanded, setTimelineExpanded] = useState(false)
  // The panels along the bottom share the space, and together they would leave the cue
  // list too little room to be a cue list. One at a time: opening one closes the other,
  // and the same button closes the one it opened.
  const [strip, setStrip] = useState<ShowStrip | null>(null)
  // Which view fills the window. The scenes view is what the show is run from and where
  // it is edited; the cue stack is the other half, one click away at curtain up.
  const [view, setView] = useState<AppView>('cues')
  const selected = useSelectedCue()

  const timelineGroupCue = selected?.type === 'group' && (selected as GroupCue).mode === 'timeline'
    ? selected as GroupCue
    : null

  const shellClass = `app-shell${timelineExpanded && timelineGroupCue ? ' timeline-fullscreen' : ''}`

  // The licence can change while the window is open — a key entered in Settings, or one
  // that ran out overnight — so the panels follow the main process rather than the read
  // taken at startup. The startup read itself happens before the first frame (main.tsx).
  useEffect(() => window.winslab.license.onChanged(setLicense), [setLicense])

  useEffect(() => {
    return window.winslab.app.onMenuAction((action) => {
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
      else store.redo()
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
    const off = window.winslab.app.onMainError((message) => {
      delivered.add(message)
      useStore.getState().appendLog([{ level: 'error', message }])
    })
    void window.winslab.app.drainMainErrors()
      .then(messages => {
        for (const message of messages) {
          if (delivered.has(message)) continue
          useStore.getState().appendLog([{ level: 'error', message }])
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
      <Toolbar
        onOpenSettings={() => openSettings('audio')}
        view={view}
        onSwitchView={setView}
      />
      <div className="app-main" data-view={view}>
        {view === 'scenes' ? (
          pro ? (
            <ScenesView />
          ) : (
            <ProLock
              variant="view"
              feature="Scenes"
              blurb="Scenes drive the desk: who is open on stage, and only the messages that change it. Recall one and the mics move with the show."
            />
          )
        ) : (
          <>
            <CueList />
            <Inspector />
          </>
        )}
      </div>
      {view === 'cues' && (timelineGroupCue
        ? <TimelineEditor
            cue={timelineGroupCue}
            expanded={timelineExpanded}
            onToggleExpand={() => setTimelineExpanded(e => !e)}
          />
        : <WaveformPanel />
      )}
      {strip === 'monitor' && (pro
        ? <MonitorPanel onClose={() => setStrip(null)} />
        : <ProLock
            variant="strip"
            feature="Show monitor"
            blurb="What is listening, what is on stage, and what just came in."
            onClose={() => setStrip(null)}
          />)}
      {strip === 'rf' && (pro
        ? <RfPanel onClose={() => setStrip(null)} />
        : <ProLock
            variant="strip"
            feature="Wireless"
            blurb="The mic plot, the packs on stage, and the alarm before a battery dies mid-line."
            onClose={() => setStrip(null)}
          />)}
      {strip === 'script' && (pro
        ? <ScriptPanel onClose={() => setStrip(null)} />
        : <ProLock
            variant="strip"
            feature="Script panel"
            blurb="The script beside the cue stack, with cues pinned to the lines they fire on."
            onClose={() => setStrip(null)}
          />)}
      {strip === 'log' && <LogPanel onClose={() => setStrip(null)} />}
      <TransportBar
        strip={strip}
        onToggleStrip={next => setStrip(current => current === next ? null : next)}
      />
      {settingsTab !== null && <SettingsDialog initialTab={settingsTab} onClose={closeSettings} />}
    </div>
  )
}
