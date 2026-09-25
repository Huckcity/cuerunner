// Tests for scripts/signing-env.sh — the rule that keeps an unset certificate secret
// from reaching electron-builder as an empty CSC_LINK.
//
// The failure this guards is not hypothetical: a repository with no signing secrets is
// the normal state of a release build until certificates are bought, and on macOS an
// empty CSC_LINK is resolved as a certificate path rather than skipped, so the build
// fails for a reason that has nothing to do with the app.

import { describe, it, expect } from 'vitest'
import { execFileSync } from 'child_process'
import path from 'path'

const script = path.resolve(__dirname, 'signing-env.sh')

/**
 * Sources the script in a shell and reports what it left behind: the variables it
 * exported (by name, with their values) and everything it printed.
 */
function source(link: string, password: string): { output: string; values: Record<string, string> } {
  const probe = [
    `. ${script}`,
    'for name in CSC_LINK CSC_KEY_PASSWORD; do',
    '  eval "value=\\${$name+set}"',
    '  if [ "$value" = set ]; then',
    '    eval "echo exported $name=\\${$name}"',
    '  fi',
    'done'
  ].join('\n')
  const output = execFileSync('sh', ['-c', probe], {
    encoding: 'utf-8',
    env: { ...process.env, SIGNING_LINK: link, SIGNING_PASSWORD: password }
  })
  const values: Record<string, string> = {}
  for (const line of output.split('\n')) {
    const match = /^exported (\w+)=(.*)$/.exec(line.trim())
    if (match !== null) values[match[1]] = match[2]
  }
  return { output, values }
}

// Sourced by a POSIX shell — that is what the release lane is (`release.yml` runs on
// Ubuntu), and what a Windows runner has no `sh` on PATH for. The script is unchanged by
// which machine reads this file; the test states which machine can.
describe.skipIf(process.platform === 'win32')('signing-env.sh', () => {
  it('exports nothing when the secret is empty, and warns', () => {
    const { output, values } = source('', '')
    expect(values).toEqual({})
    expect(output).toContain('::warning::')
    expect(output).toContain('MAC_CSC_LINK')
    expect(output).toContain('unsigned')
  })

  it('exports the certificate and its password when there is one', () => {
    const { output, values } = source('/certs/developer-id.p12', 'hunter2')
    expect(values).toEqual({ CSC_LINK: '/certs/developer-id.p12', CSC_KEY_PASSWORD: 'hunter2' })
    expect(output).not.toContain('::warning::')
  })

  it('keeps an empty password empty rather than dropping the certificate', () => {
    const { values } = source('/certs/developer-id.p12', '')
    expect(values).toEqual({ CSC_LINK: '/certs/developer-id.p12', CSC_KEY_PASSWORD: '' })
  })
})
