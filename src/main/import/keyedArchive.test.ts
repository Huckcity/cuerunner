import { describe, expect, it } from 'vitest'
import { PlistError, PlistUid } from './bplist'
import { isArchivedObject, unarchive } from './keyedArchive'
import { Dict, MutableString, Url, writeBinaryPlist, writeKeyedArchive } from './archiveFixture'

describe('the keyed archive reader', () => {
  it('unwraps Foundation’s containers and keeps custom objects with their class', () => {
    const root = unarchive(writeKeyedArchive({
      $class: 'AudioCue',
      name: 'Walk-in',
      notes: new MutableString('House open'),
      tags: ['a', 'b'],
      settings: new Dict({ volume: 1, label: 'main' }),
      target: new Url('file:///Users/sm/Show/audio/walk-in.wav'),
      armed: false,
      level: 0.5,
      missing: null
    }))
    expect(isArchivedObject(root, 'AudioCue')).toBe(true)
    expect(root).toMatchObject({
      $class: 'AudioCue',
      name: 'Walk-in',
      notes: 'House open',
      tags: ['a', 'b'],
      settings: { volume: 1, label: 'main' },
      target: { $class: 'NSURL', 'NS.relative': 'file:///Users/sm/Show/audio/walk-in.wav', 'NS.base': null },
      armed: false,
      level: 0.5,
      missing: null
    })
  })

  it('reads an object that points back at its parent without following the loop', () => {
    // A group whose child names the group as its parent: the cycle every cue tree has.
    const archive = writeBinaryPlist({
      $archiver: 'NSKeyedArchiver',
      $version: 100000,
      $top: { root: new PlistUid(1) },
      $objects: [
        '$null',
        { $class: new PlistUid(3), name: new PlistUid(4), cues: new PlistUid(5) },
        { $class: new PlistUid(3), name: new PlistUid(6), parent: new PlistUid(1) },
        { $classname: 'GroupCue', $classes: ['GroupCue', 'NSObject'] },
        'Group',
        { $class: new PlistUid(7), 'NS.objects': [new PlistUid(2)] },
        'Child',
        { $classname: 'NSArray', $classes: ['NSArray', 'NSObject'] }
      ]
    })
    const root = unarchive(archive) as Record<string, unknown>
    expect(root['name']).toBe('Group')
    const [child] = root['cues'] as Array<Record<string, unknown>>
    expect(child['name']).toBe('Child')
    expect(child['parent']).toBeNull()
  })

  it('reads data, dates and UUIDs the way Foundation archives them', () => {
    const archive = writeBinaryPlist({
      $archiver: 'NSKeyedArchiver',
      $version: 100000,
      $top: { root: new PlistUid(1) },
      $objects: [
        '$null',
        { $class: new PlistUid(2), blob: new PlistUid(3), when: new PlistUid(5), id: new PlistUid(7) },
        { $classname: 'Thing', $classes: ['Thing', 'NSObject'] },
        { $class: new PlistUid(4), 'NS.data': new Uint8Array([9, 8]) },
        { $classname: 'NSMutableData', $classes: ['NSMutableData', 'NSData', 'NSObject'] },
        { $class: new PlistUid(6), 'NS.time': 0 },
        { $classname: 'NSDate', $classes: ['NSDate', 'NSObject'] },
        { $class: new PlistUid(8), 'NS.uuidbytes': new Uint8Array(16).fill(0xab) },
        { $classname: 'NSUUID', $classes: ['NSUUID', 'NSObject'] }
      ]
    })
    const root = unarchive(archive) as Record<string, unknown>
    expect([...(root['blob'] as Uint8Array)]).toEqual([9, 8])
    expect((root['when'] as Date).toISOString()).toBe('2001-01-01T00:00:00.000Z')
    expect(root['id']).toBe('ABABABAB-ABAB-ABAB-ABAB-ABABABABABAB')
  })

  it('refuses a plist that is not an archive', () => {
    expect(() => unarchive(writeBinaryPlist({ hello: 'world' }))).toThrow(/not a keyed archive/)
    expect(() => unarchive(writeBinaryPlist(['a list']))).toThrow(/not an archive/)
  })

  it('refuses an archive that does not say where its root is', () => {
    const archive = writeBinaryPlist({ $archiver: 'NSKeyedArchiver', $top: { root: 'nowhere' }, $objects: ['$null'] })
    expect(() => unarchive(archive)).toThrow(PlistError)
  })

  it('refuses an object that points past the end of the archive', () => {
    const archive = writeBinaryPlist({ $archiver: 'NSKeyedArchiver', $top: { root: new PlistUid(40) }, $objects: ['$null'] })
    expect(() => unarchive(archive)).toThrow(/does not hold/)
  })
})
