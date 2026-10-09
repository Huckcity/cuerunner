// The test certificate is built by hand in DER, and OpenSSL refuses one whose serial is not
// minimally encoded — a refusal that surfaced one CI run in a few hundred, whenever the hashed
// serial happened to start with a zero byte.
import { describe, expect, it } from 'vitest'
import { X509Certificate } from 'node:crypto'
import { integer, makeTestCertificate } from './testCertificate'

const hex = (bytes: Buffer): string => bytes.toString('hex')

describe('the test certificate', () => {
  it('writes an integer in its shortest form', () => {
    expect(hex(integer(Buffer.from([0x12])))).toBe('020112')
    // A leading zero the next byte does not need is dropped, however many there are.
    expect(hex(integer(Buffer.from([0x00, 0x12])))).toBe('020112')
    expect(hex(integer(Buffer.from([0x00, 0x00, 0x00, 0x7f])))).toBe('02017f')
    // A zero that keeps a top bit from reading as a sign stays, and one is added where needed.
    expect(hex(integer(Buffer.from([0x00, 0x80])))).toBe('02020080')
    expect(hex(integer(Buffer.from([0x00, 0x00, 0x80])))).toBe('02020080')
    expect(hex(integer(Buffer.from([0x80])))).toBe('02020080')
    expect(hex(integer(Buffer.from([0x00])))).toBe('020100')
  })

  it('is a certificate OpenSSL reads', () => {
    const certificate = makeTestCertificate('not-a-receiver')
    expect(new X509Certificate(certificate.cert).subject).toBe('CN=not-a-receiver')
  })
})
