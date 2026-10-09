import { useEffect, useState, useSyncExternalStore } from 'react'
import { useStore } from '../../store'
import type { AudioCrosspoint } from '../../../../shared/cue'
import {
  FIT_MODES,
  GRID_POSITIONS,
  GEOMETRY_LIMITS,
  VIDEO_DEFAULTS,
  VISUAL_BASE_DEFAULTS,
  defaultGeometry,
  mediaUrl,
  outputFor,
  type FitMode,
  type GridPosition,
  type ImageCue,
  type TextCue,
  type VideoCue,
  type VisualCue,
  type VisualGeometry
} from '../../../../shared/visual'
import { LastRun } from './LastRun'
import { ResetButton } from './ResetButton'
import { NumberField, TextField } from '../common/Field'
import { RoutingMatrix } from './RoutingMatrix'
import { audioEngine } from '../../engine/audioEngineClient'
import { cueEngine, videoSound } from '../../engine/CueEngine'
import { CurveEditor } from '../audio/CurveEditor'
import { PatchSelect } from '../audio/PatchSelect'
import { AuditionButton } from '../audio/AuditionButton'
import { visualCues } from '../../engine/visualCues'
import { cueNameFromFile } from '../../utils/cueDefaults'
import { formatDuration } from '../../utils/cueDefaults'
import { PictureCompositing, PictureKeyframes } from './PictureMotion'
import { CameraInspector } from './CameraInspector'
import type { CameraCue } from '../../../../shared/visual'
import './VisualInspector.css'

// The picture cues' tabs. Every one of them shares the Picture tab — which output, which
// layer, how visible, how it fades and where it sits — and has a tab of its own for what it
// shows; a video has a third, for its sound, which is an engine voice like an audio cue's.

const FIT_NAME: Record<FitMode, string> = {
  fit: 'Fit — all of it, letterboxed',
  fill: 'Fill — the whole output, cropped',
  stretch: 'Stretch — to the output’s shape',
  native: 'Native — one pixel per pixel'
}

const GRID_NAME: Record<GridPosition, string> = {
  'top-left': 'Top left',
  top: 'Top',
  'top-right': 'Top right',
  left: 'Left',
  center: 'Centre',
  right: 'Right',
  'bottom-left': 'Bottom left',
  bottom: 'Bottom',
  'bottom-right': 'Bottom right'
}

const toSeconds = (ms: number): number => Math.round(ms / 100) / 10
const fromSeconds = (s: number): number => Math.round(s * 1000)

function useSet<T extends VisualCue>(cue: T): (patch: Partial<T>) => void {
  const update = useStore(s => s.updateCue)
  return patch => update(cue.id, patch as Partial<VisualCue>)
}

/** The file a picture cue plays, with the dialog that picks it and what the file turned out to be. */
function MediaFile({ cue, kind }: { cue: VideoCue | ImageCue; kind: 'video' | 'image' }) {
  const set = useSet<VideoCue | ImageCue>(cue)
  const separator = Math.max(cue.filePath.lastIndexOf('/'), cue.filePath.lastIndexOf('\\'))
  const fileName = cue.filePath.slice(separator + 1)
  const pick = async (): Promise<void> => {
    const path = await window.cuerunner.output.pickFile(kind)
    if (path === null) return
    const unnamed = cue.name === 'Video Cue' || cue.name === 'Image Cue'
    set(unnamed ? { filePath: path, name: cueNameFromFile(path) } : { filePath: path })
  }
  return (
    <div className="field-row">
      <label>File</label>
      <input value={fileName} readOnly className="visual-file-name" title={cue.filePath} data-path={cue.filePath}
        placeholder="No file selected" style={{ flex: 1, cursor: 'pointer' }} onClick={() => void pick()} />
      <button onClick={() => void pick()} className="inspector-btn">Browse</button>
    </div>
  )
}

/**
 * A small picture of the file, read the way an output reads it — through the media scheme,
 * decoded by Chromium — so a file this window can show is one the output can. A video's
 * length is read off it as it loads, which is a measurement like an audio file's.
 */
