import { useEffect, useState } from 'react'
import { Toolbar } from './components/layout/Toolbar'
import { TransportBar } from './components/layout/TransportBar'
import { CueList } from './components/cue-list/CueList'
import { Inspector } from './components/inspector/Inspector'
import { WaveformPanel } from './components/waveform/WaveformPanel'
import { TimelineEditor } from './components/timeline/TimelineEditor'
import { SettingsDialog } from './components/layout/SettingsDialog'
import { LogPanel } from './components/log/LogPanel'
import { useSelectedCue, useStore } from './store'
import type { GroupCue } from './types/cue'
import './App.css'

export function App() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [timelineExpanded, setTimelineExpanded] = useState(false)
  const [logOpen, setLogOpen] = useState(false)
  const selected = useSelectedCue()

  const timelineGroupCue = selected?.type === 'group' && (selected as GroupCue).mode === 'timeline'
    ? selected as GroupCue
    : null

  const shellClass = `app-shell${timelineExpanded && timelineGroupCue ? ' timeline-fullscreen' : ''}`

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

  return (
    <div className={shellClass}>
      <Toolbar onOpenSettings={() => setSettingsOpen(true)} />
      <div className="app-main">
        <CueList />
        <Inspector />
      </div>
      {timelineGroupCue
        ? <TimelineEditor
            cue={timelineGroupCue}
            expanded={timelineExpanded}
            onToggleExpand={() => setTimelineExpanded(e => !e)}
          />
        : <WaveformPanel />
      }
      {logOpen && <LogPanel onClose={() => setLogOpen(false)} />}
      <TransportBar logOpen={logOpen} onToggleLog={() => setLogOpen(v => !v)} />
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
