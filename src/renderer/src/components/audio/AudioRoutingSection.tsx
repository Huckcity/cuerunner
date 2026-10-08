import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../../store'
import { audioEngine } from '../../engine/audioEngineClient'
import type { AudioDeviceInfo } from '../../../../shared/audio'
import {
  audioRoutingOf,
  newPatchId,
  patchChannelsLabel,
  withAudioRouting,
  type AudioRouting,
  type OutputPatch
} from '../../../../shared/audioRouting'
import { NumberField, TextField } from '../common/Field'
import './AudioIo.css'

/**
 * Device outputs as an operator types them — "1-2", "5, 6", "3" — read into zero-based
 * outputs; null for text that is not that.
 */
export function parseChannels(text: string): number[] | null {
  const outputs: number[] = []
  for (const part of text.split(',').map(piece => piece.trim()).filter(piece => piece !== '')) {
    const range = /^(\d+)\s*[-–]\s*(\d+)$/.exec(part)
    if (range) {
      const from = Number(range[1])
      const to = Number(range[2])
      if (from < 1 || to < from || to > 32) return null
      for (let n = from; n <= to; n++) outputs.push(n - 1)
      continue
    }
    if (!/^\d+$/.test(part)) return null
    const n = Number(part)
    if (n < 1 || n > 32) return null
    outputs.push(n - 1)
  }
  return outputs.length > 0 && outputs.length <= 32 ? outputs : null
}

/**
 * The show's routing settings, in Settings → Audio: its output patches (a name, the device
 * they were made for and the outputs they are), the patch audition plays through, and the
 * loudness a cue is normalised to.
 */
export function AudioRoutingSection() {
  const settings = useStore(s => s.audioSettings)
  const updateAudioSettings = useStore(s => s.updateAudioSettings)
  const routing = useMemo(() => audioRoutingOf(settings), [settings])
  const [devices, setDevices] = useState<AudioDeviceInfo[]>([])
  const [engineDevice, setEngineDevice] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    audioEngine.devices().then(list => { if (current) setDevices(list) }).catch(() => {})
    audioEngine.info().then(info => { if (current) setEngineDevice(info.deviceId) }).catch(() => {})
    return () => { current = false }
  }, [])

  const write = (next: AudioRouting): void =>
    updateAudioSettings(withAudioRouting(useStore.getState().audioSettings, next))
  const setPatch = (id: string, patch: Partial<OutputPatch>): void =>
    write({ ...routing, patches: routing.patches.map(entry => (entry.id === id ? { ...entry, ...patch } : entry)) })
  const addPatch = (): void => {
    const id = newPatchId(routing.patches)
    const first = routing.patches.reduce((most, patch) => Math.max(most, ...patch.channels, -1), -1) + 1
    const channels = first + 1 < 32 ? [first, first + 1] : [0, 1]
    write({
      ...routing,
      patches: [...routing.patches, { id, name: `Patch ${routing.patches.length + 1}`, deviceId: '', channels, gainDb: 0, muted: false }]
    })
  }
  const removePatch = (id: string): void =>
    write({
      ...routing,
      patches: routing.patches.filter(patch => patch.id !== id),
      auditionPatchId: routing.auditionPatchId === id ? null : routing.auditionPatchId
    })

  return (
    <div className="audio-routing-section">
      <div className="field-section-title">Output patches</div>
      <div className="patch-list">
        {routing.patches.map(patch => {
          const elsewhere = patch.deviceId !== '' && engineDevice !== null && patch.deviceId !== engineDevice
          return (
            <div key={patch.id} className="patch-entry" data-patch={patch.id}>
              <div className="patch-row">
                <TextField value={patch.name} aria-label="Patch name" className="patch-name"
                  onValue={name => setPatch(patch.id, { name: name.trim() === '' ? patch.name : name })} />
                <select aria-label="Patch device" className="patch-device" value={patch.deviceId}
                  onChange={e => setPatch(patch.id, { deviceId: e.target.value })}>
                  <option value="">The show's device</option>
                  {devices.map(device => <option key={device.id} value={device.id}>{device.name}</option>)}
                  {patch.deviceId !== '' && !devices.some(device => device.id === patch.deviceId) && (
                    <option value={patch.deviceId}>{patch.deviceId} (not connected)</option>
                  )}
                </select>
                <TextField value={patchChannelsLabel(patch.channels)} aria-label="Patch outputs" className="patch-channels"
                  validate={text => (parseChannels(text) === null ? 'Outputs like 1-2 or 5, 6' : null)}
                  onValue={text => {
                    const channels = parseChannels(text)
                    if (channels !== null) setPatch(patch.id, { channels })
                  }} />
                <button className="inspector-btn patch-remove" onClick={() => removePatch(patch.id)}>Remove</button>
              </div>
              {elsewhere && (
                <p className="inspector-hint patch-elsewhere">
                  Made for another device: it plays on outputs {patchChannelsLabel(patch.channels)} of the one in use.
                </p>
              )}
            </div>
          )
        })}
      </div>
      <div className="field-row">
        <button className="inspector-btn patch-add" onClick={addPatch} disabled={routing.patches.length >= 16}>
          Add patch
        </button>
      </div>
      <div className="field-row">
        <label htmlFor="audition-patch">Audition output</label>
        <select id="audition-patch" className="audition-patch" value={routing.auditionPatchId ?? ''}
          onChange={e => write({ ...routing, auditionPatchId: e.target.value === '' ? null : e.target.value })}>
          <option value="">None — audition is off</option>
          {routing.patches.map(patch => <option key={patch.id} value={patch.id}>{patch.name}</option>)}
        </select>
      </div>
      <div className="field-section-title">Loudness</div>
      <div className="field-row">
        <label htmlFor="loudness-target">Normalize to (LUFS)</label>
        <NumberField id="loudness-target" className="loudness-target" when="typed" min={-60} max={0} step={0.5}
          value={routing.loudnessTargetLufs}
          onValue={value => { if (value !== null) write({ ...routing, loudnessTargetLufs: value }) }} />
      </div>
      <div className="field-row">
        <label htmlFor="true-peak-ceiling">True-peak ceiling (dBTP)</label>
        <NumberField id="true-peak-ceiling" className="true-peak-ceiling" when="typed" min={-20} max={0} step={0.5}
          value={routing.truePeakCeilingDb}
          onValue={value => { if (value !== null) write({ ...routing, truePeakCeilingDb: value }) }} />
      </div>
    </div>
  )
}
