import { describe, expect, it } from 'vitest'
import * as path from 'node:path'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { shellWorkingDirectory, type PathKind } from './shellCwd'

const is = (kind: PathKind) => (): PathKind => kind

describe('where a script cue\'s shell() command runs', () => {
  it('runs in a directory it is given, whatever the directory is called', () => {
    // The fault: a dot in a folder's name made it a file, and the command ran one level up.
    for (const dir of ['/shows/cues.v2', '/shows/Tour 2026.03', '/shows/plain']) {
      expect(shellWorkingDirectory(dir, is('directory'))).toBe(dir)
    }
  })

  it('runs beside a file it is given: the workspace file is the default the window sends', () => {
    // Built with the platform's own separators, so the same rule is read on Windows.
    const shows = path.resolve('shows')
    expect(shellWorkingDirectory(path.join(shows, 'Macbeth.cuerunner'), is('file'))).toBe(shows)
    // A file with no extension is still a file.
    expect(shellWorkingDirectory(path.join(shows, 'Makefile'), is('file'))).toBe(shows)
  })

  it('guesses by the extension only for a path that is not there', () => {
    const gone = path.resolve('gone')
    expect(shellWorkingDirectory(path.join(gone, 'Show.cuerunner'), is('missing'))).toBe(gone)
    expect(shellWorkingDirectory(path.join(gone, 'folder'), is('missing'))).toBe(path.join(gone, 'folder'))
  })

  it('runs in the app\'s own directory when it is given none', () => {
    expect(shellWorkingDirectory(undefined)).toBe(process.cwd())
    expect(shellWorkingDirectory('')).toBe(process.cwd())
  })

  it('asks the disk when nothing else is injected', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'cuerunner-shellcwd-'))
    try {
      const dotted = path.join(root, 'cues.v2')
      mkdirSync(dotted)
      const show = path.join(root, 'Show.cuerunner')
      writeFileSync(show, '{}')
      expect(shellWorkingDirectory(dotted)).toBe(dotted)
      expect(shellWorkingDirectory(show)).toBe(root)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
