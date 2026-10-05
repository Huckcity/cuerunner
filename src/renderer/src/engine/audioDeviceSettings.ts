// One home for the window's device request. The settings a show carries become the
// payload the engine's `configure` verb takes, the refusal comes back in the engine's
// own words, and what the store holds about the last request is written here and only
// here. The mount effect and Settings → Audio's Reconnect device both send through
// this module, so the lever cannot drift from what the window already does on every
// launch — and an operator reviving a lost device sends exactly what the show holds.

import { audioEngine } from './audioEngineClient'
import type { AudioEngineInfo, DeviceOptions } from './audioEngineClient'
import { useStore } from '../store'
import type { AudioSettings } from '../../../shared/workspace'

/**
 * The show's device settings as the wire payload. "default" is no device id at all —
 * the engine's own default — and an absent setting is left as the engine has it: a
 * request never silently falls back, so a refusal reaches the caller instead.
 */
export function deviceOptionsFromSettings(settings: AudioSettings): DeviceOptions {
  return {
    backend: settings.backend ?? 'auto',
    deviceId: settings.outputDeviceId === 'default' ? undefined : settings.outputDeviceId,
    sampleRate: settings.sampleRate,
    channels: settings.channels,
    exclusive: settings.exclusive,
    bufferFrames: settings.bufferFrames
  }
}

/**
 * A backend that has no device to configure, so no device request can ever be honoured:
 * the silent and offline ones a test or a dev run uses. Their refusal of every request is
 * by definition, not a fault anyone can act on, so nothing on screen reports it.
 */
export function backendHasNoDevice(backend: string): boolean {
  return backend === 'silent' || backend === 'offline' || backend === 'none'
}

/**
 * Electron wraps a rejected `invoke` in its own sentence, and the engine's class name
 * rides along behind it. The operator asked for a device setting and the engine refused
 * it; what they need is the engine's reason, not the plumbing that carried it.
 */
export function engineReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message
    .replace(/^Error invoking remote method '[^']*':\s*/, '')
    .replace(/^AudioEngineError:\s*/, '')
}

/**
 * Sends the settings and records what came back. A request the engine honoured clears
 * the refusal — the text described a device that is no longer the one in force — and
 * one it refused keeps the engine's own sentence for the panel. The reading a configure
 * returns is the engine as it is now, so the caller can publish it at once rather than
 * waiting for the next poll.
 */
export async function applyAudioDeviceSettings(settings: AudioSettings): Promise<AudioEngineInfo> {
  try {
    const info = await audioEngine.configure(deviceOptionsFromSettings(settings))
    useStore.getState().setAudioDeviceError(null)
    return info
  } catch (error) {
    useStore.getState().setAudioDeviceError(engineReason(error))
    throw error
  }
}
