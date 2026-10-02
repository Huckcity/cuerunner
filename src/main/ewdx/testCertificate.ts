import { createHash, generateKeyPairSync, sign } from 'node:crypto'

// A self-signed certificate for the fake receiver to present, made when a test asks for one.
// A real receiver's certificate is a chain nothing trusts, and the pin has to be tested
// against exactly that — but the key behind one has no business in the repository, even a
// throwaway, so there is none: each call makes a fresh key and signs its own certificate.
//
// X.509 is a small, rigid DER structure, and a certificate that Node's TLS will present needs
// only the fields below, so this writes them rather than carrying a dependency for it. TEST
// ONLY: nothing here is used by the app.

/** DER's definite length: one byte under 128, otherwise the byte count and then the bytes. */
function length(size: number): Buffer {
  if (size < 0x80) return Buffer.from([size])
  const bytes: number[] = []
  for (let rest = size; rest > 0; rest = Math.floor(rest / 256)) bytes.unshift(rest % 256)
  return Buffer.from([0x80 | bytes.length, ...bytes])
}

function der(tag: number, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts)
  return Buffer.concat([Buffer.from([tag]), length(body.length), body])
}

/** A positive INTEGER: DER reads a leading 1 bit as a sign, so one is padded with a zero byte. */
function integer(bytes: Buffer): Buffer {
  return der(0x02, bytes[0] & 0x80 ? Buffer.concat([Buffer.from([0]), bytes]) : bytes)
}

/** ecdsa-with-SHA256, 1.2.840.10045.4.3.2: what the certificate is signed with. */
const SIGNATURE_ALGORITHM = der(0x30, der(0x06, Buffer.from('2a8648ce3d040302', 'hex')))

/** commonName, 2.5.4.3, in a one-attribute distinguished name. */
function name(commonName: string): Buffer {
  return der(0x30, der(0x31, der(0x30, der(0x06, Buffer.from('550403', 'hex')), der(0x0c, Buffer.from(commonName)))))
}

/**
 * RFC 5280's rule for a date: UTCTime up to 2049 and GeneralizedTime from 2050. Node's own
 * OpenSSL forgives a certificate that mixes them up and Electron's BoringSSL does not, and
 * the app's side of the handshake is Electron's.
 */
function time(date: Date): Buffer {
  const iso = date.toISOString().replace(/[-:]|\.\d{3}/g, '') // YYYYMMDDTHHMMSSZ
  const stamp = iso.replace('T', '')
  return date.getUTCFullYear() < 2050
    ? der(0x17, Buffer.from(stamp.slice(2)))
    : der(0x18, Buffer.from(stamp))
}

function pem(label: string, body: Buffer): string {
  const lines = body.toString('base64').match(/.{1,64}/g) ?? []
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`
}

export interface TestCertificate {
  key: string
  cert: string
  /** SHA-256 of the certificate, colon-separated, as Node's own `fingerprint256` reads. */
  fingerprint: string
}

export function makeTestCertificate(commonName: string): TestCertificate {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const now = new Date()
  const until = new Date(now.getTime() + 100 * 365 * 24 * 3600 * 1000)
  const subject = name(commonName)

  const tbs = der(
    0x30,
    der(0xa0, der(0x02, Buffer.from([2]))), // version 3
    integer(Buffer.from(createHash('sha256').update(commonName + now.getTime()).digest().subarray(0, 16))),
    SIGNATURE_ALGORITHM,
    subject, // issuer: self-signed
    der(0x30, time(now), time(until)),
    subject,
    publicKey.export({ type: 'spki', format: 'der' })
  )
  const signature = sign('sha256', tbs, privateKey)
  const certificate = der(0x30, tbs, SIGNATURE_ALGORITHM, der(0x03, Buffer.concat([Buffer.from([0]), signature])))

  const fingerprint = (createHash('sha256').update(certificate).digest('hex').toUpperCase().match(/../g) ?? []).join(':')
  return {
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    cert: pem('CERTIFICATE', certificate),
    fingerprint
  }
}
