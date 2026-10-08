import { describe, expect, it } from 'vitest'
import { MAX_COMMANDS_PER_LAYER, OutputRegistry } from './registry'
import { createOutput, defaultGeometry } from '../../shared/visual'
import type { LayerSpec } from '../../shared/ipc/output'

function spec(cueId: string, outputId = '', patch: Partial<LayerSpec> = {}): LayerSpec {
  return {
    cueId, outputId, kind: 'image', seq: 1, layer: 1, opacity: 1, geometry: defaultGeometry(),
    fadeInMs: 0, fadeOutMs: 0, crossfade: false, at: 1000, src: 'cuerunner-media://file/x.png',
    timeline: null, elapsedMs: 0, holdLastFrame: false, displayMs: null, text: null,
    ...patch
  }
}

describe('the output registry', () => {
  it('says which outputs a new declaration added, changed and took away', () => {
    const registry = new OutputRegistry()
    expect(registry.configure([createOutput('a', 'A'), createOutput('b', 'B')]).added.map(o => o.id)).toEqual(['a', 'b'])
    const change = registry.configure([{ ...createOutput('a', 'A'), name: 'Stage' }, createOutput('c', 'C')])
    expect(change.added.map(o => o.id)).toEqual(['c'])
    expect(change.changed.map(o => o.id)).toEqual(['a'])
    expect(change.removed).toEqual(['b'])
    // The same outputs in another key order are the same outputs.
    const same = JSON.parse(JSON.stringify(registry.list()).replace('"name":"Stage"', '"name":"Stage"'))
    expect(registry.configure(same)).toEqual({ added: [], changed: [], removed: [] })
  })

  it('keeps one output per id, and none without one', () => {
    const registry = new OutputRegistry()
    registry.configure([createOutput('a', 'A'), createOutput('a', 'twice'), { ...createOutput('', 'blank') }])
    expect(registry.list().map(o => o.name)).toEqual(['A'])
  })

  it('sends a picture that names no output to the first, and refuses one with nowhere to go', () => {
    const registry = new OutputRegistry()
    expect(registry.route({ op: 'play', layer: spec('i1') })).toEqual({
      kind: 'refused', error: 'the show has no video output — add one in the Outputs panel'
    })
    registry.configure([createOutput('a', 'A'), createOutput('b', 'B')])
    const routed = registry.route({ op: 'play', layer: spec('i1') })
    expect(routed.kind === 'output' && routed.outputId).toBe('a')
    expect(registry.route({ op: 'play', layer: spec('i2', 'gone') })).toEqual({
      kind: 'refused', error: 'the output this cue names is not in the show'
    })
  })

  it('sends a command to wherever the cue\'s picture is, and nowhere for a picture that is not up', () => {
    const registry = new OutputRegistry()
    registry.configure([createOutput('a', 'A'), createOutput('b', 'B')])
    registry.route({ op: 'play', layer: spec('i1', 'b') })
    expect(registry.route({ op: 'stop', cueId: 'i1', fadeMs: 0, at: 0 })).toEqual(expect.objectContaining({ kind: 'output', outputId: 'b' }))
    expect(registry.route({ op: 'stop', cueId: 'nobody', fadeMs: 0, at: 0 })).toEqual({ kind: 'nowhere' })
  })

  it('takes a re-fired cue down from the output it was on when it goes to another', () => {
    const registry = new OutputRegistry()
    registry.configure([createOutput('a', 'A'), createOutput('b', 'B')])
    registry.route({ op: 'play', layer: spec('i1', 'a') })
    const moved = registry.route({ op: 'play', layer: spec('i1', 'b') })
    expect(moved).toEqual(expect.objectContaining({ kind: 'output', outputId: 'b', takeDownFrom: 'a' }))
    expect(registry.cuesOn('a')).toEqual([])
    expect(registry.cuesOn('b')).toEqual(['i1'])
  })

  it('hands a reloaded window every picture it had, with the commands since, edits folded in', () => {
    const registry = new OutputRegistry()
    registry.configure([createOutput('a', 'A')])
    registry.route({ op: 'play', layer: spec('v1', 'a', { kind: 'video' }) })
    registry.route({ op: 'update', cueId: 'v1', patch: { opacity: 0.5, layer: 4 } })
    registry.route({ op: 'pause', cueId: 'v1', at: 2000 })
    registry.route({ op: 'fade', cueId: 'v1', to: 0, durationMs: 100, curve: 'linear', at: 2100 })
    const replay = registry.replay('a')
    expect(replay.layers).toEqual([expect.objectContaining({ cueId: 'v1', opacity: 0.5, layer: 4 })])
    expect(replay.commands.map(command => command.op)).toEqual(['pause', 'fade'])
  })

  it('keeps the newest commands a picture was given, not every one', () => {
    const registry = new OutputRegistry()
    registry.configure([createOutput('a', 'A')])
    registry.route({ op: 'play', layer: spec('v1', 'a') })
    for (let i = 0; i < MAX_COMMANDS_PER_LAYER + 10; i++) registry.route({ op: 'seek', cueId: 'v1', elapsedMs: i, at: i })
    const commands = registry.replay('a').commands
    expect(commands).toHaveLength(MAX_COMMANDS_PER_LAYER)
    expect(commands.at(-1)).toEqual(expect.objectContaining({ elapsedMs: MAX_COMMANDS_PER_LAYER + 9 }))
  })

  it('forgets a picture that has gone, and every picture on an output that has been taken away', () => {
    const registry = new OutputRegistry()
    registry.configure([createOutput('a', 'A'), createOutput('b', 'B')])
    registry.route({ op: 'play', layer: spec('i1', 'a') })
    registry.route({ op: 'play', layer: spec('i2', 'a') })
    registry.route({ op: 'play', layer: spec('i3', 'b') })
    registry.gone('i1', 'b')
    expect(registry.cuesOn('a')).toEqual(['i1', 'i2'])
    registry.gone('i1', 'a')
    expect(registry.cuesOn('a')).toEqual(['i2'])
    expect(registry.withdraw('a')).toEqual(['i2'])
    expect(registry.outputOf('i2')).toBeNull()
    expect(registry.route({ op: 'clear', fadeMs: 0, at: 0 })).toEqual({ kind: 'all', command: { op: 'clear', fadeMs: 0, at: 0 } })
    expect(registry.cuesOn('b')).toEqual([])
  })
})
