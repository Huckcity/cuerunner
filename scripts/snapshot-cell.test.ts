// What `native/audio/tests/snapshot-cell.mjs` says when the binary it built does not pass.
// The 2026-10-05 soak night lost its fault half to a ThreadSanitizer build that printed
// nothing and left as a bare exit 1: whether it was killed, never started or reported a race
// could not be told from the log. These cases build a "binary" that dies the way a run can,
// through the script's own `--compiler` seam, and read what the script says about it.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const script = resolve(__dirname, '..', 'native', 'audio', 'tests', 'snapshot-cell.mjs')

/**
 * A stand-in compiler: it ignores the source and writes, at the `-o` path, a shell script
 * that ends the way `body` says. The plain flavour builds and passes; only the run under
 * test — the one whose flags carry the sanitizer — gets the ending under test.
 */
function fakeCompiler(dir: string, body: string): string {
  const compiler = join(dir, 'fake-cxx')
  writeFileSync(compiler, [
    '#!/bin/sh',
    'out=""; tsan=""',
    'while [ $# -gt 0 ]; do',
    '  case "$1" in -o) out="$2"; shift ;; -fsanitize=thread) tsan=1 ;; esac',
    '  shift',
    'done',
    'if [ -n "$tsan" ]; then',
    `  printf '#!/bin/sh\\n%s\\n' '${body}' > "$out"`,
    'else',
    `  printf '#!/bin/sh\\necho "snapshot-cell: ok"\\n' > "$out"`,
    'fi',
    'chmod +x "$out"'
  ].join('\n'))
  chmodSync(compiler, 0o755)
  return compiler
}

function run(body: string): { status: number | null; stdout: string; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), 'snapshot-cell-test-'))
  try {
    const result = spawnSync(process.execPath, [script, '--compiler', fakeCompiler(dir, body)], { encoding: 'utf8' })
    return { status: result.status, stdout: result.stdout, stderr: result.stderr }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// A shell-script binary and POSIX signals: the stand-in is a Unix one. The Windows lane runs
// the script with MSVC, which has no sanitizer build at all.
describe.skipIf(process.platform === 'win32')('snapshot-cell.mjs, when a run does not pass', () => {
  it('names the signal that killed it, and that it printed nothing', () => {
    const result = run('kill -KILL $$')
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('[plain] snapshot-cell: ok')
    expect(result.stdout).toContain('[thread] \n')
    expect(result.stderr).toContain('snapshot-cell: the thread build was killed by SIGKILL, having printed nothing')
  })

  it('names the status a run left with, and keeps what it said', () => {
    const result = run('echo "WARNING: ThreadSanitizer: data race" >&2; exit 66')
    expect(result.status).toBe(66)
    expect(result.stderr).toContain('WARNING: ThreadSanitizer: data race')
    expect(result.stderr).toContain('snapshot-cell: the thread build exited with status 66')
    expect(result.stderr).not.toContain('printed nothing')
  })

  it('says nothing extra when the run passes', () => {
    const result = run('echo "snapshot-cell: ok"')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('[thread] snapshot-cell: ok')
    expect(result.stderr).not.toContain('the thread build')
  })
})
