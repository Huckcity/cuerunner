// These guards exist because of a real crash: a large PDF opened as a script became a
// million-line document, the panel rendered every line, and the window's process reached
// 3 GB and stopped answering. What is tested here is the refusal, not the reading.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  MAX_SCRIPT_BYTES,
  MAX_SCRIPT_LINES,
  loadScriptDocument,
  looksBinary
} from './document'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuerunner-document-'))

function write(name: string, contents: string | Buffer): string {
  const file = path.join(dir, name)
  fs.writeFileSync(file, contents)
  return file
}

beforeAll(() => {
  fs.mkdirSync(dir, { recursive: true })
})

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('looksBinary', () => {
  it('sees text as text, whatever its line endings', () => {
    expect(looksBinary(Buffer.from('ACT ONE\nThe house lights dim.'))).toBe(false)
    expect(looksBinary(Buffer.from('ACT ONE\r\nThe house lights dim.\r\n'))).toBe(false)
    // Multi-byte characters are not NUL bytes.
    expect(looksBinary(Buffer.from('ALDonza — señor, ¿qué?'))).toBe(false)
  })

  it('sees a binary file as binary', () => {
    // A PDF's header followed by the NUL a compressed stream always carries.
    const pdf = Buffer.concat([
      Buffer.from('%PDF-1.7\n'),
      Buffer.from([0x1f, 0x8b, 0x00, 0x00, 0x00])
    ])
    expect(looksBinary(pdf)).toBe(true)
    expect(looksBinary(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]))).toBe(true)
  })

  it('only looks at the start, where the giveaway always is', () => {
    const text = Buffer.concat([Buffer.from('x'.repeat(5000)), Buffer.from([0])])
    expect(looksBinary(text)).toBe(false)
  })
})

describe('loadScriptDocument', () => {
  it('returns the lines of a script', async () => {
    const file = write('act1.txt', 'ACT ONE\n\nALDonza enters.\n')

    expect(await loadScriptDocument(file, null)).toEqual({
      ok: true,
      lines: ['ACT ONE', '', 'ALDonza enters.']
    })
  })

  it('refuses a binary file by name, without reading it as text', async () => {
    const file = write('libretto.pdf', Buffer.concat([
      Buffer.from('%PDF-1.7\n'),
      Buffer.from([0x00, 0x01, 0x02])
    ]))

    const result = await loadScriptDocument(file, null)

    expect(result).toEqual({ ok: false, error: expect.stringContaining('libretto.pdf') })
    expect(result.ok === false && result.error).toContain('not a text file')
  })

  it('refuses a document larger than the panel will open', async () => {
    const file = write('huge.txt', 'x'.repeat(MAX_SCRIPT_BYTES + 1))

    const result = await loadScriptDocument(file, null)

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('1.0 MB')
  })

  it('refuses a text file with more lines than the panel will render', async () => {
    const file = write('endless.txt', 'line\n'.repeat(MAX_SCRIPT_LINES + 1))

    const result = await loadScriptDocument(file, null)

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('10,001 lines')
  })

  it('names a file it cannot read rather than throwing', async () => {
    const result = await loadScriptDocument(path.join(dir, 'not-here.txt'), null)

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('not-here.txt')
  })

  it('resolves a relative path against the workspace, the way an include does', async () => {
    write('beside-workspace.txt', 'ACT TWO\n')
    const workspace = path.join(dir, 'Show.cuerunner')

    expect(await loadScriptDocument('beside-workspace.txt', workspace)).toEqual({
      ok: true,
      lines: ['ACT TWO']
    })
  })
})
