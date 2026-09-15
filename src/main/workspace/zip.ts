// A zip reader and writer, small enough to read: the container a show bundle is.
//
// A zip rather than a format of our own, because the whole point of a bundle is that it
// leaves this app: an operator hands one to a colleague, a venue's IT desk opens it, a
// touring tech unzips it by hand when the laptop will not start. Anything a laptop can
// open without being asked is the right container.
//
// Three properties this file guarantees, and the bundle relies on all three:
//
// - **Streamed.** A show's media is gigabytes; the writer reads 64 KiB at a time and the
//   CRC is computed as the bytes go past. Nothing here holds a media file in memory.
// - **Deterministic.** Entries keep the order they are given, every timestamp is the same
//   fixed one, and the bytes are the same for the same show. A bundle is an artifact
//   somebody may keep, compare or hash.
// - **Checked on the way out.** Reading verifies each entry's CRC and size, so a bundle
//   copied over a bad USB stick is refused rather than extracted into half a show.
//
// Entries are written stored (method 0): media is compressed already, and a stored entry
// is both faster to write and readable by anything. Reading accepts deflate as well, so a
// bundle that somebody re-zipped by hand still opens.

import { createReadStream, createWriteStream } from 'fs'
import { mkdir, open, rm, stat } from 'fs/promises'
import type { FileHandle } from 'fs/promises'
import { dirname, resolve, sep } from 'path'
import { Transform } from 'stream'
import { pipeline } from 'stream/promises'
import { promisify } from 'util'
import { crc32, createInflateRaw, inflateRaw as inflateRawCallback } from 'zlib'

/** The callback form, as a promise: the small entries are read whole. */
const inflateRaw = promisify(inflateRawCallback)

const LOCAL_SIGNATURE = 0x04034b50
const CENTRAL_SIGNATURE = 0x02014b50
const END_SIGNATURE = 0x06054b50
const END_SIZE = 22
/** The comment is the only thing that may follow the end record, and a bundle has none. */
const MAX_COMMENT = 65_535
const STORED = 0
const DEFLATED = 8
const CHUNK = 1 << 16
/** Zip64 is refused rather than half-supported: a show that needs it is not a show. */
const ZIP64_MARKER = 0xffffffff

/**
 * The largest archive this file can describe: every offset, size and count in a zip
 * without zip64 is 32 bits. A show whose media comes to more than this is refused with a
 * sentence rather than written as an archive whose own directory lies about it.
 */
const MAX_ARCHIVE_BYTES = ZIP64_MARKER - (1 << 16)

/** A timestamp inside a zip is 16 bits of date and 16 of time. Fixed, so bundles repeat. */
const FIXED_TIME = 0
const FIXED_DATE = ((2001 - 1980) << 9) | (1 << 5) | 1

/** One entry of an archive, as its directory describes it. */
export interface ZipEntry {
  /** The path inside the archive: forward slashes, relative. */
  name: string
  /** Where the entry's data begins in the file. */
  offset: number
  compressedSize: number
  size: number
  /** The CRC-32 of the uncompressed bytes. */
  crc: number
  /** 0 = stored, 8 = deflated. */
  method: number
}

/** What to write as one entry: bytes already in hand, or a file to stream in. */
export interface ZipSource {
  name: string
  data?: Buffer
  file?: string
}

/**
 * A name an entry may carry. Absolute paths, `..`, backslashes and drive letters are
 * refused at the door: an archive is a thing somebody else made, and a name that can
 * climb out of the folder it is being extracted into is how that becomes a problem.
 */
function safeName(name: string): string {
  if (name === '' || name.startsWith('/') || name.includes('\\') || /^[A-Za-z]:/.test(name)) {
    throw new Error(`"${name}" is not a path an archive may hold`)
  }
  if (name.split('/').includes('..')) {
    throw new Error(`"${name}" is not a path an archive may hold`)
  }
  return name
}

/**
 * Where one entry goes inside a destination folder. The name is checked again here and
 * the result is checked against the folder, so no caller can extract something outside
 * it even by accident.
 */
