import { useEffect, useRef, useState } from 'react'
import { useSelectedCue, usePro } from '../../store'
import { ProLock, ProMark } from '../license/ProLock'
import { BasicTab } from './BasicTab'
import { Triggers } from './Triggers'
import { cueTriggers } from '../../engine/triggers'
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
import { DevampInspector } from './DevampInspector'
import { MscInspector } from './MscInspector'
import { MicInspector } from './MicInspector'
import { MidiFileInspector } from './MidiFileInspector'
import { LightInspector, LightTrackingTab } from '../lighting/LightInspector'
import { TimecodeInspector } from './TimecodeInspector'
import type {
  Cue, AudioCue, MidiCue, OscCue, WaitCue, FadeCue, GroupCue, NetworkCue, ScriptCue, StopCue, SceneCue, DevampCue,
  MscCue, MicCue, LightCue, TimecodeCue
} from '../../../../shared/cue'
import type { MidiFileCue } from '../../../../shared/cue'
import { isProCueType } from '../../../../shared/cue'
import './Inspector.css'

// Basics is what every cue shares, then what this type does, then what else can fire
// it. An audio cue's second tab is about the file — where it starts and stops, how it
// fades in, how often it loops — which is not the cue's timing, so it is not called that.
const TYPE_TABS: Record<string, string[]> = {
  audio: ['Basics', 'Audio', 'Time & Loops'],
  midi: ['Basics', 'MIDI'],
  osc: ['Basics', 'OSC'],
  wait: ['Basics', 'Wait'],
  fade: ['Basics', 'Fade'],
  stop: ['Basics', 'Stop'],
  group: ['Basics', 'Group'],
  network: ['Basics', 'Network'],
  script: ['Basics', 'Script'],
  scene: ['Basics', 'Scene'],
  devamp: ['Basics', 'Devamp'],
  msc: ['Basics', 'Show Control'],
  mic: ['Basics', 'Mic'],
  // A memo is its name and its note, and both are on Basics: it has nothing else to set.
  memo: ['Basics'],
  midiFile: ['Basics', 'MIDI File', 'Channels'],
  light: ['Basics', 'Light', 'Tracking'],
  timecode: ['Basics', 'Timecode']
}

const TRIGGERS_TAB = 'Triggers'

function TabContent({ cue, tab }: { cue: Cue; tab: string }) {
  const pro = usePro()
  if (tab === 'Basics') return <BasicTab cue={cue} />
  if (tab === TRIGGERS_TAB) {
    return <Triggers cue={cue} />
  }
  if (tab === 'Audio' || tab === 'Time & Loops') return <AudioInspector cue={cue as AudioCue} tab={tab} />
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
  if (tab === 'Devamp') return <DevampInspector cue={cue as DevampCue} />
  if (tab === 'Show Control') return <MscInspector cue={cue as MscCue} />
  if (tab === 'MIDI File' || tab === 'Channels') return <MidiFileInspector cue={cue as MidiFileCue} tab={tab} />
  if (tab === 'Mic') {
    return pro ? (
      <MicInspector cue={cue as MicCue} />
    ) : (
      <ProLock
        variant="inspector"
        feature="Mic cues"
        blurb="A cue that mutes or unmutes a radio mic at its receiver, so a pack is closed by the cue list and not by a hand on a fader."
      />
    )
  }
  if (tab === 'Light' || tab === 'Tracking') {
    return pro ? (
      tab === 'Light' ? <LightInspector cue={cue as LightCue} /> : <LightTrackingTab cue={cue as LightCue} />
    ) : (
      <ProLock
        variant="inspector"
        feature="Light cues"
        blurb="A cue that fades the lighting rig to a look over sACN or Art-Net, tracking what it does not change."
      />
    )
  }
  if (tab === 'Timecode') {
    return pro ? (
      <TimecodeInspector cue={cue as TimecodeCue} />
    ) : (
      <ProLock
        variant="inspector"
        feature="Timecode cues"
        blurb="A cue that runs a SMPTE clock — MTC, LTC and Art-Net — so the lighting desk, the video and the band follow the cue list."
      />
    )
  }
  return <div className="inspector-placeholder">No settings for this tab.</div>
}

export function Inspector() {
  const cue = useSelectedCue()
  const pro = usePro()
  const [activeTab, setActiveTab] = useState('Basics')
  const bodyRef = useRef<HTMLDivElement>(null)

  // The panel is one scrolling box, and the tab's content is remounted inside it — so
  // without this the box keeps the last cue's scroll position, and walking the stack with
  // the arrows shows the middle of one cue and the top of the next. The field an operator
  // is watching must not move under them because they moved the selection.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0
  }, [cue?.id, activeTab])

  if (!cue) {
    return (
      <div className="inspector inspector-empty">
        Select a cue to inspect it.
      </div>
    )
  }

  const tabs = [...(TYPE_TABS[cue.type] ?? ['Basics']), TRIGGERS_TAB]
  const tab = tabs.includes(activeTab) ? activeTab : tabs[0]
  const triggerCount = cueTriggers(cue).length
  // The type's own tab — the one `TYPE_TABS` names beside `Basics` — is the one the type's
  // class locks: `PRO_CUE_TYPES` is the declaration that says which types cost, so a type
  // added to it is locked and marked here rather than only where its executor was written.
  const typeTab = (TYPE_TABS[cue.type] ?? [])[1]
  const typeLocked = isProCueType(cue.type) && !pro

  return (
    <div className="inspector">
      <div className="inspector-tabs">
        {tabs.map(t => (
          <button
            key={t}
            className="inspector-tab"
            data-active={t === tab}
            data-locked={(t === typeTab && typeLocked) || (t === TRIGGERS_TAB && !pro)}
            onClick={() => setActiveTab(t)}
          >
            {t}
            {t === TRIGGERS_TAB && pro && triggerCount > 0 && (
              <span className="inspector-tab-count">{triggerCount}</span>
            )}
            {t === typeTab && typeLocked && <ProMark />}
          </button>
        ))}
      </div>
      <div className="inspector-body" ref={bodyRef}>
        <TabContent key={cue.id} cue={cue} tab={tab} />
      </div>
    </div>
  )
}
