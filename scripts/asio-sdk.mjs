#!/usr/bin/env node
/**
 * Where an ASIO build gets Steinberg's SDK from.
 *
 * The SDK's licence allows neither redistribution nor a second copy in a checkout, so
 * it is never vendored here (native/audio/third_party/DEPENDENCIES.json): a machine
 * opts into ASIO by pointing WINSLAB_ASIO_SDK at an SDK root, and every machine that
 * does not gets the plain build it had before. The resolution lives in one module
 * because more than one script asks the question — the build compiles against the SDK,
 * ensure-native decides from the SDK's state whether a rebuild is due — and they must
 * not be able to disagree about the answer.
 *
 * A root is the ASIO SDK's own layout: common/asio.h, host/asiodrivers.h and
 * host/pc/asiolist.cpp under one directory. common/asio.h is the marker that is checked
 * — a directory with it is an SDK root, a directory without it is a variable pointing
 * somewhere that is not one. Only the environment variable is read: a default location
 * is a runner's business, not the build's (the workflows probe one).
 */
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** The one way in. Nothing else names an SDK location. */
export const ASIO_SDK_ENV = 'WINSLAB_ASIO_SDK'

/**
 * The reason that means "nobody asked for ASIO" — the ordinary case, and not an error.
 * Every other reason a resolution is disabled is a variable pointing at something that
 * is not an SDK, which a Windows build fails on rather than quietly ignoring.
 */
export const NOT_CONFIGURED = 'not configured'

/** The header that makes a directory an SDK root. */
const SDK_ROOT_MARKER = join('common', 'asio.h')

/**
 * What an ASIO build compiles out of the SDK, relative to its root — the driver list,
 * and only it. The backend creates a driver with CoCreateInstance and talks to its
 * IASIO interface directly, so the SDK's loader (common/asio.cpp, host/asiodrivers.cpp)
 * is code the engine never calls: it keeps the driver instance it loaded, which would
 * turn a driver that was busy once into "already open" for the rest of the process.
 */
export const ASIO_SDK_SOURCES = [join('host', 'pc', 'asiolist.cpp')]

/** The include directories those sources — and the engine's own backend — compile against. */
export const ASIO_SDK_INCLUDE_DIRS = [join('common'), join('host'), join('host', 'pc')]

/**
 * Resolve the SDK from the environment.
 *
 * The platform is deliberately not consulted: a valid SDK root is a valid SDK root
 * wherever it is found, and whether this machine builds ASIO is the build's decision
 * (describeAsioState folds the platform in). `dir` is null whenever `enabled` is false,
 * and `reason` is meant to be printed verbatim by whatever asked.
 */
export function resolveAsioSdk(env = process.env) {
  const configured = (env[ASIO_SDK_ENV] ?? '').trim()
  if (configured === '') return { enabled: false, dir: null, reason: NOT_CONFIGURED }
  if (!existsSync(join(configured, SDK_ROOT_MARKER))) {
    return {
      enabled: false,
      dir: null,
      reason: `${ASIO_SDK_ENV} is set to "${configured}", but that is not an ASIO SDK root (no ${SDK_ROOT_MARKER} in it)`
    }
  }
  return { enabled: true, dir: configured, reason: `the SDK at ${configured}` }
}

/**
 * The state of ASIO in a build, as one line: what the build log says and what the stamp
 * file stores. "off" covers every machine that does not build ASIO — another platform,
 * or no SDK — and a real SDK is recorded with a fingerprint of its tree, so that
 * pointing the variable somewhere else, or replacing the SDK already there, is a change
 * the mtime-based staleness check in ensure-native.mjs can see.
 */
export function describeAsioState(sdk = resolveAsioSdk(), platform = process.platform) {
  // The engine's ASIO backend is a Windows backend; elsewhere the variable is ignored
  // rather than failed on, and the state says so.
  if (platform !== 'win32') return 'off (Windows only)'
  if (!sdk.enabled) return `off (${sdk.reason})`
  return `${sdk.dir} ${sdkFingerprint(sdk.dir)}`
}

/**
 * A fingerprint of the whole SDK tree: every file's path, size and mtime, hashed. An
 * SDK is a few hundred small files, so this costs a walk, and it answers the only
 * question that matters here — is this the same SDK the objects were built from?
 */
function sdkFingerprint(dir) {
  const hash = createHash('sha1')
  const walk = (current) => {
    // Sorted, so that two walks of an unchanged tree are the same fingerprint even
    // though readdir does not promise an order.
    const entries = readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0
    )
    for (const entry of entries) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) {
        walk(path)
        continue
      }
      const stats = statSync(path)
      hash.update(`${path}\u0000${stats.size}\u0000${stats.mtimeMs}\n`)
    }
  }
  walk(dir)
  return hash.digest('hex').slice(0, 16)
}
