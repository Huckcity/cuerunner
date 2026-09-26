import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  EXCLUDES,
  body,
  npmCommand,
  sshCommand,
  hosts,
  plan,
  prologue,
  quote,
  refusal,
  sshArgs,
  tarArgs,
  treeDigest
} from './local-ci.mjs'

describe('the lanes and the hosts they run on', () => {
  it('gives each host the lanes that say something about it', () => {
    const table = hosts({})
    // This machine is the whole gate: it is the one platform that can run e2e from a
    // terminal, and the native and integration lanes are Linux lanes by construction.
    expect(table.linux.lanes).toEqual(['typecheck', 'unit', 'native', 'integration', 'e2e'])
    // The remotes say what *their* platform says about the code, and no more.
    expect(table.win.lanes).toEqual(['typecheck', 'unit'])
    expect(table.mac.lanes).toEqual(['typecheck', 'unit'])
    expect(table.win.ssh).toBe('adam@192.168.0.210')
    expect(table.mac.ssh).toBe('adam@mac.local')
  })

  it('takes the doors from the environment when they are set', () => {
    const table = hosts({ LOCAL_CI_WIN: 'ci@10.0.0.9', LOCAL_CI_MAC: 'build@studio.local', LOCAL_CI_LINUX: 'adam@ubox' })
    expect(table.win.ssh).toBe('ci@10.0.0.9')
    expect(table.mac.ssh).toBe('build@studio.local')
    expect(table.linux.ssh).toBe('adam@ubox')
  })

  it('plans every host by default, and one lane everywhere when asked for one', () => {
    const all = plan([])
    expect(all.steps).toHaveLength(9)
    expect(all.steps.map(step => step.host.key)).toEqual(['linux', 'linux', 'linux', 'linux', 'linux', 'win', 'win', 'mac', 'mac'])

    const one = plan(['--lanes=unit', '--hosts=win,mac'])
    expect(one.steps.map(step => `${step.host.key}:${step.lane}`)).toEqual(['win:unit', 'mac:unit'])
  })

  it('refuses a host or a lane it does not have, rather than planning nothing', () => {
    expect(() => plan(['--hosts=nuc'])).toThrow('no such host: nuc')
    expect(() => plan(['--lanes=soak'])).toThrow('no such lane: soak')
  })

  it('refuses a flag it does not know, and a host or lane list that names none', () => {
    // A misspelt flag is how a reader asks for something other than what they get: `--lisst`
    // would run the gate instead of listing it, and a valueless `--hosts=` a gate with no steps
    // that still reports `0 passed` and exits 0.
    expect(() => plan(['--lisst'])).toThrow('no such flag: lisst')
    expect(() => plan(['--host=win'])).toThrow('no such flag: host')
    expect(() => plan(['--hosts='])).toThrow('no host to run')
    expect(() => plan(['--lanes='])).toThrow('no lane to run')
  })
})

describe('what a step can and cannot do where it was asked to', () => {
  const table = hosts({})

  it('refuses the e2e lane anywhere but here, and says why', () => {
    const remote = refusal({ host: table.win, lane: 'e2e', gui: true, linux: false })
    expect(remote).toContain('desktop session')
    expect(remote).toContain('login session')
    expect(refusal({ host: table.linux, lane: 'e2e', gui: true, linux: false })).toBeNull()
  })

  it('refuses a Linux lane on a platform CI does not run it on', () => {
    expect(refusal({ host: table.mac, lane: 'native', gui: false, linux: true })).toContain('Linux lane')
    expect(refusal({ host: table.linux, lane: 'native', gui: false, linux: true })).toBeNull()
  })
})

