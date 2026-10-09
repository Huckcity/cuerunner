// The lighting state: what every slot of every universe is doing, and why.
//
// A slot is held by the last cue that set it — latest takes precedence — and keeps the value
// that cue left it at after the cue's own run has ended: tracking, the way a lighting console
// tracks, so a cue that only changes the colour leaves the intensity where the cue before it
// put it. Intensity from a cue that asks for highest-takes-precedence lives in a layer of its
// own per cue, and the slot shows the highest of those layers and the tracked value.
//
// Over the cues sit three things a person's hand puts there: the faders of the lighting view
// (the programmer), an identify flashing one fixture, and the blackout. A console a show
// listens to may be merged in under them.
//
// Nothing here has a clock or a socket. Every call is handed `now` in milliseconds, so the
// tests drive fades, effects and releases on a fake clock and read the bytes back.

import type { FadeCurve } from '../../shared/cue'
import { fadeShareAt, type FadeShape } from '../../shared/fadeShape'
import {
  clamp01,
  curveShape,
  DMX_LIMITS,
  effectWave,
  slotKey,
  toByte,
  toBytes16,
  type DmxAddress,
  type DmxValue,
  type EffectShape,
  type LightingPanic
} from '../../shared/dmx'
import type { DmxGo, DmxProgrammerValue } from '../../shared/dmxWire'

/** How long the release a panic asks for takes. */
export const PANIC_RELEASE_MS = 2000

/** An identify's flash: this long on, this long off. */
export const IDENTIFY_FLASH_MS = 250

interface Fade {
  from: number
  to: number
  start: number
  duration: number
  curve: FadeCurve
  /** A drawn shape, read in place of `curve` by the one function every fade reads. */
  shape?: FadeShape | null
}

interface Effect {
  shape: EffectShape
  rate: number
  low: number
  high: number
  phase: number
  start: number
}

/** One parameter's slot (or slot pair), as the cues hold it. */
interface Slot extends DmxAddress {
  /** Where the value rests when no fade or effect is moving it. */
  value: number
  /** The cue holding it, or null once released. */
  owner: string | null
  /** What the owning cue asked for: a level change scales from here. */
  set: number
  fade: Fade | null
  effect: Effect | null
}

/** One cue's highest-takes-precedence intensity on one slot. */
interface Layer {
  value: number
  set: number
  fade: Fade | null
  /** A released layer fades to nothing and is then dropped. */
  releasing: boolean
}

interface HtpSlot extends DmxAddress {
  layers: Map<string, Layer>
}

/** A frame heard from a console this show listens to, as the receiver has merged it. */
export interface InputFrame {
  data: Uint8Array
  merge: boolean
}

function fadeValue(fade: Fade, now: number): number {
  if (fade.duration <= 0 || now >= fade.start + fade.duration) return fade.to
  if (now <= fade.start) return fade.from
  const t = (now - fade.start) / fade.duration
  const share = fade.shape ? fadeShareAt(t, fade.curve, fade.shape) : curveShape(t, fade.curve)
  return fade.from + (fade.to - fade.from) * share
}

function effectValue(effect: Effect, now: number): number {
  const cycles = ((now - effect.start) / 1000) * effect.rate + effect.phase
  return effect.low + (effect.high - effect.low) * effectWave(effect.shape, cycles)
}

function slotValue(slot: Slot, now: number): number {
  if (slot.effect !== null) return effectValue(slot.effect, now)
  if (slot.fade !== null) return fadeValue(slot.fade, now)
  return slot.value
}

function layerValue(layer: Layer, now: number): number {
  return layer.fade === null ? layer.value : fadeValue(layer.fade, now)
}

/** Writes a normalised value into a frame at an address: one byte, or a coarse and a fine one. */
function write(frame: Uint8Array, address: DmxAddress, value: number): void {
  if (address.f === null) {
    frame[address.s] = toByte(value)
    return
  }
  const [coarse, fine] = toBytes16(value)
  frame[address.s] = coarse
  frame[address.f] = fine
}

export class DmxEngine {
  private readonly slots = new Map<number, Slot>()
  private readonly htp = new Map<number, HtpSlot>()
  private readonly programmer = new Map<number, DmxProgrammerValue>()
  private identifying: { values: DmxValue[]; start: number; until: number } | null = null
  private blackedOut = false

  /** Universes some state reaches, besides the ones the outputs name. */
  universes(): number[] {
    const found = new Set<number>()
    for (const slot of this.slots.values()) found.add(slot.u)
    for (const slot of this.htp.values()) found.add(slot.u)
    for (const value of this.programmer.values()) found.add(value.u)
    for (const value of this.identifying?.values ?? []) found.add(value.u)
    return [...found].sort((a, b) => a - b)
  }

  get blackout(): boolean {
    return this.blackedOut
  }

