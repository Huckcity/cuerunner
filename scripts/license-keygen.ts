// The issuer's tool. It is not part of the app and it never ships: the private key stays
// on the machine that mints licenses, and a build only ever carries the public half.
//
//   npm run license:keygen                       write a new pair, print the public half
//   npm run license:issue -- --name "Theatre X"  mint a key from the pair on disk
//   npm run license:verify -- "WSL1-…"           check a key against the shipped key
//
// Node runs the TypeScript directly (type stripping), so the tooling and the app share
// one implementation of the format. Nothing here is imported by the app.
import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createLicense, describeRefusal, verifyLicense, type LicenseDraft } from '../src/main/license/key.ts'
import { PRODUCT_PUBLIC_KEYS } from '../src/main/license/publicKey.ts'

/** Kept out of the repository on purpose: it is the whole of the product's protection. */
export const DEFAULT_KEY_PATH = join(homedir(), '.winslab', 'license-private.pem')

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export interface IssueOptions {
  /** Who the key is for, as it should read in Settings. */
  licensee: string
  /** Short id, for matching a key back to a sale. Generated when it is not given. */
  id?: string
  /** Last day the key works, YYYY-MM-DD. Omitted means it does not expire. */
  expires?: string
  /** Today, YYYY-MM-DD. Passed in so the tool's output is testable. */
  issued: string
}

/** Mints a key. Throws with something to read when the options cannot make one. */
export function issueKey(options: IssueOptions, privateKeyPem: string): string {
  const licensee = options.licensee.trim()
  if (licensee.length === 0) throw new Error('A license needs a name: --name "Theatre X"')
  if (options.expires !== undefined && !DATE_PATTERN.test(options.expires)) {
    throw new Error(`--expires must be YYYY-MM-DD, not "${options.expires}"`)
  }
  if (options.expires !== undefined && Number.isNaN(Date.parse(`${options.expires}T00:00:00Z`))) {
    throw new Error(`--expires is not a real date: "${options.expires}"`)
  }
  const payload: LicenseDraft = {
    v: 1,
    id: options.id ?? `WSP-${randomId()}`,
    licensee,
    issued: options.issued,
    ...(options.expires === undefined ? {} : { expires: options.expires })
  }
  return createLicense(payload, privateKeyPem)
}

/** Six characters of base32: enough to tell two keys apart on an invoice. */
function randomId(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')
}

export interface ParsedArgs {
  command: string
  flags: Record<string, string>
  rest: string[]
}

/** Flags that take a value. Anything else is a switch, and reads as "true". */
const VALUE_FLAGS: Record<string, true> = { name: true, id: true, expires: true, key: true }

export function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string> = {}
  const rest: string[] = []
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (!arg.startsWith('--')) {
      rest.push(arg)
      continue
    }
    const [name, inline] = arg.slice(2).split('=')
    if (VALUE_FLAGS[name] !== true) {
      flags[name] = 'true'
      continue
    }
    const value = inline ?? argv[++index]
    if (value === undefined) throw new Error(`${arg} needs a value`)
    flags[name] = value
  }
  return { command: rest.shift() ?? 'help', flags, rest }
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function keyPathFrom(parsed: ParsedArgs): string {
  return parsed.flags['key'] ?? DEFAULT_KEY_PATH
}

export function runCli(
  argv: string[],
  out: (line: string) => void,
  /** Keys `verify` checks against. The shipped build passes nothing and gets its own. */
  publicKeys: string[] = PRODUCT_PUBLIC_KEYS
): void {
  const parsed = parseArgs(argv)

  if (parsed.command === 'keygen') {
    const filePath = keyPathFrom(parsed)
    if (existsSync(filePath) && parsed.flags['force'] === undefined) {
      throw new Error(
        `${filePath} already exists. Overwriting it would invalidate every key already sold — ` +
        'pass --force only if that is what you mean.'
      )
    }
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), { mode: 0o600 })
    chmodSync(filePath, 0o600)
    out(`Private key written to ${filePath} — back it up somewhere offline.`)
    out('')
    out('Public key. Replace PRODUCT_PUBLIC_KEYS in src/main/license/publicKey.ts with this,')
    out('then release: every build verifies licenses against what is in that file.')
    out('')
    out(publicKey.export({ type: 'spki', format: 'pem' }).toString().trim())
    return
  }

  if (parsed.command === 'issue') {
    const privateKeyPem = readFileSync(keyPathFrom(parsed), 'utf-8')
    const text = issueKey(
      {
        licensee: parsed.flags['name'] ?? '',
        ...(parsed.flags['id'] === undefined ? {} : { id: parsed.flags['id'] }),
        ...(parsed.flags['expires'] === undefined ? {} : { expires: parsed.flags['expires'] }),
        issued: today()
      },
      privateKeyPem
    )
    const verified = verifyLicense(text, [publicKeyOf(privateKeyPem)])
    out(text)
    out('')
    if (verified.ok) {
      out(`For ${verified.payload.licensee} · ${verified.payload.id} · issued ${verified.payload.issued}` +
        (verified.payload.expires === undefined ? ' · does not expire' : ` · until ${verified.payload.expires}`))
    }
    return
  }

  if (parsed.command === 'verify') {
    const text = parsed.rest[0]
    if (text === undefined) throw new Error('verify needs a key: npm run license:verify -- "WSL1-…"')
    const verified = verifyLicense(text, publicKeys)
    if (!verified.ok) throw new Error(`Refused: ${describeRefusal(verified.reason)}`)
    out(`Signed by the key this build ships, for ${verified.payload.licensee} (${verified.payload.id}).`)
    out(verified.payload.expires === undefined
      ? 'It does not expire.'
      : `It is good through ${verified.payload.expires}.`)
    return
  }

  out('WinsLab license keys')
  out('')
  out('  npm run license:keygen                        write a new key pair (once)')
  out('  npm run license:issue -- --name "Theatre X"   mint a key from that pair')
  out('  npm run license:issue -- --name "…" --expires 2027-09-12 --id WSP-ABC123')
  out('  npm run license:verify -- "WSL1-…"            check a key against the shipped key')
}

/** The public half of a private key, for the check `issue` prints after minting. */
function publicKeyOf(privateKeyPem: string): string {
  return createPublicKey(createPrivateKey(privateKeyPem))
    .export({ type: 'spki', format: 'pem' })
    .toString()
}

// Only when run as a program: the tests import the functions above.
if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    runCli(process.argv.slice(2), line => console.log(line))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}