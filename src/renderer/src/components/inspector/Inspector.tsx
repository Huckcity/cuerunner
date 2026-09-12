import { useState } from 'react'
import { useSelectedCue, usePro } from '../../store'
import { ProLock, ProMark } from '../license/ProLock'
import { BasicTab } from './BasicTab'
import { AudioInspector } from './AudioInspector'
import { MidiInspector } from './MidiInspector'
import { OscInspector } from './OscInspector'
import { WaitInspector } from './WaitInspector'
import { FadeInspector } from './FadeInspector'
import { GroupInspector } from './GroupInspector'
import { NetworkInspector } from './NetworkInspector'
import { ScriptInspector } from './ScriptInspector'
import { SceneInspector } from './SceneInspector'
import { StopInspector } from './StopInspector'
import type { Cue, AudioCue, MidiCue, OscCue, WaitCue, FadeCue, GroupCue, NetworkCue, ScriptCue, StopCue, SceneCue } from '../../types/cue'
import './Inspector.css'

const TYPE_TABS: Record<string, string[]> = {
  audio: ['Basics', 'Audio', 'Timing'],
  midi: ['Basics', 'MIDI'],
  osc: ['Basics', 'OSC'],
  wait: ['Basics', 'Wait'],
  fade: ['Basics', 'Fade'],
  stop: ['Basics', 'Stop'],
  group: ['Basics', 'Group'],
  network: ['Basics', 'Network'],
  script: ['Basics', 'Script'],
  scene: ['Basics', 'Scene']
}

function TabContent({ cue, tab }: { cue: Cue; tab: string }) {
  const pro = usePro()
  if (tab === 'Basics') return <BasicTab cue={cue} />
  if (tab === 'Audio' || tab === 'Timing') return <AudioInspector cue={cue as AudioCue} tab={tab} />
  if (tab === 'MIDI') return <MidiInspector cue={cue as MidiCue} />
  if (tab === 'OSC') return <OscInspector cue={cue as OscCue} />
  if (tab === 'Wait') return <WaitInspector cue={cue as WaitCue} />
  if (tab === 'Fade') return <FadeInspector cue={cue as FadeCue} />
  if (tab === 'Group') return <GroupInspector cue={cue as GroupCue} />
  if (tab === 'Network') return <NetworkInspector cue={cue as NetworkCue} />
  if (tab === 'Script') return <ScriptInspector cue={cue as ScriptCue} />
  if (tab === 'Scene') {
    return pro ? (
      <SceneInspector cue={cue as SceneCue} />
    ) : (
      <ProLock
        variant="inspector"
        feature="Scene cues"
        blurb="A cue that recalls a scene, so GO moves the desk along with the show."
      />
    )
  }
  if (tab === 'Stop') return <StopInspector cue={cue as StopCue} />
  return <div className="inspector-placeholder">No settings for this tab.</div>
}

export function Inspector() {
  const cue = useSelectedCue()
  const pro = usePro()
  const [activeTab, setActiveTab] = useState('Basics')

  if (!cue) {
    return (
      <div className="inspector inspector-empty">
        Select a cue to inspect it.
      </div>
    )
  }

  const tabs = TYPE_TABS[cue.type] ?? ['Basics']
  const tab = tabs.includes(activeTab) ? activeTab : tabs[0]

  return (
    <div className="inspector">
      <div className="inspector-tabs">
        {tabs.map(t => (
          <button
            key={t}
            className="inspector-tab"
            data-active={t === tab}
            data-locked={t === 'Scene' && !pro}
            onClick={() => setActiveTab(t)}
          >
            {t}
            {t === 'Scene' && !pro && <ProMark />}
          </button>
        ))}
      </div>
      <div className="inspector-body">
        <TabContent key={cue.id} cue={cue} tab={tab} />
      </div>
    </div>
  )
}