  /** The cues holding at least one slot or one intensity layer. */
  holding(): string[] {
    const cues = new Set<string>()
    for (const slot of this.slots.values()) if (slot.owner !== null) cues.add(slot.owner)
    for (const slot of this.htp.values()) for (const [cueId, layer] of slot.layers) if (!layer.releasing) cues.add(cueId)
    return [...cues]
  }

  programmerValues(): DmxProgrammerValue[] {
    return [...this.programmer.values()]
  }

  /**
   * A Light cue's GO: every value fades from wherever its slot is now to where the cue says,
   * and the cue takes the slot. Intensity from a highest-takes-precedence cue fades in the
   * cue's own layer instead, from where that layer was. An effect replaces whatever its slot
   * was doing and is held by the cue the same way.
   */
  go(command: DmxGo, now: number): void {
    this.refuseNewUniverses([...command.values, ...command.effects])
    const duration = command.fadeMs
    for (const value of command.values) {
      const key = slotKey(value.u, value.s)
      if (command.htp && value.i) {
        const slot = this.htp.get(key) ?? { u: value.u, s: value.s, f: value.f, i: true, h: value.h, layers: new Map() }
        const layer = slot.layers.get(command.cueId)
        const from = layer === undefined ? 0 : layerValue(layer, now)
        slot.layers.set(command.cueId, {
          value: value.v,
          set: value.v,
          fade: duration > 0 ? { from, to: value.v, start: now, duration, curve: command.curve, shape: command.shape ?? null } : null,
          releasing: false
        })
        this.htp.set(key, slot)
        continue
      }
      const existing = this.slots.get(key)
      const from = existing === undefined ? 0 : slotValue(existing, now)
      this.slots.set(key, {
        u: value.u,
        s: value.s,
        f: value.f,
        i: value.i,
        h: value.h,
        value: value.v,
        owner: command.cueId,
        set: value.v,
        fade: duration > 0 ? { from, to: value.v, start: now, duration, curve: command.curve, shape: command.shape ?? null } : null,
        effect: null
      })
    }
    for (const effect of command.effects) {
      const key = slotKey(effect.u, effect.s)
      const existing = this.slots.get(key)
      this.slots.set(key, {
        u: effect.u,
        s: effect.s,
        f: effect.f,
        i: effect.i,
        h: effect.h,
        value: existing === undefined ? effect.low : slotValue(existing, now),
        owner: command.cueId,
        set: effect.high,
        fade: null,
        effect: {
          shape: effect.shape,
          rate: effect.rate,
          low: effect.low,
          high: effect.high,
          phase: effect.phase,
          start: now
        }
      })
    }
  }

  /**
   * Stops a cue where it is: a fade in flight stops at the value it has reached and an effect
   * stops on the step it is on, and the cue still holds them — stopping a light is not
   * turning it off. `null` stops every cue, which is what a panic that holds does.
   */
  stop(cueId: string | null, now: number): void {
    for (const slot of this.slots.values()) {
      if (cueId !== null && slot.owner !== cueId) continue
      slot.value = slotValue(slot, now)
      slot.fade = null
      slot.effect = null
    }
    for (const slot of this.htp.values()) {
      for (const [layerCue, layer] of slot.layers) {
        if (cueId !== null && layerCue !== cueId) continue
        layer.value = layerValue(layer, now)
        layer.fade = null
      }
    }
  }

  /**
   * Releases a cue: every slot it holds fades to its home value and is held by nothing, and
   * its intensity layers fade out and go. A slot a later cue has taken is that cue's, and a
   * release of the earlier one does not touch it. `null` releases everything.
   */
  release(cueId: string | null, fadeMs: number, curve: FadeCurve, now: number): void {
    for (const slot of this.slots.values()) {
      if (cueId !== null && slot.owner !== cueId) continue
      if (cueId === null && slot.owner === null && slot.fade === null && slot.value === slot.h) continue
      const from = slotValue(slot, now)
      slot.value = slot.h
      slot.owner = null
      slot.set = slot.h
      slot.effect = null
      slot.fade = fadeMs > 0 ? { from, to: slot.h, start: now, duration: fadeMs, curve } : null
    }
    for (const [key, slot] of this.htp) {
      for (const [layerCue, layer] of slot.layers) {
        if (cueId !== null && layerCue !== cueId) continue
        const from = layerValue(layer, now)
        if (fadeMs <= 0) {
          slot.layers.delete(layerCue)
          continue
        }
        layer.value = 0
        layer.set = 0
        layer.releasing = true
        layer.fade = { from, to: 0, start: now, duration: fadeMs, curve }
      }
      if (slot.layers.size === 0) this.htp.delete(key)
    }
  }

