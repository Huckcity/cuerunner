// jsdom has no Worker, and the host exists to manage one, so the worker is faked here:
// the test plays the script's side of the protocol. The real worker is exercised end to
// end by the E2E suite, which runs scripts in the built app.
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { scriptHost, ScriptCancelledError } from './scriptHost'
import type { HostMessage, WorkerMessage } from './scriptProtocol'

class FakeWorker {
  static instances: FakeWorker[] = []

  onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  /** Messages the host sent to the worker, in order. */
  posted: HostMessage[] = []
  terminated = false

  constructor(readonly url: URL, readonly options: WorkerOptions) {
    FakeWorker.instances.push(this)
  }

  postMessage(message: HostMessage): void {
    this.posted.push(message)
  }

  terminate(): void {
    this.terminated = true
  }

  /** The worker sending something to the host. */
  emit(message: WorkerMessage): void {
    this.onmessage?.({ data: message } as MessageEvent<WorkerMessage>)
  }

  failToStart(message: string): void {
    this.onerror?.({ message } as ErrorEvent)
  }

  /** Everything the worker was asked to run. */
  runs(): Array<Extract<HostMessage, { type: 'run' }>> {
    return this.posted.filter((m): m is Extract<HostMessage, { type: 'run' }> => m.type === 'run')
  }
}

function lastWorker(): FakeWorker {
  return FakeWorker.instances[FakeWorker.instances.length - 1]
}

