// A file found under the name a cloud drive or a zip tool gave it, with the names a real show's
// audio came back from Google Drive with.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { foldedName, listFolder, MAX_FOLDER_ENTRIES, renamedFile } from './mediaNames'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cuerunner-media-names-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('a renamed media file', () => {
  it('folds the characters cloud storage and zip tools replace, and either Unicode form', () => {
    expect(foldedName("(rt) 07B IT'S SURE A NICE VIEW HERE.mp3")).toBe('(rt) 07B IT_S SURE A NICE VIEW HERE.mp3')
    expect(foldedName('(rt) 07B IT’S SURE A NICE VIEW HERE.mp3')).toBe('(rt) 07B IT_S SURE A NICE VIEW HERE.mp3')
    expect(foldedName('a:b/c?d"e<f>g|h*i\\j.wav')).toBe('a_b_c_d_e_f_g_h_i_j.wav')
    expect(foldedName('Café.wav')).toBe(foldedName('Café.wav'))
  })

  it('is found in the folder its old name would be in, when it is the only file it could be', () => {
    writeFileSync(join(dir, '(rt) 07B IT_S SURE A NICE VIEW HERE.mp3'), 'ID3')
    writeFileSync(join(dir, "(rt) 13.2-14.1 38 PLANES REPRISE-SOMEWHERE - SOMETHING_S MISSING.mp3"), 'ID3')
    expect(renamedFile(join(dir, "(rt) 07B IT'S SURE A NICE VIEW HERE.mp3")))
      .toEqual({ path: join(dir, '(rt) 07B IT_S SURE A NICE VIEW HERE.mp3') })
    expect(renamedFile(join(dir, "(rt) 13.2-14.1 38 PLANES REPRISE-SOMEWHERE - SOMETHING'S MISSING.mp3")))
      .toEqual({ path: join(dir, '(rt) 13.2-14.1 38 PLANES REPRISE-SOMEWHERE - SOMETHING_S MISSING.mp3') })
  })

  it('finds a decomposed name under its composed one', () => {
    writeFileSync(join(dir, 'Café scene.wav'), 'RIFF')
    expect(renamedFile(join(dir, 'Café scene.wav'))).toEqual({ path: join(dir, 'Café scene.wav') })
  })

  it('is not guessed between two files it could be: both are said instead', () => {
    writeFileSync(join(dir, '(rt) 07B IT_S SURE A NICE VIEW HERE.mp3'), 'ID3')
    writeFileSync(join(dir, '(rt) 07B IT’S SURE A NICE VIEW HERE.mp3'), 'ID3')
    expect(renamedFile(join(dir, "(rt) 07B IT'S SURE A NICE VIEW HERE.mp3"))).toEqual({
      ambiguous: [join(dir, '(rt) 07B IT_S SURE A NICE VIEW HERE.mp3'), join(dir, '(rt) 07B IT’S SURE A NICE VIEW HERE.mp3')].sort()
    })
  })

  it('is nothing when no file folds to its name, or the folder is not there', () => {
    writeFileSync(join(dir, 'IT_S A DIFFERENT SONG.mp3'), 'ID3')
    expect(renamedFile(join(dir, "IT'S SURE A NICE VIEW HERE.mp3"))).toBeNull()
    expect(renamedFile(join(dir, 'gone', "IT'S.mp3"))).toBeNull()
  })

  it('reads each folder once per relink, and only its files', () => {
    mkdirSync(join(dir, 'IT_S A FOLDER.mp3'))
    writeFileSync(join(dir, 'WORLD_S LARGEST REFRIGERATOR.mp3'), 'ID3')
    const reads: string[] = []
    const listings = new Map<string, string[] | null>()
    const list = (folder: string): string[] | null => {
      reads.push(folder)
      return listFolder(folder)
    }
    expect(renamedFile(join(dir, "IT'S A FOLDER.mp3"), list, listings)).toBeNull()
    expect(renamedFile(join(dir, "WORLD'S LARGEST REFRIGERATOR.mp3"), list, listings))
      .toEqual({ path: join(dir, 'WORLD_S LARGEST REFRIGERATOR.mp3') })
    expect(reads).toEqual([dir])
  })

  it('reads a folder no further than its bound', () => {
    expect(MAX_FOLDER_ENTRIES).toBeGreaterThan(1000)
    for (let i = 0; i < 20; i++) writeFileSync(join(dir, `${i}.wav`), '')
    expect(listFolder(dir)).toHaveLength(20)
    expect(listFolder(join(dir, 'gone'))).toBeNull()
  })
})
