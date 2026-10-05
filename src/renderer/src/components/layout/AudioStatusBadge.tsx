import { useEffect, useState } from 'react'
import { useStore } from '../../store'
import { useAudioEngineInfo } from '../../hooks/useAudioEngineInfo'
import { backendHasNoDevice } from '../../engine/audioDeviceSettings'
import './AudioStatusBadge.css'

/**
 * How long the engine has to have been silent before the transport says so. Longer than
 * one poll (`useAudioEngineInfo` asks every four seconds), so a second reading has had its
 * chance: an engine that is still starting when the window opens, or one being replaced
 * mid-show, refuses a reading or two and is then fine — and a red pill that flashes at
 * every launch is one nobody reads on the night it means something.
 */
export const ENGINE_SILENCE_GRACE_MS = 5000

/** What is wrong with the sound, as the transport says it: a few words, and the reason. */
interface AudioProblem {
  state: 'engine' | 'device'
  label: string
  reason: string
}

/**
 * Says when the show is not coming out of where the operator thinks it is.
 *
 * Two states, and both used to be visible only to somebody who opened Settings → Audio.
 * The engine is not answering at all — it never started, or it has gone — so no audio cue
 * can sound. Or the engine refused the output device the show asks for: a show carried to
 * another machine names a device that machine does not have, the engine says no and stays
 * on the device it already had open, and the show plays out of the wrong outputs with
 * nothing on screen to say so.
 *
 * It follows the MIDI badge beside it: there only when the answer is bad, always in the
 * tree so the row does not move when it arrives, and one press from the panel that fixes
 * it. A backend with no device at all refuses every request by definition, and is not
 * reported — the same rule the panel itself keeps.
 */
export function AudioStatusBadge() {
  const { info, available } = useAudioEngineInfo()
  const deviceError = useStore(s => s.audioDeviceError)
  const openSettings = useStore(s => s.openSettings)

  // Whether the engine has stayed silent past the grace: one refused reading is not it.
  const [silent, setSilent] = useState(false)
  useEffect(() => {
    if (available) {
      setSilent(false)
      return
    }
    const timer = setTimeout(() => setSilent(true), ENGINE_SILENCE_GRACE_MS)
    return () => clearTimeout(timer)
  }, [available])

  const problem: AudioProblem | null = silent
    ? { state: 'engine', label: 'Audio engine not answering', reason: 'No audio cue can play until it does' }
    : available && deviceError !== null && info !== null && !backendHasNoDevice(info.backend)
      ? { state: 'device', label: 'Output device refused', reason: deviceError }
      : null

  return (
    <button
      className="audio-status"
      data-state={problem?.state ?? 'ok'}
      aria-hidden={problem === null}
      tabIndex={problem === null ? -1 : 0}
      title={problem === null ? undefined : `${problem.reason} — open Settings, Audio`}
      onClick={() => { if (problem !== null) openSettings('audio') }}
    >
      {problem?.label ?? null}
    </button>
  )
}
