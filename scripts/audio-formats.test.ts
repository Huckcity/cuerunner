// One list of the audio files the window offers, held to the places that read it and to the
// words the guide uses for it.
//
// A drop on the cue list, the Browse dialog and the relink dialog each had a list of their
// own, and they had drifted: the drop took kinds the engine has no decoder for, and the
// dialogs left out `.aif`. `src/shared/media.ts` is the list now; this is what keeps a
// fourth from being written beside it, and the sentence the notice bar says from parting
// with the guide's.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { AUDIO_FILE_EXTENSIONS, AUDIO_FORMATS_SENTENCE } from '../src/shared/media'

describe('the audio files the window offers', () => {
  it('is the one list: nothing else in the app spells out audio extensions of its own', () => {
    // The three lists this replaced had drifted apart. A fourth, written by hand, would
    // drift the same way; these are the three places a list of extensions used to live.
    for (const file of [
      'src/renderer/src/components/cue-list/CueList.tsx',
      'src/main/ipc/handlers.ts',
      'src/main/workspace/WorkspaceManager.ts'
    ]) {
      const source = readFileSync(file, 'utf8')
      expect(source, `${file} has an extension list of its own`).not.toMatch(/['"]\.?(mp3|flac|aiff?)['"]/)
    }
  })

  it('tells an operator the formats in the guide\'s own words', () => {
    const guide = readFileSync('website/docs/guides.mjs', 'utf8')
    // "WAV, AIFF, FLAC, MP3, M4A and OGG all play."
    expect(guide).toContain(`${AUDIO_FORMATS_SENTENCE} all play`)
    // And each word in the sentence is a kind the list takes.
    for (const word of AUDIO_FORMATS_SENTENCE.replace(' and ', ', ').split(', ')) {
      const extension = word === 'AIFF' ? 'aiff' : word.toLowerCase()
      expect(AUDIO_FILE_EXTENSIONS as readonly string[], word).toContain(extension)
    }
  })
})