export function entryDestination(directory: string, name: string): string {
  const root = resolve(directory)
  const destination = resolve(root, safeName(name))
  if (destination !== root && !destination.startsWith(root + sep)) {
    throw new Error(`"${name}" would be written outside the folder it came from`)
  }
  return destination
}

/** A stream that counts the bytes going past and their CRC, without holding them. */
class Checksum extends Transform {
  crc = 0
  size = 0

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    done: (error?: Error | null, data?: Buffer) => void
  ): void {
    this.crc = crc32(chunk, this.crc)
    this.size += chunk.length
    // The chunk goes through untouched: this transform counts, it does not consume.
    done(null, chunk)
  }
}

/** Writes into a file at a moving offset, and allows one header to be patched afterwards. */
class Writer {
  private offset = 0

  constructor(private readonly handle: FileHandle) {}

  get position(): number {
    return this.offset
  }

  async write(buffer: Buffer): Promise<void> {
    await this.handle.write(buffer, 0, buffer.length, this.offset)
    this.offset += buffer.length
  }

  async patch(buffer: Buffer, at: number): Promise<void> {
    await this.handle.write(buffer, 0, buffer.length, at)
  }
}

/** What each entry will be, measured before anything is written. */
interface Prepared {
  name: string
  data?: Buffer
  file?: string
  size: number
}

/**
 * Measures the entries and refuses the archive before a byte of it is written: a write
 * that fails half way through leaves a file that looks like a bundle and is not one, and
 * the one thing this format must never do is lie about what it holds.
 */
async function prepare(sources: ZipSource[]): Promise<Prepared[]> {
  const prepared: Prepared[] = []
  let total = 0
  for (const source of sources) {
    const name = safeName(source.name)
    let size: number
    if (source.data !== undefined) size = source.data.length
    else if (source.file !== undefined) size = (await stat(source.file)).size
    else throw new Error(`"${source.name}" has nothing in it`)
    total += size
    if (total > MAX_ARCHIVE_BYTES) {
      throw new Error(
        `this show comes to more than ${Math.round(MAX_ARCHIVE_BYTES / 1e9)} GB, which is more `
        + 'than a bundle this app writes can hold'
      )
    }
    prepared.push({ name, data: source.data, file: source.file, size })
  }
  return prepared
}

/**
 * Writes a zip holding exactly these entries, in this order. The bytes are a function of
 * the entries and nothing else — not of when it was written, and not of the sizes the
 * filesystem happens to report.
 */
