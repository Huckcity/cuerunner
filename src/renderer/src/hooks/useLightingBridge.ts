import { useEffect } from 'react'
import { usePro, useStore } from '../store'
import { stableJson } from '../../../shared/showfile'
import type { LightingSettings } from '../../../shared/dmx'
import type { DmxConfig } from '../../../shared/dmxWire'
import { lightingCommand } from '../engine/lighting'

/** The slice of the rig main reads: where each universe goes, and what a panic does. */
export function lightingConfig(lighting: LightingSettings): DmxConfig {
  return {
    outputs: lighting.outputs,
    inputs: lighting.inputs,
    sync: lighting.sync,
    syncUniverse: lighting.syncUniverse,
    panic: lighting.panic
  }
}

/**
 * Keeps the lighting engine told where the show's universes go: on load, on every edit to the
 * outputs, and whenever a licence turns the engine on. Compared by value, so an edit to a
 * fixture's name — which main never reads — sends nothing, and a re-render sends nothing twice.
 * The patch itself stays here: main is handed slots, never fixtures.
 */
export function useLightingBridge(): void {
  const key = useStore(s => stableJson(lightingConfig(s.lighting)))
  const pro = usePro()
  useEffect(() => {
    if (!pro) return
    void lightingCommand('configure', JSON.parse(key) as DmxConfig).then(result => {
      if (!result.ok) {
        useStore.getState().appendLog([{ level: 'error', message: `Lighting: ${result.error ?? 'the outputs were not taken'}` }])
      }
    })
  }, [key, pro])
}
