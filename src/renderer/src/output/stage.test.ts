// The stage's own decisions, on text layers (which need no decoder): when a picture is up,
// what it is drawn at, what a dissolve plans and takes down, and what it says it did.
import { describe, expect, it } from 'vitest'
import { Stage, formatTimer, timerText } from './stage'
import type { LayerSpec, OutputEvent } from '../../../shared/ipc/output'
import { createOutput, defaultGeometry } from '../../../shared/visual'

function textLayer(cueId: string, patch: Partial<LayerSpec> = {}): LayerSpec {
  return {
    cueId, outputId: 'o1', kind: 'text', seq: 1, layer: 1, opacity: 1, geometry: defaultGeometry(),
    fadeInMs: 0, fadeOutMs: 0, crossfade: false, at: 1000, src: null, timeline: null, elapsedMs: 0,
    holdLastFrame: false, displayMs: null,
    text: { text: cueId, fontFamily: 'IBM Plex Sans', fontSize: 50, color: '#ffffff', bold: false, italic: false, position: 'center' },
    ...patch
  }
}

function stageAt(): { stage: Stage; events: OutputEvent[]; at: (ms: number) => void } {
  let now = 0
  const events: OutputEvent[] = []
  const stage = new Stage({ now: () => now, toEngine: local => local, emit: event => events.push(event), release: () => {} })
  stage.configure(createOutput('o1', 'Stage'), 1920, 1080)
  return { stage, events, at: ms => { now = ms } }
}

function drawn(stage: Stage): Array<{ key: string; opacity: number }> {
  const frame = stage.frame()
  if (frame.plan.kind !== 'single') throw new Error('expected one stack')
  return frame.plan.draws.map(item => ({ key: item.key, opacity: Math.round(item.opacity * 1000) / 1000 }))
}

describe('the stage', () => {
  it('puts a picture up at its moment, not before, and says so', () => {
    const { stage, events, at } = stageAt()
    stage.apply({ op: 'play', layer: textLayer('t1') })
    at(999)
    expect(drawn(stage)).toEqual([])
    at(1000)
    expect(drawn(stage)).toEqual([{ key: 't1', opacity: 1 }])
    expect(events).toEqual([{ kind: 'first-frame', cueId: 't1', outputId: 'o1', at: 1000, outgoing: [] }])
  })

  it('fades in from the first frame and out onto its display time, then takes it down', () => {
    const { stage, events, at } = stageAt()
    stage.apply({ op: 'play', layer: textLayer('t1', { fadeInMs: 500, fadeOutMs: 500, displayMs: 2000 }) })
    at(1000)
    stage.frame()
    at(1250)
    expect(drawn(stage)).toEqual([{ key: 't1', opacity: 0.5 }])
    at(2750)
    expect(drawn(stage)).toEqual([{ key: 't1', opacity: 0.5 }])
    at(3000)
    expect(drawn(stage)).toEqual([])
    expect(events.map(event => event.kind)).toEqual(['first-frame', 'ended', 'gone'])
  })

  it('moves a picture\'s level with a fade and takes it down with a stop\'s fade', () => {
    const { stage, events, at } = stageAt()
    stage.apply({ op: 'play', layer: textLayer('t1') })
    at(1000)
    stage.frame()
    stage.apply({ op: 'fade', cueId: 't1', to: 0.2, durationMs: 1000, curve: 'linear', at: 1000 })
    at(1500)
    expect(drawn(stage)).toEqual([{ key: 't1', opacity: 0.6 }])
    stage.apply({ op: 'stop', cueId: 't1', fadeMs: 400, at: 2000 })
    at(2200)
    expect(drawn(stage)).toEqual([{ key: 't1', opacity: 0.1 }])
    at(2400)
    expect(drawn(stage)).toEqual([])
    expect(events.at(-1)).toEqual({ kind: 'gone', cueId: 't1', outputId: 'o1' })
  })

  it('applies an edit to a picture that is up on the next frame', () => {
    const { stage, at } = stageAt()
    stage.apply({ op: 'play', layer: textLayer('t1') })
    stage.apply({ op: 'play', layer: textLayer('t2', { seq: 2 }) })
    at(1000)
    expect(drawn(stage).map(item => item.key)).toEqual(['t1', 't2'])
    stage.apply({ op: 'update', cueId: 't1', patch: { layer: 5, opacity: 0.5 } })
    expect(drawn(stage)).toEqual([{ key: 't2', opacity: 1 }, { key: 't1', opacity: 0.5 }])
  })

  it('dissolves from what is at or below the incoming picture, and takes it down when it lands', () => {
    const { stage, events, at } = stageAt()
    stage.apply({ op: 'play', layer: textLayer('back', { layer: 1 }) })
    stage.apply({ op: 'play', layer: textLayer('title', { layer: 9, seq: 2 }) })
    at(1000)
    stage.frame()
    stage.apply({ op: 'play', layer: textLayer('next', { layer: 1, seq: 3, at: 2000, crossfade: true, fadeInMs: 1000 }) })
    at(2000)
    stage.frame()
    expect(events.find(event => event.kind === 'first-frame' && event.cueId === 'next')).toEqual(
      expect.objectContaining({ outgoing: ['back'] })
    )
    at(2500)
    const frame = stage.frame()
    expect(frame.plan.kind).toBe('dissolve')
    if (frame.plan.kind === 'dissolve') {
      expect(frame.plan.progress).toBe(0.5)
      expect(frame.plan.before.map(item => item.key)).toEqual(['back', 'title'])
      expect(frame.plan.after.map(item => item.key)).toEqual(['next', 'title'])
      // The incoming picture is at its full level in its own stack: the mix is its fade.
      expect(frame.plan.after[0].opacity).toBe(1)
    }
    at(3000)
    expect(drawn(stage).map(item => item.key)).toEqual(['next', 'title'])
    expect(events).toEqual(expect.arrayContaining([
      { kind: 'gone', cueId: 'back', outputId: 'o1' },
      { kind: 'dissolved', cueId: 'next', outputId: 'o1', removed: ['back'] }
    ]))
  })

  it('fades a crossfade up over black when there is nothing to dissolve from', () => {
    const { stage, at } = stageAt()
    stage.apply({ op: 'play', layer: textLayer('only', { crossfade: true, fadeInMs: 1000 }) })
    at(1000)
    stage.frame()
    at(1500)
    expect(drawn(stage)).toEqual([{ key: 'only', opacity: 0.5 }])
  })

  it('leaves what it was replacing when the incoming picture is taken back mid-dissolve', () => {
    const { stage, at } = stageAt()
    stage.apply({ op: 'play', layer: textLayer('back') })
    at(1000)
    stage.frame()
    stage.apply({ op: 'play', layer: textLayer('next', { seq: 2, at: 1000, crossfade: true, fadeInMs: 1000 }) })
    stage.frame()
    stage.apply({ op: 'stop', cueId: 'next', fadeMs: 0, at: 1200 })
    at(1300)
    expect(drawn(stage).map(item => item.key)).toEqual(['back'])
  })

  it('takes everything down for a clear, and moves every time held when the engine is replaced', () => {
    const { stage, at } = stageAt()
    stage.apply({ op: 'play', layer: textLayer('t1', { displayMs: 5000 }) })
    at(1000)
    stage.frame()
    // The new engine reads 100 000 ms later for the same instant.
    stage.rebase(100_000)
    at(101_000)
    expect(drawn(stage)).toEqual([{ key: 't1', opacity: 1 }])
    at(105_999)
    expect(drawn(stage)).toEqual([{ key: 't1', opacity: 1 }])
    stage.apply({ op: 'clear', fadeMs: 0, at: 0 })
    expect(drawn(stage)).toEqual([])
  })
})

