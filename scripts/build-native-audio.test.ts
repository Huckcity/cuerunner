// Tests for scripts/build-native-audio.mjs. The object-path case is the one that broke
// the Windows lane: the source arrives with backslashes there, and a name derived from
// the path instead of the file put a `D:\...` inside the object directory.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

// @ts-ignore — js file, no type declarations
import { findOnPath, objectName } from './build-native-audio.mjs'

describe('objectName', () => {
  it('names a Windows source by its file, not by its path', () => {
    const source = 'D:\\a\\winslab\\winslab\\native\\audio\\third_party\\stb_vorbis.c'
    expect(objectName(source, '.obj')).toBe('stb_vorbis.obj')
  })

  it('names a POSIX source the same way', () => {
    expect(objectName('/home/adam/dev/winslab/native/audio/third_party/cJSON.c', '.o')).toBe('cJSON.o')
    expect(objectName('native/audio/src/engine.cpp', '.o')).toBe('engine.o')
  })

  it('strips only the extension', () => {
    expect(objectName('dr_mp3.cpp', '.o')).toBe('dr_mp3.o')
    expect(objectName('m4a_macos.cpp', '.obj')).toBe('m4a_macos.obj')
  })
})

describe('findOnPath', () => {
  let rootDir: string
  let binDir: string

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-native-test-'))
    binDir = path.join(rootDir, 'bin')
    fs.mkdirSync(binDir)
  })

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true })
  })

  it('finds an executable on PATH', () => {
    const cl = path.join(binDir, 'cl.EXE')
    fs.writeFileSync(cl, '', 'utf8')
    // The stored name is cl.EXE, which is what PATHEXT is for.
    expect(findOnPath('cl', binDir, 'win32')).toBe(cl)
    expect(findOnPath('cl', binDir, 'linux')).toBeNull()
  })

  it('returns null when nothing on PATH matches', () => {
    expect(findOnPath('cl', binDir, 'win32')).toBeNull()
    expect(findOnPath('g++', binDir, 'linux')).toBeNull()
  })

  it('searches every PATH entry, ignoring the empty ones', () => {
    const gcc = path.join(binDir, 'gcc')
    fs.writeFileSync(gcc, '', 'utf8')
    const pathEnv = `${path.delimiter}${path.join(rootDir, 'missing')}${path.delimiter}${binDir}`
    expect(findOnPath('gcc', pathEnv, 'linux')).toBe(gcc)
  })
})