describe('scriptHost', () => {
  let onLog: Mock

  beforeEach(() => {
    FakeWorker.instances = []
    vi.stubGlobal('Worker', FakeWorker)
    onLog = vi.fn()
    Object.defineProperty(window, 'cuerunner', {
      value: {
        script: {
          shell: vi.fn().mockResolvedValue({ stdout: '', stderr: '', code: 0, signal: null }),
          readFile: vi.fn().mockResolvedValue('// included')
        }
      },
      writable: true
    })
  })

  afterEach(() => {
    scriptHost.cancelAll()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  const run = (overrides: Partial<Parameters<typeof scriptHost.run>[0]> = {}) =>
    scriptHost.run({
      cueId: 'sc1',
      code: 'console.log(1)',
      workspacePath: '/shows/My Show.cuerunner',
      timeoutMs: 60000,
      onLog,
      ...overrides
    })

  it('runs the script in a module worker and resolves when it settles', async () => {
    const settled = run()
    const worker = lastWorker()

    expect(worker.options).toEqual({ type: 'module' })
    expect(worker.runs()).toEqual([{ type: 'run', code: 'console.log(1)' }])

    worker.emit({ type: 'settled', error: null })
    await expect(settled).resolves.toBeUndefined()
    expect(worker.terminated).toBe(true)
  })

  it('rejects with the script error and throws the worker away', async () => {
    const settled = run()
    const worker = lastWorker()

    worker.emit({ type: 'settled', error: 'boom' })

    await expect(settled).rejects.toThrow('boom')
    expect(worker.terminated).toBe(true)
  })

  it('rejects when the worker stops before the script finishes', async () => {
    const settled = run()
    lastWorker().failToStart('worker exploded')

    await expect(settled).rejects.toThrow('worker exploded')
  })

  it('terminates a script that outlives its timeout', async () => {
    vi.useFakeTimers()
    const settled = run({ timeoutMs: 1500 })
    const worker = lastWorker()

    vi.advanceTimersByTime(1500)

    await expect(settled).rejects.toThrow('Script timed out after 1500 ms')
    expect(worker.terminated).toBe(true)
    vi.useRealTimers()
  })

  it('gives a run with no timeout as long as it needs', async () => {
    vi.useFakeTimers()
    const settled = run({ timeoutMs: 0 })
    const worker = lastWorker()

    vi.advanceTimersByTime(60 * 60 * 1000)
    worker.emit({ type: 'settled', error: null })

    await expect(settled).resolves.toBeUndefined()
    vi.useRealTimers()
  })

  it('runs shell() through the main process in the workspace folder, and logs it', async () => {
    const shell = window.cuerunner.script.shell as ReturnType<typeof vi.fn>
    shell.mockResolvedValue({ stdout: 'hello\n', stderr: '', code: 0, signal: null })

    const settled = run()
    const worker = lastWorker()
    worker.emit({ type: 'shell', id: 4, command: 'echo hello' })
    await vi.waitFor(() => expect(worker.posted.some(m => m.type === 'shellResult')).toBe(true))

    expect(shell).toHaveBeenCalledWith('echo hello', { cwd: '/shows/My Show.cuerunner' })
    expect(worker.posted).toContainEqual({
      type: 'shellResult',
      id: 4,
      result: { stdout: 'hello\n', stderr: '', code: 0, signal: null }
    })
    expect(onLog).toHaveBeenCalledWith('output', '$ echo hello\nhello')

    worker.emit({ type: 'settled', error: null })
    await settled
  })

  it('lets the script see a failing shell command rather than rejecting the run', async () => {
    const shell = window.cuerunner.script.shell as ReturnType<typeof vi.fn>
    shell.mockResolvedValue({ stdout: '', stderr: 'nope\n', code: 127, signal: null })

    const settled = run()
    const worker = lastWorker()
    worker.emit({ type: 'shell', id: 5, command: 'nope', options: { timeout: 2000 } })
    await vi.waitFor(() => expect(worker.posted.some(m => m.type === 'shellResult')).toBe(true))

    expect(shell).toHaveBeenCalledWith('nope', { cwd: '/shows/My Show.cuerunner', timeout: 2000 })
    expect(worker.posted).toContainEqual(expect.objectContaining({
      type: 'shellResult',
      result: expect.objectContaining({ code: 127 })
    }))
    expect(onLog).toHaveBeenCalledWith('error', '$ nope\nnope\nexited with code 127')

    worker.emit({ type: 'settled', error: null })
    await settled
  })

  it('hands a failing shell call back to the script as an error', async () => {
    const shell = window.cuerunner.script.shell as ReturnType<typeof vi.fn>
    shell.mockRejectedValue(new Error('no such command'))

    const settled = run()
    const worker = lastWorker()
    worker.emit({ type: 'shell', id: 6, command: 'nope' })
    await vi.waitFor(() => expect(worker.posted.some(m => m.type === 'rpcError')).toBe(true))

    expect(worker.posted).toContainEqual({ type: 'rpcError', id: 6, message: 'no such command' })

    worker.emit({ type: 'settled', error: null })
    await settled
  })

  it('resolves include() paths against the workspace', async () => {
    const readFile = window.cuerunner.script.readFile as ReturnType<typeof vi.fn>
    readFile.mockResolvedValue({ code: 'return 1', path: '/shows/lib.js' })

    const settled = run()
    const worker = lastWorker()
    worker.emit({ type: 'readFile', id: 9, path: './lib.js' })
    await vi.waitFor(() => expect(worker.posted.some(m => m.type === 'readFileResult')).toBe(true))

    expect(readFile).toHaveBeenCalledWith('./lib.js', '/shows/My Show.cuerunner', undefined)
    expect(worker.posted).toContainEqual({
      type: 'readFileResult',
      id: 9,
      code: 'return 1',
      path: '/shows/lib.js'
    })

    worker.emit({ type: 'settled', error: null })
    await settled
  })

  it('names the including file, so an include inside it resolves against that file', async () => {
    const readFile = window.cuerunner.script.readFile as ReturnType<typeof vi.fn>
    readFile.mockResolvedValue({ code: 'return 2', path: '/shows/cues/lamp.js' })

    const settled = run()
    const worker = lastWorker()
    worker.emit({ type: 'readFile', id: 10, path: './lamp.js', base: '/shows/cues/kit.js' })
    await vi.waitFor(() => expect(worker.posted.some(m => m.type === 'readFileResult')).toBe(true))

    expect(readFile).toHaveBeenCalledWith('./lamp.js', '/shows/My Show.cuerunner', '/shows/cues/kit.js')

    worker.emit({ type: 'settled', error: null })
    await settled
  })

  it('terminates the run on cancel, and reports it as a cancellation', async () => {
    const settled = run()
    const worker = lastWorker()

    scriptHost.cancel('sc1')

    await expect(settled).rejects.toBeInstanceOf(ScriptCancelledError)
    expect(worker.terminated).toBe(true)
  })

  it('cancels every run at once', async () => {
    const first = run({ cueId: 'sc1' })
    const second = run({ cueId: 'sc2' })

    scriptHost.cancelAll()

    await expect(first).rejects.toBeInstanceOf(ScriptCancelledError)
    await expect(second).rejects.toBeInstanceOf(ScriptCancelledError)
  })

  it('drops the previous run when the same cue fires again', async () => {
    const first = run({ code: 'console.log("first")' })
    const stale = lastWorker()
    const second = run({ code: 'console.log("second")' })

    await expect(first).rejects.toBeInstanceOf(ScriptCancelledError)
    expect(stale.terminated).toBe(true)

    lastWorker().emit({ type: 'settled', error: null })
    await expect(second).resolves.toBeUndefined()
  })
})
