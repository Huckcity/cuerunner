// Tests for scripts/trusted-signing.ts — the decision that says whether a Windows build
// signs, and the electron-builder flags it is signed with.
//
// The failure these guard against is the one a release cannot see: a signing identity
// configured halfway. The four resource identifiers and the three Entra credentials are set
// in two different places — repository variables and repository secrets — and a build that
// finds only some of them either refuses deep inside electron-builder's pre-flight, after
// the packaging job has already spent minutes producing a build, or drops to unsigned and
// ships. The states below are the four the decision can be in, and the words each one says
// are the words the release notes and a release engineer read.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { CREDENTIALS, IDENTIFIERS, plan, type SigningPlan } from './trusted-signing.ts'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const script = path.join(root, 'scripts', 'trusted-signing.ts')

/** An environment where Trusted Signing is fully configured, as the repository's runner has it. */
const CONFIGURED: Record<string, string> = {
  TRUSTED_SIGNING_PUBLISHER: 'CN=Cuerunner Ltd',
  TRUSTED_SIGNING_ENDPOINT: 'https://weu.codesigning.azure.net',
  TRUSTED_SIGNING_ACCOUNT: 'cuerunner-signing',
  TRUSTED_SIGNING_PROFILE: 'cuerunner-public-trust',
  AZURE_TENANT_ID: '11111111-1111-1111-1111-111111111111',
  AZURE_CLIENT_ID: '22222222-2222-2222-2222-222222222222',
  AZURE_CLIENT_SECRET: 'the-client-secret'
}

/** Runs the script the way the packaging job does, in exactly the environment it is handed. */
function run(env: Record<string, string>): SigningPlan {
  const result = spawnSync(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', script], {
    env,
    encoding: 'utf-8'
  })
  if (result.status !== 0) throw new Error(`trusted signing exited ${result.status}: ${result.stderr}`)
  return JSON.parse(result.stdout) as SigningPlan
}

describe('the Windows signing decision', () => {
  it('says nothing is signed, by name, when no identity is configured', () => {
    const decision = plan({})
    expect(decision.signed).toBe('no')
    expect(decision.args).toEqual([])
    expect(decision.error).toBeNull()
    // A release engineer reads this on the run page: which configuration is missing, and what
    // the artifact they are about to publish is.
    expect(decision.warning).toContain('Azure Trusted Signing')
    expect(decision.warning).toContain('unsigned')
    for (const name of Object.keys(IDENTIFIERS)) expect(decision.warning).toContain(name)
  })

  it('configures the service by its own field names when the identity is complete', () => {
    const decision = plan(CONFIGURED)
    expect(decision.signed).toBe('yes')
    expect(decision.warning).toBeNull()
    expect(decision.error).toBeNull()
    // The publisher name carries spaces and an `=`, which is the case a flag handed over as
    // one argument has to survive: it is the certificate's own subject.
    expect(decision.args).toEqual([
      '--config.win.azureSignOptions.publisherName=CN=Cuerunner Ltd',
      '--config.win.azureSignOptions.endpoint=https://weu.codesigning.azure.net',
      '--config.win.azureSignOptions.codeSigningAccountName=cuerunner-signing',
      '--config.win.azureSignOptions.certificateProfileName=cuerunner-public-trust'
    ])
  })

  it('refuses a half-configured identity rather than signing nothing or everything', () => {
    // The account without its credentials: a signer with no way to authenticate.
    const noCredentials = plan({ ...CONFIGURED, AZURE_CLIENT_SECRET: '' })
    expect(noCredentials.signed).toBe('no')
    expect(noCredentials.args).toEqual([])
    expect(noCredentials.error).toContain('AZURE_CLIENT_SECRET')
    // A refusal is not the unsigned state: it must not also read as one, or a half-configured
    // release would warn about signing nothing and then ship it.
    expect(noCredentials.warning).toBeNull()

    // The credentials without the account: a signer with nothing to sign against.
    const noAccount = plan({ ...CONFIGURED, TRUSTED_SIGNING_ACCOUNT: '' })
    expect(noAccount.error).toContain('TRUSTED_SIGNING_ACCOUNT')
    expect(noAccount.args).toEqual([])

    // The credentials with no resource identifier at all — the service principal created, the
    // repository variables never added. This is the case that must not read as "nothing is
    // configured": an operator who set up the identity and missed a variable gets a build that
    // signs under a warning claiming no identity exists, and an unsigned release they did not
    // mean to cut.
    const credentialsOnly = plan({
      AZURE_TENANT_ID: CONFIGURED.AZURE_TENANT_ID,
      AZURE_CLIENT_ID: CONFIGURED.AZURE_CLIENT_ID,
      AZURE_CLIENT_SECRET: CONFIGURED.AZURE_CLIENT_SECRET
    })
    expect(credentialsOnly.signed).toBe('no')
    expect(credentialsOnly.args).toEqual([])
    expect(credentialsOnly.error).toContain('TRUSTED_SIGNING_PUBLISHER')
    expect(credentialsOnly.error).toContain('TRUSTED_SIGNING_ENDPOINT')
    expect(credentialsOnly.warning, 'a refused configuration must not also read as unsigned').toBeNull()
  })

  it('treats an empty value as absent, because that is how an unset variable arrives', () => {
    // An unset GitHub variable or secret is an empty string, not a missing key: a check that
    // asked whether the key was there would read a configured identity where there is none.
    const empty = plan(Object.fromEntries(Object.entries(CONFIGURED).map(([key]) => [key, ''])))
    expect(empty.signed).toBe('no')
    expect(empty.warning).toContain('unsigned')
    expect(empty.error).toBeNull()
  })

  it('prints the plan as the one JSON object the packaging job parses', () => {
    expect(run(CONFIGURED)).toEqual(plan(CONFIGURED))
    const unsigned = run({ PATH: process.env.PATH ?? '' })
    expect(unsigned).toEqual(plan({}))
  })

  it('asks for the three credentials electron-builder admits, and no others', () => {
    // `EnvironmentCredential` is the only chain 26.8.1 will take (electron-builder#9623): a
    // federated or `az login` session is refused before the signer is ever called, so a
    // fourth variable here would promise an identity this pipeline cannot use.
    expect([...CREDENTIALS].sort()).toEqual(['AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET', 'AZURE_TENANT_ID'])
    expect(Object.values(IDENTIFIERS).sort()).toEqual([
      'certificateProfileName',
      'codeSigningAccountName',
      'endpoint',
      'publisherName'
    ])
  })
})
