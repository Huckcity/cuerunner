// Runs the app from source with the Pro half unlocked.
//
//   npm run dev:pro
//
// The gate is not touched: the app is licensed the way an operator's machine is, and
// told to trust the key that signed the license. The pair it trusts exists only for the
// run — `WINSLAB_LICENSE_PUBLIC_KEY` is honoured in a source tree and ignored in a build
// (src/main/license/trustedKeys.ts) — so nothing here unlocks anything that ships.
//
// The key is planted in a user-data directory of its own, as e2e/helpers.ts and
// scripts/capture-screenshots.mjs do it for the same reason: the profile of a normal
// `npm run dev`, and any license in it, is never read, written or shown. The pair is
// minted in this process and the private half never reaches the disk — the issuer's own
// offline key, the one real licenses are signed with, is not read at all.
import { spawn } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { issueKey } from './license-keygen.ts'

/** Where a Pro run keeps its state: beside the app's own profile, never inside it. */
export const DEV_PROFILE_DIR = join(homedir(), '.winslab-dev', 'user-data')

/** What Settings → License says the run is licensed to. */
export const DEV_LICENSEE = 'WinsLab dev'

export interface DevLicense {
  /** The key itself, as the app stores it and shows it. */
  text: string
  /** The public half to check it against: what the app is told to trust. */
  publicKeyPem: string
}

/** Mints a license for one run, from a pair that exists only for that run. */
export function mintDevLicense(issued: string): DevLicense {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  return {
    text: issueKey(
      { licensee: DEV_LICENSEE, id: 'WSP-DEV', issued },
      privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    ),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString()
  }
}

/** Puts the key where the app looks for the one it holds, and answers with the directory. */
export function provision(license: DevLicense, profileDir: string = DEV_PROFILE_DIR): string {
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(join(profileDir, 'license.key'), license.text, 'utf-8')
  return profileDir
}

/** The environment for the dev server: the license, and the shell as it was. */
export function devEnv(environment: NodeJS.ProcessEnv, license: DevLicense): NodeJS.ProcessEnv {
  return { ...environment, WINSLAB_LICENSE_PUBLIC_KEY: license.publicKeyPem }
}

/**
 * `npm run dev`, plus the profile flag.
 *
 * Two separators, and they are both load-bearing. The first is npm's, and the second is
 * electron-vite's: it hands everything after its own `--` to the Electron process
 * (`ELECTRON_CLI_ARGS`, in its CLI, which it rewrites from that list — so setting the
 * variable in the environment is no use). Flags meant for the dev server itself, such as
 * `--inspect`, stay before the second one where its CLI can read them. The profile goes
 * last: it is where this run's license is, and a flag should not point the app elsewhere.
 */
export function devArgs(
  extra: string[] = [],
  profileDir: string = DEV_PROFILE_DIR
): string[] {
  return ['run', 'dev', '--', ...extra, '--', `--user-data-dir=${profileDir}`]
}

function run(): void {
  const license = mintDevLicense(new Date().toISOString().slice(0, 10))
  provision(license)
  console.log(`Pro dev · "${DEV_LICENSEE}" only for this run · profile ${DEV_PROFILE_DIR}`)

  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  // Anything after `--` belongs to the dev server, the way it does for `npm run dev`.
  const child = spawn(npm, devArgs(process.argv.slice(2)), {
    stdio: 'inherit',
    env: devEnv(process.env, license),
    shell: process.platform === 'win32'
  })
  child.on('error', (error) => {
    console.error(`Could not start the dev server: ${error.message}`)
    process.exitCode = 1
  })
  // The dev server's exit is this command's: a build that failed is not a success here.
  child.on('exit', (code) => {
    process.exitCode = code ?? 1
  })
}

// Only when run as a program: the tests import the functions above.
if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    run()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
