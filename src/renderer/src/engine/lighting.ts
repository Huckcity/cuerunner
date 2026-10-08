import { useStore } from '../store'
import type { Cue, FadeCurve, LightCue } from '../../../shared/cue'
import {
  resolveLook,
  resolveParam,
  targetFixtures,
  type LightEffect,
  type LightingSettings
} from '../../../shared/dmx'
import { DMX_SERVICE_ID, type DmxEffect } from '../../../shared/dmxWire'

// The window's half of the lights: a Light cue's look resolved against the show's rig, and
// handed to the lighting engine in main as slots and values. Main holds the levels and sends
// them; nothing here keeps any, so a window that reloads mid-show finds the rig exactly where
// the cues left it.

export interface LightResult {
  ok: boolean
  error?: string
}

/** Sends one command to the lighting engine, and answers with what it said. */
export async function lightingCommand(action: string, payload?: unknown): Promise<LightResult & { result?: unknown }> {
  try {
    const answer = await window.cuerunner.show.command(DMX_SERVICE_ID, action, payload)
    return answer.ok ? { ok: true, result: answer.result } : { ok: false, error: answer.error ?? 'the lighting did not take it' }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Effects resolved to the slots they move. On a group each member starts at its own place in
 * the cycle — `spread` of a cycle shared out across the members in the group's order — which is
 * what turns one sine into a chase.
 */
export function resolveEffects(lighting: LightingSettings, effects: readonly LightEffect[]): DmxEffect[] {
  const resolved: DmxEffect[] = []
  for (const effect of effects) {
    const members = targetFixtures(lighting, effect.target, effect.id)
    members.forEach((fixture, index) => {
      const address = resolveParam(lighting, fixture, effect.param)
      if (address === null) return
      const phase = members.length > 1 ? (effect.spread * index) / members.length : 0
      resolved.push({
        ...address,
        shape: effect.shape,
        rate: effect.rate,
        low: effect.low,
        high: effect.high,
        phase: phase - Math.floor(phase)
      })
    })
  }
  return resolved
}

/**
 * A Light cue's GO: its look and effects resolved against the rig the show has now, faded over
 * what is left of its time — the whole of it from the top, the rest of it when a timeline
 * starts the cue part-way in.
 */
export function goLight(cue: LightCue, seekMs = 0): Promise<LightResult> {
  const lighting = useStore.getState().lighting
  return lightingCommand('go', {
    cueId: cue.id,
    values: resolveLook(lighting, cue.look),
    fadeMs: Math.max(0, cue.duration - seekMs),
    curve: cue.curve,
    htp: cue.intensity === 'htp',
    effects: resolveEffects(lighting, cue.effects)
  })
}

/** Stops a Light cue's fade where it is; the light stays on. */
export function stopLight(cueId: string): void {
  void lightingCommand('stop', { cueId })
}

/** Releases what a Light cue holds: it fades home. */
export function releaseLight(cueId: string | null, fadeMs: number, curve: FadeCurve = 'linear'): Promise<LightResult> {
  return lightingCommand('release', { cueId, fadeMs, curve })
}

/** A Fade cue aimed at a Light cue: its intensity to `level` of what it set. */
export function levelLight(cueId: string, level: number, fadeMs: number, curve: FadeCurve): Promise<LightResult> {
  return lightingCommand('level', { cueId, level, fadeMs, curve })
}

/** The panic, by the show's own rule for the lights. */
export function panicLights(): void {
  void lightingCommand('panic')
}

/** Whether a cue in the show is a Light cue. */
export function isLightCue(cues: readonly Cue[], cueId: string): boolean {
  return cues.some(cue => cue.id === cueId && cue.type === 'light')
}

/** Freezes every Light cue among the cues named: STOP stops a fade, it does not turn the light off. */
export function stopLightsAmong(cues: readonly Cue[], cueIds: Iterable<string>): void {
  for (const cueId of cueIds) if (isLightCue(cues, cueId)) stopLight(cueId)
}
