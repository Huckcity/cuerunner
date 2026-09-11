// What include() promises: the file runs once per script run, whatever the includers
// do, and it gets the value the file returned.
import { describe, it, expect, vi } from 'vitest'
import { createModuleSystem, type ModuleSource } from './scriptModules'

/** Files by the path the reader resolves them to. */
function readerFor(files: Record<string, string>) {
  return vi.fn(async (path: string, base?: string): Promise<ModuleSource> => {
    const resolved = base === undefined
      ? path
      : `${base.slice(0, base.lastIndexOf('/'))}/${path}`.replace(/\/\.\//g, '/')
    const code = files[resolved]
    if (code === undefined) throw new Error(`no such file: ${resolved}`)
    return { code, path: resolved }
  })
}

/** Runs the file's own code, so nested includes come from the file, not the test. */
const evaluator = (code: string, include: (path: string) => Promise<unknown>): Promise<unknown> =>
  new Function('include', 'return (async () => { ' + code + ' })()')(include)

describe('createModuleSystem', () => {
  it('hands the including script what the included file returned', async () => {
    const read = readerFor({ './lib.js': `return { level: 80 }` })
    const include = createModuleSystem(read, evaluator)

    expect(await include('./lib.js')).toEqual({ level: 80 })
  })

  it('reads and runs a file once, however many times it is included', async () => {
    const read = readerFor({ './lib.js': `return 'once'` })
    const run = vi.fn(evaluator)
    const include = createModuleSystem(read, run)

    expect(await include('./lib.js')).toBe('once')
    expect(await include('./lib.js')).toBe('once')
    expect(read).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('shares one evaluation between two files that include the same module', async () => {
    const read = readerFor({
      './a.js': `return (await include('./shared.js')) + 'a'`,
      './b.js': `return (await include('./shared.js')) + 'b'`,
      './shared.js': `return 'shared'`
    })
    const run = vi.fn(evaluator)
    const include = createModuleSystem(read, run)

    expect(await include('./a.js')).toBe('shareda')
    expect(await include('./b.js')).toBe('sharedb')
    expect(run).toHaveBeenCalledTimes(3)
  })

  it('resolves an include inside a file against that file, not the workspace', async () => {
    const read = readerFor({
      './cues/kit.js': `return (await include('./lamp.js')) + '!'`,
      './cues/lamp.js': `return 'lamp'`
    })
    const include = createModuleSystem(read, evaluator)

    expect(await include('./cues/kit.js')).toBe('lamp!')
    expect(read).toHaveBeenLastCalledWith('./lamp.js', './cues/kit.js')
  })

  it('reports a cycle instead of recursing until the script times out', async () => {
    const read = readerFor({
      './a.js': `return await include('./b.js')`,
      './b.js': `return await include('./a.js')`
    })
    const include = createModuleSystem(read, evaluator)

    await expect(include('./a.js')).rejects.toThrow(/include\(\) cycle: \.\/a\.js/)
  })

  it('says which file could not be read', async () => {
    const include = createModuleSystem(readerFor({}), evaluator)

    await expect(include('./missing.js')).rejects.toThrow('no such file: ./missing.js')
  })
})
