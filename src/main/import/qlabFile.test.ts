import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MAX_QLAB_FILE_BYTES, parseQLabWorkspace, readQLabWorkspace } from './qlabFile'
import {
  Dict, Real, alias, pressNightWorkspace, qlabCue, qlabWorkspace, writeBinaryPlist, writeKeyedArchive
} from './archiveFixture'
import type { QLabCue } from './qlabShow'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'feat-qlab-import-file-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function find(cues: QLabCue[], number: string): QLabCue {
  for (const cue of cues) {
    if (cue.number === number) return cue
    const inner = cue.children ? findOrNull(cue.children, number) : null
    if (inner) return inner
  }
  throw new Error(`no cue ${number}`)
}

function findOrNull(cues: QLabCue[], number: string): QLabCue | null {
  try {
    return find(cues, number)
  } catch {
    return null
  }
}

describe('reading a QLab workspace file', () => {
  const show = parseQLabWorkspace(pressNightWorkspace(), 'Press Night.qlab5')
  const main = show.lists[0].cues

  it('reads the name and every cue list, carts included', () => {
    expect(show.name).toBe('Press Night')
    expect(show.lists.map(list => [list.name, list.cart])).toEqual([['Main Cue List', false], ['Sound FX', true]])
  })

  it('reads the fields every cue carries', () => {
    expect(find(main, '1')).toMatchObject({
      kind: 'audio', uniqueID: 'A1', name: 'Walk-in', notes: 'House open', colorName: 'green',
      armed: true, preWait: 0, postWait: 2, continueMode: 1
    })
    expect(find(main, '7')).toMatchObject({ kind: 'memo', armed: false, notes: 'Call it on the cans' })
  })

  it('reads an audio cue’s file, region, loop, rate and level', () => {
    expect(find(main, '1')).toMatchObject({
      media: { relative: 'audio/walk-in.wav', absolute: '/Users/sm/Press Night/audio/walk-in.wav' },
      startTime: 1.5, endTime: 30, playCount: 1, infiniteLoop: true, rate: 1,
      levels: { master: 0.5, left: null, right: null }
    })
  })

  it('reads a QLab 4 file target, an NSURL, as the path it names', () => {
    expect(show.lists[1].cues[0].media).toEqual({ relative: '', absolute: '/Users/sm/Press Night/audio/door.wav' })
  })

  it('reads a fade’s target, the levels it fades to, and whether it stops the target', () => {
    expect(find(main, '2')).toMatchObject({
      kind: 'fade', target: { uniqueID: 'A1', number: '' }, duration: 5,
      fadeTo: { master: 0, pan: null }, stopTargetWhenDone: true
    })
  })

  it('reads a group’s mode and its children in order', () => {
    const group = find(main, '4')
    expect(group.groupMode).toBe(2)
    expect(group.children?.map(child => child.number)).toEqual(['4.1', '4.2'])
  })

  it('reads MIDI voice, show control and the port the patch names', () => {
    expect(find(main, '8').midi).toMatchObject({ messageType: 1, status: 1, channel: 2, byte1: 60, byte2: 100, port: 'Network Session 1' })
    expect(find(main, '9').midi?.msc).toEqual({ format: 1, command: 1, deviceId: 0, cueNumber: '12', cueList: '1' })
  })

  it('reads a network cue’s message and the destination its patch names', () => {
    expect(find(main, '11').network).toEqual({
      kind: 'osc', message: '/eos/cue/1/go 1 2.5 "hello world"', host: '10.0.0.5', port: 8000, patch: 'Lighting desk'
    })
    expect(find(main, '12').network).toMatchObject({ kind: 'text', message: 'PWR ON' })
    // QLab 4's OSC cue keeps its message under another name.
    expect(find(main, '19.1')).toMatchObject({ kind: 'network', network: { kind: 'osc', message: '/ping' } })
  })

  it('keeps what a placeholder needs: a script, a light command, a target named by number', () => {
    expect(find(main, '13').script).toBe('tell application "QLab" to start')
    expect(find(main, '15').detail).toBe('all = 0')
    expect(find(main, '17').target).toEqual({ uniqueID: '', number: '4' })
    expect(find(main, '18').kind).toBe('timecode')
  })

  it('reads a .cues file, which holds cues with no list around them, as one list', () => {
    const cues = writeKeyedArchive([qlabCue('AudioCue', { uniqueID: 'Z', number: '1', name: 'Lone', fileTarget: alias('a.wav') })])
    const read = parseQLabWorkspace(cues, 'Lone.cues')
    expect(read.lists).toHaveLength(1)
    expect(read.lists[0].cues[0]).toMatchObject({ kind: 'audio', name: 'Lone' })
  })

  it('reads levels QLab wrote in decibels as the gain they mean', () => {
    const bytes = qlabWorkspace({
      lists: [{
        name: 'Main',
        cues: [qlabCue('AudioCue', {
          number: '1',
          levels: { $class: 'AudioLevelMatrix', entries: [{ $class: 'E', row: 0, column: 0, level: new Real(-6) }] }
        })]
      }]
    })
    const master = parseQLabWorkspace(bytes, 'dB.qlab5').lists[0].cues[0].levels?.master ?? 0
    expect(master).toBeCloseTo(0.501, 3)
  })

  it('names the class of a cue type it does not know, rather than dropping it', () => {
    const bytes = qlabWorkspace({ lists: [{ name: 'Main', cues: [qlabCue('HologramCue', { number: '1' })] }] })
    expect(parseQLabWorkspace(bytes, 'Future.qlab6').lists[0].cues[0]).toMatchObject({ kind: 'unknown', typeName: 'Hologram' })
  })
})

