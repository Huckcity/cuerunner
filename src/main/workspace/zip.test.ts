// The container a show bundle is: a zip, written deterministically and read defensively.
//
// The tests below are about the three properties the bundle leans on — that the bytes
// repeat, that what comes out is what went in, and that an archive which is damaged or
// hostile is refused rather than half-unpacked. The foreign fixtures were made by another
// implementation (Python's `zipfile`), because a reader that only ever reads its own
// writer proves nothing about the files an operator will actually hand this app.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  truncateSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { entryDestination, extractZipEntry, readZip, readZipEntry, writeZip } from './zip'
import { Refusal } from '../ipc/refusal'

const FOREIGN = join(__dirname, '../../test/fixtures/foreign.zip')
const FOREIGN_ESCAPE = join(__dirname, '../../test/fixtures/foreign-escape.zip')

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cuerunner-zip-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** Deterministic bytes that are not all one value, so a splice shows up in the CRC. */
function bytes(length: number): Buffer {
  const buffer = Buffer.alloc(length)
  for (let index = 0; index < length; index++) buffer[index] = (index * 31 + 7) % 256
  return buffer
}

/** The recipe the foreign fixture's large entry was generated with. */
function foreignBytes(length: number): Buffer {
  const buffer = Buffer.alloc(length)
  for (let index = 0; index < length; index++) buffer[index] = (index * 37 + 11) % 251
  return buffer
}

describe('writing a zip', () => {
  it('keeps the entries, their order and their bytes', async () => {
    const file = join(dir, 'bundle.zip')
    const large = join(dir, 'large.bin')
    writeFileSync(large, bytes(300_000))

    await writeZip(file, [
      { name: 'show.cuerunner', data: Buffer.from('{"a":1}', 'utf8') },
      { name: 'media/large.bin', file: large }
    ])

    const entries = await readZip(file)
    expect(entries.map(entry => entry.name)).toEqual(['show.cuerunner', 'media/large.bin'])
    expect(entries[1].size).toBe(300_000)
    expect((await readZipEntry(file, entries[0])).toString('utf8')).toBe('{"a":1}')
    expect((await readZipEntry(file, entries[1])).equals(bytes(300_000))).toBe(true)
  })

  it('writes the same bytes for the same entries', async () => {
    const media = join(dir, 'walk-in.wav')
    writeFileSync(media, bytes(4096))
    const first = join(dir, 'first.zip')
    const second = join(dir, 'second.zip')

    const sources = [{ name: 'show.cuerunner', data: Buffer.from('{}') }, { name: 'media/walk-in.wav', file: media }]
    await writeZip(first, sources)
    await writeZip(second, sources)

    expect(readFileSync(first).equals(readFileSync(second))).toBe(true)
  })

  it('refuses an archive too large to describe, before writing anything', async () => {
    // A sparse file: five gigabytes by its own account, nothing on disk. Nothing may be
    // written — an archive whose directory lies about its own offsets is worse than a
    // refusal, and a half-written bundle looks like a bundle.
    const huge = join(dir, 'huge.bin')
    writeFileSync(huge, '')
    truncateSync(huge, 5 * 1024 * 1024 * 1024)
    const target = join(dir, 'too-big.cuerunnerx')

    await expect(writeZip(target, [{ name: 'media/huge.bin', file: huge }]))
      .rejects.toThrow('more than a bundle this app writes can hold')
    expect(existsSync(target)).toBe(false)
  })

  it('leaves nothing behind when a write fails half way', async () => {
    // A directory where the entry should be a file: it measures like a file and then
    // cannot be read, which is what a write failing part way through looks like.
    mkdirSync(join(dir, 'media'))
    const target = join(dir, 'half-written.cuerunnerx')
    await expect(writeZip(target, [
      { name: 'show.cuerunner', data: Buffer.from('{}') },
      { name: 'media/folder', file: join(dir, 'media') }
    ])).rejects.toThrow()
    // The show entry was already written when the second one failed: the file is gone
    // rather than left as something that looks like a bundle.
    expect(existsSync(target)).toBe(false)
  })

  it('keeps the previous bundle when a write fails half way', async () => {
    const target = join(dir, 'previous.cuerunnerx')
    await writeZip(target, [{ name: 'show.cuerunner', data: Buffer.from('{"a":1}', 'utf8') }])
    const before = readFileSync(target)
    // A directory where the entry should be a file: it measures like a file and then
    // cannot be read, which is what a write failing part way through looks like.
    mkdirSync(join(dir, 'media'))
    await expect(writeZip(target, [
      { name: 'show.cuerunner', data: Buffer.from('{}') },
      { name: 'media/folder', file: join(dir, 'media') }
    ])).rejects.toThrow()
    // The old bundle survives: a failed export replaces nothing.
    expect(readFileSync(target).equals(before)).toBe(true)
  })

  it('refuses a show too large to describe in one archive, before writing a byte', async () => {
    // A zip without zip64 cannot describe an archive this big, and the refusal is the
    // operator's own show rather than a fault: `workspace:exportBundle` answers it as a
    // value. Sparse, so the test measures 4 GiB without writing it.
    const huge = join(dir, 'huge.bin')
    writeFileSync(huge, '')
    truncateSync(huge, 4.5e9)

    const target = join(dir, 'too-big.cuerunnerx')
    const writing = writeZip(target, [
      { name: 'show.cuerunner', data: Buffer.from('{}') },
      { name: 'media/huge.bin', file: huge }
    ])
    await expect(writing).rejects.toThrow('more than a bundle this app writes can hold')
    await expect(writing).rejects.toBeInstanceOf(Refusal)
    // Measured before anything was written: there is no half-archive on disk.
    expect(existsSync(target)).toBe(false)
  })

  it('refuses a name that would leave the folder it is unpacked into', async () => {
    await expect(
      writeZip(join(dir, 'bad.zip'), [{ name: '../escape.txt', data: Buffer.from('x') }])
    ).rejects.toThrow('not a path an archive may hold')
    await expect(
      writeZip(join(dir, 'bad.zip'), [{ name: '../escape.txt', data: Buffer.from('x') }])
    ).rejects.toBeInstanceOf(Refusal)
    await expect(
      writeZip(join(dir, 'bad.zip'), [{ name: 'C:\\windows\\evil.txt', data: Buffer.from('x') }])
    ).rejects.toThrow('not a path an archive may hold')
  })
})