  /**
   * A Fade cue aimed at a Light cue: the intensity it holds moves to `level` of what it set,
   * over the fade. Colour, position and everything else it holds stay where they are.
   */
  level(cueId: string, level: number, fadeMs: number, curve: FadeCurve, now: number, shape: FadeShape | null = null): void {
    const target = clamp01(level)
    for (const slot of this.slots.values()) {
      if (slot.owner !== cueId || !slot.i || slot.effect !== null) continue
      const from = slotValue(slot, now)
      slot.value = slot.set * target
      slot.fade = fadeMs > 0 ? { from, to: slot.value, start: now, duration: fadeMs, curve, shape } : null
    }
    for (const slot of this.htp.values()) {
      const layer = slot.layers.get(cueId)
      if (layer === undefined || layer.releasing) continue
      const from = layerValue(layer, now)
      layer.value = layer.set * target
      layer.fade = fadeMs > 0 ? { from, to: layer.value, start: now, duration: fadeMs, curve, shape } : null
    }
  }

  /** The faders: values over every cue, until they are cleared. A value replaces its slot's last. */
  program(values: readonly DmxProgrammerValue[]): void {
    this.refuseNewUniverses(values)
    for (const value of values) this.programmer.set(slotKey(value.u, value.s), value)
  }

  clearProgrammer(): void {
    this.programmer.clear()
  }

  /** Flashes one fixture for `ms`: over everything but the blackout, then gone. */
  identify(values: readonly DmxValue[], ms: number, now: number): void {
    this.refuseNewUniverses(values)
    this.identifying = values.length === 0 || ms <= 0 ? null : { values: [...values], start: now, until: now + ms }
  }

  setBlackout(on: boolean): void {
    this.blackedOut = on
  }

  /**
   * A panic, as the show's rule for it says: hold everything where it is, release everything
   * home, or black out. Every rule stops what is moving first and ends an identify, so nothing
   * the panic did not decide on is still changing afterwards.
   */
  panic(rule: LightingPanic, now: number): void {
    this.identifying = null
    if (rule === 'release') {
      this.release(null, PANIC_RELEASE_MS, 'linear', now)
      return
    }
    this.stop(null, now)
    if (rule === 'blackout') this.blackedOut = true
  }

  /**
   * Settles what has finished: a fade that has arrived leaves its value, a released layer that
   * has faded out is dropped, an identify that has run its time ends. The frame itself is
   * computed from the clock whether or not this has run, so a late tick changes nothing that
   * goes out — it only keeps the bookkeeping from growing.
   */
  tick(now: number): void {
    for (const slot of this.slots.values()) {
      if (slot.fade !== null && now >= slot.fade.start + slot.fade.duration) {
        slot.value = slot.fade.to
        slot.fade = null
      }
    }
    for (const [key, slot] of this.htp) {
      for (const [cueId, layer] of slot.layers) {
        if (layer.fade !== null && now >= layer.fade.start + layer.fade.duration) {
          layer.value = layer.fade.to
          layer.fade = null
        }
        if (layer.releasing && layer.fade === null) slot.layers.delete(cueId)
      }
      if (slot.layers.size === 0) this.htp.delete(key)
    }
    if (this.identifying !== null && now >= this.identifying.until) this.identifying = null
  }

  /**
   * One universe's 512 bytes at `now`: the tracked values; the highest of them and any
   * intensity layer; a console merged in, highest takes precedence; the faders; an identify;
   * and the blackout over everything.
   */
  render(universe: number, now: number, input: InputFrame | null = null): Uint8Array {
    const frame = new Uint8Array(DMX_LIMITS.slots)
    const base = new Map<number, number>()
    for (const [key, slot] of this.slots) {
      if (slot.u !== universe) continue
      const value = slotValue(slot, now)
      base.set(key, value)
      write(frame, slot, value)
    }
    for (const [key, slot] of this.htp) {
      if (slot.u !== universe) continue
      let highest = base.get(key) ?? 0
      for (const layer of slot.layers.values()) highest = Math.max(highest, layerValue(layer, now))
      write(frame, slot, highest)
    }
    if (input !== null && input.merge) {
      const count = Math.min(input.data.length, DMX_LIMITS.slots)
      for (let at = 0; at < count; at++) frame[at] = Math.max(frame[at], input.data[at])
    }
    for (const value of this.programmer.values()) {
      if (value.u === universe) write(frame, value, value.v)
    }
    if (this.identifying !== null && now < this.identifying.until) {
      // On, then off: the off half darkens what identify lit and leaves a head where it
      // pointed it, so the beam blinks rather than swings.
      const on = Math.floor((now - this.identifying.start) / IDENTIFY_FLASH_MS) % 2 === 0
      for (const value of this.identifying.values) {
        if (value.u !== universe) continue
        write(frame, value, on || value.v < 1 ? value.v : 0)
      }
    }
    if (this.blackedOut) frame.fill(0)
    return frame
  }

  /**
   * A command that would bring the engine past its universe bound is refused whole, before
   * any of it is applied: the engine renders every universe it holds on every frame.
   */
  private refuseNewUniverses(values: readonly { u: number }[]): void {
    const known = new Set(this.universes())
    for (const value of values) {
      known.add(value.u)
      if (known.size > DMX_LIMITS.universes) {
        throw new Error(`the lighting reaches more than ${DMX_LIMITS.universes} universes`)
      }
    }
  }
}