describe('what a workspace file is refused for', () => {
  it('a file that is not a binary property list', () => {
    expect(() => parseQLabWorkspace(Buffer.from('{"cues": []}'), 'show.qlab5'))
      .toThrow('“show.qlab5” is not a QLab workspace: QLab saves its workspaces as a binary property list, and this file is not one')
  })

  it('a property list that is damaged, naming what is wrong with it', () => {
    const bytes = pressNightWorkspace().subarray(0, 4000)
    expect(() => parseQLabWorkspace(bytes, 'cut.qlab5')).toThrow(/^“cut\.qlab5” looks like a QLab workspace but cannot be read: /)
  })

  it('an archive that holds no cue lists', () => {
    const bytes = writeKeyedArchive({ $class: 'Something', unrelated: 'value' })
    expect(() => parseQLabWorkspace(bytes, 'other.qlab5')).toThrow('“other.qlab5” is an archive, but it holds no QLab cue lists')
  })

  it('a property list that is not an archive at all', () => {
    expect(() => parseQLabWorkspace(writeBinaryPlist({ a: 1 }), 'prefs.qlab5')).toThrow(/cannot be read: it is a property list, but not a keyed archive/)
  })

  it('a show with more cues than an import converts, before converting the rest', () => {
    const cues = Array.from({ length: 10_001 }, (_, i) => qlabCue('MemoCue', { number: String(i) }))
    const bytes = qlabWorkspace({ lists: [{ name: 'Main', cues }] })
    expect(() => parseQLabWorkspace(bytes, 'huge.qlab5')).toThrow('“huge.qlab5” holds more than 10,000 cues, which is more than this import converts')
  })

  it('a file larger than the ceiling, before it is read', async () => {
    const file = join(dir, 'Big.qlab5')
    writeFileSync(file, '')
    truncateSync(file, MAX_QLAB_FILE_BYTES + 1)
    await expect(readQLabWorkspace(file)).rejects.toThrow('“Big.qlab5” is 64 MB, and a QLab workspace this import reads is at most 64 MB')
  })

  it('a file that is not there', async () => {
    await expect(readQLabWorkspace(join(dir, 'Gone.qlab5'))).rejects.toThrow('“Gone.qlab5” is not there any more')
  })

  it('a folder with no workspace inside it', async () => {
    const folder = join(dir, 'Empty.qlab5')
    mkdirSync(folder)
    writeFileSync(join(folder, 'notes.txt'), 'hello')
    await expect(readQLabWorkspace(folder)).rejects.toThrow('“Empty.qlab5” is a folder with no QLab workspace inside it')
  })
})

describe('where a workspace is read from', () => {
  it('a file: its media are relative to the folder it is in, and its name is its own', async () => {
    const file = join(dir, 'Press Night.qlab5')
    writeFileSync(file, pressNightWorkspace())
    const read = await readQLabWorkspace(file)
    expect(read.baseDir).toBe(dir)
    expect(read.name).toBe('Press Night')
  })

  it('a package folder: the workspace inside it, and media relative to the package', async () => {
    const folder = join(dir, 'Tour.qlab5')
    mkdirSync(folder)
    writeFileSync(join(folder, 'readme.txt'), 'not a plist')
    writeFileSync(join(folder, 'Tour.qlab5'), qlabWorkspace({ name: '', lists: [{ name: 'Main', cues: [] }], settings: new Dict({}) }))
    const read = await readQLabWorkspace(folder)
    expect(read.baseDir).toBe(folder)
    // A workspace with no name of its own takes the file's.
    expect(read.name).toBe('Tour')
  })
})