function MediaPreview({ cue }: { cue: VideoCue | ImageCue }) {
  const syncDuration = useStore(s => s.syncCueDuration)
  const [fault, setFault] = useState<string | null>(null)
  const [size, setSize] = useState<string>('')
  useEffect(() => { setFault(null); setSize('') }, [cue.filePath])
  if (cue.filePath === '') return null
  const src = mediaUrl(cue.filePath)
  return (
    <div className="visual-preview">
      {cue.type === 'video' ? (
        <video
          key={src}
          src={src}
          muted
          preload="metadata"
          className="visual-preview-media"
          onLoadedMetadata={event => {
            const video = event.currentTarget
            setSize(`${video.videoWidth} × ${video.videoHeight}`)
            if (Number.isFinite(video.duration) && video.duration > 0) syncDuration(cue.id, Math.round(video.duration * 1000))
            // The first frame, not a black one: a hair past the start.
            video.currentTime = Math.min(0.05, video.duration / 2)
          }}
          onError={() => setFault('this file cannot be shown — it is missing, or not a video Chromium decodes')}
        />
      ) : (
        <img
          key={src}
          src={src}
          alt=""
          className="visual-preview-media"
          onLoad={event => setSize(`${event.currentTarget.naturalWidth} × ${event.currentTarget.naturalHeight}`)}
          onError={() => setFault('this file cannot be shown — it is missing, or not an image Chromium decodes')}
        />
      )}
      <span className="inspector-readout visual-preview-size">
        {fault ?? [size, cue.type === 'video' && cue.duration > 0 ? formatDuration(cue.duration) : ''].filter(Boolean).join(' · ')}
      </span>
    </div>
  )
}

/** Whether the runner has the cue's picture up, and whether it is paused: the live controls read this. */
function usePictureState(cueId: string): { showing: boolean; paused: boolean } {
  const showing = useSyncExternalStore(listener => visualCues.subscribe(listener), () => visualCues.isShowing(cueId))
  const paused = useSyncExternalStore(listener => visualCues.subscribe(listener), () => visualCues.isPaused(cueId))
  return { showing, paused }
}

export function VideoInspector({ cue, tab }: { cue: VideoCue; tab: string }) {
  if (tab === 'Picture') return <PictureTab cue={cue} />
  if (tab === 'Sound') return <VideoSoundTab cue={cue} />
  return <VideoTab cue={cue} />
}

