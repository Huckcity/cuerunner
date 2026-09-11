// Runs one script cue. Nothing here may touch the interface, so a script that never
// yields blocks this worker and nothing else — the host terminates it on STOP, PANIC
// or timeout.
import type { HostMessage, ShellOptions, ShellResult, WorkerMessage } from './scriptProtocol'
import { createModuleSystem, type EvaluateModule, type ModuleSource } from './scriptModules'

// The renderer project is typed against the DOM lib, which has no worker global scope.
// This is the whole of the worker's own runtime surface.
const scope = self as unknown as {
  postMessage(message: WorkerMessage): void
  onmessage: ((event: MessageEvent<HostMessage>) => void) | null
}

let nextId = 1
const callbacks = new Map<number, (reply: HostMessage) => void>()

function shell(command: string, options?: ShellOptions): Promise<ShellResult> {
  const id = nextId++
  const { promise, resolve, reject } = Promise.withResolvers<ShellResult>()
  callbacks.set(id, (reply) => {
    callbacks.delete(id)
    if (reply.type === 'shellResult') resolve(reply.result)
    else if (reply.type === 'rpcError') reject(new Error(reply.message))
  })
  scope.postMessage({ type: 'shell', id, command, options } satisfies WorkerMessage)
  return promise
}

async function readModule(path: string, base?: string): Promise<ModuleSource> {
  const id = nextId++
  const { promise, resolve, reject } = Promise.withResolvers<ModuleSource>()
  callbacks.set(id, (reply) => {
    callbacks.delete(id)
    if (reply.type === 'readFileResult') resolve({ code: reply.code, path: reply.path })
    else if (reply.type === 'rpcError') reject(new Error(reply.message))
  })
  scope.postMessage({ type: 'readFile', id, path, base } satisfies WorkerMessage)
  return promise
}

function formatArg(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.message
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

function emit(level: 'output' | 'error', args: unknown[]): void {
  scope.postMessage({ type: 'log', level, message: args.map(formatArg).join(' ') } satisfies WorkerMessage)
}

const scriptConsole = {
  log: (...args: unknown[]) => emit('output', args),
  info: (...args: unknown[]) => emit('output', args),
  debug: (...args: unknown[]) => emit('output', args),
  warn: (...args: unknown[]) => emit('error', args),
  error: (...args: unknown[]) => emit('error', args)
}

// The script body is wrapped the same way it always was: `await` works at the top level
// and the cue waits for the returned promise. An included file is wrapped the same way,
// so its own `return` is what include() hands back to whoever included it.
const evaluateModule: EvaluateModule = async (code, include) => {
  const fn = new Function('include', 'shell', 'console', `return (async () => {\n${code}\n})()`)
  return await fn(include, shell, scriptConsole)
}

const include = createModuleSystem(readModule, evaluateModule)

async function runScript(code: string): Promise<void> {
  await evaluateModule(code, include)
}

scope.onmessage = (event: MessageEvent<HostMessage>): void => {
  const message = event.data

  if (message.type !== 'run') {
    callbacks.get(message.id)?.(message)
    return
  }

  runScript(message.code).then(
    () => scope.postMessage({ type: 'settled', error: null } satisfies WorkerMessage),
    (error: unknown) => scope.postMessage({
      type: 'settled',
      error: error instanceof Error ? error.message : String(error)
    } satisfies WorkerMessage)
  )
}