export async function writeZip(filePath: string, sources: ZipSource[]): Promise<void> {
  const entries = await prepare(sources)
  const handle = await open(filePath, 'w')
  const writer = new Writer(handle)
  const directory: Array<{ name: Buffer; crc: number; size: number; offset: number }> = []
  try {
    for (const source of entries) {
      const name = Buffer.from(source.name, 'utf8')
      const headerOffset = writer.position
      const header = Buffer.alloc(30)
      header.writeUInt32LE(LOCAL_SIGNATURE, 0)
      header.writeUInt16LE(20, 4)
      // No data descriptor: the header is patched once the bytes have gone past, which
      // keeps the entry readable by tools that only look at the local header.
      header.writeUInt16LE(0, 6)
      header.writeUInt16LE(STORED, 8)
      header.writeUInt16LE(FIXED_TIME, 10)
      header.writeUInt16LE(FIXED_DATE, 12)
      header.writeUInt16LE(name.length, 26)
      await writer.write(header)
      await writer.write(name)

      let crc = 0
      let size = 0
      if (source.data !== undefined) {
        crc = crc32(source.data)
        size = source.data.length
        await writer.write(source.data)
      } else if (source.file !== undefined) {
        const checksum = new Checksum()
        const source_ = createReadStream(source.file, { highWaterMark: CHUNK })
        source_.pipe(checksum)
        for await (const chunk of checksum) {
          await writer.write(chunk as Buffer)
        }
        crc = checksum.crc
        size = checksum.size
      } else {
        throw new Error(`"${source.name}" has nothing in it`)
      }

      const patch = Buffer.alloc(12)
      patch.writeUInt32LE(crc, 0)
      patch.writeUInt32LE(size, 4)
      patch.writeUInt32LE(size, 8)
      await writer.patch(patch, headerOffset + 14)
      directory.push({ name, crc, size, offset: headerOffset })
    }

    const centralOffset = writer.position
    for (const entry of directory) {
      const header = Buffer.alloc(46)
      header.writeUInt32LE(CENTRAL_SIGNATURE, 0)
      // Made by a Unix ("3") of the zip that this file writes, with the permissions of an
      // ordinary file, so an extracted bundle comes out rw-r--r-- rather than guessed at.
      header.writeUInt16LE(0x031e, 4)
      header.writeUInt16LE(20, 6)
      header.writeUInt16LE(0, 8)
      header.writeUInt16LE(STORED, 10)
      header.writeUInt16LE(FIXED_TIME, 12)
      header.writeUInt16LE(FIXED_DATE, 14)
      header.writeUInt32LE(entry.crc, 16)
      header.writeUInt32LE(entry.size, 20)
      header.writeUInt32LE(entry.size, 24)
      header.writeUInt16LE(entry.name.length, 28)
      // A regular file, rw-r--r--, for the tools that read the top half of this word as
      // Unix permissions. Shifted into the unsigned range by hand: 0o100644 << 16 is a
      // negative int32, and Buffer refuses those.
      header.writeUInt32LE((0o100644 << 16) >>> 0, 38)
      header.writeUInt32LE(entry.offset, 42)
      await writer.write(header)
      await writer.write(entry.name)
    }

    const end = Buffer.alloc(END_SIZE)
    end.writeUInt32LE(END_SIGNATURE, 0)
    end.writeUInt16LE(directory.length, 8)
    end.writeUInt16LE(directory.length, 10)
    end.writeUInt32LE(writer.position - centralOffset, 12)
    end.writeUInt32LE(centralOffset, 16)
    await writer.write(end)
  } finally {
    await handle.close()
  }
}

/**
 * Reads an archive's directory. Only the directory: the entries themselves are read one
 * at a time by whoever wants them, because the largest thing in a show bundle is the
 * media and nobody wants all of it in memory at once.
 */
