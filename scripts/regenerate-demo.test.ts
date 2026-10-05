// The demo show is the serialiser's own output, and `scripts/regenerate-demo.ts` is the
// recipe that says so — this holds the shipped file to it, so a demo left in a form the
// writer would not have produced (a section taken out by hand, a route pair hand-written,
// keys moved: what a shape change leaves behind) fails here rather than in the app. The
// other direction is `src/main/workspace/demo.test.ts`: it opens the demo the way the File
// menu does and holds a save of the freshly opened show to the same bytes, so the shipped
// file, the loader, the serialiser and the recipe cannot drift apart.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { DEMO_FILE, demoBytes, runDemo } from './regenerate-demo.ts'

const shipped = (): string => readFileSync(DEMO_FILE, 'utf-8')

describe('the demo show harness', () => {
  it('writes the bytes the demo ships with', () => {
    expect(demoBytes(shipped())).toBe(shipped())
  })

  it('is a fixed point: what it writes is what it reads back', () => {
    // The recipe reads a document and writes the declared shape, so running it over its
    // own output changes nothing: a writer that reordered keys per pass, or re-derived a
    // route from the folder it was handed, would move the file on every run and this would
    // catch it on the second.
    const once = demoBytes(shipped())
    expect(demoBytes(once)).toBe(once)
  })

  it('checks without writing, and refuses an option it does not know', async () => {
    // A check is the question a reviewer asks: it reports, and the file is left alone.
    expect(await runDemo(['--check'])).toEqual({
      path: DEMO_FILE, current: true, difference: null, written: false
    })
    // A typo must not be read as a write: the only option there is is `--check`, and
    // anything else is refused rather than ignored.
    await expect(runDemo(['--write'])).rejects.toThrow('unknown option "--write" — the only one is --check')
  })
})

// The demo is the first show anybody runs, pressing GO down the list at their own pace. A
// cue that acts on another cue has to find it still there when they arrive, however long
// they took: the demo's fade used to be aimed at a four-second clip that had ended at least
// twelve seconds earlier in running order, so the cue that shows what a fade is faded
// silence.
describe('the demo show, run at a newcomer\'s pace', () => {
  interface DemoCue {
    id: string
    number: string
    type: string
    targetCueId?: string
    loopCount?: number
  }
  const cues = (JSON.parse(readFileSync(DEMO_FILE, 'utf8')) as { cues: DemoCue[] }).cues

  it('aims every fade at a sound that is still playing when the fade is reached', () => {
    const fades = cues.filter(cue => cue.type === 'fade')
    expect(fades.length).toBeGreaterThan(0)
    for (const fade of fades) {
      const target = cues.find(cue => cue.id === fade.targetCueId)
      expect(target, `cue ${fade.number} fades a cue that is not in the demo`).toBeDefined()
      expect(target?.type, `cue ${fade.number} fades something with no sound`).toBe('audio')
      // Looping until it is taken out is the only length that outlasts any pace.
      expect(target?.loopCount, `cue ${fade.number} fades a cue that ends by itself`).toBeLessThan(0)
      // And it is earlier in the list, so it has been fired by the time the fade is.
      expect(cues.indexOf(target as DemoCue)).toBeLessThan(cues.indexOf(fade))
    }
  })
})