describe('the commands it builds', () => {
  it('ships the tree without the toolchain, the history or the build products', () => {
    const args = tarArgs()
    for (const name of ['node_modules', '.git', 'out', 'test-results']) {
      expect(args).toContain(`--exclude=${name}`)
      expect(EXCLUDES).toContain(name)
    }
    // The engine's build directory is one platform's binary, and the Mac would read a shipped
    // Linux `cuerunner-audio` as current; the FFmpeg cache is 160 MB no host needs shipped.
    for (const name of ['native/audio/build', 'native/audio/.cache']) {
      expect(args).toContain(`--exclude=${name}`)
      expect(EXCLUDES).toContain(name)
    }
    expect(args.at(-1)).toBe('.')
  })

  it('ssh with the host key, no prompt, and a key only where one is configured', () => {
    const table = hosts({})
    const win = sshArgs(table.win, 'echo hi')
    expect(win[0]).toBe('ssh')
    expect(win.join(' ')).toContain('-i ')
    expect(win.join(' ')).toContain('id_ed25519_winvm')
    expect(win).toContain('BatchMode=yes')
    // A host that answers and then stalls has to end the session itself, or the run hangs where
    // the README promises a skipped row.
    expect(win).toContain('ServerAliveInterval=15')
    expect(win).toContain('ServerAliveCountMax=3')
    expect(win.at(-2)).toBe(table.win.ssh)
    expect(win.at(-1)).toBe('echo hi')

    const mac = sshArgs(table.mac, 'echo hi')
    expect(mac).not.toContain('-i')
  })

  it('hands spawn the binary and its arguments apart, so ssh is not asked for a host called ssh', () => {
    const { command, args } = sshCommand(hosts({}).win, 'echo hi')
    expect(command).toBe('ssh')
    expect(args).not.toContain('ssh')
    expect(args.at(-1)).toBe('echo hi')
  })

  it('gives the Windows shell the runner\'s node, MSVC and the ASIO SDK', () => {
    const pre = prologue(hosts({}).win)
    expect(pre).toContain('_work\\_tool\\node')
    expect(pre).toContain('vcvars64.bat')
    expect(pre).toContain('C:\\asio-sdk\\ASIOSDK')
    expect(pre).toContain('CUERUNNER_ASIO_SDK')
  })

  it('gives a posix host the runner\'s node when it has one, and never a Windows one', () => {
    const pre = prologue(hosts({}).mac)
    expect(pre).toContain('_work/_tool/node')
    expect(pre).not.toContain('vcvars')
    expect(pre).not.toContain('asio-sdk')
  })

  it('spells npm the way the host can run it', () => {
    const table = hosts({})
    expect(npmCommand(table.win, 'npm run typecheck')).toBe('npm.cmd run typecheck')
    expect(npmCommand(table.win, 'npm ci --legacy-peer-deps')).toBe('npm.cmd ci --legacy-peer-deps')
    expect(npmCommand(table.mac, 'npm run typecheck')).toBe('npm run typecheck')
    // Anything that is not npm is left exactly as the workflow states it.
    expect(npmCommand(table.win, 'node scripts/thing.mjs')).toBe('node scripts/thing.mjs')
  })

  it('joins a lane\'s parts the way each platform\'s shell reads them', () => {
    const table = hosts({})
    expect(body(table.win, ['a', 'b'])).toBe('a; b')
    expect(body(table.mac, ['a', 'b'])).toBe('a && b')
    expect(quote(table.win, 'C:\\Users\\Adam\\x')).toBe("'C:\\Users\\Adam\\x'")
    expect(quote(table.mac, '/Users/adam/x')).toBe('"/Users/adam/x"')
  })
})

describe('the tree digest', () => {
  it('is a short digest, and the same one twice', () => {
    const first = treeDigest()
    expect(first).toMatch(/^[0-9a-f]{16}$/)
    expect(treeDigest()).toBe(first)
  })

  it('changes when a file is edited, not only when one is added', async () => {
    // The one way a local run could quietly test something other than what is on disk here:
    // an edit keeps the file's name, so the digest has to read what the file *is*.
    const probe = join(process.cwd(), 'scripts/tmp-digest-probe.txt')
    const digestOf = async (): Promise<string> => {
      vi.resetModules()
      const fresh = await import('./local-ci.mjs')
      return fresh.treeDigest()
    }
    try {
      const before = treeDigest()
      writeFileSync(probe, 'one')
      const added = await digestOf()
      writeFileSync(probe, 'two-two')
      const edited = await digestOf()
      expect(added).not.toBe(before)
      expect(edited).not.toBe(added)
    } finally {
      rmSync(probe, { force: true })
    }
  })
})
