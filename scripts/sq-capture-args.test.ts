// The capture tool's arguments, refused where they are read.
//
// `sqCapture.mjs` sweeps a port range against a desk and records what answers. Its port
// flags used to go through `Number(...)` with no check, so `--first-port abc` swept `NaN`
// (no listener, a banner, an empty capture) and `--first-port 0` walked ephemeral ports
// that bind and answer nothing. Both look like a run that produced no traffic rather than
// like a typo, which is the worst shape a diagnostic can fail in.
//
// The tool is spawned rather than imported: it is a script with top-level work, and the
// refusal happens before any socket is opened, so these cases need no desk and no network.
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const tool = join(root, 'integration', 'sqCapture.mjs')

/**
 * The tool's own answer to one argument list: its exit code and what it said.
 *
 * Bounded, because the failure this guards against is not a crash: without the check the
 * tool *runs*, opening listeners and waiting for a desk, so a case that waited on it would
 * hang rather than fail — which is exactly what a mutation run did before this deadline
 * was added (ten minutes, killed). A kill reports what was captured, and the cases below
 * assert on the refusal they expect instead.
 */
function run(args: string[]): { status: number; stdout: string; stderr: string } {
  try {
    execFileSync(process.execPath, [tool, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10_000,
      killSignal: 'SIGKILL'
    })
    return { status: 0, stdout: '', stderr: '' }
  } catch (error) {
    const failure = error as { status?: number; signal?: string; stdout?: string; stderr?: string }
    return {
      status: failure.status ?? (failure.signal === 'SIGKILL' ? 124 : -1),
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? ''
    }
  }
}

describe('the capture tool’s port arguments', () => {
  it('refuses a port that is not a whole number, naming the flag', () => {
    for (const [flag, value] of [['--first-port', 'abc'], ['--last-port', ''], ['--discovery-port', '51.32']]) {
      const { status, stderr } = run(['--desk', '127.0.0.1', flag, value])
      expect(status, `${flag} ${JSON.stringify(value)} was accepted`).toBe(2)
      expect(stderr).toContain(flag)
      expect(stderr).toContain('whole port number from 1 to 65535')
    }
  })

  it('refuses a port outside the range a port can be', () => {
    for (const value of ['0', '65536', '99999']) {
      const { status, stderr } = run(['--desk', '127.0.0.1', '--first-port', value])
      expect(status, `--first-port ${value} was accepted`).toBe(2)
      expect(stderr).toContain('whole port number from 1 to 65535')
    }
  })

  it('refuses a range that runs backwards, rather than sweeping nothing', () => {
    const { status, stderr } = run(['--desk', '127.0.0.1', '--first-port', '51340', '--last-port', '51320'])
    expect(status).toBe(2)
    expect(stderr).toContain('there is no range to sweep')
  })

  it('never announces a sweep it is not going to make', () => {
    // What the call without the guard did: it printed `sqCapture: relaying tcp NaN-NaN …`
    // and then relayed nothing, so a capture that said it ran held no traffic. The banner
    // is the thing an operator reads as "it worked", and it must not be printed.
    const { status, stdout } = run(['--desk', '127.0.0.1', '--first-port', 'abc'])
    expect(status).toBe(2)
    expect(stdout).not.toContain('relaying')
  })
})
