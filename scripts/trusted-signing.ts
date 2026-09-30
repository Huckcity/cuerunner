// What this build can sign the Windows installer with, decided from the environment and
// printed as one JSON object the packaging job hands to electron-builder.
//
// Azure Trusted Signing keeps the private key in Azure: the pipeline holds four resource
// identifiers and three Entra credentials, and there is no certificate, no `.pfx` and no key
// anywhere to lose. `electron-builder` signs through it whenever `win.azureSignOptions` is
// configured — `WindowsSignAzureManager` runs `Invoke-TrustedSigning` over the app's own
// binaries, the uninstaller and the NSIS installer — and it *throws* when `AZURE_TENANT_ID`
// or `AZURE_CLIENT_ID` is unset, so that configuration cannot live in `package.json`: every
// build would carry it, and a repository with no identity configured would fail the packaging
// job instead of shipping unsigned, which is the opposite of what this pipeline promises. It
// is decided here instead, once per run, and passed to electron-builder as the
// `-c.win.azureSignOptions.*` flags it deep-assigns over the packaged config
// (`electron-builder/out/builder.js`).
//
// Three states, and only one of them is decided by which half is present:
//
//   nothing configured              -> `no`, with the warning a release engineer has to
//                                      read: unsigned, and the release notes will say so
//   any of the seven, and not all    -> refused, not signed. An identity that is configured
//   seven of them                       halfway is a mistake, in either direction: a release
//                                       that quietly drops to unsigned is how one ships
//                                       without anybody noticing, and a signer that
//                                       authenticates with nothing to sign against is
//                                       refused by the service anyway.
//
// The macOS counterpart is `scripts/signing-env.sh`, which exports `CSC_LINK`; this is the
// Windows one, and it exports nothing — it is a module the verification suites import
// because a PowerShell script could only be held to these states on the one lane that runs
// PowerShell.
//
//   node scripts/trusted-signing.ts     # the plan, as JSON
import { pathToFileURL } from 'node:url'

/**
 * The four resource identifiers Trusted Signing needs, as this pipeline names them, mapped to
 * the `azureSignOptions` fields they configure. The endpoint is the region the account and
 * its certificate profile were created in; a mismatched one is refused by the service.
 */
export const IDENTIFIERS: Record<string, string> = {
  TRUSTED_SIGNING_PUBLISHER: 'publisherName',
  TRUSTED_SIGNING_ENDPOINT: 'endpoint',
  TRUSTED_SIGNING_ACCOUNT: 'codeSigningAccountName',
  TRUSTED_SIGNING_PROFILE: 'certificateProfileName'
}

/**
 * The Entra credentials the signer authenticates with. `EnvironmentCredential` is the only
 * chain `electron-builder` 26.8.1 admits: it refuses an `az login` or OIDC session before
 * `Invoke-TrustedSigning` is ever called (electron-builder#9623), so a federated credential
 * is not an option here and these three are the whole of it.
 */
export const CREDENTIALS: string[] = ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET']

/** The decision for one environment. */
export interface SigningPlan {
  /** `yes` or `no` — the word the packaging job records and the release notes are composed from. */
  signed: string
  /** electron-builder's own configuration flags, empty unless this build signs. */
  args: string[]
  /** What a release engineer reads when this build will not sign. */
  warning: string | null
  /** The refusal of a configuration that is neither signing nor deliberately unsigned. */
  error: string | null
}

/**
 * The plan for one environment: the flags that configure the service, or the state this build
 * ships in. An unset GitHub variable or secret arrives as an empty string, which is what makes
 * a key's presence the wrong test and an empty value the right one.
 */
export function plan(env: Record<string, string | undefined>): SigningPlan {
  const absent = (names: string[]): string[] => names.filter((name) => (env[name] ?? '') === '')
  const identifiers = absent(Object.keys(IDENTIFIERS))
  const credentials = absent(CREDENTIALS)
  // Nothing missing: the identity is whole, and these are the flags that configure the service.
  if (identifiers.length === 0 && credentials.length === 0) {
    return {
      signed: 'yes',
      args: Object.entries(IDENTIFIERS).map(([name, field]) => `--config.win.azureSignOptions.${field}=${env[name]}`),
      warning: null,
      error: null
    }
  }
  // Everything missing: a repository that never configured an identity, which is the normal
  // state of a build until it does — unsigned, and saying so.
  if (identifiers.length === Object.keys(IDENTIFIERS).length && credentials.length === CREDENTIALS.length) {
    return {
      signed: 'no',
      args: [],
      warning:
        'No Azure Trusted Signing identity is configured (repository variables ' +
        `${Object.keys(IDENTIFIERS).join(', ')}; secrets ${CREDENTIALS.join(', ')}); ` +
        'the installer will be unsigned, and a venue machine will refuse it.',
      error: null
    }
  }
  // Anything in between is a mistake in one of two directions — a service principal with no
  // account to sign against, or an account with no credentials — and neither is a release.
  const missing = [...identifiers, ...credentials]
  return {
    signed: 'no',
    args: [],
    warning: null,
    error:
      `Azure Trusted Signing is half-configured — ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} unset while the rest of the identity is. ` +
      'Configure all four resource identifiers and all three credentials, or none of them: a signing service configured halfway is a release that ships unsigned behind a warning nobody reads.'
  }
}

// Only when run as a program: the tests import the plan above.
if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.stdout.write(`${JSON.stringify(plan(process.env))}\n`)
}
