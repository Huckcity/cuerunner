// The control window's half of the video outputs: it tells main which outputs the show
// declares, hands what the outputs report to the picture runner, keeps the outputs' own
// state for the panel that draws it, feeds the timers, opens the next video before its GO,
// and carries an inspector edit to a picture that is up.

import { useEffect } from 'react'
import { create } from 'zustand'
import { useStore } from '../store'
import { cueEngine } from '../engine/CueEngine'
import { visualCues } from '../engine/visualCues'
import { audioEngine } from '../engine/audioEngineClient'
import { isVisualCue, type DisplayInfo, type OutputStatus } from '../../../shared/visual'
import type { CameraSnapshot, OutputEvent, OutputSnapshot, TimerFeed, TimerWindowState } from '../../../shared/ipc/output'
import { cameraSourceProblem } from '../../../shared/camera'
import type { Cue } from '../../../shared/cue'

/** How often the timers' feed is worked out. A change is sent at once; nothing else is sent. */
const TIMER_TICK_MS = 250

interface OutputState {
  statuses: Record<string, OutputStatus>
  displays: DisplayInfo[]
  timerWindow: TimerWindowState
  /** Pictures that could not be shown, newest last, for the panel to say. */
  errors: Array<{ cueId: string; outputId: string; message: string }>
  /** The capture devices this machine's outputs see, and the one each camera cue uses here. */
  cameras: CameraSnapshot
  /** How each camera picture is getting on, by cue: the line its output shows, or '' when it is live. */
  cameraStates: Record<string, { state: string; message: string }>
  setCameras: (cameras: CameraSnapshot) => void
  apply: (snapshot: OutputSnapshot) => void
  status: (status: OutputStatus) => void
  error: (entry: { cueId: string; outputId: string; message: string }) => void
  setTimerWindow: (state: TimerWindowState) => void
}

/** What main says about the outputs. Session state: none of it is the show's. */
export const useOutputState = create<OutputState>(set => ({
  statuses: {},
  displays: [],
  timerWindow: { open: false, mode: 'remaining' },
  errors: [],
  cameras: { devices: [], listed: false, choices: {} },
  cameraStates: {},
  setCameras: cameras => set({ cameras }),
  apply: snapshot => set({
    statuses: Object.fromEntries(snapshot.outputs.map(status => [status.outputId, status])),
    displays: snapshot.displays,
    timerWindow: snapshot.timerWindow
  }),
  status: status => set(s => ({ statuses: { ...s.statuses, [status.outputId]: status } })),
  error: entry => set(s => ({ errors: [...s.errors, entry].slice(-20) })),
  setTimerWindow: timerWindow => set({ timerWindow })
}))

/** The timers' feed now: the show's first GO, and the cue with an end that started last. */
export function timerFeedNow(elapsedFromShowMs: number | null): TimerFeed {
  const latest = cueEngine.runningEnds()[0]
  return {
    elapsedFrom: elapsedFromShowMs === null ? null : audioEngine.engineTime(elapsedFromShowMs),
    remaining: latest === undefined ? null : { label: latest.label, endsAt: audioEngine.engineTime(latest.endAt) }
  }
}

export function useOutputs(): void {
  // The show's outputs, to main: opened, changed and closed to match.
  const outputs = useStore(s => s.videoOutputs)
  useEffect(() => {
    void window.cuerunner.output.configure(outputs).then(() => window.cuerunner.output.snapshot())
      .then(snapshot => useOutputState.getState().apply(snapshot))
      .catch(() => {
        // Main not answering is main's fault to report; the outputs stay as they were.
      })
  }, [outputs])

  // What the outputs say: to the runner (first frames, ends, dissolves) and to the panel.
  useEffect(() => {
    const unsubscribe = window.cuerunner.output.onEvents((events: OutputEvent[]) => {
      visualCues.handle(events)
      const state = useOutputState.getState()
      for (const event of events) {
        if (event.kind === 'status') state.status(event.status)
        if (event.kind === 'error') state.error({ cueId: event.cueId, outputId: event.outputId, message: event.message })
        if (event.kind === 'cameras') state.setCameras(event.cameras)
        if (event.kind === 'camera') {
          useOutputState.setState(s => ({ cameraStates: { ...s.cameraStates, [event.cueId]: { state: event.state, message: event.message } } }))
        }
      }
    })
    return unsubscribe
  }, [])

  // The next video is opened on its output before its GO, so its first frame is ready: when
  // it is stood on, and again when the cue stood on is given a file.
  const selectedId = useStore(s => s.selectedId)
  const selectedVideoFile = useStore(s => {
    const cue = s.cues.find(c => c.id === s.selectedId)
    return cue?.type === 'video' ? cue.filePath : null
  })
  useEffect(() => {
    if (selectedId === null || selectedVideoFile === null || selectedVideoFile === '') return
    const cue = useStore.getState().cues.find(c => c.id === selectedId)
    if (cue?.type === 'video') visualCues.prepare(cue)
  }, [selectedId, selectedVideoFile])

  // A camera stood on is opened on its output the same way, so its picture is live the moment
  // GO asks for it rather than a second later: a capture device takes that long to wake.
  const selectedCamera = useStore(s => {
    const cue = s.cues.find(c => c.id === s.selectedId)
    return cue?.type === 'camera' && cameraSourceProblem(cue) === null ? `${cue.source}|${cue.deviceName}|${cue.url}|${cue.outputId}` : null
  })
  useEffect(() => {
    if (selectedId === null || selectedCamera === null) return
    const cue = useStore.getState().cues.find(c => c.id === selectedId)
    if (cue?.type === 'camera') visualCues.prepare(cue)
  }, [selectedId, selectedCamera])

  // The capture devices, as main has them now: the camera picker reads them.
  useEffect(() => {
    void window.cuerunner.output.cameras().then(cameras => useOutputState.getState().setCameras(cameras)).catch(() => {})
  }, [])

  // An edit to a picture that is up reaches it on its next frame.
  useEffect(() => {
    let previousList = useStore.getState().cues
    let previous = new Map<string, Cue>(previousList.map(cue => [cue.id, cue]))
    return useStore.subscribe(state => {
      // Most changes to the store are not to the cues — a running row, a log line — and
      // those cost nothing here.
      if (state.cues === previousList) return
      previousList = state.cues
      const next = new Map<string, Cue>()
      for (const cue of state.cues) {
        next.set(cue.id, cue)
        if (!isVisualCue(cue) || previous.get(cue.id) === cue) continue
        if (visualCues.isShowing(cue.id)) visualCues.update(cue)
      }
      previous = next
    })
  }, [])

  // The timers: what they count, sent when it changes. The show clock starts on the first
  // GO after a show is opened, and a show that is opened again starts it over.
  useEffect(() => {
    let elapsedFrom: number | null = null
    let sent = ''
    let workspaceId = useStore.getState().workspaceId
    const timer = setInterval(() => {
      const state = useStore.getState()
      if (state.workspaceId !== workspaceId) {
        workspaceId = state.workspaceId
        elapsedFrom = null
      }
      if (elapsedFrom === null && state.running.size > 0) elapsedFrom = audioEngine.nowMs()
      const feed = timerFeedNow(elapsedFrom)
      const key = JSON.stringify(feed)
      if (key === sent) return
      sent = key
      void window.cuerunner.output.timer(feed).catch(() => {})
    }, TIMER_TICK_MS)
    return () => clearInterval(timer)
  }, [])
}
