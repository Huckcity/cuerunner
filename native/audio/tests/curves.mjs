#!/usr/bin/env node
/**
 * Drawn fade shapes, read off the engine's real output in offline mode: a fade carrying a
 * table of points plays exactly that shape — at its points and in a straight line between
 * them — on a fade, on a cue's fade-in, and the three named curves are what they were.
 *
 *   node native/audio/tests/curves.mjs [--binary path]
 */
import { join } from 'node:path'
import { checker, render, reply, START, writeFloatWav } from './offline-kit.mjs'

const { workDir, check, finish } = checker('curves')
const RATE = 48000
const dcPath = join(workDir, 'dc.wav')
writeFloatWav(dcPath, 2, RATE, RATE * 4, () => 0.5)

const at = (wav, frame) => wav.samples[frame * wav.channels]
const near = (a, b, tolerance = 1e-4) => Math.abs(a - b) <= tolerance

/** The table's own reading at `t`, the way the engine is meant to read it. */
function tableAt(table, t) {
  const x = t * (table.length - 1)
  const i = Math.min(table.length - 2, Math.floor(x))
  return table[i] + (table[i + 1] - table[i]) * (x - i)
}

{
  console.log('\na fade plays the shape it was drawn as')
  const shape = [0, 0.6, 0.8, 0.9, 1]
  const { summary, wav } = render(workDir, {
    frames: RATE * 2,
    commands: [
      { atMs: 0, verb: 'prepare', cueId: 'a', filePath: dcPath },
      { atMs: 0, verb: 'start', cueId: 'a', options: START },
      { atMs: 200, verb: 'fade', cueId: 'a', param: 'volume', value: 0, durationMs: 1000, curve: 'custom', shape }
    ]
  })
  check('the fade is applied', reply(summary, 2).ok === true && reply(summary, 2).result.applied === true,
    JSON.stringify(reply(summary, 2)))
  const fadeStart = 0.2 * RATE
  let worst = 0
  for (let k = 0; k <= 100; k++) {
    const t = k / 100
    const frame = Math.min(fadeStart + Math.round(t * RATE), fadeStart + RATE - 1)
    const expected = 0.5 * (1 - tableAt(shape, (frame - fadeStart) / RATE))
    worst = Math.max(worst, Math.abs(at(wav, frame) - expected))
  }
  check('every hundredth of the way down is where the shape puts it', worst < 1e-4, `worst error ${worst}`)
  check('a quarter of the way in, at the shape\'s second point: 0.6 of the change done', near(at(wav, fadeStart + RATE / 4), 0.5 * 0.4))
  check('an eighth of the way in, half way between the first two points', near(at(wav, fadeStart + RATE / 8), 0.5 * 0.7))
  check('silent when the fade is done', at(wav, fadeStart + RATE + 10) === 0)
}

{
  console.log('\na cue\'s fade-in plays its shape')
  const shape = [0, 0.1, 1]
  const { wav } = render(workDir, {
    frames: RATE,
    commands: [
      { atMs: 0, verb: 'prepare', cueId: 'a', filePath: dcPath },
      { atMs: 0, verb: 'start', cueId: 'a', options: { ...START, fadeInDuration: 400, fadeInShape: shape } }
    ]
  })
  const span = 0.4 * RATE
  check('a quarter of the way in: 0.05 of full', near(at(wav, span / 4), 0.5 * 0.05), `${at(wav, span / 4)}`)
  check('half way in: the shape\'s middle point, 0.1 of full', near(at(wav, span / 2), 0.5 * 0.1), `${at(wav, span / 2)}`)
  check('three quarters in: 0.55 of full', near(at(wav, (3 * span) / 4), 0.5 * 0.55), `${at(wav, (3 * span) / 4)}`)
  check('at its level after the fade-in', near(at(wav, span + 10), 0.5))
}

{
  console.log('\nthe named curves are what they were')
  const { wav } = render(workDir, {
    frames: RATE * 2,
    commands: [
      { atMs: 0, verb: 'prepare', cueId: 'a', filePath: dcPath },
      { atMs: 0, verb: 'start', cueId: 'a', options: START },
      { atMs: 0, verb: 'fade', cueId: 'a', param: 'volume', value: 0, durationMs: 1000, curve: 'linear' }
    ]
  })
  check('linear is half way down at half way', near(at(wav, RATE / 2), 0.25))
  const { wav: s } = render(workDir, {
    frames: RATE * 2,
    commands: [
      { atMs: 0, verb: 'prepare', cueId: 'a', filePath: dcPath },
      { atMs: 0, verb: 'start', cueId: 'a', options: START },
      { atMs: 0, verb: 'fade', cueId: 'a', param: 'volume', value: 0, durationMs: 1000, curve: 'sCurve' }
    ]
  })
  // smoothstep at a quarter: 0.15625 of the change done.
  check('the S-curve is a smoothstep', near(at(s, RATE / 4), 0.5 * (1 - 0.15625)), `${at(s, RATE / 4)}`)
}

{
  console.log('\nwhat a shape refuses')
  const { summary } = render(workDir, {
    frames: 4800,
    commands: [
      { atMs: 0, verb: 'prepare', cueId: 'a', filePath: dcPath },
      { atMs: 0, verb: 'start', cueId: 'a', options: START },
      { atMs: 0, verb: 'fade', cueId: 'a', param: 'volume', value: 0, durationMs: 100, shape: [0, 1.5, 1] },
      { atMs: 0, verb: 'fade', cueId: 'a', param: 'volume', value: 0, durationMs: 100, shape: [0, 'x'] },
      { atMs: 0, verb: 'fade', cueId: 'a', param: 'volume', value: 0, durationMs: 100, curve: 'custom' },
      { atMs: 0, verb: 'start', cueId: 'b', options: { ...START, fadeInDuration: 10, fadeInShape: new Array(66).fill(0.5) } }
    ]
  })
  check('a point past the end of the change', reply(summary, 2).ok === false && /shares from 0 to 1/.test(reply(summary, 2).error.message),
    JSON.stringify(reply(summary, 2)))
  check('a point that is not a number', reply(summary, 3).ok === false && /must be a number/.test(reply(summary, 3).error.message))
  check('a custom curve with no shape', reply(summary, 4).ok === false)
  check('more points than a shape holds', reply(summary, 5).ok === false && /at most 65/.test(reply(summary, 5).error.message),
    JSON.stringify(reply(summary, 5)))
}

finish()