describe('a hostile archive', () => {
  it('refuses a directory that runs past the end of the file', async () => {
    const file = join(dir, 'lying.zip')
    await writeZip(file, [{ name: 'show.cuerunner', data: Buffer.from('{}') }])
    const bytes = readFileSync(file)
    // The end record's directory-size field (22-byte record at the tail): claim 4 GiB
    // in a 100-byte file.
    bytes.writeUInt32LE(0xffffffff - 1, bytes.length - 22 + 12)
    writeFileSync(file, bytes)

    await expect(readZip(file)).rejects.toThrow()
  })

  it('refuses an entry that claims more than the file holds', async () => {
    const file = join(dir, 'greedy.zip')
    await writeZip(file, [{ name: 'show.cuerunner', data: Buffer.from('{}') }])
    const entries = await readZip(file)
    const greedy = { ...entries[0], size: 4 * 1024 * 1024 * 1024, compressedSize: 4 * 1024 * 1024 * 1024 }

    await expect(readZipEntry(file, greedy)).rejects.toThrow('claims a size')
    // Marked, so the bundle channels answer the archive's claims as a value.
    await expect(readZipEntry(file, greedy)).rejects.toBeInstanceOf(Refusal)
  })

  it('refuses a small deflated entry that unpacks past the cap', async () => {
    const { deflateRawSync } = await import('node:zlib')
    const file = join(dir, 'bomb.zip')
    const raw = deflateRawSync(Buffer.from('{}'))
    writeFileSync(file, raw)
    const entry = { name: 'show.cuerunner', offset: 0, compressedSize: raw.length, size: 2, crc: 0, method: 8 }
    // Two inflated bytes against a one-byte cap: the cap fires on the output, which is
    // the path a bomb with small declared sizes takes.
    await expect(readZipEntry(file, entry, 1)).rejects.toThrow('unpacks to more')
  })

  it('stops a streamed entry at the size the archive declared for it', async () => {
    // The write is what has to be bounded: a media entry that lied about its size would
    // otherwise inflate to disk — a thousand to one — before anything could refuse it.
    const { deflateRawSync } = await import('node:zlib')
    const file = join(dir, 'bomb.cuerunnerx')
    const payload = deflateRawSync(Buffer.alloc(4 * 1024 * 1024))
    writeFileSync(file, payload)
    const entry = {
      name: 'media/bomb.wav', offset: 0, compressedSize: payload.length, size: 1024, crc: 0, method: 8
    }

    await expect(extractZipEntry(file, entry, dir)).rejects.toThrow('more than the archive says')
    expect(existsSync(join(dir, 'media', 'bomb.wav'))).toBe(false)
  })

  it('extracts an entry with nothing in it, which a show of empty files exports', async () => {
    // A zero-byte media file is one a show can hold and a bundle can carry: there is
    // nothing to stream for it, and a range that ends before it starts is one a read
    // stream refuses outright.
    const file = join(dir, 'empty.cuerunnerx')
    writeFileSync(join(dir, 'empty.wav'), Buffer.alloc(0))
    await writeZip(file, [
      { name: 'show.cuerunner', data: Buffer.from('{}') },
      { name: 'media/empty.wav', file: join(dir, 'empty.wav') }
    ])

    const entries = await readZip(file)
    expect(entries[1]).toMatchObject({ name: 'media/empty.wav', size: 0, compressedSize: 0 })
    await extractZipEntry(file, entries[1], dir)

    expect(existsSync(join(dir, 'media', 'empty.wav'))).toBe(true)
    expect(readFileSync(join(dir, 'media', 'empty.wav')).length).toBe(0)
  })

  it('refuses a directory offset near the end of the file with a sentence', async () => {
    const file = join(dir, 'short.zip')
    await writeZip(file, [{ name: 'show.cuerunner', data: Buffer.from('{}') }])
    const bytes = readFileSync(file)
    // The central directory's local-header offset field: 42 bytes into the first central
    // header, which is where the end record says the directory starts.
    const centralOffset = bytes.readUInt32LE(bytes.length - 22 + 16)
    bytes.writeUInt32LE(bytes.length - 2, centralOffset + 42)
    writeFileSync(file, bytes)

    await expect(readZip(file)).rejects.toThrow('does not start where the archive says')
  })
})