export async function readZip(filePath: string): Promise<ZipEntry[]> {
  const { size } = await stat(filePath)
  const tailSize = Math.min(size, END_SIZE + MAX_COMMENT)
  const tailStart = size - tailSize
  const tail = await read(filePath, tailStart, tailSize)

  // The end record is the last thing in the file bar its comment, so it is found from the
  // end — and the comment length has to agree with where the record sits, or a signature
  // that happens to appear inside some other archive's comment would be read as this one.
  let end = -1
  for (let at = tail.length - END_SIZE; at >= 0; at--) {
    if (tail.readUInt32LE(at) !== END_SIGNATURE) continue
    if (tail.readUInt16LE(at + 20) !== tail.length - at - END_SIZE) continue
    end = at
    break
  }
  if (end < 0) throw new Error('that file is not a zip archive')

  const disk = tail.readUInt16LE(end + 4)
  const directoryDisk = tail.readUInt16LE(end + 6)
  const count = tail.readUInt16LE(end + 10)
  const directorySize = tail.readUInt32LE(end + 12)
  const directoryOffset = tail.readUInt32LE(end + 16)
  if (disk !== 0 || directoryDisk !== 0) throw new Error('that archive is spread over several files')
  if (count === 0xffff || directorySize === ZIP64_MARKER || directoryOffset === ZIP64_MARKER) {
    throw new Error('that archive is too large to open here')
  }

  const directory = await read(filePath, directoryOffset, directorySize)
  const entries: ZipEntry[] = []
  let at = 0
  for (let index = 0; index < count; index++) {
    if (at + 46 > directory.length || directory.readUInt32LE(at) !== CENTRAL_SIGNATURE) {
      throw new Error('that archive’s directory is damaged')
    }
    const flags = directory.readUInt16LE(at + 8)
    const method = directory.readUInt16LE(at + 10)
    const crc = directory.readUInt32LE(at + 16)
    const compressedSize = directory.readUInt32LE(at + 20)
    const size_ = directory.readUInt32LE(at + 24)
    const nameLength = directory.readUInt16LE(at + 28)
    const extraLength = directory.readUInt16LE(at + 30)
    const commentLength = directory.readUInt16LE(at + 32)
    const offset = directory.readUInt32LE(at + 42)
    const name = directory.subarray(at + 46, at + 46 + nameLength).toString('utf8')
    at += 46 + nameLength + extraLength + commentLength

    if ((flags & 0x1) !== 0) throw new Error('that archive is encrypted')
    if (method !== STORED && method !== DEFLATED) {
      throw new Error(`that archive holds an entry packed in a way this app does not read (${method})`)
    }
    if (compressedSize === ZIP64_MARKER || size_ === ZIP64_MARKER) {
      throw new Error('that archive is too large to open here')
    }
    if (name.endsWith('/')) continue      // A directory entry: nothing to extract.
    safeName(name)

    // The local header is the one that says where the data really starts: its name and
    // extra field may be a different length from the directory's copy.
    const local = await read(filePath, offset, 30)
    if (local.readUInt32LE(0) !== LOCAL_SIGNATURE) {
      throw new Error(`"${name}" does not start where the archive says it does`)
    }
    const dataOffset = offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28)
    if (dataOffset + compressedSize > size) {
      throw new Error(`"${name}" runs past the end of the archive`)
    }
    entries.push({ name, offset: dataOffset, compressedSize, size: size_, crc, method })
  }
  return entries
}

/** One entry's bytes, for the small things — a showfile rather than a media file. */
export async function readZipEntry(filePath: string, entry: ZipEntry): Promise<Buffer> {
  const raw = await read(filePath, entry.offset, entry.compressedSize)
  const data = entry.method === DEFLATED ? await inflate(raw) : raw
  checked(entry, crc32(data), data.length)
  return data
}

/**
 * One entry, written into a folder: the destination is derived from the folder and the
 * entry's own name, so an archive cannot place a file anywhere but inside it. A file
 * whose checksum does not match is removed rather than left half-written.
 */
export async function extractZipEntry(filePath: string, entry: ZipEntry, into: string): Promise<string> {
  const destination = entryDestination(into, entry.name)
  await mkdir(dirname(destination), { recursive: true })
  const source = createReadStream(filePath, {
    start: entry.offset,
    end: entry.offset + entry.compressedSize - 1,
    highWaterMark: CHUNK
  })
  const checksum = new Checksum()
  try {
    await pipeline(
      entry.method === DEFLATED ? source.pipe(createInflateRaw()) : source,
      checksum,
      createWriteStream(destination)
    )
    checked(entry, checksum.crc, checksum.size)
  } catch (error) {
    await rm(destination, { force: true })
    throw error
  }
  return destination
}

function checked(entry: ZipEntry, crc: number, size: number): void {
  if (size !== entry.size) {
    throw new Error(`"${entry.name}" came out a different size than the archive says`)
  }
  if (crc !== entry.crc) {
    throw new Error(`"${entry.name}" does not match its checksum — the archive is damaged`)
  }
}

async function read(filePath: string, start: number, length: number): Promise<Buffer> {
  const handle = await open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(length)
    let read = 0
    while (read < length) {
      const chunk = await handle.read(buffer, read, length - read, start + read)
      if (chunk.bytesRead === 0) break
      read += chunk.bytesRead
    }
    return read === length ? buffer : buffer.subarray(0, read)
  } finally {
    await handle.close()
  }
}

async function inflate(raw: Buffer): Promise<Buffer> {
  try {
    return (await inflateRaw(raw)) as Buffer
  } catch {
    throw new Error('that archive entry could not be unpacked')
  }
}