function VideoTab({ cue }: { cue: VideoCue }) {
  const set = useSet(cue)
  const { showing, paused } = usePictureState(cue.id)
  const running = useStore(s => s.running.has(cue.id))
  const [position, setPosition] = useState<number | null>(null)
  useEffect(() => {
    if (!showing) { setPosition(null); return }
    const timer = setInterval(() => {
      setPosition(visualCues.position(cue.id, audioEngine.nowMs())?.positionMs ?? null)
    }, 200)
    return () => clearInterval(timer)
  }, [showing, cue.id])
  const regionEnd = cue.endTime ?? (cue.duration > 0 ? cue.duration : null)

  return (
    <div>
      <MediaFile cue={cue} kind="video" />
      <MediaPreview cue={cue} />
      <div className="field-row">
        <label>Start time (s)</label>
        <NumberField when="typed" min={0} step={0.1} value={toSeconds(cue.startTime)}
          onValue={seconds => { if (seconds !== null) set({ startTime: fromSeconds(seconds) }) }} />
        <ResetButton label="Start time" value={cue.startTime} defaultValue={VIDEO_DEFAULTS.startTime}
          onReset={() => set({ startTime: VIDEO_DEFAULTS.startTime })} />
      </div>
      <div className="field-row">
        <label>End time (s)</label>
        <NumberField when="typed" min={0} step={0.1} value={cue.endTime !== null ? toSeconds(cue.endTime) : null}
          placeholder="play to end"
          onValue={seconds => set({ endTime: seconds === null ? null : fromSeconds(seconds) })} />
        <ResetButton label="End time" value={cue.endTime} defaultValue={VIDEO_DEFAULTS.endTime}
          onReset={() => set({ endTime: VIDEO_DEFAULTS.endTime })} />
      </div>
      <div className="field-row">
        <label>Loop count</label>
        <NumberField when="typed" min={-1} value={cue.loopCount}
          onValue={loopCount => { if (loopCount !== null) set({ loopCount }) }} />
        <ResetButton label="Loop count" value={cue.loopCount} defaultValue={VIDEO_DEFAULTS.loopCount}
          onReset={() => set({ loopCount: VIDEO_DEFAULTS.loopCount })} />
      </div>
      <p className="inspector-hint" style={{ marginTop: 0 }}>0 = play once, -1 = loop until stopped or devamped</p>
      <div className="field-row">
        <label htmlFor="inspector-hold-last-frame">Hold last frame</label>
        <input id="inspector-hold-last-frame" type="checkbox" checked={cue.holdLastFrame}
          onChange={e => set({ holdLastFrame: e.target.checked })} />
        <span className="inspector-readout">{cue.holdLastFrame ? 'runs until it is stopped' : 'goes when the video ends'}</span>
      </div>
      {running && (
        <>
          <div className="field-section-title">Live</div>
          <div className="field-row">
            <label>Playing</label>
            <button className="inspector-btn visual-pause" disabled={!showing}
              onClick={() => { if (paused) cueEngine.resumeCue(cue.id); else cueEngine.pauseCue(cue.id) }}>
              {paused ? 'Resume' : 'Pause'}
            </button>
            <span className="inspector-readout visual-position">
              {position === null ? '–' : formatDuration(Math.max(1, position))}
            </span>
          </div>
          {regionEnd !== null && (
            <div className="field-row">
              <label>Position</label>
              <input type="range" className="visual-seek" min={cue.startTime} max={regionEnd} step={100}
                value={position ?? cue.startTime} disabled={!showing}
                onChange={e => cueEngine.seekCue(cue.id, Number(e.target.value))}
                style={{ flex: 1, accentColor: 'var(--accent-blue)' }} />
            </div>
          )}
        </>
      )}
      <LastRun cueId={cue.id} />
    </div>
  )
}