describe('a held picture', () => {
  it('stands still with the show: its fade and its display time wait, then go on from there', () => {
    const { stage, events, at } = stageAt()
    stage.apply({ op: 'play', layer: textLayer('t1', { fadeInMs: 1000, displayMs: 3000 }) })
    at(1000)
    stage.frame()
    at(1500)
    stage.apply({ op: 'pause', cueId: 't1', at: 1500 })
    at(10_000)
    // Half faded in when it was held, and still: the display time has not run out either.
    expect(drawn(stage)).toEqual([{ key: 't1', opacity: 0.5 }])
    stage.apply({ op: 'resume', cueId: 't1', at: 10_000 })
    at(10_500)
    expect(drawn(stage)).toEqual([{ key: 't1', opacity: 1 }])
    // Shown for 3 s of its own time: 0.5 s before the hold and 2.5 s after it.
    at(12_499)
    expect(drawn(stage)).toEqual([{ key: 't1', opacity: 1 }])
    at(12_500)
    expect(drawn(stage)).toEqual([])
    expect(events.map(event => event.kind)).toEqual(['first-frame', 'ended', 'gone'])
  })
})

describe('the timer', () => {
  it('reads a duration as minutes and seconds, and hours when there are some', () => {
    expect(formatTimer(0)).toBe('00:00')
    expect(formatTimer(61_500)).toBe('01:01')
    expect(formatTimer(3_723_000)).toBe('1:02:03')
  })

  it('counts the show from its first GO, and down to the cue\'s end, rounded up', () => {
    expect(timerText('elapsed', { elapsedFrom: 1000, remaining: null }, 62_000)).toBe('01:01')
    expect(timerText('elapsed', { elapsedFrom: null, remaining: null }, 62_000)).toBe('00:00')
    expect(timerText('remaining', { elapsedFrom: null, remaining: { label: '1 · Walk-in', endsAt: 10_000 } }, 9_500)).toBe('−00:01')
    expect(timerText('remaining', { elapsedFrom: null, remaining: { label: '1 · Walk-in', endsAt: 10_000 } }, 10_000)).toBe('')
    expect(timerText('clock', { elapsedFrom: null, remaining: null }, 0, new Date(2026, 9, 8, 19, 30, 5))).toBe('19:30:05')
    expect(timerText('off', { elapsedFrom: 0, remaining: null }, 5000)).toBe('')
  })
})
