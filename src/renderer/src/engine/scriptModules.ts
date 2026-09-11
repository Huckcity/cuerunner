// include() used to be a plain re-evaluation, and each file got its own scope with no
// say in what it resolved against. It is now a module system scoped to one script run:
// a file is read once and evaluated once however many times it is included, an included
// file can make its own includes — resolved against itself, not the workspace file —
// and a cycle is reported as an error instead of recursing until the timeout.

export interface ModuleSource {
  code: string
  /** Where the file actually is, and therefore the base for the includes inside it. */
  path: string
}

/** What a script is handed: the same function, bound to the file that is asking. */
export type Include = (path: string) => Promise<unknown>

export type ReadModule = (path: string, base?: string) => Promise<ModuleSource>
export type EvaluateModule = (code: string, include: Include) => Promise<unknown>

export function createModuleSystem(read: ReadModule, evaluate: EvaluateModule): Include {
  const evaluation = new Map<string, Promise<unknown>>()
  // The resolved path of a request is worth remembering on its own: a script that
  // includes the same file twice must not re-read it to discover that it already ran.
  const resolvedByRequest = new Map<string, string>()
  const sources = new Map<string, string>()

  const load = async (
    requested: string,
    base: string | undefined,
    ancestry: readonly string[]
  ): Promise<unknown> => {
    const requestKey = `${base ?? ''}\u0000${requested}`
    let path = resolvedByRequest.get(requestKey)
    if (path === undefined) {
      const source = await read(requested, base)
      path = source.path
      resolvedByRequest.set(requestKey, path)
      sources.set(path, source.code)
    }

    // A file that is already being evaluated further up this chain is a cycle: it can
    // never finish, so saying so beats recursing until the script times out.
    if (ancestry.includes(path)) {
      throw new Error(`include() cycle: ${path} is already being included`)
    }

    const started = evaluation.get(path)
    if (started !== undefined) return started

    // Cached before it settles, so two includes of one file share a single evaluation.
    const promise = evaluate(sources.get(path)!, next => load(next, path, [...ancestry, path]))
    evaluation.set(path, promise)
    return promise
  }

  return requested => load(requested, undefined, [])
}
