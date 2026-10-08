// Pictures a spec writes for itself: a PNG of exactly the colours it will read back off an
// output, and a Y4M clip for Chromium's fake camera to play as if it were a capture device.
// Made at run time, so the colours a case asserts are the ones in the case, not in a binary
// fixture somebody has to open to understand.
import { writeFileSync } from 'fs'
import { crc32, deflateSync } from 'zlib'

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body) >>> 0)
  return Buffer.concat([length, body, crc])
}

/** An RGBA PNG, `pixel` giving each pixel's [r, g, b, a] (0–255). */
export function writePng(path: string, width: number, height: number, pixel: (x: number, y: number) => readonly number[]): void {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // RGBA
  const rows = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1)
    rows[row] = 0 // no filter
    for (let x = 0; x < width; x++) {
      const [r, g, b, a = 255] = pixel(x, y)
      rows.set([r, g, b, a], row + 1 + x * 4)
    }
  }
  writeFileSync(path, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0))
  ]))
}

/** A PNG of one colour. */
export function writeSolidPng(path: string, rgb: readonly number[], size = 8): void {
  writePng(path, size, size, () => [rgb[0], rgb[1], rgb[2], 255])
}

/**
 * A clip of one colour in YUV 4:2:0 (`Y4M`), which Chromium's fake capture device plays on a
 * loop when it is told to (`--use-file-for-fake-video-capture`).
 */
export function writeSolidY4m(path: string, yuv: readonly [number, number, number], width = 64, height = 48, frames = 10): void {
  const header = Buffer.from(`YUV4MPEG2 W${width} H${height} F30:1 Ip A1:1 C420jpeg\n`, 'ascii')
  const plane = width * height
  const chroma = (width / 2) * (height / 2)
  const frame = Buffer.concat([
    Buffer.from('FRAME\n', 'ascii'),
    Buffer.alloc(plane, yuv[0]),
    Buffer.alloc(chroma, yuv[1]),
    Buffer.alloc(chroma, yuv[2])
  ])
  writeFileSync(path, Buffer.concat([header, ...Array.from({ length: frames }, () => frame)]))
}
