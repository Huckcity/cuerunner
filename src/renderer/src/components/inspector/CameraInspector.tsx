import { useStore } from '../../store'
import { useOutputState } from '../../hooks/useOutputs'
import type { CameraCue } from '../../../../shared/visual'
import { cameraSourceProblem, isRtsp, resolveCameraDevice, type CameraDevice } from '../../../../shared/camera'
import { TextField } from '../common/Field'
import { LastRun } from './LastRun'

// A Camera cue's own tab: where its live picture comes from. A device is chosen from the ones
// this machine's outputs can see — an output window is the one place the app opens a camera, so
// with none open there is nothing to list — and kept twice: by name in the show, so another
// machine finds the same camera, and by this machine's own id in userData, so this one opens
// exactly the device that was picked even when two have the same name.

const DEFAULT_NAME = 'Camera Cue'

export function CameraInspector({ cue }: { cue: CameraCue }) {
  const update = useStore(s => s.updateCue)
  const cameras = useOutputState(s => s.cameras)
  const live = useOutputState(s => s.cameraStates[cue.id])
  const set = (patch: Partial<CameraCue>): void => update(cue.id, patch)
  const chosenHere = cameras.choices[cue.id] ?? null
  const resolved = resolveCameraDevice({ deviceId: chosenHere?.deviceId ?? '', deviceName: cue.deviceName }, cameras.devices)
  const missing = cue.source === 'device' && cue.deviceName !== '' && cameras.listed && resolved === null

  const choose = (device: CameraDevice | null): void => {
    const unnamed = cue.name === DEFAULT_NAME || cue.name === cue.deviceName
    set({ deviceName: device?.label ?? '', ...(unnamed && device !== null ? { name: device.label } : {}) })
    void window.cuerunner.output.chooseCamera(cue.id, device)
      .then(snapshot => useOutputState.getState().setCameras(snapshot))
      .catch(() => {})
  }
  const problem = cameraSourceProblem(cue)

  return (
    <div>
      <div className="field-row">
        <label>Source</label>
        <select className="camera-source" value={cue.source} onChange={e => set({ source: e.target.value as CameraCue['source'] })}>
          <option value="device">A camera on this machine</option>
          <option value="url">A network stream</option>
        </select>
      </div>
      {cue.source === 'device' ? (
        <>
          <div className="field-row">
            <label>Camera</label>
            <select className="camera-device" value={resolved?.deviceId ?? (cue.deviceName !== '' ? '__missing' : '')}
              onChange={e => {
                if (e.target.value === '__missing') return
                choose(cameras.devices.find(device => device.deviceId === e.target.value) ?? null)
              }}>
              <option value="">— choose a camera —</option>
              {cameras.devices.map(device => <option key={device.deviceId} value={device.deviceId}>{device.label}</option>)}
              {/* The show's camera, said by name, when this machine cannot see it. */}
              {resolved === null && cue.deviceName !== '' && <option value="__missing">{cue.deviceName} — not connected</option>}
            </select>
          </div>
          {!cameras.listed && (
            <p className="inspector-hint camera-unlisted" role="status">Open an output to list this machine's cameras.</p>
          )}
          {missing && (
            <p className="inspector-hint camera-missing" role="status">{cue.deviceName} is not connected to this machine.</p>
          )}
        </>
      ) : (
        <>
          <div className="field-row">
            <label>Address</label>
            <TextField value={cue.url} placeholder="http://camera.local/stream.mjpg" className="camera-url"
              onValue={url => set({ url: url.trim() })} />
          </div>
          <p className="inspector-hint" style={{ marginTop: 0 }}>
            {isRtsp(cue.url) ? 'RTSP is not supported — use the camera’s HTTP, MJPEG or HLS address.' : 'HTTP video, HLS or MJPEG; a login in the address is passed on.'}
          </p>
        </>
      )}
      {problem === null && live !== undefined && live.message !== '' && (
        <p className="inspector-hint camera-state" role="status">{live.message}</p>
      )}
      <LastRun cueId={cue.id} />
    </div>
  )
}
