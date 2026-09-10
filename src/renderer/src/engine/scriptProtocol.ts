// Messages between the script host (the renderer's main thread) and the worker that
// actually runs a script cue. The split is deliberate: the host owns the session
// (workspace paths, logging, IPC to the main process), the worker owns nothing but the
// script and can therefore be terminated at any moment.

export interface ShellOptions {
  timeout?: number
  cwd?: string
  env?: Record<string, string>
}

export interface ShellResult {
  stdout: string
  stderr: string
  code: number | null
  signal: string | null
}

/** Worker → host. */
export type WorkerMessage =
  | { type: 'log'; level: 'output' | 'error'; message: string }
  | { type: 'shell'; id: number; command: string; options?: ShellOptions }
  | { type: 'readFile'; id: number; path: string }
  | { type: 'settled'; error: string | null }

/** Host → worker. */
export type HostMessage =
  | { type: 'run'; code: string }
  | { type: 'shellResult'; id: number; result: ShellResult }
  | { type: 'readFileResult'; id: number; code: string }
  | { type: 'rpcError'; id: number; message: string }
