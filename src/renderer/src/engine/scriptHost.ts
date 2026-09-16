import type { HostMessage, ShellOptions, ShellResult, WorkerMessage } from './scriptProtocol'

/** A run that was terminated on purpose: STOP, PANIC, or a re-fire of the same cue. */
export class ScriptCancelledError extends Error {
  constructor() {
    super('Script cancelled')
    this.name = 'ScriptCancelledError'
  }
}

export interface ScriptRun {
  cueId: string
  code: string
  /** Base for shell() commands and include() paths; null when no file is open. */
  workspacePath: string | null
  /** Hard limit in ms. 0 or less runs without one. */
  timeoutMs: number
  onLog: (level: 'output' | 'error', message: string) => void
}

interface ActiveRun {
  worker: Worker
  /** Terminates the worker and settles the promise the caller is waiting on. */
  finish: (error?: Error) => void
}

// Every run gets its own worker: a worker that is stuck in a loop cannot be reset, so
// the only way to stop one is to throw it away. The interface stays responsive no
// matter what the script does, because the script is not running on it.
class ScriptHost {
  private active = new Map<string, ActiveRun>()

  run(run: ScriptRun): Promise<void> {
    // A cue that is fired again while its previous run is still going must not leave
    // that run behind.
    this.cancel(run.cueId)

    const worker = new Worker(new URL('./scriptWorker.ts', import.meta.url), { type: 'module' })
    const { promise, resolve, reject } = Promise.withResolvers<void>()
    let timer: ReturnType<typeof setTimeout> | undefined
    let settled = false

    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      this.active.delete(run.cueId)
      worker.terminate()
      if (error) reject(error)
      else resolve()
    }

    if (run.timeoutMs > 0) {
      timer = setTimeout(
        () => finish(new Error(`Script timed out after ${run.timeoutMs} ms`)),
        run.timeoutMs
      )
    }
    this.active.set(run.cueId, { worker, finish })

    worker.onmessage = (event: MessageEvent<WorkerMessage>): void => {
      const message = event.data
      switch (message.type) {
        case 'log':
          run.onLog(message.level, message.message)
          break
        case 'settled':
          finish(message.error === null ? undefined : new Error(message.error))
          break
        case 'shell':
          void this.handleShell(run, worker, message)
          break
        case 'readFile':
          void this.handleReadFile(run, worker, message)
          break
      }
    }

    // The worker itself failed to start, or died: the cue must not wait for a timeout.
    worker.onerror = (event) => {
      finish(new Error(event.message || 'the script worker stopped before the script finished'))
    }

    worker.postMessage({ type: 'run', code: run.code } satisfies HostMessage)
    return promise
  }

  cancel(cueId: string): void {
    this.active.get(cueId)?.finish(new ScriptCancelledError())
  }

  cancelAll(): void {
    for (const cueId of [...this.active.keys()]) this.cancel(cueId)
  }

  private async handleShell(
    run: ScriptRun,
    worker: Worker,
    message: Extract<WorkerMessage, { type: 'shell' }>
  ): Promise<void> {
    const options: ShellOptions = { cwd: run.workspacePath ?? undefined, ...message.options }
    let reply: HostMessage
    try {
      const result = await window.cuerunner.script.shell(message.command, options)
      logShellOutput(run.onLog, message.command, result)
      reply = { type: 'shellResult', id: message.id, result }
    } catch (error) {
      reply = { type: 'rpcError', id: message.id, message: describe(error) }
    }
    this.reply(worker, reply)
  }

  private async handleReadFile(
    run: ScriptRun,
    worker: Worker,
    message: Extract<WorkerMessage, { type: 'readFile' }>
  ): Promise<void> {
    let reply: HostMessage
    try {
      const source = await window.cuerunner.script.readFile(
        message.path,
        run.workspacePath,
        message.base
      )
      reply = { type: 'readFileResult', id: message.id, code: source.code, path: source.path }
    } catch (error) {
      reply = { type: 'rpcError', id: message.id, message: describe(error) }
    }
    this.reply(worker, reply)
  }

  private reply(worker: Worker, message: HostMessage): void {
    try {
      worker.postMessage(message)
    } catch {
      // The run was cancelled or timed out while the reply was in flight.
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// Surface the command's output without requiring the script to log it.
function logShellOutput(
  onLog: ScriptRun['onLog'],
  command: string,
  result: ShellResult
): void {
  const lines = [`$ ${command}`]
  if (result.stdout.trim()) lines.push(result.stdout.trimEnd())
  if (result.stderr.trim()) lines.push(result.stderr.trimEnd())
  if (result.code !== 0) {
    lines.push(`exited with code ${result.code}${result.signal ? ` (${result.signal})` : ''}`)
  }
  if (lines.length > 1) onLog(result.code === 0 ? 'output' : 'error', lines.join('\n'))
}

export const scriptHost = new ScriptHost()
