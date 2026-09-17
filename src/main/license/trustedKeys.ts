import { PRODUCT_PUBLIC_KEYS } from './publicKey'

/**
 * Which public keys this process verifies licenses against.
 *
 * A packaged build trusts what it was built with and nothing else, so a shipped installer
 * cannot be talked into trusting a key its owner minted. Development and the E2E suite do
 * need that ability — the private half of the product key is deliberately not in the
 * repository, so a test that wants to unlock something has to bring a key of its own —
 * and the door is shut by `isPackaged`, which is false only for a build run out of a
 * source tree. There is no supported way to set this in a package a user has installed.
 */
export function trustedPublicKeys(isPackaged: boolean, env: NodeJS.ProcessEnv): string[] {
  const override = env['CUERUNNER_LICENSE_PUBLIC_KEY']
  return !isPackaged && override ? [override] : PRODUCT_PUBLIC_KEYS
}