describe('reading an archive this app did not write', () => {
  it('reads a deflated entry, a nested one and a directory entry', async () => {
    const entries = await readZip(FOREIGN)
    expect(entries.map(entry => entry.name)).toEqual(['notes.txt', 'media/large.bin'])
    expect((await readZipEntry(FOREIGN, entries[0])).toString('utf8'))
      .toBe('a show somebody zipped by hand\n')

    const destination = await extractZipEntry(FOREIGN, entries[1], dir)
    expect(destination).toBe(join(dir, 'media', 'large.bin'))
    expect(readFileSync(destination).equals(foreignBytes(200_000))).toBe(true)
  })

  it('refuses an archive whose entry climbs out of the folder', async () => {
    await expect(readZip(FOREIGN_ESCAPE)).rejects.toThrow('not a path an archive may hold')
    await expect(readZip(FOREIGN_ESCAPE)).rejects.toBeInstanceOf(Refusal)
    expect(existsSync(join(dir, '..', 'escape.txt'))).toBe(false)
  })

  it('refuses what is not an archive at all', async () => {
    const file = join(dir, 'show.cuerunner')
    writeFileSync(file, '{"version":1}')
    await expect(readZip(file)).rejects.toThrow('not a zip archive')
    await expect(readZip(file)).rejects.toBeInstanceOf(Refusal)
  })

  it('refuses an archive that is not there, the way it refuses one that is damaged', async () => {
    // The operator picked it a moment ago; a file that moved in between is their machine's
    // ordinary state, so the channel answers a sentence rather than logging a fault.
    await expect(readZip(join(dir, 'gone.cuerunnerx'))).rejects.toBeInstanceOf(Refusal)
  })
})

describe('an archive that is damaged', () => {
  it('is refused rather than extracted, and leaves nothing behind', async () => {
    const file = join(dir, 'bundle.zip')
    writeFileSync(join(dir, 'media.wav'), bytes(8192))
    await writeZip(file, [
      { name: 'show.cuerunner', data: Buffer.from('{}') },
      { name: 'media/media.wav', file: join(dir, 'media.wav') }
    ])

    // One byte of the media, flipped: the CRC has to notice.
    const damaged = readFileSync(file)
    const entries = await readZip(file)
    const at = entries[1].offset + 10
    damaged[at] = damaged[at] ^ 0xff
    writeFileSync(file, damaged)

    await expect(extractZipEntry(file, entries[1], dir)).rejects.toThrow('checksum')
    await expect(extractZipEntry(file, entries[1], dir)).rejects.toBeInstanceOf(Refusal)
    expect(existsSync(join(dir, 'media', 'media.wav'))).toBe(false)
    expect(readdirSync(join(dir, 'media'))).toEqual([])
  })

  it('is refused when the directory itself is damaged', async () => {
    const file = join(dir, 'bundle.zip')
    await writeZip(file, [{ name: 'show.cuerunner', data: Buffer.from('{}') }])
    const damaged = readFileSync(file)
    damaged.writeUInt32LE(0, damaged.length - 10)
    writeFileSync(file, damaged)

    await expect(readZip(file)).rejects.toThrow()
  })
})

describe('where an entry goes', () => {
  it('is inside the folder it was pointed at', () => {
    // A platform's own separator, because that is what the destination is on: on Windows the
    // answer is a `C:\` path, and the guard's job is that the entry lands *inside* the folder
    // it was pointed at, which is what the two refusals below are about.
    expect(entryDestination('/shows/hamlet', 'media/walk-in.wav'))
      .toBe(resolve('/shows/hamlet', 'media/walk-in.wav'))
    expect(() => entryDestination('/shows/hamlet', '../walk-in.wav')).toThrow()
    expect(() => entryDestination('/shows/hamlet', '/etc/passwd')).toThrow()
  })
})
