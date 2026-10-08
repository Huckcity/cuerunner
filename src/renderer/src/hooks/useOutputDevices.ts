// The output devices a show plays on, as the engine has them right now: each extra device's
// state (playing or lost, its rate, its clock against the main device's, its latency), the
// devices a patch can name, and which of the show's patches have fallen back to the show's own
// device and why. The fallback notice and Settings → Audio both read it.

import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import { audioEngine } from '../engine/audioEngineClient'
import { patchDeviceReasons } from '../engine/audioRouting'
import { useAudioEngineInfo } from './useAudioEngineInfo'
import type { AudioOutputDevice, AudioOutputStatus } from '../../../shared/audio'
import { audioRoutingOf, patchDevices, patchFallbacks, type PatchFallback } from '../../../shared/audioRouting'

/** How often the devices' state is read while a show names any: a lost device is on screen inside this. */
export const OUTPUT_STATUS_POLL_MS = 1000

export interface OutputDevices {
  /** Every extra output device the engine holds open (or lost). */
  statuses: AudioOutputStatus[]
  /** The devices a patch can name; empty until the engine has listed them. */
  devices: AudioOutputDevice[]
  /** The show's patches that play on the show's own device instead of the one they name. */
  fallbacks: PatchFallback[]
  /** The main device as the engine has it: its id (null with none) and its name. */
  main: { id: string | null; name: string }
  /** Reads the state again now — after a reconnect, without waiting for the poll. */
  refresh: () => void
  /** Lists the devices again — after one is plugged in. */
  relist: () => void
}

/**
 * `listDevices` asks the engine for the devices a patch can name, which on a real backend is
 * an enumeration — Settings asks; the notice across the window does not need to.
 */
export function useOutputDevices({ listDevices = false }: { listDevices?: boolean } = {}): OutputDevices {
  const settings = useStore(s => s.audioSettings)
  const { info } = useAudioEngineInfo()
  const routing = useMemo(() => audioRoutingOf(settings), [settings])
  const named = useMemo(() => patchDevices(routing.patches, null), [routing])
  const [statuses, setStatuses] = useState<AudioOutputStatus[]>([])
  // Readings taken since the show's devices last changed. The first can land before the sync
  // that opens them has finished, so a fallback is only said on the second: a show that loads
  // on a machine with every device it names never flashes a notice.
  const [readings, setReadings] = useState(0)
  const [devices, setDevices] = useState<AudioOutputDevice[]>([])
  const [tick, setTick] = useState(0)
  const [listTick, setListTick] = useState(0)

  // Polled only while the show names a device beside its own: a show on one device asks nothing.
  const watching = named.length > 0 || listDevices
  const namedKey = named.join('\n')
  useEffect(() => {
    setReadings(0)
  }, [namedKey])
  useEffect(() => {
    if (!watching) {
      setStatuses([])
      return
    }
    let current = true
    const load = (): void => {
      audioEngine.outputStatus()
        .then(next => {
          if (!current) return
          setStatuses(next)
          setReadings(n => n + 1)
        })
        .catch(() => { if (current) setStatuses([]) })
    }
    load()
    const timer = setInterval(load, OUTPUT_STATUS_POLL_MS)
    return () => {
      current = false
      clearInterval(timer)
    }
  }, [watching, tick])

  useEffect(() => {
    if (!listDevices) return
    let current = true
    audioEngine.outputs().then(list => { if (current) setDevices(list) }).catch(() => {})
    return () => { current = false }
  }, [listDevices, listTick])

  const main = useMemo(() => ({
    id: info?.deviceId ?? null,
    name: info?.deviceName ?? ''
  }), [info?.deviceId, info?.deviceName])

  const fallbacks = useMemo(() => {
    if (readings < 2) return []
    const names = new Map(devices.map(device => [device.id, device.name] as const))
    return patchFallbacks(routing.patches, statuses, main, patchDeviceReasons(), names)
    // `statuses` changes with every poll, which is when a reason the sync recorded is read again.
  }, [routing, statuses, main, devices, readings])

  return {
    statuses,
    devices,
    fallbacks,
    main,
    refresh: () => setTick(n => n + 1),
    relist: () => setListTick(n => n + 1)
  }
}