function VideoSoundTab({ cue }: { cue: VideoCue }) {
  const set = useSet(cue)
  const outputDeviceId = useStore(s => s.audioSettings.outputDeviceId)
  const [fileChannels, setFileChannels] = useState(0)
  const [silent, setSilent] = useState(false)
  const [deviceChannels, setDeviceChannels] = useState(2)
  useEffect(() => {
    setSilent(false)
    if (cue.filePath === '') { setFileChannels(0); return }
    let current = true
    audioEngine.prepare(cue.id, cue.filePath)
      .then(metadata => { if (current) setFileChannels(metadata.channels) })
      .catch((error: unknown) => {
        if (!current) return
        setFileChannels(0)
        setSilent((error as { code?: string } | null)?.code === 'no-audio')
      })
    return () => { current = false }
  }, [cue.id, cue.filePath])
  useEffect(() => {
    let current = true
    audioEngine.devices()
      .then(devices => {
        if (!current) return
        const device = devices.find(d => d.id === outputDeviceId) ?? devices.find(d => d.isDefault)
        if (device && device.channels > 0) setDeviceChannels(device.channels)
      })
      .catch(() => {})
    return () => { current = false }
  }, [outputDeviceId])

  const applyVolume = (volume: number): void => {
    set({ volume })
    cueEngine.setLiveParameter(cue.id, 'volume', volume)
  }
  const applyPan = (pan: number): void => {
    set({ pan })
    cueEngine.setLiveParameter(cue.id, 'pan', pan)
  }
  const applyRouting = (outputs: AudioCrosspoint[] | null): void => {
    set({ outputs })
    cueEngine.setLiveRouting(cue.id)
  }

  return (
    <div>
      {silent && <p className="inspector-hint visual-silent" role="status">This video has no sound track: its picture plays alone.</p>}
      <div className="field-row">
        <label>Volume</label>
        <input type="range" min={0} max={1} step={0.01} value={cue.volume}
          onChange={e => applyVolume(Number(e.target.value))} style={{ flex: 1, accentColor: 'var(--accent-blue)' }} />
        <span className="inspector-readout">{Math.round(cue.volume * 100)}%</span>
        <ResetButton label="Volume" value={cue.volume} defaultValue={VIDEO_DEFAULTS.volume}
          onReset={() => applyVolume(VIDEO_DEFAULTS.volume)} />
      </div>
      <div className="field-row">
        <label>Pan</label>
        <input type="range" min={-1} max={1} step={0.01} value={cue.pan}
          onChange={e => applyPan(Number(e.target.value))} style={{ flex: 1, accentColor: 'var(--accent-blue)' }} />
        <span className="inspector-readout">
          {cue.pan > 0 ? `R${Math.round(cue.pan * 100)}` : cue.pan < 0 ? `L${Math.round(-cue.pan * 100)}` : 'C'}
        </span>
        <ResetButton label="Pan" value={cue.pan} defaultValue={VIDEO_DEFAULTS.pan}
          onReset={() => applyPan(VIDEO_DEFAULTS.pan)} />
      </div>
      <CurveEditor name="video-fade-in" label="Fade-in shape" defaultLabel="linear" shape={cue.fadeInShape}
        onChange={shape => set({ fadeInShape: shape })} />
      <CurveEditor name="video-fade-out" label="Fade-out shape" defaultLabel="linear" shape={cue.fadeOutShape}
        onChange={shape => set({ fadeOutShape: shape })} />
      <div className="field-section-title">Output routing</div>
      <PatchSelect name="video" value={cue.outputPatchId} onChange={outputPatchId => set({ outputPatchId })} />
      <RoutingMatrix cue={videoSound(cue)} fileChannels={fileChannels} deviceChannels={deviceChannels} onChange={applyRouting} />
      <div className="field-row">
        <label>Audition</label>
        <AuditionButton cue={cue} label="Audition the sound" />
      </div>
    </div>
  )
}

export function ImageInspector({ cue, tab }: { cue: ImageCue; tab: string }) {
  if (tab === 'Picture') return <PictureTab cue={cue} />
  return (
    <div>
      <MediaFile cue={cue} kind="image" />
      <MediaPreview cue={cue} />
      <DisplayTime cue={cue} />
      <LastRun cueId={cue.id} />
    </div>
  )
}

/** How long an image or text is up: a length, or until it is stopped. */
function DisplayTime({ cue }: { cue: ImageCue | TextCue }) {
  const update = useStore(s => s.updateCue)
  return (
    <div className="field-row">
      <label>Shown for (s)</label>
      <NumberField when="typed" min={0} step={0.1} value={cue.duration > 0 ? toSeconds(cue.duration) : null}
        placeholder="until stopped"
        onValue={seconds => update(cue.id, { duration: seconds === null ? 0 : fromSeconds(seconds) })} />
      <ResetButton label="Shown for" value={cue.duration} defaultValue={0}
        onReset={() => update(cue.id, { duration: 0 })} />
    </div>
  )
}

/** A live picture: its source on its own tab, and the Picture tab every picture shares. */
export function CameraCueInspector({ cue, tab }: { cue: CameraCue; tab: string }) {
  if (tab === 'Picture') return <PictureTab cue={cue} />
  return <CameraInspector cue={cue} />
}

