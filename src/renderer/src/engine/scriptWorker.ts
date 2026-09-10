// Runs one script cue. Nothing here may touch the interface, so a script that never
// yields blocks this worker and nothing else — the host terminates it on STOP, PANIC
// or timeout.
import type { HostMessage, ShellOptions, ShellResult, WorkerMessage } from './scriptProtocol'

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

async function readFile(path: string): Promise<string> {
  const id = nextId++
  const { promise, resolve, reject } = Promise.withResolvers<string>()
  callbacks.set(id, (reply) => {
    callbacks.delete(id)
    if (reply.type === 'readFileResult') resolve(reply.code)
    else if (reply.type === 'rpcError') reject(new Error(reply.message))
  })
  scope.postMessage({ type: 'readFile', id, path } satisfies WorkerMessage)
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

async function include(relativePath: string): Promise<void> {
  const source = await readFile(relativePath)
  const fn = new Function('include', 'shell', 'console', `return (async () => {\n${source}\n})()`)
  await fn(include, shell, scriptConsole)
}

// The script body is wrapped the same way it always was: `await` works at the top level
// and the cue waits for the returned promise.
async function runScript(code: string): Promise<void> {
  const fn = new Function('include', 'shell', 'console', `return (async () => {\n${code}\n})()`)
  const result: unknown = fn(include, shell, scriptConsole)
  if (result !== null && typeof result === 'object' && 'then' in result) {
    await (result as PromiseLike<unknown>)
  }
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
