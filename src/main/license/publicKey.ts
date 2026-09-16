/**
 * The keys every shipped build verifies license keys against.
 *
 * The private halves never leave the issuer's machine: they are not in this repository,
 * not in a build, and not on any show computer. Rotating a key means adding the new one
 * here — the old one stays until the last key sold with it has run out, because a key
 * that verified last week has to keep verifying.
 *
 * The pair this key came from was minted with `npm run license:keygen`; the private half
 * is at `~/.cuerunner/license-private.pem` on the issuer's machine, and nothing about it is
 * recoverable from this file.
 */
export const PRODUCT_PUBLIC_KEYS: string[] = [
  `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA5AmN9UUO1pM+d0uje2X8v19lJYYqRSCoEsFsYxKVOlE=
-----END PUBLIC KEY-----
`
]