export function TextInspector({ cue, tab }: { cue: TextCue; tab: string }) {
  const set = useSet(cue)
  if (tab === 'Picture') return <PictureTab cue={cue} />
  return (
    <div>
      <div className="field-row field-row-top">
        <label htmlFor="inspector-text-body">Text</label>
        <textarea id="inspector-text-body" className="inspector-code visual-text-body" rows={3} value={cue.text}
          onChange={e => set({ text: e.target.value })} />
      </div>
      <div className="field-row">
        <label>Font</label>
        <TextField value={cue.fontFamily} placeholder="IBM Plex Sans" onValue={fontFamily => set({ fontFamily })} />
      </div>
      <div className="field-row">
        <label>Size (px)</label>
        <NumberField when="typed" min={1} max={2000} value={cue.fontSize}
          onValue={fontSize => { if (fontSize !== null) set({ fontSize }) }} />
        <input type="color" className="visual-color" aria-label="Colour" value={cue.color}
          onChange={e => set({ color: e.target.value })} />
      </div>
      <div className="field-row">
        <label>Style</label>
        <label className="visual-inline"><input type="checkbox" checked={cue.bold} onChange={e => set({ bold: e.target.checked })} /> Bold</label>
        <label className="visual-inline"><input type="checkbox" checked={cue.italic} onChange={e => set({ italic: e.target.checked })} /> Italic</label>
      </div>
      <div className="field-row field-row-top">
        <label>Position</label>
        <div className="visual-grid" role="radiogroup" aria-label="Position">
          {GRID_POSITIONS.map(position => (
            <button key={position} type="button" role="radio" aria-checked={cue.position === position}
              className="visual-grid-cell" data-active={cue.position === position} title={GRID_NAME[position]}
              aria-label={GRID_NAME[position]} onClick={() => set({ position })} />
          ))}
        </div>
      </div>
      <DisplayTime cue={cue} />
      <LastRun cueId={cue.id} />
    </div>
  )
}

/** Which output, which layer, how visible, how it fades and where it sits: every picture cue's. */
function PictureTab({ cue }: { cue: VisualCue }) {
  const set = useSet<VisualCue>(cue)
  const outputs = useStore(s => s.videoOutputs)
  const target = outputFor(outputs, cue.outputId)
  const geometry = cue.geometry
  const setGeometry = (patch: Partial<VisualGeometry>): void => set({ geometry: { ...geometry, ...patch } })
  const setCrop = (edge: keyof VisualGeometry['crop'], value: number): void =>
    setGeometry({ crop: { ...geometry.crop, [edge]: value } })
  const [scaleMin, scaleMax] = GEOMETRY_LIMITS.scale
  const [offsetMin, offsetMax] = GEOMETRY_LIMITS.offset

  return (
    <div>
      <div className="field-row">
        <label>Output</label>
        <select value={cue.outputId} onChange={e => set({ outputId: e.target.value })} className="visual-output">
          <option value="">{outputs.length > 0 ? `The first output (${outputs[0].name})` : 'The first output'}</option>
          {outputs.map(output => <option key={output.id} value={output.id}>{output.name}</option>)}
        </select>
      </div>
      {target === null && (
        <p className="inspector-hint visual-no-output" role="status">
          {outputs.length === 0 ? 'The show has no video output yet — add one in the Outputs panel.' : 'That output is not in the show any more.'}
        </p>
      )}
      <div className="field-row">
        <label>Layer</label>
        <NumberField when="typed" min={-1000} max={1000} value={cue.layer}
          onValue={layer => { if (layer !== null) set({ layer }) }} />
        <ResetButton label="Layer" value={cue.layer} defaultValue={VISUAL_BASE_DEFAULTS.layer}
          onReset={() => set({ layer: VISUAL_BASE_DEFAULTS.layer })} />
      </div>
      <div className="field-row">
        <label>Opacity</label>
        <input type="range" min={0} max={1} step={0.01} value={cue.opacity} className="visual-opacity"
          onChange={e => set({ opacity: Number(e.target.value) })} style={{ flex: 1, accentColor: 'var(--accent-blue)' }} />
        <span className="inspector-readout">{Math.round(cue.opacity * 100)}%</span>
        <ResetButton label="Opacity" value={cue.opacity} defaultValue={VISUAL_BASE_DEFAULTS.opacity}
          onReset={() => set({ opacity: VISUAL_BASE_DEFAULTS.opacity })} />
      </div>
      <div className="field-row">
        <label>Fade in (s)</label>
        <NumberField when="typed" min={0} step={0.1} value={toSeconds(cue.fadeInDuration)}
          onValue={seconds => { if (seconds !== null) set({ fadeInDuration: fromSeconds(seconds) }) }} />
        <ResetButton label="Fade in" value={cue.fadeInDuration} defaultValue={VISUAL_BASE_DEFAULTS.fadeInDuration}
          onReset={() => set({ fadeInDuration: VISUAL_BASE_DEFAULTS.fadeInDuration })} />
      </div>
      <div className="field-row">
        <label>Fade out (s)</label>
        <NumberField when="typed" min={0} step={0.1} value={toSeconds(cue.fadeOutDuration)}
          onValue={seconds => { if (seconds !== null) set({ fadeOutDuration: fromSeconds(seconds) }) }} />
        <ResetButton label="Fade out" value={cue.fadeOutDuration} defaultValue={VISUAL_BASE_DEFAULTS.fadeOutDuration}
          onReset={() => set({ fadeOutDuration: VISUAL_BASE_DEFAULTS.fadeOutDuration })} />
      </div>
      <p className="inspector-hint" style={{ marginTop: 0 }}>The fade out lands on the picture’s own end.</p>
      {cue.type !== 'text' && (
        <div className="field-row">
          <label htmlFor="inspector-crossfade">Crossfade</label>
          <input id="inspector-crossfade" type="checkbox" checked={cue.crossfade}
            onChange={e => set({ crossfade: e.target.checked })} />
          <span className="inspector-readout">{cue.crossfade ? 'dissolves from what is on the output' : 'fades up over it'}</span>
        </div>
      )}
      <PictureCompositing cue={cue} />
      <div className="field-section-title">Geometry</div>
      {cue.type !== 'text' && (
        <div className="field-row">
          <label>Size to</label>
          <select value={geometry.fit} className="visual-fit" onChange={e => setGeometry({ fit: e.target.value as FitMode })}>
            {FIT_MODES.map(fit => <option key={fit} value={fit}>{FIT_NAME[fit]}</option>)}
          </select>
        </div>
      )}
      <div className="field-row">
        <label>Position (%)</label>
        <NumberField when="typed" min={offsetMin * 100} max={offsetMax * 100} step={0.1} value={Math.round(geometry.x * 1000) / 10}
          aria-label="Across" title="Right of centre, as a share of the output's width"
          onValue={x => { if (x !== null) setGeometry({ x: x / 100 }) }} />
        <NumberField when="typed" min={offsetMin * 100} max={offsetMax * 100} step={0.1} value={Math.round(geometry.y * 1000) / 10}
          aria-label="Down" title="Below centre, as a share of the output's height"
          onValue={y => { if (y !== null) setGeometry({ y: y / 100 }) }} />
      </div>
      <div className="field-row">
        <label>Scale (%)</label>
        <NumberField when="typed" min={scaleMin * 100} max={scaleMax * 100} step={0.1} value={Math.round(geometry.scale * 1000) / 10}
          onValue={scale => { if (scale !== null) setGeometry({ scale: scale / 100 }) }} />
        <label className="visual-inline-label">Rotate (°)</label>
        <NumberField when="typed" min={GEOMETRY_LIMITS.rotation[0]} max={GEOMETRY_LIMITS.rotation[1]} step={0.1} value={geometry.rotation}
          onValue={rotation => { if (rotation !== null) setGeometry({ rotation }) }} />
      </div>
      {cue.type !== 'text' && (
        <div className="field-row">
          <label>Crop (%)</label>
          {(['top', 'right', 'bottom', 'left'] as const).map(edge => (
            <NumberField key={edge} when="typed" min={0} max={GEOMETRY_LIMITS.crop[1] * 100} step={0.1}
              className="visual-crop" aria-label={`Crop ${edge}`} title={`Cut from the ${edge}`}
              value={Math.round(geometry.crop[edge] * 1000) / 10}
              onValue={value => { if (value !== null) setCrop(edge, value / 100) }} />
          ))}
        </div>
      )}
      <div className="field-row">
        <label>Geometry</label>
        <button className="inspector-btn" onClick={() => set({ geometry: defaultGeometry() })}>Reset geometry</button>
      </div>
      <PictureKeyframes cue={cue} />
    </div>
  )
}
